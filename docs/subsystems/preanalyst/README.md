# Sottosistema `preanalyst` (preanalysis gate)

Documentazione completa del **cancello della pre-analisi**: la pagina da cui il cliente entra nel
flusso. Oggi contiene il form delle domande, la provenienza dal link di un driver e l'accesso; non
invia ancora niente.

> Ultimo aggiornamento: 2026-09-21 · versione del sottosistema: `0.9.0`.

Codice: `webtools/preanalyst/`. Guida breve: `webtools/preanalyst/README.md`.

---

## 0. Scheda rapida

| Voce | Valore |
|---|---|
| Cosa fa | Serve **una sola pagina**: il form della pre-analisi, la provenienza (`discount` o `driver`) letta dall'URL, e lo stato dell'accesso |
| Stack | Node 23 · modulo `node:http` · **nunjucks** per la pagina (unica dipendenza) |
| Codice | `webtools/preanalyst/` |
| Avvio (background, slegato dal terminale) | `webtools/preanalyst/webtools_preanalyst.sh --start` |
| Arresto | `webtools/preanalyst/webtools_preanalyst.sh --stop` |
| Processo | `…/node …/webtools/preanalyst/src/index.js` |
| PID / Log | `webtools/preanalyst/webtools_preanalyst.pid` / `webtools/preanalyst/webtools_preanalyst.log` |
| Indirizzo | `http://127.0.0.1:8200` |
| Dipende da | `webtools_anagraphics` su `http://127.0.0.1:8100` e `webtools_sso` su `http://127.0.0.1:8300` (devono essere accesi) |
| Database | Nessuno: non ha stato proprio |
| Accesso | La pagina è pubblica e si compila anche da sloggati. Il conto serve per **proseguire** (§7) |
| Test | Nessuno automatico, per ora (§11) |
| Stato | Una pagina, il form, l'accesso collegato al sso. L'invio della richiesta non è ancora collegato |

Prova veloce, con i due server accesi:
```sh
open http://127.0.0.1:8200/
open "http://127.0.0.1:8200/?discount=e8013cf2-34eb-4bc3-8a34-b08fb24a1bf3"
open "http://127.0.0.1:8200/?driver=7633be3d-e701-42ca-9fea-6c6d1bb4b7d1"
```

---

## 1. Scopo e ruolo nel sistema

Nel flusso (`contesto/02. contesto_aggiornato.md`, `struttura/design/Sequence.drawio.pdf`) il
cliente arriva dal sito vetrina `front-gate` e entra nel **preanalysis ecosystem**: formula il
proprio bisogno, da solo con il *self analysis prompt* oppure con il form assistito dalla nostra AI.
`preanalyst` è la porta d'ingresso di quel pezzo.

Di tutto questo oggi c'è solo il primo pezzo: **chi è il driver di riferimento**. Se il cliente
arriva dal link di un driver — con un **codice sconto** oppure col solo **uid del driver** — la
scelta è già fatta e non si tocca.

Non è ancora collegato al `front-gate`: il bottone "Inizia" del sito vetrina non porta qui.

---

## 2. Scelte funzionali

- **La pagina è resa dal server.** Il browser riceve l'HTML già completo: la tendina arriva piena e
  lo stato dello sconto è già deciso. Non c'è JavaScript lato client.
- **Il browser non parla mai con `anagraphics`.** Le letture partono da questo server. Anagraphics
  accetta solo chiamate da IP noti (`ALLOWED_IPS`): se le facesse il browser, funzionerebbe finché
  tutto sta sullo stesso Mac e si romperebbe il giorno del primo deploy vero. In più i dati interni
  dei driver non finiscono in una pagina pubblica.
- **Due modi di arrivare da un driver, un solo effetto sulla pagina.** `?discount=` e `?driver=`
  bloccano tutti e due la tendina; il primo porta con sé uno sconto, il secondo no. La logica è
  la stessa, il messaggio all'utente cambia.
- **Il driver non si sceglie.** O lo porta il link con cui il cliente è arrivato, o lo assegniamo
  noi: non c'è nessun campo da compilare e nessun modo di cambiarlo dalla pagina.
- **Il box del driver si vede solo a chi arriva dal link di un driver**, cioè con `?discount=` o
  `?driver=` nell'URL. Per tutti gli altri non c'è niente da dire: niente box, una colonna sola,
  e nessuna chiamata ad anagraphics.
