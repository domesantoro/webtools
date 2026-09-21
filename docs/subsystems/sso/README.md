# Sottosistema `sso`

> Documentazione di riferimento per sviluppo, manutenzione, troubleshooting, bugfix e metriche.
> Ultimo aggiornamento: 2026-09-21 · versione del sottosistema: `0.3.0`.
> Codice: `webtools/sso/` (percorsi relativi alla root del workspace `ftab - webtools/`).

---

## 0. Scheda rapida

| Voce | Valore |
|---|---|
| Cosa fa | Autentica: **login**, **stato della sessione**, **logout**. Tre rotte per i programmi, tre pagine per le persone |
| Stack | Node 23 · modulo `node:http` · **nunjucks** per le pagine (unica dipendenza) |
| Codice | `webtools/sso/` |
| Avvio (background, slegato dal terminale) | `webtools/sso/webtools_sso.sh --start` |
| Arresto | `webtools/sso/webtools_sso.sh --stop` |
| Processo | `…/node …/webtools/sso/src/index.js` |
| PID / Log | `webtools/sso/webtools_sso.pid` / `webtools/sso/webtools_sso.log` |
| Indirizzo | `http://127.0.0.1:8300` |
| Dipende da | `webtools_anagraphics` su `http://127.0.0.1:8100` (deve essere acceso) |
| Database | Nessuno: utenti, sessioni e biglietti stanno in anagraphics |
| Accesso | Solo dagli IP in `ALLOWED_IPS` (default: localhost); gli altri ricevono `403` |
| Client per i sottosistemi | `webtools/commons/sso/`: `sso_client.js` per il server, `sso_popup.js` per il browser. Distribuiti da `webtools/configurator/sso_deployer/deploy.sh` |
| Test | `npm test` (31 test, non serve nessun server acceso) |
| Stato | Login con username e password, sessioni a token, pagine di accesso. Nessun ruolo, nessun permesso, registrazione non attiva |

Prova veloce, con anagraphics e sso accesi:
```sh
# dal browser
open "http://127.0.0.1:8300/ui/login?next=http://127.0.0.1:8200/"

# da riga di comando
curl -s -X POST http://127.0.0.1:8300/login -H 'content-type: application/json' \
  -d '{"username":"driver.prova@example.com","password":"<password>"}'
```

---

## 1. Scopo e ruolo nel sistema

Nel flusso del progetto (`contesto/02. contesto_aggiornato.md`) più sottosistemi hanno bisogno di sapere **chi sta chiedendo**: oggi `preanalyst`, domani l'interfaccia del driver e la dashboard. Il sso è il posto unico dove si risponde a quella domanda, e l'unico posto del sistema dove si digita una password.

### 1.1 Perché serve un cookie, e perché serve un biglietto

Queste due cose sono il cuore del sottosistema. Chi le ha chiare capisce tutto il resto.

**Il web non ha memoria.** Ogni richiesta che un browser fa a un server è slegata dalla precedente: se ti sei appena loggato e chiedi un'altra pagina, il server non ha nessun modo di sapere che sei tu. Serve quindi qualcosa che il browser riporti indietro da solo, ogni volta. Le possibilità sono tre: il **cookie** (il server dice al browser «tieni questa stringa e rimandamela sempre», e il browser lo fa da sé, senza JavaScript); il token **dentro l'indirizzo**, che però finisce nella cronologia, nei log dei proxy e nei link che la gente si passa; il **JavaScript** nella pagina, che qui non c'è per scelta, perché le pagine arrivano già fatte dal server. Resta il cookie.

**Un cookie appartiene a un indirizzo solo.** Il sso sta su `127.0.0.1:8300`, preanalyst su `127.0.0.1:8200`: il sso non può mettere un cookie per conto di preanalyst. Ma allora, dopo il login, come fa preanalyst a sapere chi sei?

Con un **biglietto**: uno scontrino fatto apposta per viaggiare nell'indirizzo, perché vale **una volta sola** e per **un minuto**.

