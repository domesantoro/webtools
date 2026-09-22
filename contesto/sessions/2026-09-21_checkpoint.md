# Checkpoint sessione 2026-09-21

Nasce il sottosistema **`sso`**: l'autenticazione del sistema. Con lui, la collection `users` e le
sessioni persistenti in `anagraphics`, il giro dei biglietti per passare una sessione tra
sottosistemi, il client condiviso `commons/sso`, i deployer, e l'accesso dentro `preanalyst`.

Stato di partenza: i checkpoint del 2026-09-19 e del 2026-09-20.

---

## 1. `webtools_anagraphics` — da 0.2.1 a 0.4.0

### 1.1 Collection nuove

| Collection | Chiave | Altri indici | Contenuto |
|---|---|---|---|
| `users` | `username` (univoco) | `uid` (univoco) | `uid`, `username`, `screen_name`, `active`, `driver_uid`, `credential` |
| `sessions` | `token` (univoco) | `uid`, **TTL** su `expires_at` | `token`, `uid`, `username`, `issued_at`, `expires_at`, `data` |
| `tickets` | `ticket` (univoco) | **TTL** su `expires_at` | `ticket`, `token`, `service`, `issued_at`, `expires_at` |

Utenti presenti: `dome.santoro@gmail.com` (`8ff93901-…`, password di sviluppo **`ciao`**) e
`driver.prova@example.com` (`214912a9-…`, password **`prova-poc-2026`**). Tutti e due con
`driver_uid` verso il driver corrispondente.

### 1.2 Endpoint nuovi

`GET /users/{username}` · `GET /users/{username}/credential` · `POST /sessions` ·
`GET /sessions/{token}` · `DELETE /sessions/{token}` · `DELETE /sessions?uid=…` ·
`POST /tickets` · `DELETE /tickets/{ticket}`.

Codici nuovi: `USER_NOT_FOUND`, `CREDENTIAL_NOT_SET`, `SESSION_NOT_FOUND`, `SESSION_EXISTS`,
`TICKET_NOT_FOUND`, `TICKET_EXISTS`, `INVALID_BODY`.

Test da 17 a **33**, verdi.

### 1.3 Decisioni, con il perché

- **Anagraphics conserva, non decide.** Espone le credenziali e le sessioni, ma non confronta
  password e non giudica le scadenze. Indicazione esplicita dell'utente: *«anagraphics può esporre
  servizi utili ad sso, ma non deve fare il suo lavoro»*.
- **Prime scritture** del sottosistema, e solo su sessioni e biglietti: nascono e muoiono di
  continuo, non è roba da `mongosh`.
- **`DELETE /tickets/{ticket}` consuma**: `find_one_and_delete` legge e cancella insieme, quindi
  due richieste con lo stesso biglietto non possono riuscire entrambe.
- **`users.uid` ≠ `drivers.uid`**: l'identità della persona e l'identità del ruolo di driver sono
  due cose diverse (un cliente è utente e non driver). Il legame è esplicito in `driver_uid`.
- **scrypt dalla libreria standard**, parametri dentro il documento: nessuna dipendenza né in
  Python né in Node, e il giorno che si alzano i parametri le password vecchie restano
  verificabili con i propri.
- **`scripts/set_password.py` è stato scritto e poi cancellato**, su richiesta. Impostare una
  password è ora un comando a mano, documentato in `docs/subsystems/anagraphics/README.md` §8.5.

---

## 2. `webtools_sso` — 0.2.0

Node, porta **8300**, nessun database. Tre rotte JSON per i programmi
(`/login`, `/session`, `/logout`, più `/tickets/exchange`) e tre pagine per le persone
(`/ui/login`, `/ui/logout`, `/ui/register`). **31 test** verdi.

### 2.1 La domanda dell'utente, e la risposta

*Il sso deve avere un frontend autonomo, o si inoculano nei sottosistemi delle parti comuni?*

Tutte e due, ma divise così: **la pagina di login sta solo nel sso** — è l'unico posto del sistema
in cui si digita una password, e se ogni sottosistema avesse la sua non sarebbe un *single*
sign-on ma N login separati; il **codice per parlarci** sta in `commons/sso` e ogni sottosistema se
lo porta in casa.

### 2.2 Il giro dei biglietti — fatto subito, non rimandato

Un cookie appartiene a un indirizzo solo: il sso (8300) non può mettere il cookie di preanalyst
(8200). Su questo Mac la cosa si potrebbe aggirare, perché **i cookie ignorano la porta** e un
cookie messo su `127.0.0.1` arriva a tutte le porte — ma smetterebbe di funzionare al primo
deploy su host diversi.