- **Niente ferma la pre-analisi.** Sconto scaduto, driver sparito, elenco dei driver irraggiungibile:
  in ogni caso storto il form resta lì e si può compilare. Un campo facoltativo non può bloccare
  una pagina, quindi `GET /` risponde **sempre `200`**.
- **Quello che arriva nell'URL non si perde.** `discount` e `driver` restano attaccati al form come
  campi nascosti anche quando non si sono potuti risolvere: se il guasto è nostro, non deve
  pagarlo l'utente con lo sconto perduto.
- **Un solo avviso per volta**, sopra il campo, in italiano corrente e senza codici d'errore.
- **Testi asciutti.** Le domande e gli avvisi dicono che cosa scrivere e a che cosa serve, e
  nient'altro: niente toni motivazionali, niente complimenti al cliente, niente pubblicità del
  metodo. Le affermazioni sono verificabili — «ogni cosa che escludi qui è un giro di domande in
  meno» sì, «la domanda più utile di tutte» no. La regola sta in cima a `src/questions.js` e in
  `CLAUDE.md`.

---

## 3. Scelte tecnologiche

- **Node con una sola dipendenza, nunjucks.** La pagina è una sola e il server fa tre cose: leggere due URL, comporre
  HTML, servire file statici. `node:http` basta. Niente `npm install`, niente `node_modules`,
  niente catena di pacchetti da aggiornare. `package.json` esiste per dichiarare nome, `type:
  module` e la versione minima di Node, e ha `dependencies` vuoto **di proposito**.
- **`fetch` globale** (Node ≥ 18) con `AbortSignal.timeout`.
- **Nessun motore di template**: l'HTML si compone con template literal in `src/page.js`. Ogni
  valore che viene dal database o dall'URL passa per `escape()`.

---

## 4. Architettura

### 4.1 Mappa dei file

```
webtools/preanalyst/
├── package.json       # nome webtools_preanalyst, type=module, dipendenza: nunjucks
├── README.md          # guida breve
├── webtools_preanalyst.sh    # CONTROLLO: --start / --stop (nohup + file PID verificato)
├── webtools_preanalyst.pid   # generato da --start, rimosso da --stop
├── webtools_preanalyst.log   # generato da --start (append)
├── src/
│   ├── index.js       # AVVIO: listen su HOST/PORT, riga di conferma, SIGTERM/SIGINT
│   ├── settings.js    # loadSettings() dalle variabili d'ambiente
│   ├── anagraphics.js # client HTTP: listDrivers(), findDiscount(); mai eccezioni al chiamante
│   ├── referral.js    # i sei stati della provenienza: resolveReferral(), isLocked()
│   ├── questions.js   # LE DOMANDE del form, come dati: è il file da rifinire
│   ├── page.js        # prepara i DATI della pagina; l'HTML sta in templates/
│   ├── server.js      # routing: GET /, GET /logout, i file statici di public/
│   └── commons/
│       └── sso_client.js   # COPIA generata dal deployer: non modificare qui
├── templates/
│   ├── page.njk            # la pagina
│   ├── login_done.njk      # la paginetta che chiude la finestra del login
│   ├── macros/fields.njk   # i campi, disegnati dai dati di questions.js
│   ├── partials/driver_box.njk  # il box del driver
│   ├── partials/access.njk # testata e cancello dell'accesso, come macro
│   ├── partials/driver_work.njk # il blocco del lavoro autonomo
│   ├── fragments/          # gli stessi due pezzi, da soli, per /session-fragment
│   └── commons/base.njk    # COPIA generata dal deployer: non modificare qui
└── public/
    ├── styles.css     # stile LOCALE di questa pagina
    ├── sso_popup.js   # COPIA generata dal deployer: non modificare qui
    ├── commons.css    # COPIA generata dal deployer: non modificare qui
    ├── fonts/         # COPIA generata dal deployer: non modificare qui
    └── assets/
        └── mark.svg   # copiato a mano da front-gate/assets/ (il marchio non è nel deployer)
```

### 4.2 Percorso di una richiesta a `/`

0. Se nell'indirizzo c'è `?ticket=…`, il browser sta tornando dal login: si scambia il biglietto
   con il sso, si mette il cookie di sessione e si rimanda il browser allo stesso indirizzo senza
   il biglietto (§6.1). Altrimenti si legge il cookie e si chiede al sso chi è.