```text
browser                     sso (8300)              preanalyst (8200)        anagraphics (8100)
   │                           │                          │                        │
   │ 1. "Entra" ──────────────►│                          │                        │
   │ 2. username + password ──►│  verifica ───────────────────────────────────────►│
   │                           │  crea la sessione ───────────────────────────────►│
   │◄─ 3. cookie del sso ──────│  crea il biglietto ──────────────────────────────►│
   │   + "torna là col biglietto"                         │                        │
   │                           │                          │                        │
   │ 4. GET /?ticket=… ───────────────────────────────────►│                       │
   │                           │◄─ 5. scambio (server a server) ──┤                │
   │                           │   il biglietto viene consumato ──────────────────►│
   │◄─ 6. cookie di preanalyst ───────────────────────────┤                        │
   │                           │                          │                        │
   │ 7. ogni richiesta porta il cookie ───────────────────►│ "chi è?" ──►│ sso      │
```

Il token della sessione, che dura ore, **non passa mai dall'indirizzo**: ci passa solo il biglietto, che quando qualcuno lo legge in un log è già stato consumato.

**Il cookie del sso** (passo 3) è la parte *single* del single sign-on: quando il secondo sottosistema manderà qui lo stesso browser, il sso lo riconoscerà e non chiederà di nuovo la password — emetterà solo un altro biglietto.

### 1.2 Che cosa non fa

Non gestisce ruoli o permessi (dice chi sei, non che cosa puoi fare), non registra nuovi utenti, non manda email, non ha un database.

### 1.3 Rapporto con `anagraphics`

Utenti, credenziali, sessioni e biglietti stanno in `anagraphics`, che li conserva e li restituisce ma non decide niente: non confronta password e non giudica le scadenze. La divisione vale in entrambe le direzioni — **anagraphics è un archivio, il sso è l'autorità**.

---

## 2. Scelte funzionali

| Scelta | Motivo |
|---|---|
| **Una sola pagina di login, qui** | È l'unico posto del sistema in cui si digita una password: uno da guardare, uno da cambiare. Se ogni sottosistema avesse la sua, non sarebbe un *single* sign-on ma N login separati. |
| **Le sessioni stanno in Mongo, non in memoria** | Una mappa dentro il processo muore al riavvio e non esiste per un secondo processo: metà delle richieste direbbe "non loggato". La sessione è un dato condiviso, e i dati condivisi stanno nell'archivio. |
| **Il biglietto invece del token nell'indirizzo** | Vedi §1.1. Un token che dura otto ore non si lascia nella cronologia del browser; un biglietto che vale un minuto e una volta sola, sì. |
| **Ogni sottosistema ha il **suo** cookie** | Non si conta sul fatto che i cookie ignorino la porta — cosa vera, che su `127.0.0.1` farebbe sembrare tutto funzionante. Il giorno che i sottosistemi stanno su indirizzi diversi, il giro dei biglietti funziona già uguale. |
| **Nomi dei cookie diversi tra sottosistemi** | Conseguenza della stessa regola: siccome la porta non conta, su `127.0.0.1` i cookie finiscono tutti nello stesso mucchio e due con lo stesso nome si sovrascriverebbero. Il sso usa `webtools_sso`, preanalyst `webtools_preanalyst`. |
| **`next` solo verso indirizzi ammessi** | Chi manda qui il browser dice anche dove tornare. Senza un elenco, chiunque potrebbe costruire `…/ui/login?next=http://sito-finto` e usare la nostra pagina di login come trampolino. |
| **Token opaco, 32 byte casuali** | Non contiene informazioni: non si legge e non si fabbrica. Il prezzo è una lettura a ogni `GET /session`; il vantaggio è che il logout ha effetto immediato, cosa che con un JWT autoconsistente non si ottiene. |
| **Scadenza fissa dal login, senza prolungamenti** | 8 ore (`SESSION_TTL_SECONDS`). Regola prevedibile, e nessuna scrittura a ogni lettura. |
| **Tutti i modi di non entrare danno la stessa risposta** | Utente sconosciuto, disattivato, senza password, password sbagliata: sempre `401 INVALID_CREDENTIALS`. Distinguerli direbbe a chi prova se un indirizzo è registrato. Il motivo vero resta nel log (§7). |
| **Token sconosciuto: `200 {"logged": false}`, non un errore** | "Questo token vale?" è una domanda legittima, e "no" è una risposta. Gli errori restano per i guasti veri. |
| **Con anagraphics giù si risponde `503`, mai `logged: false`** | Se l'archivio non risponde non sappiamo se la sessione vale. Dire "non loggato" butterebbe fuori tutti a ogni guasto di Mongo. |
| **"Esci" esce da tutto** | Chiude la sessione condivisa: da quel momento nessun sottosistema riconosce più quel token. È quello che una persona si aspetta, ed è l'unico modo di uscire davvero da un computer condiviso. |
| **La fotografia dell'utente sta dentro la sessione** | `screen_name` e `driver_uid` si copiano nella sessione al login, così `GET /session` costa una lettura sola. Il prezzo: un cambio di `screen_name` si vede al login successivo. Stesso compromesso del driver dentro i codici sconto. |
| **Nessuna dipendenza** | `node:http` e `node:crypto` bastano. Ogni dipendenza in più, in un sottosistema che tratta password, è una superficie in più da tenere d'occhio. |