Indicazione dell'utente: *«Perché segnarsi una cosa che poi uno si scorda solo perché OGGI è
gratis?»*. Quindi è stato fatto il giro completo:

1. il sso verifica, crea la sessione, mette il **suo** cookie e crea un **biglietto**;
2. rimanda il browser al sottosistema con `?ticket=…`;
3. il sottosistema lo scambia da server a server e riceve la sessione;
4. si mette il **suo** cookie e toglie il biglietto dall'indirizzo.

Il biglietto vale **un minuto e una volta sola**, quindi può stare in un indirizzo; il token della
sessione, che dura otto ore, non ci passa mai.

### 2.3 Altre decisioni

- **Cookie con nomi diversi** (`webtools_sso`, `webtools_preanalyst`): siccome la porta non conta,
  due cookie omonimi su `127.0.0.1` si sovrascriverebbero. È il classico errore che si manifesta
  come "entro in un posto ed esco da un altro".
- **`ALLOWED_NEXT`**: l'indirizzo di ritorno dopo il login deve essere in un elenco, altrimenti la
  pagina di login diventa un trampolino verso qualsiasi sito.
- **Chi ha già il cookie del sso non ridigita la password**: si emette solo un altro biglietto.
  È la parte *single* del single sign-on.
- **"Esci" esce da tutto** (decisione dell'utente): chiude la sessione condivisa, non solo il
  cookie locale.
- **Registrazione**: link presente, pagina che dice che non è attiva. Il posto è pronto.
- Restano validi i principi della prima versione: un solo `INVALID_CREDENTIALS` per tutti e
  quattro i modi di non entrare, `200 {"logged": false}` per un token sconosciuto, e **`503`
  quando anagraphics è giù**, mai `logged: false`.

---

## 3. `commons/sso` e i deployer

- **`webtools/commons/sso/sso_client.js`**: il client condiviso. `currentSession`, `claimTicket`,
  `loginUrl`/`logoutUrl`/`registerUrl`, i cookie, `ticketFrom`, `urlWithoutTicket`. Un sottosistema
  con login non scrive niente di tutto questo a mano.
- **`webtools/configurator/sso_deployer/deploy.sh`**: lo distribuisce (oggi solo a preanalyst,
  in `src/commons/`). Il sso non lo riceve: lui è il servizio.
- **`webtools/configurator/deploy.sh`**: il deployer generale, che era un file vuoto. Chiama i
  sotto-deployer nell'ordine dichiarato; `./deploy.sh style sso` ne lancia solo alcuni; un nome
  sbagliato esce con 2 e stampa l'elenco. Provato su bash 3.2, che è quello del Mac.
- `deploy_sso` aggiunto anche al deployer dello stile: le pagine del sso usano `commons.css`.
- Documentazione nuova: `webtools/configurator/README.md`.

---

## 4. `webtools_preanalyst` — 0.6.0

- In testata: "Entra" da sloggati, nome e "Esci" da loggati.
- Sotto il bottone d'invio: il riquadro "per proseguire serve un account", con Entra e Registrati.
- `GET /?ticket=…` scambia il biglietto e mette il cookie; `GET /logout` esce da tutto.
- **La pagina resta usabile da sloggati e anche col sso spento**, coerente con la regola che niente
  ferma la pre-analisi.

**Decisione dell'utente sul form**: il login **si apre in una scheda nuova**, così le risposte già
scritte non si perdono. Al ritorno la pagina va ricaricata a mano. La bozza salvata lato server è
stata scartata: sarebbe un altro pezzo di lavoro, e l'invio non è ancora collegato.

Il bottone d'invio **resta disabilitato anche da loggati**: dove finisce la richiesta non è ancora
deciso.

---

## 5. Verifiche

- `uv run pytest` in anagraphics: **33 verdi**.
- `npm test` nel sso: **31 verdi**, senza bisogno di server accesi (anagraphics finto).
- `tests/credentials.test.js` contiene un hash prodotto davvero da Python: se i due scrypt si
  disallineassero, fallirebbe quel test invece di un login.
- Prova dal vivo del giro completo su porte temporanee (8101/8201/8301), per non toccare le
  istanze dell'utente: pagina da sloggato, login, ritorno col biglietto, cookie, pagina da
  loggato, "Esci" con i due cookie tolti e la sessione cancellata da Mongo. Le istanze temporanee
  sono state fermate e i dati di prova ripuliti.

---

## 6. Da fare

Resta quanto elencato il 2026-09-20, meno il login, più:

1. **Dove finisce la richiesta della pre-analisi** quando si preme invio. È il nodo che blocca il
   bottone, e con esso la decisione se salvare una bozza del form.
2. **Registrazione**: oggi la pagina dice solo che non è attiva.
3. **Autenticazione tra servizi**: il pool di IP non distingue il sso dagli altri sottosistemi,
   quindi chiunque sia nel pool può leggere gli hash delle password e creare sessioni per un
   `uid` qualsiasi. Da risolvere prima di separare le macchine.
4. **Rate limiting sui tentativi di login**, oggi assente, e l'hash finto per l'utente sconosciuto
   (che oggi risponde più in fretta, e quindi rivela se un indirizzo è registrato).
5. **TLS**: password, cookie e biglietti viaggiano in chiaro sulla loopback; fuori da qui no.
6. **CSRF** sul form di login, quando le pagine usciranno da localhost.
7. Gli stili dei campi (`.field`, `.input`, `.notice`) sono ora in **due** copie, preanalyst e sso:
   al terzo form vanno spostati in `commons.css`.
8. Password di sviluppo (`ciao`, `prova-poc-2026`) e utente di prova: da rifare uscendo dalla PoC.

---

## 7. Coda della giornata: via l'HTML dal JavaScript

Due cose emerse provando le pagine dal browser.

### 7.1 Il bug dei fogli di stile

La pagina di login si vedeva **senza stile**. I file c'erano ed erano al posto giusto: era la
pagina a chiederli con percorsi **relativi**, e siccome sta sotto `/ui/login` il browser andava a
cercare `/ui/commons.css`, che non esiste. Corretto con percorsi assoluti, e la regola è ora nel
commento di `commons/templates/base.njk`: le pagine possono stare sotto un percorso qualsiasi.

### 7.2 Nunjucks, subito

Domanda dell'utente: *«Ma stai schiantando html dentro il javascript? è standard sta cosa?»*.
Risposta onesta: è una pratica normale in Node, ma il difetto è che **l'escape è a mano**, e basta
dimenticarlo una volta su un valore che arriva da fuori per aprire un buco. Avevo proposto di
cambiare "quando serviranno pezzi ripetuti"; l'utente ha tagliato corto — il sistema sarà grande,
si cambia adesso.

Scelto **nunjucks** (autoescape di default, ereditarietà dei layout, include), prima dipendenza npm
del progetto.

- `webtools/commons/templates/base.njk`: guscio e testata comuni, con i blocchi `head`,
  `header_extra`, `main`.
- Nuovo sotto-deployer **`template_deployer`**, che lo copia in `templates/commons/` di preanalyst
  e del sso. Il sso riceve i template ma non il client del sso: lui è il servizio.
- `sso`: `templates/login.njk` e `templates/register.njk`; `src/page.js` ora sceglie solo i dati.
- `preanalyst`: `templates/page.njk`, `macros/fields.njk` (disegna i campi dai dati di
  `questions.js`), `partials/driver_box.njk` come macro; `src/page.js` prepara i dati e non
  contiene più HTML.
- `trimBlocks` **spento**: acceso, insieme ai `{%-` dei template, riduceva la pagina a poche righe
  lunghissime.

Verificato: sso 31 test verdi anche dopo la conversione, e la pagina di preanalyst resa dai
template è identica a prima (5 sezioni, 4 aree di testo, 44 scelte, box del driver nei suoi stati,
campi nascosti al posto giusto).

In `CLAUDE.md` è stata aggiunta la regola generale: **l'HTML sta nei template, mai nel codice**.

### 7.3 Conseguenze operative

`node_modules/` non è gestito da nessuno script: dopo un clone o un cambio di versione serve
`npm install` in `webtools/sso/` e `webtools/preanalyst/`. Le due guide brevi che dicevano "niente
npm install, non ci sono dipendenze" sono state corrette.

### 7.4 `webtools/configurator/start.sh`

Riempito il placeholder: avvia `anagraphics` → `sso` → `preanalyst` nell'ordine giusto (e li ferma
in ordine inverso), con `--restart` per fermare prima quelli accesi. Usa gli script di controllo dei
sottosistemi, quindi file PID e riga di comando verificata: mai per nome, mai per porta. Senza
`--restart` un servizio già acceso viene lasciato dov'è. Controlla anche che Mongo risponda, e lo
dice senza fermarsi. Provato su bash 3.2, compreso un `--restart` completo.