1. `server.js` accetta solo `GET` (gli altri metodi ricevono `405`).
2. Se **non** c'è né `discount` né `driver`, si salta tutto: niente box, nessuna chiamata ad
   anagraphics, si compone la pagina con il solo form.
3. Altrimenti `listDrivers()` chiama `GET /drivers` su anagraphics.
   - Se fallisce, la tendina sparisce, il box lo dice e il form resta: la pagina è comunque `200`.
4. `resolveReferral()` guarda i parametri dell'URL e decide lo stato (§5).
   - Con `?discount=<codice>` fa una **seconda lettura**, `GET /discounts/{codice}`.
   - Con `?driver=<uid>` **non legge niente**: l'elenco dei driver è già in mano e li contiene
     tutti, quindi basta cercare l'uid lì dentro.
5. `renderPage()` compone l'HTML e il server risponde `200`.

---

## 5. La provenienza nell'URL

Un driver può mandare un cliente qui in due modi, e sono due parametri diversi:

| Parametro | Che cos'è | Sconto |
|---|---|---|
| `?discount=<codice>` | Un **codice sconto**: l'UUID `discount_code` della collection `discounts` | Sì, quello del codice |
| `?driver=<uid>` | L'**uid** di un driver: l'UUID `uid` della collection `drivers` | **No**, nessuno |

In tutti e due i casi, se il driver si trova, la tendina arriva **già scelta e bloccata**. Quello
che cambia è lo sconto a valle e il messaggio all'utente.

Gli stati possibili sono **sei** e sono definiti in `src/referral.js`:

| Stato | Quando | Cosa vede l'utente |
|---|---|---|
| `none` | Nessuno dei due parametri | Nessun box |
| `discount_applied` | Sconto letto **e** il suo driver esiste | Il **nome** del driver, e l'avviso verde con la percentuale |
| `discount_expired` | La lettura dello sconto **fallisce** | "Non è applicabile: con ogni probabilità è scaduto. Vai avanti lo stesso: il driver lo assegniamo noi" |
| `discount_driver_missing` | Sconto letto, ma il suo `driver.uid` non si trova | "Il driver non si trova più. Contattalo per un codice nuovo" |
| `driver_applied` | `?driver=` con un uid che esiste | Il **nome** del driver, e nient'altro: non c'è nessun avviso |
| `own_link` | Lo sconto o il link sono di **chi ha fatto il login** | Nessun box: a spiegarlo è il blocco del lavoro autonomo (§6.3) |
| `driver_unknown` | `?driver=` con un uid che non esiste | "Il driver di questo link non si trova più. Contattalo" |

Negli stati `discount_applied` e `driver_applied` il driver è **riconosciuto**: c'è un nome da
mostrare e un `uid` che viaggia col form come campo nascosto. L'insieme è la costante `RESOLVED`
in `referral.js`, e la pagina chiede `isResolved()` invece di elencare gli stati a mano.
Negli altri casi non si manda nessun driver: lo assegniamo noi leggendo la richiesta.

### 5.1 Se arrivano tutti e due i parametri

Vince **`discount`**, e `driver` viene ignorato.

È l'unico dei due che porta con sé un effetto economico: seguire `driver` toglierebbe all'utente
uno sconto a cui ha diritto, mentre il contrario, al massimo, gli dà lo sconto del link da cui è
arrivato davvero. Un link con entrambi i parametri è però quasi sempre un errore di chi l'ha
costruito, quindi il caso finisce nel log:

```
[preanalyst] link con discount e driver insieme: vince discount (discount=…, driver=…)
```

### 5.2 `driver_unknown` non costa una lettura in più

`?driver=` non interroga `GET /drivers/{uid}`: l'elenco dei driver è già stato caricato per
riempire la tendina e li contiene **tutti**, quindi l'uid o è lì dentro o non esiste. Una seconda
lettura darebbe la stessa risposta più tardi.

Ne segue che `driver_unknown` non distingue "driver cancellato" da "uid inventato": per la pagina
sono la stessa cosa, e il messaggio è lo stesso.

### 5.3 Perché `discount_expired` copre anche il guasto tecnico

`discount_expired` scatta sia sul `404 DISCOUNT_NOT_FOUND` (il codice non esiste) sia sul guasto tecnico
(anagraphics spento, Mongo giù, timeout, `403`, `500`). All'utente si dice comunque "probabilmente
è scaduto".