---

## 3. Scelte tecnologiche

- **Node**, perché è la spina dorsale della piattaforma e il sso è I/O e poco altro.
- **scrypt** dalla libreria standard: niente dipendenze per la parte crittografica, e lo stesso identico calcolo che fa Python quando la password viene impostata (`docs/subsystems/anagraphics/README.md` §5.5).
- **`crypto.timingSafeEqual`** per il confronto finale: la durata della risposta non deve dire quanti byte dell'hash erano giusti.
- **nunjucks** per le pagine, con `autoescape: true`. I template stanno in `templates/`; il guscio comune (`templates/commons/base.njk`) arriva dal deployer, come `commons.css`. `trimBlocks` è **spento**: acceso, insieme ai `{%-` dei template, ridurrebbe la pagina a poche righe lunghissime.

---

## 4. Architettura

### 4.1 Mappa dei file

| File | Responsabilità |
|---|---|
| `src/index.js` | Avvio: impostazioni, ascolto, riga di conferma, chiusura su SIGTERM/SIGINT |
| `src/settings.js` | Variabili d'ambiente, default, e `safeNext()` che valida l'indirizzo di ritorno |
| `src/server.js` | HTTP: pool di IP, rotte, cookie, corpo delle richieste, file statici |
| `src/auth.js` | Le operazioni: `login`, `readSession`, `logout`, `issueTicket`, `exchangeTicket` |
| `src/sessions.js` | Il documento di sessione: token, date, scadenza |
| `src/tickets.js` | Il biglietto: come si costruisce, quando scade, come si aggiunge all'indirizzo |
| `src/credentials.js` | Verifica della password contro il blocco `credential` |
| `src/page.js` | Quali dati vanno a ogni pagina. Niente HTML: configura nunjucks e chiama i template |
| `templates/login.njk`, `templates/register.njk` | Le due pagine |
| `templates/commons/base.njk` | Guscio e testata comuni: **copia generata** dal deployer dei template |
| `src/anagraphics.js` | Client HTTP verso anagraphics |
| `public/` | `styles.css` locale, `assets/mark.svg`; `commons.css` e `fonts/` sono **copie generate** dal deployer dello stile |
| `tests/*.test.js` | Test con `node --test` (§9) |
| `webtools_sso.sh` | Avvio e arresto con file PID verificato |

### 4.2 Percorso di un login dalle pagine