---

## 8. Il login in una finestra che si chiude da sola

La prima versione apriva il login in una scheda nuova e poi **ci caricava dentro la pre-analisi**:
una seconda copia del form nella finestra sbagliata, mentre quella vera restava sloggata. Bocciata
dall'utente, giustamente: *«la scheda di login deve chiudersi, e la pagina di origine deve
aggiornare il dom e continuare ad eseguire il suo flusso»*.

Rifatto così:

1. "Entra" apre il login con `window.open()` — serve il `window.open`, non un semplice
   `target="_blank"`: una scheda aperta dal browser non si lascia chiudere da dentro.
2. Il `next` **non** è la pagina di partenza ma `GET /login-done` di preanalyst: lì si scambia il
   biglietto e si mette il cookie.
3. Quella paginetta porta il marcatore `data-sso-login-done`: lo script avvisa con `postMessage`
   la finestra che l'ha aperta e chiude la propria.
4. La pagina di partenza chiede `GET /session-fragment` e rimpiazza due soli nodi, `data-sso-header`
   e `data-sso-gate`. **Non si ricarica niente e il form non viene toccato.**

Pezzi nuovi:

- **`webtools/commons/sso/sso_popup.js`**: la metà browser del client condiviso, distribuita dal
  `sso_deployer` in `public/`. È la prima riga di JavaScript lato browser del progetto.