È una **semplificazione voluta**, chiesta esplicitamente: per chi sta davanti allo schermo il
risultato non cambia, lo sconto non si applica, e non ha senso spiegargli che un servizio interno
non risponde. Ma le due cose **non sono la stessa cosa**, quindi la differenza resta nel log:

```
[anagraphics] /discounts/xxx: HTTP 404 DISCOUNT_NOT_FOUND     ← codice inesistente
[anagraphics] /discounts/xxx: TypeError fetch failed          ← servizio irraggiungibile
```

Va rivisto quando lo sconto avrà un valore economico reale: dire "scaduto" mentre il servizio è
giù fa perdere uno sconto valido a chi ne aveva diritto (§13).

### 5.4 Il nome del driver quando non si trova

Il nome mostrato viene dalla **copia ridondata dentro lo sconto** (`driver.screen_name`), non dalla
collection `drivers`: se il driver non è più in elenco, quella copia è l'unico appiglio rimasto per
far capire all'utente chi deve contattare. Se manca anche quella, l'avviso si limita a dire che il
driver non si trova.

### 5.5 Come viaggia il driver

Quando il driver è riconosciuto, il suo `uid` viene messo in un `<input type="hidden"
name="driver">` agganciato al form con `form="gate-form"`. Non c'è nessun controllo visibile da
compilare: il box è informativo, il dato viaggia nascosto.

Quando ci sarà un invio vero, quel valore va **ricontrollato sul server**: un campo nascosto non
impedisce a nessuno di mandare quello che vuole.

---

## 6. L'accesso

La pre-analisi si compila **anche da sloggati**: chi arriva dal sito vetrina non ha un conto e non
gli si chiede di farselo per rispondere a delle domande. Il conto serve al passo dopo, per
proseguire, e lì viene chiesto.

### 6.1 Che cosa vede l'utente

| Dove | Da sloggato | Da loggato |
|---|---|---|
| Testata | "Entra", che apre il login **in una finestra a parte** | Il nome della persona e "Esci" |
| Sotto il bottone d'invio | Un riquadro: "Per proseguire serve un account", con "Entra" e "Registrati" | "Sei <nome>. L'invio non è ancora collegato" |

**Il login si apre in una finestra a parte, e questa pagina non si ricarica mai.** Se il login
sostituisse la pagina, tutto quello che è stato scritto nel form andrebbe perso: non c'è nessuna
bozza salvata da nessuna parte. Finito il login la finestra **si chiude da sola** e la pagina di
partenza **si aggiorna sul posto**: cambiano solo la testata e il riquadro, il form resta
esattamente com'era.

Se il sso non risponde, la testata e il riquadro lo dicono e il form resta compilabile: **niente
ferma la pre-analisi**, com'è già per il box del driver.

### 6.2 Come funziona, sotto

Il giro del sso è quello descritto in `docs/subsystems/sso/README.md` §1.1; questo sottosistema
non ne scrive una riga a mano, usa le **copie generate** del client condiviso:
`src/commons/sso_client.js` sul server e `public/sso_popup.js` nel browser (originali in
`webtools/commons/sso/`, distribuiti da `webtools/configurator/deploy.sh sso`).

1. Su ogni caricamento della pagina, `currentSession()` legge il cookie e chiede al sso chi è.
   Tre esiti, e sono tre cose diverse: loggato, non loggato, oppure **non lo sappiamo** perché il
   sso non risponde. L'ultimo non si tratta come un logout.
2. "Entra" apre con `window.open()` il login del sso, con
   `next=<nostro indirizzo>/login-done` — **non** la pagina di partenza (§6.4).
3. Finito il login, il sso rimanda quella finestra a `GET /login-done?ticket=…`. Il server scambia
   il biglietto da dietro (`claimTicket`), mette il **proprio** cookie e rende una paginetta che
   porta il marcatore `data-sso-login-done`.
4. Lo script vede il marcatore, avvisa con `postMessage` la finestra che l'ha aperta e **chiude**
   la propria.
5. La pagina di partenza riceve il messaggio e chiede `GET /session-fragment`: riceve i due pezzi
   **già resi dai template** e li mette al posto di quelli vecchi. Non si ricarica niente, il form
   non viene toccato.