```text
GET /ui/login?next=…
  ├─ next fuori dagli indirizzi ammessi → si usa il primo ammesso, e finisce nel log
  ├─ cookie del sso presente e sessione valida
  │     └─ emette il biglietto ────────────────► 303 verso next?ticket=…
  └─ altrimenti ──────────────────────────────► 200 la pagina con il form

POST /ui/login  (username, password, next)
  ├─ campi vuoti ─────────────────────────────► 400 la pagina, con l'avviso
  ├─ credenziali rifiutate ───────────────────► 401 la pagina, con l'avviso
  ├─ anagraphics giù ─────────────────────────► 503 la pagina, con l'avviso
  └─ ok: crea la sessione, mette il cookie del sso, emette il biglietto
        └───────────────────────────────────── ► 303 verso next?ticket=…
```

### 4.3 Percorso dello scambio

```text
POST /tickets/exchange  { ticket, service }     ← lo chiama il sottosistema, non il browser
  ├─ biglietto sconosciuto o già usato ───────► 404 TICKET_NOT_FOUND
  ├─ biglietto scaduto ───────────────────────► 400 TICKET_EXPIRED
  ├─ emesso per un altro sottosistema ────────► 403 TICKET_MISMATCH
  ├─ sessione chiusa nel frattempo ───────────► 200 { logged: false }
  └─ ────────────────────────────────────────► 200 { logged: true, session }
```

Il biglietto viene cancellato da anagraphics **nel momento in cui viene letto**, quindi il secondo che prova trova 404 anche se arriva un millisecondo dopo.

### 4.4 Percorso di una lettura di sessione

```text
GET /session  Authorization: Bearer <token>
  ├─ header assente o malformato ─────────────► 400 MISSING_TOKEN
  ├─ token sconosciuto ───────────────────────► 200 { logged: false }
  ├─ scadenza passata o illeggibile ──────────► 200 { logged: false }
  ├─ anagraphics giù ─────────────────────────► 503 ANAGRAPHICS_UNAVAILABLE
  └─ ────────────────────────────────────────► 200 { logged: true, session }
```

La sessione scaduta non viene cancellata dal sso: la toglie l'indice TTL di anagraphics. Una cancellazione a ogni lettura sarebbe una scrittura per niente.

---

## 5. Riferimento API

URL base: `http://127.0.0.1:8300`. Le risposte JSON hanno `Cache-Control: no-store`.

### 5.1 Formato degli errori (contratto)

Le rotte JSON seguono il contratto del progetto: stato HTTP corretto e **codice stabile**, `{"error": "<CODICE>"}`. Le pagine invece parlano alle persone, quindi rispondono con HTML anche quando qualcosa va storto.

| Stato | `error` | Quando |
|---|---|---|
| `400` | `INVALID_BODY` | Corpo di `/login` o `/tickets/exchange` assente, non JSON, o campi mancanti |
| `400` | `MISSING_TOKEN` | Manca `Authorization: Bearer <token>` su `/session` o `/logout` |
| `400` | `TICKET_EXPIRED` | Biglietto presentato oltre il minuto |
| `401` | `INVALID_CREDENTIALS` | Login rifiutato, per uno qualsiasi dei quattro motivi (§2) |
| `403` | `IP_NOT_ALLOWED` | IP del chiamante fuori da `ALLOWED_IPS` |
| `403` | `TICKET_MISMATCH` | Biglietto emesso per un sottosistema, presentato da un altro |
| `404` | `TICKET_NOT_FOUND` | Biglietto sconosciuto o già consumato |
| `404` | `ROUTE_NOT_FOUND` | URL inesistente |
| `405` | `METHOD_NOT_ALLOWED` | Metodo sbagliato su una rotta esistente |
| `503` | `ANAGRAPHICS_UNAVAILABLE` | anagraphics irraggiungibile, in errore, o che risponde in modo inatteso |
| `500` | `INTERNAL_ERROR` | Qualsiasi altro errore imprevisto; lo stack è nel log |

### 5.2 Rotte per i programmi