- `templates/partials/access.njk`: testata e cancello come macro, usati **sia** dalla pagina **sia**
  da `/session-fragment`. L'HTML non si compone nel JavaScript: la versione appena caricata e
  quella aggiornata vengono dallo stesso posto e non possono divergere.
- `templates/login_done.njk` e i due `templates/fragments/`.
- In `base.njk` sono comparsi i blocchi `body_attributes` e `scripts`.

**Senza JavaScript funziona lo stesso**: i link hanno un `href` vero, il login si apre in una
scheda e finisce sulla paginetta, che dice di tornare indietro e ricaricare. Si perdono la chiusura
automatica e l'aggiornamento sul posto, non l'accesso.

Verificato a mano tutto il giro lato server (login → biglietto → `/login-done` con cookie →
`/session-fragment` che risponde `logged: true` con i due pezzi resi). **Il comportamento nel
browser — apertura, chiusura e aggiornamento del DOM — non è ancora stato provato in un browser
vero**, ed è la prima cosa da fare.

---

## 9. Il driver che compila la pre-analisi per sé

Regole nuove sulla pagina del form, quando chi ha fatto il login è **anche un driver**
(`session.data.driver_uid`, fotografato al login).

- **Il proprio link non si applica**: se lo sconto o l'uid nell'indirizzo puntano a lui, vengono
  ignorati — sarebbe uno sconto che si fa da solo. Nuovo stato `own_link` in `referral.js`, con
  `withoutOwnReferral()`. Il box del driver non compare e i campi nascosti non partono.
  Il confronto è sull'**uid**, non sullo username: l'uid non cambia mai.
- **I link di altri driver restano validi**: quello è lavoro portato da loro.
- **Blocco "Lavoro autonomo"**, sotto il box del driver e solo per un driver: una casella «È un
  lavoro autonomo», con lo sconto del **20% sulla fee al sistema**.
- Segnata la casella, il box del driver **si spegne** (grigio) e compare la riga che dice che il
  sistema non ne terrà conto. Senza JavaScript e senza giri sul server: il CSS legge lo stato con
  `:has(#autonomous-work:checked)`.
- I campi nascosti dell'altro driver **restano nel form**: la dichiarazione vale di più, ma
  toglierli perderebbe l'informazione che quel link c'era. Decide chi legge la richiesta.

Conseguenza sul giro del login: la colonna destra può cambiare **dopo** il login (un driver che
entra si vede sparire il proprio sconto e comparire il blocco). Quindi i blocchi del driver stanno
in un contenitore aggiornabile e `/session-fragment` li restituisce, accettando gli stessi
`?discount=` e `?driver=` della pagina, che il browser le passa.

> Rivisto nel pomeriggio (§10.2): il contenitore aggiornabile è `data-sso-driver`, **non** tutta la
> colonna, perché dentro la colonna è arrivato il blocco del caricamento e rifarlo butterebbe via
> il file già scelto.

Provati tutti i casi con i server veri: sloggato con sconto (invariato), driver col proprio sconto
(box via, blocco con la spiegazione, nessun campo nascosto), driver col link di un altro (box con
"Prova", avviso pronto e spento, campo nascosto al suo posto), driver senza link (solo il blocco),
sloggato senza link (una colonna sola), e il frammento che restituisce anche la colonna destra.

---