6. La durata del cookie non è decisa qui: si legge da `expires_at` della sessione. Il cookie non
   deve sopravvivere alla sessione che rappresenta.
7. `GET /logout` toglie il nostro cookie e manda il browser a `/ui/logout` del sso, che chiude la
   sessione condivisa. **"Esci" esce da tutto**, non solo da questa pagina.

**Senza JavaScript funziona lo stesso**: i link hanno un `href` vero, il login si apre in una
scheda normale e finisce sulla paginetta di `/login-done`, che dice di tornare alla pre-analisi e
ricaricarla. Si perde la chiusura automatica e l'aggiornamento sul posto, non l'accesso.

**L'HTML dei due pezzi non è scritto nel JavaScript**: i macro di
`templates/partials/access.njk` servono sia la pagina sia `/session-fragment`, quindi la versione
appena caricata e quella aggiornata non possono divergere. Lo script sposta nodi, non compone
markup.

### 6.5 Perché il ritorno non è sulla pagina di partenza

Perché il `next` è la finestra del login, non quella di prima. Mandandolo alla pre-analisi si
aprirebbe una **seconda copia del form** dentro la finestra sbagliata, mentre quella vera —
quella con le risposte scritte — resterebbe convinta che non sia entrato nessuno. `/login-done`
esiste per chiudere il giro nel posto giusto.

### 6.3 Quando chi compila è un driver

Un driver può usare la pre-analisi per un lavoro suo. Allora valgono due regole.

**Il proprio link non si applica.** Se lo sconto o l'uid nell'indirizzo puntano al driver che ha
fatto il login, vengono ignorati: sarebbe uno sconto che si fa da solo. Il box del driver non
compare affatto, e a dirlo è il blocco qui sotto — «il link che hai usato è tuo». I campi nascosti
non partono: quel codice non viaggia con la richiesta.

Il confronto si fa sull'**uid** del driver (`session.data.driver_uid` contro l'uid del driver dello
sconto o del link), non sullo username: l'uid non cambia mai, lo username sì.

**I link di altri driver restano validi.** Quello è lavoro portato da loro, e il box li mostra come
sempre.

**Il blocco "Lavoro autonomo"** compare sotto il box del driver, e solo a chi è un driver: una
casella, «è un lavoro che porto io», con l'indicazione dello sconto del **20% sulla fee al
sistema**. Segnata la casella, il box del driver qui sopra si **spegne** — in grigio, meno
contrasto — e compare la riga che dice che il sistema non terrà conto di quello che c'è lì.

Lo spegnimento non passa da JavaScript né dal server: il CSS legge lo stato della casella con
`:has(#autonomous-work:checked)`. La riga dell'avviso è già nella pagina, nascosta.

I campi nascosti dell'altro driver **restano nel form** anche con la casella segnata: la
dichiarazione vale più di loro, e a decidere sarà chi legge la richiesta. Toglierli dal form
vorrebbe dire perdere l'informazione che quel link c'era.

### 6.4 Il nome del cookie

Il nostro cookie si chiama `webtools_preanalyst`, quello del sso `webtools_sso`. Devono essere
diversi: i cookie **ignorano la porta**, quindi su `127.0.0.1` finiscono tutti nello stesso mucchio
e due cookie con lo stesso nome si sovrascriverebbero a vicenda. È un errore che su questa macchina
si vedrebbe come "entro in un posto ed esco da un altro".

---

## 7. Rotte

| Rotta | Risposta |
|---|---|
| `GET /` | La pagina. Sempre `200`: nessun guasto di anagraphics o del sso la ferma |
| `GET /login-done?ticket=…` | Il ritorno dal login, dentro la finestra del login: scambia il biglietto, mette il cookie e rende la paginetta che si chiude da sola. Sempre `200`, anche quando il biglietto non vale |
| `GET /session-fragment` | `200` JSON `{logged, header, gate, aside}`: i pezzi della pagina già resi, per il browser che aggiorna senza ricaricare. Accetta gli stessi `?discount=` e `?driver=` della pagina, perché la colonna destra dipende da quelli |
| `GET /logout` | `303` verso `/ui/logout` del sso, togliendo il nostro cookie |
| `GET /<file>` | Un file di `public/` col suo content-type; `404` se non esiste |
| Metodo ≠ GET | `405` |
| Errore imprevisto | `500`, con lo stack nel log |