| Rotta | Corpo / header | Risposta |
|---|---|---|
| `POST /login` | `{"username","password"}` | `201 {"logged":true,"session":{…}}` · `401` · `400` · `503` |
| `GET /session` | `Authorization: Bearer <token>` | `200 {"logged":true,"session":{…}}` · `200 {"logged":false}` · `400` · `503` |
| `POST /logout` | `Authorization: Bearer <token>` | `200 {"logged":false}`, ripetibile · `400` · `503` |
| `POST /tickets/exchange` | `{"ticket","service"}` | `200 {"logged":…,"session"?}` · `400` · `403` · `404` · `503` |

`service` è l'indirizzo del sottosistema che scambia, es. `http://127.0.0.1:8200`: deve combaciare con quello per cui il biglietto è stato emesso.

Login ripetuti aprono **sessioni diverse**, tutte valide: chiuderne una non tocca le altre.

### 5.3 Pagine per le persone

| Rotta | Che cosa fa |
|---|---|
| `GET /ui/login?next=…` | La pagina con username e password. Se il browser ha già il cookie del sso, non chiede niente: emette il biglietto e torna al `next` |
| `POST /ui/login` | Il form di sopra (`username`, `password`, `next`) |
| `GET /ui/logout?next=…` | Chiude la sessione condivisa, toglie il cookie del sso, torna al `next` |
| `GET /ui/register?next=…` | La registrazione, che non è ancora attiva: la pagina lo dice |

`next` deve cominciare con uno degli indirizzi in `ALLOWED_NEXT`, altrimenti viene sostituito con il primo della lista (e la cosa finisce nel log).

I file statici delle pagine (`commons.css`, `styles.css`, `assets/`, `fonts/`) si servono dalla radice.

### 5.4 L'oggetto `session`

È lo stesso documento conservato in anagraphics (`docs/subsystems/anagraphics/README.md` §5.6), senza traduzioni:

```json
{
  "token": "T4yS…43 caratteri…",
  "uid": "8ff93901-673e-44ba-b05b-56011395dcba",
  "username": "dome.santoro@gmail.com",
  "issued_at": "2026-09-21T10:00:00.000Z",
  "expires_at": "2026-09-21T18:00:00.000Z",
  "data": { "screen_name": "Dome", "driver_uid": "7633be3d-e701-42ca-9fea-6c6d1bb4b7d1" }
}
```

### 5.5 Per chi consuma: usare il client condiviso

Un sottosistema non dovrebbe scrivere a mano né il cookie né lo scambio del biglietto. Il client condiviso ha due metà, tutte e due distribuite dal deployer (§8):

- **`sso_client.js`**, lato server: `currentSession`, `claimTicket`, `loginUrl`, `logoutUrl`, `registerUrl`, `sessionCookie`, `clearSessionCookie`, `ticketFrom`, `urlWithoutTicket`.
- **`sso_popup.js`**, lato browser: apre il login in una finestra, la chiude quando ha finito e fa aggiornare alla pagina di partenza i pezzi che dipendono da chi è entrato, senza ricaricarla. Il sottosistema deve servire due cose: una pagina di ritorno con il marcatore `data-sso-login-done` (dove va il `next`) e un `GET /session-fragment` che restituisca quei pezzi già resi.

L'integrazione di preanalyst è l'esempio di riferimento: `docs/subsystems/preanalyst/README.md` §6.

---

## 6. Configurazione (variabili d'ambiente)

| Variabile | Default | Note |
|---|---|---|
| `HOST` | `127.0.0.1` | Interfaccia di ascolto |
| `PORT` | `8300` | — |
| `ALLOWED_IPS` | `127.0.0.1,::1` | Vale l'IP della connessione; `::ffff:127.0.0.1` è riconosciuto come `127.0.0.1` |
| `ANAGRAPHICS_URL` | `http://127.0.0.1:8100` | — |
| `ANAGRAPHICS_TIMEOUT_MS` | `5000` | anagraphics aspetta fino a 30 s se Mongo non risponde: qui si taglia prima |
| `SESSION_TTL_SECONDS` | `28800` (8 ore) | Durata di una sessione dal login |
| `TICKET_TTL_SECONDS` | `60` | Durata di un biglietto: il tempo di un redirect |
| `COOKIE_NAME` | `webtools_sso` | Deve restare diverso dai cookie dei sottosistemi |
| `ALLOWED_NEXT` | `http://127.0.0.1:8200,http://localhost:8200` | Dove si può rimandare il browser dopo il login |