## 10. Caricare un'analisi già pronta, e una lunga correzione di copy e stile

### 10.1 Il blocco del caricamento

Terzo blocco nella colonna destra, **sempre visibile**, anche da sloggati: «Hai già un'analisi?
Caricala o trascinala qui». L'area di trascinamento è una `<label>` che contiene il campo file, così
tutto il riquadro è cliccabile e funziona anche senza JavaScript. Scelto un file compaiono **Carica**
e **Rimuovi**.

`public/upload.js` (locale, non condiviso) gestisce scelta, trascinamento e invio.

### 10.2 Il contratto dei frammenti, rifatto generico

Il browser rimpiazzava tutta la colonna destra dopo il login: con il blocco del caricamento dentro,
avrebbe buttato via il file già scelto. Quindi:

- `/session-fragment` ora risponde `{ logged, fragments: { "<selettore>": "<html>" } }`;
- `sso_popup.js` cicla sulla mappa e non sa più niente di che cosa contenga: **chi rende i pezzi
  decide quali sono**, e chi rimpiazza troppo si porta via lo stato del browser;
- i blocchi del driver stanno in `[data-sso-driver]`, il caricamento resta fuori e non si tocca.

### 10.3 Niente finestre che si aprono da sole

Alla prima versione «Carica» da sloggati apriva la finestra del login **senza dire niente**.
Bocciato. Ora compare un avviso dentro il blocco — «Per caricare un'analisi serve l'accesso», più la
riga che spiega che il file resta lì e parte da solo — e la finestra si apre **solo** premendo
"Entra e carica". Se il browser la blocca, lo dice invece di restare muto.

### 10.4 `POST /upload`

Il file arriva **nel corpo così com'è**, con il nome in `X-File-Name` codificato: per un file solo
non serve un form multipart, e senza multipart non serve niente per smontarlo. Il tipo dichiarato
non si guarda.

| Caso | Risposta |
|---|---|
| Loggato, file valido | `201 {"received":true,"name":…,"bytes":…}` |
| Sloggato | `401 NOT_LOGGED` |
| Senza `X-File-Name` | `400 MISSING_FILE_NAME` |
| Corpo vuoto | `400 EMPTY_FILE` |
| Oltre `UPLOAD_MAX_BYTES` (10 MB) | `413 FILE_TOO_LARGE` |
| sso irraggiungibile | `503 SSO_UNAVAILABLE` |

**Il file non si conserva**: si conta, si scrive nel log (`analisi caricata da …: nome (N byte) —
non conservata`) e si butta. Serve a fissare il contratto prima di decidere dove finiranno davvero.

Un dettaglio che ha richiesto due giri: sul file troppo grande bisogna **rispondere prima e chiudere
dopo**. Chiudendo subito il client non legge mai il motivo e vede solo una connessione caduta.

Il nome con dei percorsi dentro (`../../etc/passwd`) viene ridotto all'ultima parte (`passwd`): un
nome con dei percorsi è un tentativo, non un nome.

### 10.5 Copy: tre correzioni, tutte dello stesso tipo

- «Progetto che porti tu» / «lavoro che porto io» → **solo "lavoro autonomo"** come concetto.
- «Il sistema non terrà conto di quanto c'è qui sopra» era vago. Ora dice **che cosa** non viene
  applicato, e cambia col caso: «il codice sconto di Prova non viene applicato, e lo sconto resta
  quello del lavoro autonomo: 20% sulla fee» oppure «il progetto non viene attribuito a Prova». Su
  uno sconto scaduto l'avviso **non compare**: non c'è niente di valido da non applicare.
- Nella pagina di login avevo scritto di mia iniziativa «Serve per proseguire dopo la pre-analisi. È
  lo stesso accesso per tutti gli strumenti webtool». **Tolta**: non era richiesta, ed è falsa
  quando il login lo apre il blocco del caricamento o, domani, un altro sottosistema. Stessa sorte
  per «scrivilo nella pre-analisi» nella pagina di registrazione.

### 10.6 Stile

- **Bug in `commons.css`**, quindi anche sul sito vetrina: `.card-head` aveva uno sfondo pieno senza
  raggio e cancellava due pezzi di bordo agli angoli alti della scheda. Corretto nell'originale e
  ridistribuito.
- Colonna destra: i blocchi del driver erano appiccicati perché il loro contenitore non aveva
  spaziatura. Risolto con `display: contents`, che lo toglie di mezzo nel layout. In più `overflow`
  tagliava le ombre piene: spazio aggiunto e restituito con un margine negativo.