I percorsi statici vengono normalizzati e verificati: un percorso che uscirebbe da `public/`
(`/../package.json`) riceve `404`/`403`, non il file.

A differenza di `anagraphics`, gli errori **non** hanno un codice stabile in JSON: qui le risposte
sono pagine e file per un browser, non un'API per altri sottosistemi. Il contratto a codici vale
per le API interne.

---

## 8. Configurazione (variabili d'ambiente)

Si passano con `--start`, per esempio `PORT=8300 ./webtools_preanalyst.sh --start`.

| Variabile | Default | A che serve |
|---|---|---|
| `HOST` | `127.0.0.1` | Interfaccia di ascolto |
| `PORT` | `8200` | Porta. `8100` è di anagraphics |
| `ANAGRAPHICS_URL` | `http://127.0.0.1:8100` | Dove sta anagraphics |
| `ANAGRAPHICS_TIMEOUT_MS` | `5000` | Taglio delle letture verso anagraphics |
| `PUBLIC_URL` | `http://127.0.0.1:8200` | Il nostro indirizzo visto da fuori: ci torna il browser dopo il login, ed è quello che dichiariamo al sso allo scambio del biglietto |
| `SSO_URL` | `http://127.0.0.1:8300` | Dove sta il sso |
| `SSO_TIMEOUT_MS` | `5000` | Taglio delle chiamate verso il sso |
| `COOKIE_NAME` | `webtools_preanalyst` | Il **nostro** cookie di sessione. Deve restare diverso da quello del sso |

Il timeout è **più corto** dei 30 s con cui anagraphics aspetta Mongo: se Mongo è giù, l'utente
vede la pagina in 5 secondi invece di restare fermo mezzo minuto.

---

## 9. Comandi operativi

### 9.1 Avvio e arresto
```sh
webtools/preanalyst/webtools_preanalyst.sh --start
webtools/preanalyst/webtools_preanalyst.sh --stop
```
- `--start` non fa nulla se il server è già su, e aspetta fino a 10 s la riga di conferma
  `webtools_preanalyst in ascolto su …`. Se il processo muore, stampa le ultime righe del log.
- `--stop` ferma **solo** il processo del file PID, e solo dopo aver verificato con `ps` che quel
  PID sia davvero `node …/src/index.js`. Mai per nome, mai per porta.
- Debug in primo piano, dalla cartella del progetto: `npm start` (Ctrl+C per fermarlo).

Serve anche anagraphics acceso:
```sh
webtools/anagraphics/webtools_anagraphics.sh --start
```

### 9.2 Stile e client condivisi
Due file di questo sottosistema sono **copie generate** e non si modificano qui:
`public/commons.css` (più `public/fonts/`) e `src/commons/sso_client.js`. Si modificano gli
originali in `webtools/commons/` e si rilancia il deployer:

```sh
webtools/configurator/deploy.sh          # stile + client del sso
webtools/configurator/deploy.sh style    # solo lo stile
webtools/configurator/deploy.sh sso      # solo il client del sso
```

Lo stile **locale** è `public/styles.css`, e quello si modifica a mano.

---

## 10. Stile della pagina

- Da `commons.css`: font, token dei colori, `.container`, `.site-header`, `.brand*`, `.card`,
  `.card-head`, `.eyebrow`, `.reveal`.
- Da `public/styles.css`, solo roba di questa pagina: colonna stretta `.gate`, `.gate-card`,
  il campo `.field`, la tendina `.select` (freccia disegnata in CSS, niente immagini) e gli avvisi
  `.notice` nelle due varianti `notice-ok` (verde salvia) e `notice-warn` (giallo nota).
- La tendina bloccata si vede: sfondo spento, niente ombra, niente freccia, cursore `not-allowed`.

---

## 11. Test

**Non ci sono test automatici.** È un buco noto, non una scelta: `referral.js` è logica pura con
sei esiti ed è il primo candidato a essere coperto, con `node --test`.

Verificato a mano il 2026-09-20, con i due server accesi:

| Caso | Esito |
|---|---|
| `/` senza parametro | `200`, nessun box del driver, form a colonna singola, e nessuna chiamata ad anagraphics |
| `?discount=e8013cf2-…` | `200`, avviso verde, `<select disabled>`, hidden col `uid` di Dome |
| `?discount=non-esiste` | `200`, avviso "probabilmente scaduto", tendina libera |
| Sconto con driver fuori elenco (dato temporaneo, poi cancellato) | `200`, avviso "il driver non si trova", col nome dalla copia ridondata |
| `?driver=7633be3d-…` | `200`, nome "Dome" nel box, nessun avviso, hidden col suo `uid` |
| `?driver=00000000-…` | `200`, avviso "il driver di questo link non si trova", con l'uid in chiaro |
| `?discount=…&driver=…` insieme | `200`, vince lo sconto, e nel log la riga che segnala il link malfatto |
| Anagraphics irraggiungibile (`ANAGRAPHICS_URL` su una porta chiusa) | `200`, form presente, box con l'avviso "non riusciamo a dirti chi è il driver", e nel log `TypeError fetch failed` |
| Idem, ma con `?discount=…&driver=…` nel link | `200`, i due valori restano come campi nascosti e l'avviso dice che il link non va perso |
| `/commons.css`, `/styles.css`, `/fonts/inter.woff2`, `/assets/mark.svg` | `200` col content-type giusto |
| `/../package.json` | `404` |

---

## 12. Troubleshooting

| Sintomo | Causa probabile | Cosa fare |
|---|---|---|
| Box con "non riusciamo a dirti chi è il driver" | Anagraphics spento | `webtools/anagraphics/webtools_anagraphics.sh --start` |
| Idem, ma anagraphics è acceso | `ALLOWED_IPS` non contiene l'IP di questo server, oppure Mongo è giù | Log: `HTTP 403 IP_NOT_ALLOWED` o `HTTP 503 DATABASE_UNAVAILABLE` |
| Tendina vuota, senza avvisi | Nessun driver nel database | `uv run python -m scripts.seed` in `webtools/anagraphics/` |
| Ogni sconto risulta "scaduto" | Anagraphics risponde ma non trova i codici | `mongosh webtools --eval 'db.discounts.find({}, {_id:0}).toArray()'` |
| Pagina senza stile o font | Deployer mai lanciato dopo aver creato `public/` | `webtools/configurator/style_deployer/deploy.sh` |
| `--start` dice "già in esecuzione" ma non risponde | PID riciclato da un altro processo | Il controllo su `ps` lo esclude: guarda il log |
| `EADDRINUSE` nel log | Porta 8200 occupata da altro | `PORT=8300 ./webtools_preanalyst.sh --start` |

---

## 13. Limiti noti e debito tecnico

- **Nessun test automatico** (§11).
- La pagina **non invia niente**: il bottone d'invio resta disabilitato anche da loggati, perché
  non è ancora deciso dove finisce la richiesta.
- **Quello che si scrive nel form non è salvato da nessuna parte**: se si chiude la pagina, si
  perde. Il login si apre in una scheda nuova proprio per questo (§6.1). Una bozza lato server
  sarebbe la soluzione vera, e non è stata fatta.
- Se il browser **blocca le finestre**, il login si apre in una scheda normale e finisce sulla
  paginetta di `/login-done`: da lì si torna a mano, come senza JavaScript.
- Lo script del browser non ha test automatici: il giro è stato provato a mano.
- Il logout dipende dal sso: se è giù, il nostro cookie viene tolto comunque e la pagina torna
  sloggata, ma la sessione condivisa resta aperta fino alla scadenza.
- `discount_expired` non distingue "scaduto" da "servizio giù" (§5.3).
- `driver_unknown` non distingue "driver cancellato" da "uid inventato" (§5.2).
- Nessuno dei due parametri viene validato come UUID: un valore storto finisce in una lettura a
  vuoto (`discount`) o in una ricerca che non trova niente (`driver`), che è l'esito giusto, ma
  per la ragione sbagliata.
- Nessuna validazione lato server del driver scelto: servirà quando ci sarà l'invio (§5.5).
- Nessuna cache: ogni caricamento rilegge i driver da anagraphics. Va bene finché i driver sono
  pochi e le visite anche.
- `node_modules/` non è gestito da nessuno script: dopo un clone o un cambio di versione serve `npm install` a mano.
- Nessun rate limiting, TLS, `/health` o metriche. Il cookie di sessione non ha `Secure`, perché su localhost non c'è HTTPS.
- Nessuna gestione come servizio (launchd): non riparte da solo, e il log cresce senza rotazione.
- `public/assets/mark.svg` è una copia a mano di quello del front-gate: se il marchio cambia, va
  ricopiato. Il deployer distribuisce solo lo stile.