Si passano allo script di avvio: `PORT=8301 webtools/sso/webtools_sso.sh --start`.

**Quando si aggiunge un sottosistema con login** servono tre cose: il suo indirizzo in `ALLOWED_NEXT`, un nome di cookie tutto suo, e una riga nel deployer del client (§8).

---

## 7. Log

Una riga per evento, sul log del processo (`webtools_sso.log`).

| Riga | Significato |
|---|---|
| `[sso] login di <username> (uid …)` | Login riuscito |
| `[sso] login rifiutato: utente sconosciuto / disattivato / CREDENTIAL_NOT_SET / password sbagliata` | I quattro motivi, distinti **solo qui** |
| `[sso] sessione non creata per …` | `POST /sessions` fallito |
| `[sso] biglietto non emesso per <service>` | `POST /tickets` fallito |
| `[sso] biglietto non valido / scaduto presentato da <service>` | Scambio rifiutato |
| `[sso] biglietto emesso per X, presentato da Y` | Biglietto di un altro sottosistema |
| `[sso] next fuori dagli indirizzi ammessi, ignorato: …` | Qualcuno ha provato a farci rimandare il browser altrove |
| `[sso] logout senza archivio: la sessione resta aperta fino alla scadenza` | Logout con anagraphics giù |
| `[sso] richiesta da IP fuori dal pool: <ip>` | Filtro sugli IP |
| `[anagraphics] …` / `[credentials] …` | Guasti dell'archivio, blocchi `credential` malfatti |

Nel log non finiscono mai password né token. Gli username sì: senza, un tentativo di accesso non si capisce.

---

## 8. Comandi operativi

```sh
webtools/sso/webtools_sso.sh --start   # avvia in background
webtools/sso/webtools_sso.sh --stop    # ferma
npm start                              # in primo piano, per debug (da webtools/sso/)
npm test                               # i test
```

Lo script è il gemello di quelli di `anagraphics` e `preanalyst`: `nohup`, PID in `webtools_sso.pid`, e `--stop` che ferma **solo** il processo indicato dal file PID, dopo averne verificato la riga di comando. Mai per nome, mai per porta: su questa macchina girano altri progetti. Prima di provare, controllare se c'è già un'istanza attiva dell'utente e non toccarla.

Lo stile delle pagine e il client per i sottosistemi si distribuiscono con il deployer generale:

```sh
webtools/configurator/deploy.sh          # stile + client del sso
webtools/configurator/deploy.sh sso      # solo il client del sso
```

Le password si impostano da anagraphics (`docs/subsystems/anagraphics/README.md` §8.5).

---

## 9. Test

`npm test` (cioè `node --test "tests/*.test.js"`): **31 test**, nessun server da accendere.

| File | Che cosa copre |
|---|---|
| `tests/api.test.js` | Rotte e pagine su un server vero in ascolto su una porta libera, con un **anagraphics finto**: giro completo login→stato→logout, sessioni multiple, i quattro rifiuti, corpi non validi, token mancante, sessione scaduta, archivio giù, pool di IP; e per le pagine: form, `next` non ammesso, giro completo con biglietto e cookie, chi è già entrato che non ridigita la password, biglietto di un altro sottosistema, password sbagliata, "esci" che chiude davvero la sessione, registrazione non attiva |
| `tests/tickets.test.js` | Il biglietto: lunghezza e unicità, contenuto, scadenza, `service`, aggiunta all'indirizzo senza perdere i parametri già presenti |
| `tests/credentials.test.js` | La verifica della password, **con un hash prodotto davvero da Python**: se i due scrypt smettessero di calcolare la stessa cosa, fallisce qui invece che in un login. Più i blocchi `credential` malfatti |
| `tests/sessions.test.js` | Token, contenuto della sessione, scadenza compreso il caso della data illeggibile |