- **Fuoco dei campi**: sei tentativi bocciati — anello rosso staccato, sfondo rosa, sfondo giallo,
  etichetta colorata col pallino, campo che si solleva, campo che si abbassa, bordo ispessito
  all'interno. Finito con quello che l'utente ha indicato: **il bordo del campo diventa vermiglio**,
  stesso spessore, nessun movimento, ombra invariata.

### 10.7 Dati di prova aggiunti

Sconto del driver **Prova**, 10%: `2629fcbd-9589-462e-a549-777b58f07aa7`. Serviva per il caso
"driver che compila con lo sconto di un altro", che prima non era provabile: l'unico sconto
esistente era quello di Dome.

### 10.8 Stato a fine giornata

I tre servizi sono **accesi**: anagraphics 8100, sso 8300, preanalyst 8200. Il database non contiene
sessioni di prova.

Test: **33** in anagraphics, **31** nel sso, verdi. `preanalyst` continua a non averne.

### 10.9 Da fare, aggiornato

Oltre a quanto già elencato in §6:

1. **Provare in un browser vero** il giro della finestra di login, il grigetto del lavoro autonomo e
   il caricamento: tutto il §2 e §3 delle prove manuali è passato solo da riga di comando.
2. **Dove finiscono i file caricati**: oggi `POST /upload` li conta e li butta.
3. Decidere se lo sconto di un altro driver e il 20% del lavoro autonomo si escludano davvero, come
   dice il testo che ho scritto, o si sommino. È una regola economica, non grafica.
4. Test di `referral.js` (ora sette stati) e del rendering della pagina.
5. Due dati di prova in più da togliere uscendo dalla PoC: lo sconto di `Prova` e l'utente `Prova`.

---

# Sessione successiva (2026-09-21, sera) — invio del form e specifiche

## 11. Stili dei campi in `commons.css`

`.field`, `.field-label`, `.field-hint`, `.required`, `.input`, `textarea.input`, `.notice` (con
`-ok` e `-warn`) spostati in `commons/style/commons.css` e tolti dagli stili locali di preanalyst e
sso. `.field` in commons non ha margine: lo spazio tra i campi lo decide il form (nel sso,
`.access .field { margin-bottom: 16px }`). Il punto 7 del §6 è chiuso.

Confermato dall'utente: sconto di un altro driver e 20% del lavoro autonomo **si escludono**.

## 12. Decisioni della sessione