- Non è collegato al `front-gate`.

---

## 14. Prossimi passi

1. Test di `referral.js` con `node --test`.
2. Il vero contenuto della pre-analisi: le domande, l'invio, dove finisce la richiesta — e con
   quello, decidere se serve salvare una bozza per non perdere le risposte.
3. Collegare il bottone "Inizia" del `front-gate` a questa pagina.
4. Decidere cosa fa davvero il codice sconto: chi lo emette, su cosa si applica, quando scade.
   Oggi `discounts` ha una percentuale che nessuno usa, e "scaduto" è un messaggio senza una
   data dietro.
5. Decidere se il link `?driver=` deve lasciare traccia a valle: oggi sceglie il driver e basta,
   ma è anche l'unico modo per sapere che un progetto arriva da lui senza passare da uno sconto.

---

## 15. Changelog

| Data | Versione | Modifica |
|---|---|---|
| 2026-09-21 | 0.9.0 | Le regole per il driver che compila: il proprio sconto o link viene ignorato (stato `own_link` in `referral.js`), quelli di altri driver restano validi; blocco **Lavoro autonomo** sotto il box del driver, con lo sconto del 20% sulla fee, che spegne il box con `:has()` e mostra l'avviso. La colonna destra diventa un contenitore aggiornabile (`data-sso-aside`), incluso nel frammento. |
| 2026-09-21 | 0.8.0 | Il login si apre in una **finestra** che si chiude da sola: `GET /login-done` chiude il giro, `GET /session-fragment` restituisce i due pezzi resi dai template e il browser li rimpiazza sul posto (`public/sso_popup.js`). Prima riga di JavaScript lato browser del sottosistema. Niente più ritorno del biglietto sulla pagina di partenza, che apriva una seconda copia del form nella finestra sbagliata. |
| 2026-09-21 | 0.7.0 | L'HTML esce dal JavaScript: `templates/page.njk`, `macros/fields.njk`, `partials/driver_box.njk` resi con **nunjucks** (autoescape), guscio comune da `commons/templates/base.njk`. `src/page.js` prepara solo i dati. Prima dipendenza npm del sottosistema. |
| 2026-09-21 | 0.6.0 | L'accesso: stato in testata, riquadro "per proseguire serve un account" sotto il bottone, `GET /logout`, ritorno dal login con `?ticket=` e cookie `webtools_preanalyst`. Tutto il dialogo col sso passa da `src/commons/sso_client.js`, copia generata dal nuovo deployer. La pagina resta usabile da sloggati e anche col sso spento. |
| 2026-09-20 | 0.1.0 | Creazione: pagina unica resa dal server, tendina dei driver letta da anagraphics, quattro stati del codice sconto, file statici, script `--start`/`--stop` con PID verificato, `deploy_preanalyst` nel deployer dello stile. |
| 2026-09-21 | 0.5.1 | Tolto l'avviso "questo link non porta con sé nessuno sconto": era inutile e fuorviante, faceva pensare che un altro link avrebbe dovuto portarne uno. Con `?driver=` il box mostra solo il nome. |
| 2026-09-21 | 0.5.0 | Tolta la tendina di scelta del driver e ogni riferimento alla possibilità di cambiarlo. Il box mostra il nome del driver quando il link lo porta, altrimenti dice perché no; l'`uid` viaggia come campo nascosto. `isLocked()` diventa `isResolved()`. |
| 2026-09-21 | 0.4.0 | Il box del driver compare **solo** con `?discount=` o `?driver=` nell'URL. Senza, la pagina è a colonna singola e non chiama anagraphics. |
| 2026-09-20 | 0.3.0 | La pagina si divide in due: blocco principale col testo e il form della pre-analisi (domande in `src/questions.js`, 5 sezioni e 14 campi), box del driver autonomo a destra, agganciato al form con `form="gate-form"`. La scelta del driver è dichiarata **facoltativa** nei testi. `GET /` risponde sempre `200`: se l'elenco dei driver non arriva, il form resta e i parametri dell'URL viaggiano come campi nascosti. |
| 2026-09-20 | 0.2.0 | Aggiunto il parametro `?driver=<uid>`, con la stessa logica di `?discount=` ma senza sconto. `discount.js` diventa `referral.js`, con sei stati al posto di quattro; se arrivano entrambi i parametri vince `discount`. |