L'archivio finto è una mappa in `tests/api.test.js` e risponde come anagraphics, guasti compresi (`broken: true`), biglietti compresi (consumo atomico). I test verificano anche che la sessione **finisca nell'archivio** e non resti dentro il sso.

Verificato a mano il 2026-09-21, con anagraphics, sso e preanalyst veri su porte temporanee: pagina da sloggato, login dalla pagina del sso, ritorno con biglietto, cookie di preanalyst, pagina da loggato col nome in testata, "Esci" che toglie i due cookie e cancella la sessione da Mongo.

---

## 10. Troubleshooting

| Sintomo | Causa probabile | Verifica / rimedio |
|---|---|---|
| Ogni chiamata risponde `503 ANAGRAPHICS_UNAVAILABLE` | anagraphics spento o su un'altra porta | `curl http://127.0.0.1:8100/drivers`; controllare `ANAGRAPHICS_URL`; il log ha la riga `[anagraphics] …` |
| `401` anche con la password giusta | Password mai impostata, o utente `active: false` | Il log dice quale dei due |
| Dopo il login il browser torna al posto sbagliato | `next` non è in `ALLOWED_NEXT`, quindi è stato sostituito | Il log ha `next fuori dagli indirizzi ammessi`; aggiungere l'indirizzo |
| Il ritorno dal login non logga nessuno | Biglietto scaduto (più di un minuto), già usato, o `service` che non combacia | Il log del sso dice quale dei tre |
| Si entra in un sottosistema e si esce da un altro | Due sottosistemi con lo **stesso nome di cookie**: i cookie ignorano la porta, quindi si sovrascrivono | Dare a ciascuno il suo `COOKIE_NAME` |
| `400 MISSING_TOKEN` con il token in mano | Header scritto male: ci vuole `Authorization: Bearer <token>`, un solo spazio | — |
| Le pagine si vedono senza stile | `commons.css` non è mai stato copiato in `webtools/sso/public/` | `webtools/configurator/deploy.sh style` |
| `template not found: commons/base.njk` | Il deployer dei template non è mai stato lanciato | `webtools/configurator/deploy.sh template` |
| `Cannot find package 'nunjucks'` | Dipendenze non installate | `npm install` in `webtools/sso/` |
| `npm test` fallisce solo su `credentials.test.js` | Il formato del blocco `credential` è cambiato da una parte sola | Rigenerare l'hash di prova con `webtools_anagraphics/credentials.py` e allineare le due implementazioni |

---

## 11. Limiti noti e debito tecnico

- **Nessun limite ai tentativi di login**: niente rate limiting, niente blocco dopo N errori, nessun ritardo.
- **Un utente sconosciuto risponde più in fretta** di uno con la password sbagliata, perché scrypt non viene nemmeno lanciato: misurando i tempi si può capire se un indirizzo è registrato. Si risolve calcolando comunque un hash finto.
- **Nessun TLS**: password, cookie e biglietti viaggiano in chiaro sulla loopback. Fuori da questa macchina non è accettabile, e ai cookie va aggiunto `Secure`.
- **Nessuna autenticazione tra servizi**: chi è nel pool di IP può leggere gli hash da anagraphics, creare sessioni per qualsiasi `uid` e dichiarare qualsiasi `service` allo scambio. Il controllo su `service` ferma gli errori, non un attacco.
- **Nessuna protezione CSRF sul form di login**: oggi il danno possibile è far entrare qualcuno con un account che chi attacca già conosce. Va messa quando le pagine saranno raggiungibili da fuori.
- **Nessun ruolo e nessun permesso**: il sso dice chi sei, non che cosa puoi fare.
- **Nessuna registrazione, nessun recupero password, nessuna scadenza delle password.**
- **Nessun prolungamento della sessione con l'uso**: alle 8 ore si rifà il login.
- **Logout con anagraphics giù**: i cookie vengono tolti, ma la sessione resta viva fino alla scadenza. Sta nel log, non è nascosto.
- **Il pool di IP è uno solo** per le rotte dei programmi e per le pagine, che invece sono destinate ai browser delle persone: il giorno che le pagine escono da localhost, i due elenchi vanno separati.
- **Nessun endpoint per chiudere tutte le sessioni di un utente**: in anagraphics c'è (`DELETE /sessions?uid=…`), il sso non lo espone.
- **Nessun `/health`, nessuna metrica**, log senza rotazione, nessun avvio automatico dopo un riavvio del Mac.
- **I campi e gli avvisi delle pagine sono ricopiati** da preanalyst (`public/styles.css`): `commons.css` non contiene gli stili dei form. Al terzo sottosistema con un form vanno spostati in commons.
- `node_modules/` non è gestito da nessuno script: dopo un clone o un cambio di versione serve `npm install` a mano.