- **preanalyst è il sottosistema della chat**: la pagina dell'analisi vive lì (`/analysis/{id}`).
- La collection `anagraphics` diventa **`projects`**.
- Le specifiche stanno **sul filesystem**, nel workspace del progetto, gestite dal nuovo
  sottosistema **`webtools-workspaces`** (nome e cartella scelti dall'utente).
- Nel file caricato l'id sta nel **front matter YAML** (`project_id: <uuid>`). Da dove l'autore
  prenda l'id non riguarda questo step: le analisi lo conterranno.
- Un progetto di un altro utente risponde `PROJECT_NOT_FOUND`, come uno inesistente.
- Più upload sullo stesso progetto: **versioni**, vale l'ultima.
- Origine della specifica (`system` | `third_party`) marcata nella chiave riservata `webtools:` del
  front matter, che timbra workspaces. **La decide il canale**, non il file.
- Codici delle opzioni del form **in inglese** (`mobile`, `unknown`, …). Le skill **non** vanno nel
  front matter: l'elenco è aperto e ha accanto un campo libero.
- Risposte aperte testuali, nella lingua del cliente. Il resto della pre-specifica è in inglese.
- Jev: per ora non se ne tiene conto.

## 13. Che cosa è stato fatto

- **anagraphics 0.5.0**:
  - `GET/POST/DELETE /projects`, con l'id generato da anagraphics;
  - `submission_id` univoco sparse, che rende idempotente l'invio;
  - campi `owner_uid`, `created_at`, `state`, `referral`; codice `SUBMISSION_EXISTS`;
  - test da 33 a **39**;
  - **migrazione eseguita sul DB `webtools`**: `renameCollection("projects")` più il seed per il
    nuovo indice. Password intatte.
- **webtools-workspaces 0.1.0** (porta 8400, Node):
  - `POST /projects/{id}/specs`, `GET /projects/{id}/specs/latest`;
  - file in `<WORKSPACES_ROOT>/<id>/specs/spec-vNNN.md`; radice di default
    `~/webtools_data/workspaces`, fuori dal repo;
  - scrittura atomica con `link` (niente numeri doppi, niente file a metà); un front matter rotto
    viene rifiutato prima di toccare il disco;
  - **13 test**.
- **`commons/specs/front_matter.js`**: `split`, `parse`, `stamp`, `isProjectId`, con la dipendenza
  `yaml`. Lo distribuisce il nuovo sotto-deployer **`specs`**.
- **preanalyst 0.10.0**:
  - `POST /submit` → progetto → pre-specifica → `303` verso `/analysis/{id}`. Se la pre-specifica
    non si scrive, il progetto si cancella;
  - `/analysis/{id}`: pagina vuota, solo per il proprietario;
  - `POST /upload`: solo `.md` UTF-8 con `project_id` valido e di un progetto dell'utente,
    salvato come `third_party`;
  - il bottone d'invio sta nel cancello dell'accesso e si abilita col login; il form non ha più
    `novalidate`.
- **Pre-specifica** (`templates/prespec.md.njk` + `src/prespec.js`):
  - front matter con `project_id`, `kind`, `template: prespec/1`, `language: it` e i codici delle
    risposte chiuse;
  - corpo in inglese, testo del cliente in blockquote, `Not provided.` per i campi vuoti;
  - la sezione **Open points** con i campi vuoti e le risposte `unknown`; skill e "Altro" contano
    come una risposta sola.
- `start.sh`: `anagraphics` → `sso` → `workspaces` → `preanalyst`.
- Documentazione: nuovo `docs/subsystems/workspaces/README.md`; aggiornati anagraphics,
  preanalyst, configurator e i README brevi.

Il `.venv` di anagraphics puntava al vecchio percorso del progetto (`Desktop/ftab - webtools`):
ricreato con `uv sync`. Il vecchio sta nella scratchpad della sessione.

## 14. Verifiche

- Test: anagraphics **39**, sso **31**, workspaces **13**, tutti verdi.
- Prova dal vivo su porte 8101/8201/8301/8401, con il DB separato `webtools_prova_live` e la radice
  nella scratchpad:
  - login, invio, doppio invio (un progetto solo), `spec-v001.md` con `origin: system`;
  - upload valido che dichiarava `system` → `spec-v002.md` `third_party`;
  - upload senza id, con id malformato, sconosciuto, di un altro utente, binario, con front matter
    rotto, da sloggati: errore giusto, niente sul disco;
  - pagina dell'analisi vista da un altro utente → `404`;
  - workspaces spento durante l'invio → `503` e progetto cancellato;
  - bottone disabilitato da sloggati e abilitato nel frammento dopo il login.
- Istanze temporanee fermate, DB di prova cancellato, radice di prova rimossa.
- **Non provato in un browser vero**: invio dal form e caricamento dalla pagina.

## 15. Stato a fine sessione

I servizi dell'utente erano **spenti** a inizio sessione e restano spenti. Per riavviare:
`npm install` in `webtools-workspaces/` è già fatto; `webtools/configurator/start.sh`.

## 16. Da fare

1. Provare nel browser invio e caricamento.
2. La chat di analisi in `/analysis/{id}`.
3. Test di `prespec.js` e `referral.js`.
4. Workspaces: nessuna cancellazione, nessun elenco delle versioni, nessun backup della radice.

**Aggiunta:** `commons/specs/front_matter.js` rinominato **`spec_front_matter.js`**, su richiesta
dell'utente: «front matter» è troppo generico, perché più avanti nel processo ne scriveranno
molti altri. Copie ridistribuite, vecchie copie rimosse, 13 test di workspaces verdi.

**Aggiunta:** nei progetti `referral` è sostituito da due sotto-oggetti, su indicazione
dell'utente: driver e sconti sono dati del **progetto**, non dell'analisi (che è solo di sistema o
caricata).
- `review: {driver_uid, preset}`: `preset` distingue il driver preimpostato (dal link, o il driver
  stesso nel lavoro autonomo) da quello che assegnerà il sistema.
- `billing: {discount_code, autonomous_work, autonomous_fee_discount}`: con il lavoro autonomo il
  codice sconto è `null` (le due cose si escludono).

Il 20% è ora `AUTONOMOUS_FEE_DISCOUNT` nelle impostazioni di preanalyst, letto sia dalla pagina sia
da `billing`. Test anagraphics: 40. Provati dal vivo i cinque casi. Il sistema è **acceso**.

**Aggiunta:** `preanalyst/src/referral.js` rinominato **`driver_link.js`** (`resolveDriverLink`,
`withoutOwnLink`, variabile `driverLink`, nel template `box.link`). Il nome faceva pensare alla
provenienza del progetto; il file decide solo che cosa mostra il box del driver.

**Aggiunta: tutta la configurazione nel sottosistema di configurazione.** Su richiesta
dell'utente, ogni valore configurabile esce dai sottosistemi e va in anagraphics
(`GET /configuration/{subsystem}`), e ogni sottosistema si configura all'avvio **senza default**:
se manca qualcosa, non parte (`webtools_<nome> non parte: …` nel log, uscita 1).
- **Fonte**: `webtools/configurator/configuration/<sottosistema>.json`, uno per sottosistema
  (anagraphics, sso, workspaces, preanalyst, front-gate), **strutturati** per argomento
  (`listen`, `access`, `services`, `session`, `limits`, …). Li carica in Mongo
  `configurator/load_configuration.sh` (→ `anagraphics/scripts/load_configuration.py`):
  sostituzione intera, documenti senza file cancellati. `start.sh` lo lancia prima di avviare e si
  ferma se non riesce. Il seed non scrive più configurazioni.
- **Bootstrap**: `configurator/bootstrap.env` con le sole `WEBTOOLS_ANAGRAPHICS_URL`,
  `WEBTOOLS_CONFIGURATION_TIMEOUT_MS`, `WEBTOOLS_MONGO_URI`, `WEBTOOLS_MONGO_DB`, caricato dagli
  script di controllo. Anagraphics ricava host e porta dall'URL e legge il suo documento
  (`access.allowed_ips`, `mongo.server_selection_timeout_ms`) direttamente da Mongo.
- **Client comune** `commons/configuration/configuration_client.js` (lettura per percorso a
  punti, controllo dei tipi), distribuito dal nuovo deployer `configuration` a sso, workspaces,
  preanalyst, front-gate.
- Diventano configurazione anche due costanti: `MAX_BODY_BYTES` del sso
  (`limits.body_max_bytes`) e `MAX_TEXT_LENGTH` di preanalyst (`form.answer_max_chars`).
- **Front-gate**: la configurazione non si rilegge più a ogni pagina con TTL, si legge all'avvio;
  via `configuration.js` e il segnaposto di "Inizia". Un cambio richiede il riavvio.
- Non sono configurazione (scelte di sicurezza o di protocollo, restano nel codice): byte di token
  e biglietti, parametri scrypt, codici d'errore, domande del form.
- Test: anagraphics 44 (4 nuovi sull'avvio), sso 35 (4 sul client), workspaces 13. Prova
  end-to-end su DB `webtools_e2e` e porte 18xxx: tutti partono; senza documento o senza un campo
  anagraphics e front-gate escono con 1. DB di prova cancellato.
- Regole nuove in `CLAUDE.md`: dati configurabili solo dal sottosistema di configurazione;
  configurazioni strutturate.
- **Le istanze dell'utente erano accese e non sono state toccate**, e il DB `webtools` non è
  stato modificato: girano ancora col codice vecchio. Per passare al nuovo:
  `webtools/configurator/start.sh --restart` (carica la configurazione e riavvia).

**Aggiunta:** su richiesta dell'utente, nei file di configurazione `services` diventa
**`subsystems_infos`** e in front-gate `pricing` passa sotto **`screen_infos.pricing`**. Codice,
client comune (ridistribuito) e documentazione allineati; prova isolata su `webtools_e2e` superata.
Il sistema acceso non è stato riavviato: va fatto con `start.sh --restart`.

**Aggiunta: preanalyst, avvisi di login in modale.** Su richiesta dell'utente, via i due riquadri
gialli fissi (sotto "Manda la richiesta" e nel box "Analisi già pronta"). L'avviso che serve un
account ora è una **modale** (`<dialog>`, macro `dialog` in `partials/access.njk`) che si apre
solo al clic, da sloggati:
- "Manda la richiesta" è sempre abilitato; da sloggati `public/gate.js` blocca l'invio e apre la
  modale (dopo il controllo dei campi obbligatori del browser). A login finito la modale si
  chiude e l'invio va ripetuto a mano: la colonna del driver può essere cambiata.
- "Carica" da sloggati apre l'altra modale; a login finito il file parte da solo, chiudere la
  modale annulla l'attesa (`public/upload.js`).
- Sso non raggiungibile: lo dice la modale.
- Tolti `fragments/access_gate.njk` e il pezzo `[data-sso-gate]` di `/session-fragment`: dopo il
  login si rimpiazzano solo testata e colonna del driver. Docs preanalyst §6.1 aggiornate.
- Provato nel browser dall'utente: funziona. Preanalyst riavviato su richiesta (PID 18654).