---

## 12. Come estendere (checklist)

**Aggiungere un sottosistema con login**
1. Il suo indirizzo in `ALLOWED_NEXT` (§6).
2. Un nome di cookie tutto suo (§2).
3. Una funzione in `webtools/configurator/sso_deployer/deploy.sh` che gli copi `sso_client.js`.
4. Nel suo server: `currentSession` su ogni pagina, una rotta di ritorno (`/login-done`) che fa `claimTicket` e mette il cookie, un `GET /session-fragment` per l'aggiornamento senza ricarica, e una rotta di logout che toglie il cookie e manda a `/ui/logout`.
5. Nelle sue pagine: `sso_popup.js`, i marcatori `data-sso-login` sui link e `data-sso-header` / `data-sso-gate` sui contenitori da aggiornare.

**Aggiungere un dato alla sessione**
Va dentro `data`, in `buildSession` (`src/sessions.js`). Non servono modifiche ad anagraphics: `data` è libero. Ricorda che è una fotografia scattata al login (§2).

**Aggiungere una rotta**
Funzione in `src/auth.js` che restituisce `{ok:true, status, body}` o `{ok:false, status, code}`, voce nella mappa `ROUTES` di `src/server.js`, codice d'errore nuovo documentato in §5.1, test in `tests/api.test.js` compreso il caso "archivio giù".

**Cambiare l'algoritmo delle password**
Il formato è nel documento, non nel codice (`params`). Si aggiunge il nuovo algoritmo in `src/credentials.js` **tenendo** il vecchio, si cambia `webtools_anagraphics/credentials.py` per generare il nuovo, e le password si convertono al primo login riuscito o si reimpostano.

---

## 13. Changelog

| Data | Versione | Modifica |
|---|---|---|
| 2026-09-21 | 0.3.0 | L'HTML esce dal JavaScript: pagine in `templates/*.njk` rese con **nunjucks** (autoescape), guscio comune in `commons/templates/base.njk` distribuito dal nuovo `template_deployer`. Corretti i percorsi dei fogli di stile, che erano relativi e sotto `/ui/` puntavano a file inesistenti. Prima dipendenza npm del sottosistema. |
| 2026-09-21 | 0.2.0 | Le pagine: `GET/POST /ui/login`, `GET /ui/logout`, `GET /ui/register`. Cookie del sso, biglietti usa-e-getta (`POST /tickets/exchange`) e `ALLOWED_NEXT` per non fare da trampolino. Il client condiviso `commons/sso/sso_client.js` e il suo deployer. Stile delle pagine da `commons.css`. Test da 17 a 31. |
| 2026-09-21 | 0.1.0 | Creazione: `POST /login`, `GET /session`, `POST /logout`. Sessioni persistenti in `anagraphics`, token opaco da 32 byte, password scrypt verificate qui e conservate là. Pool di IP su localhost. 17 test con `node --test`. |
