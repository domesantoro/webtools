# Sottosistema `preanalyst` (preanalysis gate)

Documentazione completa della **pre-analisi**: la pagina da cui il cliente entra nel flusso, e il
sottosistema che ospiterà la chat di analisi. Oggi contiene:
- il form delle domande, che all'invio crea il progetto con la sua pre-specifica;
- il caricamento di una specifica già pronta per un progetto esistente;
- la provenienza dal link di un driver;
- l'accesso;
- la pagina dell'analisi, ancora vuota.

> Ultimo aggiornamento: 2026-09-22 · versione del sottosistema: `0.15.0`.

Codice: `webtools/preanalyst/`. Guida breve: `webtools/preanalyst/README.md`.

---

## 0. Scheda rapida

| Voce | Valore |
|---|---|
| Cosa fa | La pagina della pre-analisi (form, provenienza da `discount` o `driver`, accesso), l'invio del form (§14), il caricamento di una specifica (§14.4), la pagina dell'analisi |
| Stack | Node 23 · modulo `node:http` · **nunjucks** per le pagine e la pre-specifica · **yaml** per il front matter |
| Codice | `webtools/preanalyst/` |
| Avvio (background, slegato dal terminale) | `webtools/preanalyst/webtools_preanalyst.sh --start` |
| Arresto | `webtools/preanalyst/webtools_preanalyst.sh --stop` |
| Processo | `…/node …/webtools/preanalyst/src/index.js` |
| PID / Log | `webtools/preanalyst/webtools_preanalyst.pid` / `webtools/preanalyst/webtools_preanalyst.log` |
| Indirizzo | `http://127.0.0.1:9200` |
| Dipende da | `webtools_anagraphics` (9100), `webtools_sso` (9300), `webtools-workspaces` (9400) |
| Database | Nessuno: non ha stato proprio |
| Accesso | La pagina è pubblica e si compila anche da sloggati. Il conto serve per **proseguire** (§7) |
| Test | Nessuno automatico, per ora (§11) |
| Stato | Invio e caricamento collegati. La pagina dell'analisi è vuota |

Prova veloce, con i due server accesi:
```sh
open http://127.0.0.1:9200/
open "http://127.0.0.1:9200/?discount=e8013cf2-34eb-4bc3-8a34-b08fb24a1bf3"
open "http://127.0.0.1:9200/?driver=7633be3d-e701-42ca-9fea-6c6d1bb4b7d1"
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
  accetta solo chiamate da IP noti (`access.allowed_ips` della sua configurazione): se le facesse il browser, funzionerebbe finché
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
├── package.json       # nome webtools_preanalyst, type=module, dipendenze: nunjucks, yaml
├── README.md          # guida breve
├── webtools_preanalyst.sh    # CONTROLLO: --start / --stop (nohup + file PID verificato)
├── webtools_preanalyst.pid   # generato da --start, rimosso da --stop
├── webtools_preanalyst.log   # generato da --start (append)
├── src/
│   ├── index.js       # AVVIO: legge la configurazione (o esce con 1), listen, riga di conferma, SIGTERM/SIGINT
│   ├── settings.js    # loadSettings(): la configurazione `preanalyst` da anagraphics → impostazioni del server
│   ├── anagraphics.js # client HTTP: driver, sconti, progetti; mai eccezioni al chiamante
│   ├── workspaces.js  # client HTTP verso webtools-workspaces: storeSpec()
│   ├── prespec.js     # le risposte del form → la pre-specifica .md (§14.2)
│   ├── driver_link.js    # i sei stati della provenienza: resolveDriverLink(), isLocked()
│   ├── ambassador.js     # ?ambassador=: resolveAmbassador() per la pagina, ambassadorOf() per l'invio
│   ├── questions.js   # LE DOMANDE del form, come dati: è il file da rifinire
│   ├── page.js        # prepara i DATI della pagina; l'HTML sta in templates/
│   ├── server.js      # routing: le rotte di §7
│   └── commons/
│       ├── configuration_client.js # COPIA generata dal deployer: non modificare qui
│       ├── sso_client.js   # COPIA generata dal deployer: non modificare qui
│       └── spec_front_matter.js # COPIA generata dal deployer: non modificare qui
├── templates/
│   ├── page.njk            # la pagina
│   ├── login_done.njk      # la paginetta che chiude la finestra del login
│   ├── prespec.md.njk      # la pre-specifica (markdown, senza autoescape)
│   ├── analysis.njk        # la pagina dell'analisi, vuota
│   ├── message.njk         # una pagina con un messaggio: gli esiti andati storti
│   ├── macros/fields.njk   # i campi, disegnati dai dati di questions.js
│   ├── partials/driver_box.njk  # il box del driver
│   ├── partials/access.njk # testata e modale del login, come macro
│   ├── partials/driver_work.njk # il blocco del lavoro autonomo
│   ├── partials/ambassador_box.njk # il box dell'ambassador
│   ├── fragments/          # testata e colonna del driver, da sole, per /session-fragment
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
4. `resolveDriverLink()` guarda i parametri dell'URL e decide lo stato (§5).
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

Gli stati possibili sono definiti in `src/driver_link.js`:

| Stato | Quando | Cosa vede l'utente |
|---|---|---|
| `none` | Nessuno dei due parametri | Nessun box |
| `discount_applied` | Sconto letto **e** il suo driver esiste ed è abilitato | Il **nome** del driver, e l'avviso verde con la percentuale |
| `discount_expired` | La lettura dello sconto **fallisce** | "Non è applicabile: con ogni probabilità è scaduto. Vai avanti lo stesso: il driver lo assegniamo noi" |
| `discount_driver_missing` | Sconto letto, ma il suo `driver.uid` non si trova | "Il driver non si trova più. Contattalo per un codice nuovo" |
| `discount_driver_disabled` | Sconto letto, ma il suo driver ha `enabled` diverso da `true` | "Il driver a cui è collegato, X, non è abilitato a seguire progetti, e con lui non possiamo proseguire. Contattalo". Il codice sconto **non** viaggia col form |
| `driver_applied` | `?driver=` con un uid che esiste, driver abilitato | Il **nome** del driver, e nient'altro: non c'è nessun avviso |
| `own_link` | Lo sconto o il link sono di **chi ha fatto il login** | Nessun box: a spiegarlo è il blocco del lavoro autonomo (§6.3) |
| `driver_unknown` | `?driver=` con un uid che non esiste | "Il driver di questo link non si trova più. Contattalo" |
| `driver_disabled` | `?driver=` con un driver non abilitato | "Il driver di questo link, X, non è abilitato a seguire progetti, e con lui non possiamo proseguire. Contattalo" |

Negli stati `discount_applied` e `driver_applied` il driver è **riconosciuto**: c'è un nome da
mostrare e un `uid` che viaggia col form come campo nascosto. L'insieme è la costante `RESOLVED`
in `driver_link.js`, e la pagina chiede `isResolved()` invece di elencare gli stati a mano.
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

All'invio il valore **si ricontrolla sul server** (`linkTermsOf()` in `src/project_driver.js`):
un campo nascosto non impedisce a nessuno di mandare quello che vuole. Lo sconto si rilegge
(`GET /discounts/{code}`) e il driver del progetto diventa quello dello sconto; il driver si
rilegge (`GET /drivers/{uid}`) e vale solo se esiste, è `enabled: true` e non è chi compila. Se
non vale, driver e sconto cadono insieme e il driver lo assegna il sistema. Se anagraphics non
risponde l'invio non si registra (`503`).

### 5.6 L'ambassador (`?ambassador=<uid>`)

L'ambassador è un driver che ha invitato l'utente a usare webtools: se il progetto va a buon fine
gli spetta metà della fee di sistema. Il box **Invito** mostra il suo nome e la frase «Ti ha
invitato a usare webtools.», e compare solo se:

- nell'URL non c'è `?discount=` né `?driver=` (con uno dei due, `ambassador` si ignora);
- l'uid è quello di un driver, cercato nell'elenco di `GET /drivers` (abilitato o no: per invitare
  basta essere registrati come driver);
- chi ha fatto il login non è quel driver;
- la casella del lavoro autonomo non è segnata: segnata, il box sparisce
  (`:has(#autonomous-work:checked)`, senza JavaScript).

In ogni altro caso, compreso l'elenco dei driver irraggiungibile, il box non c'è e la pagina non
dice niente. L'uid viaggia nel campo nascosto `ambassador`.

**All'invio si ricontrolla** (`ambassadorOf()`): stesse condizioni, con lavoro autonomo, link e
proprio uid letti dal form e dalla sessione, e il driver cercato con `GET /drivers/{uid}`. Se esiste,
il suo uid va in `billing.ambassador_uid`; se non esiste, `null`. Se anagraphics non risponde
l'invio non si registra (`503`), invece di perdere l'ambassador.

---

## 6. L'accesso

La pre-analisi si compila **anche da sloggati**: chi arriva dal sito vetrina non ha un conto e non
gli si chiede di farselo per rispondere a delle domande. Il conto serve al passo dopo, per
proseguire, e lì viene chiesto.

### 6.1 Che cosa vede l'utente

| Dove | Da sloggato | Da loggato |
|---|---|---|
| Testata | "Entra", che apre il login **in una finestra a parte** | Il nome della persona e "Esci" |
| "Manda la richiesta" | Il form non parte: si apre una **modale** "Per mandare la richiesta serve un account", con "Entra" e "Registrati" | Il form parte |
| "Carica" (analisi già pronta) | Il file non parte: si apre una **modale** "Per caricare un'analisi serve un account"; a login finito il file parte da solo | Il file parte |

Nessun avviso fisso nella pagina: la modale compare solo al clic su un'azione che richiede il
conto, e la finestra del login si apre solo dai suoi link. Senza JavaScript il form parte comunque
e il server risponde che serve l'accesso.

**Il login si apre in una finestra a parte, e questa pagina non si ricarica mai.** Se il login
sostituisse la pagina, tutto quello che è stato scritto nel form andrebbe perso: non c'è nessuna
bozza salvata da nessuna parte. Finito il login la finestra **si chiude da sola** e la pagina di
partenza **si aggiorna sul posto**: cambiano la testata e la colonna del driver, la modale si
chiude, il form resta esattamente com'era.

Se il sso non risponde, la testata e la modale lo dicono e il form resta compilabile: **niente
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
5. La pagina di partenza riceve il messaggio e chiede `GET /session-fragment`: riceve i pezzi
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
casella, «è un lavoro che porto io», e l'informativa: nel lavoro autonomo al prezzo non si
aggiunge la quota del driver, lo si paga a consumo con i token del driver più la fee di sistema.
Il link «Vuoi saperne di più?» apre in una **nuova scheda** la sezione
`lavora-con-noi.html#lavoro-autonomo` del front-gate, il
cui indirizzo è `subsystems_infos.front_gate.url`: nella stessa scheda il driver perderebbe le
risposte già scritte. Segnata la casella, il box del driver qui sopra si **spegne** — in grigio, meno
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
| `GET /session-fragment` | `200` JSON `{logged, header, gate, aside}`: i pezzi della pagina già resi, per il browser che aggiorna senza ricaricare. Accetta gli stessi `?discount=`, `?driver=` e `?ambassador=` della pagina, perché la colonna destra dipende da quelli |
| `GET /logout` | `303` verso `/ui/logout` del sso, togliendo il nostro cookie |
| `POST /submit` | L'invio del form (§14.1): `303` verso `/analysis/{id}`, oppure una pagina di messaggio con `400`/`401`/`413`/`503` |
| `GET /analysis/{id}` | La pagina dell'analisi, solo per il proprietario del progetto. Altrimenti `401` (sloggato) o `404` (inesistente o di un altro) |
| `POST /upload` | Una specifica già pronta (§14.4): API JSON con codici stabili |
| `POST /locale` | Il selettore della lingua in testata (`locale`, `return_to`): scrive il cookie comune e torna alla pagina (`303`). Per chi è entrato salva la lingua anche nella sessione e nel profilo, tramite il sso. `400 INVALID_LOCALE`, `413 BODY_TOO_LARGE` |
| `GET /<file>` | Un file di `public/` col suo content-type; `404` se non esiste |
| Altri metodi | `405` |
| Errore imprevisto | `500`, con lo stack nel log |

I percorsi statici vengono normalizzati e verificati: un percorso che uscirebbe da `public/`
(`/../package.json`) riceve `404`/`403`, non il file.

Gli errori delle pagine **non** hanno un codice stabile in JSON: sono pagine per un browser. Fa
eccezione `POST /upload`, che risponde al JavaScript della pagina e segue il contratto a codici.

---

## 8. Configurazione

Il server legge la sua configurazione **all'avvio** da anagraphics, `GET /configuration/preanalyst`. La fonte è `webtools/configurator/configuration/preanalyst.json`; la carica in Mongo `webtools/configurator/load_configuration.sh` (lo fa già `start.sh`). Nessun default: se manca il documento, un campo, o un campo è del tipo sbagliato, il server scrive `webtools_preanalyst non parte: …` con il percorso del campo ed esce con 1. Dopo una modifica: `webtools/configurator/start.sh --restart`.

Dall'ambiente arrivano solo `WEBTOOLS_ANAGRAPHICS_URL` e `WEBTOOLS_CONFIGURATION_TIMEOUT_MS`, che `--start` carica da `webtools/configurator/bootstrap.env`. `WEBTOOLS_ANAGRAPHICS_URL` è anche l'indirizzo di anagraphics per tutte le altre chiamate.

| Campo | Oggi | A che serve |
|---|---|---|
| `listen.host` | `127.0.0.1` | Interfaccia di ascolto |
| `listen.port` | `9200` | Porta. `9100` è di anagraphics |
| `public_url` | `http://127.0.0.1:9200` | Il nostro indirizzo visto da fuori: ci torna il browser dopo il login, ed è quello che dichiariamo al sso allo scambio del biglietto |
| `subsystems_infos.anagraphics.timeout_ms` | `5000` | Taglio delle chiamate verso anagraphics |
| `subsystems_infos.sso.url` | `http://127.0.0.1:9300` | Dove sta il sso |
| `subsystems_infos.sso.timeout_ms` | `5000` | Taglio delle chiamate verso il sso |
| `subsystems_infos.workspaces.url` | `http://127.0.0.1:9400` | Dove sta webtools-workspaces |
| `subsystems_infos.workspaces.timeout_ms` | `5000` | Taglio delle chiamate verso workspaces |
| `subsystems_infos.front_gate.url` | `http://127.0.0.1:9000` | Il sito vetrina: il blocco del lavoro autonomo rimanda alla sua pagina `lavora-con-noi.html`. Solo `http`/`https`: finisce in un `href` |
| `session.cookie_name` | `webtools_preanalyst` | Il **nostro** cookie di sessione. Deve restare diverso da quello del sso |
| `form.body_max_bytes` | `524288` | Dimensione massima dell'invio del form |
| `form.answer_max_chars` | `20000` | Oltre, una risposta aperta si tronca |
| `upload.max_bytes` | `10485760` | Dimensione massima di una specifica caricata |
| `upload.accept` | `.md` | Quello che la finestra di scelta del browser propone. Non è un controllo |
| `i18n.locales` | `["en", "it"]` | Le lingue offerte: ognuna ha il suo catalogo in `commons/i18n/locales/` |
| `i18n.fallback_locale` | `en` | La lingua di riserva, e quella da cui si prendono le chiavi che mancano in un'altra |
| `i18n.cookie_name` | `webtools_locale` | Il cookie della lingua, **uguale in tutti i sottosistemi** |
| `i18n.cookie_max_age_seconds` | `31536000` (un anno) | Quanto dura la scelta della lingua nel browser |
| `i18n.body_max_bytes` | `1024` | Il corpo più grande accettato da `POST /locale` |

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
- Debug in primo piano, dalla cartella del progetto: `set -a; source ../configurator/bootstrap.env; set +a; npm start` (Ctrl+C per fermarlo).

Servono anche anagraphics, sso e workspaces accesi: `webtools/configurator/start.sh` li avvia
tutti nell'ordine giusto.

### 9.2 Stile e client condivisi
Alcuni file di questo sottosistema sono **copie generate** e non si modificano qui:
`public/commons.css` (più `public/fonts/`), `src/commons/sso_client.js`, `public/sso_popup.js`,
`src/commons/spec_front_matter.js` e `templates/commons/base.njk`. Si modificano gli
originali in `webtools/commons/` e si rilancia il deployer:

```sh
webtools/configurator/deploy.sh          # stile + client del sso
webtools/configurator/deploy.sh style    # solo lo stile
webtools/configurator/deploy.sh sso      # solo il client del sso
webtools/configurator/deploy.sh specs    # solo il modulo del front matter
```

Lo stile **locale** è `public/styles.css`, e quello si modifica a mano.

---

## 10. Stile della pagina

- Da `commons.css`: font, token dei colori, `.container`, `.site-header`, `.brand*`, `.card`,
  `.card-head`, `.eyebrow`, `.reveal`, i campi (`.field`, `.field-label`, `.field-hint`,
  `.required`, `.input`) e gli avvisi `.notice` nelle due varianti `notice-ok` (verde salvia) e
  `notice-warn` (giallo nota).
- Da `public/styles.css`, solo roba di questa pagina: impaginazione `.gate*`, sezioni del form,
  scelte `.choice*`, colonna destra, blocchi del driver e del caricamento.
- La tendina bloccata si vede: sfondo spento, niente ombra, niente freccia, cursore `not-allowed`.

---

## 11. Test

**Non ci sono test automatici.** È un buco noto, non una scelta: `driver_link.js` è logica pura con
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
| Anagraphics irraggiungibile dopo l'avvio (spento mentre preanalyst è acceso) | `200`, form presente, box con l'avviso "non riusciamo a dirti chi è il driver", e nel log `TypeError fetch failed` |
| Idem, ma con `?discount=…&driver=…` nel link | `200`, i due valori restano come campi nascosti e l'avviso dice che il link non va perso |
| `/commons.css`, `/styles.css`, `/fonts/inter.woff2`, `/assets/mark.svg` | `200` col content-type giusto |
| `/../package.json` | `404` |

---

## 12. Troubleshooting

| Sintomo | Causa probabile | Cosa fare |
|---|---|---|
| Box con "non riusciamo a dirti chi è il driver" | Anagraphics spento | `webtools/anagraphics/webtools_anagraphics.sh --start` |
| Idem, ma anagraphics è acceso | `access.allowed_ips` di anagraphics non contiene l'IP di questo server, oppure Mongo è giù | Log: `HTTP 403 IP_NOT_ALLOWED` o `HTTP 503 DATABASE_UNAVAILABLE` |
| Tendina vuota, senza avvisi | Nessun driver nel database | `uv run python -m scripts.seed` in `webtools/anagraphics/` |
| Ogni sconto risulta "scaduto" | Anagraphics risponde ma non trova i codici | `mongosh webtools --eval 'db.discounts.find({}, {_id:0}).toArray()'` |
| Pagina senza stile o font | Deployer mai lanciato dopo aver creato `public/` | `webtools/configurator/style_deployer/deploy.sh` |
| `--start` dice "già in esecuzione" ma non risponde | PID riciclato da un altro processo | Il controllo su `ps` lo esclude: guarda il log |
| `EADDRINUSE` nel log | Porta 9200 occupata da altro | Cambiare `listen.port` (e `public_url`) in `configurator/configuration/preanalyst.json`, più gli indirizzi che puntano qui negli altri file (`sso.json`, `front-gate.json`); poi `start.sh --restart` |

---

## 13. Limiti noti e debito tecnico

- **Nessun test automatico** (§11).
- Se l'invio fallisce dopo la creazione del progetto e anche la cancellazione fallisce, il
  progetto resta **senza pre-specifica**. Succede solo se anagraphics cade in quel preciso
  momento, e nel log c'è la riga `PROGETTO RIMASTO SENZA PRE-SPECIFICA`.
- Un invio che non passa i controlli del server (può succedere solo aggirando quelli del
  browser) finisce su una pagina di messaggio: le risposte si recuperano solo con "indietro".
- La pagina dell'analisi è vuota.
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

## 14. L'invio del form e le specifiche

### 14.1 `POST /submit`

Il form si manda a `/submit` come `application/x-www-form-urlencoded`. Nell'ordine:

1. serve l'accesso: da sloggati `401`, col sso giù `503`;
2. `submission_id` deve essere un UUID, generato quando la pagina è stata resa;
3. le risposte si ripuliscono (`readAnswers` in `src/prespec.js`): codici non previsti scartati,
   testi rifilati e tagliati a `form.answer_max_chars` caratteri (oggi 20.000); `need` è obbligatoria;
4. `POST /projects` in anagraphics con `owner_uid`, `submission_id`, `review` e `billing`
   (§14.5): driver e sconti sono dati del **progetto**, non della pre-specifica;
5. la pre-specifica si rende e va a workspaces con `X-Spec-Origin: system`;
6. `303` verso `/analysis/{project_id}`. Il `303` fa sì che ricaricare la pagina dell'analisi non
   rimandi il form.

Due protezioni:
- **invio ripetuto**: lo stesso `submission_id` fa rispondere ad anagraphics `200` col progetto già
  nato. In quel caso la pre-specifica non si riscrive e si va direttamente alla pagina dell'analisi;
- **pre-specifica non scritta**: se workspaces non risponde, il progetto si cancella
  (`DELETE /projects/{id}`) e l'utente vede che la richiesta non è stata registrata.

Il bottone d'invio sta dentro il cancello dell'accesso (`partials/access.njk`): è abilitato solo
per chi è entrato, e dopo un login nella finestra a parte il browser lo riceve abilitato insieme
al resto del frammento. Il form non ha più `novalidate`: i campi obbligatori li controlla il
browser, e il server li ricontrolla.

### 14.2 La pre-specifica

Template `templates/prespec.md.njk`, reso da `src/prespec.js` con un ambiente nunjucks **senza
autoescape**: è markdown, e l'escape dell'HTML trasformerebbe `&` e `<` del cliente in entità.

- **Front matter**: `project_id`, `kind: prespec`, `template: prespec/1`, `language` (la lingua della pagina, es. `it`), e in
  `answers` i **codici** delle risposte chiuse (`today`, `users`, `devices`, `volume`,
  `personal_data`, `existing_data`). Un programma li legge senza interpretare niente. Mai testo
  scritto dall'utente, quindi niente chiavi YAML iniettate.
- **Le skill non vanno nel front matter.** L'elenco delle caselle è aperto e ha accanto un campo
  libero: un codice da solo racconterebbe metà della risposta.
- **Corpo in inglese**, sezione per sezione, con la domanda e la risposta chiusa in chiaro.
- **Le risposte aperte restano testuali**, nella lingua del cliente, dentro un blockquote: un
  `## titolo` scritto dal cliente resta testo e non diventa una sezione.
- I campi vuoti si scrivono `Not provided.`.
- **Open points**: i campi vuoti e le risposte `unknown`. Le skill e il loro "Altro" contano come
  una risposta sola (`group` in `questions.js`) e mancano solo se mancano tutte e due.
- Niente nome, email, sconto o driver: il documento va a un fornitore AI.
- La chiave `webtools:` (origine, versione, chi, quando) la timbra workspaces al salvataggio.

Le etichette inglesi stanno in `questions.js` (`spec`), e le opzioni sono
`[codice, testo per la pre-specifica]`. I testi per il cliente (domande, spiegazioni, esempi,
risposte) stanno nei cataloghi delle lingue, sotto `preanalyst.questions.*`. I codici sono in
inglese e non cambiano quando si riscrive il testo.

`language` nel front matter è la lingua della pagina da cui è partito l'invio: è quella in cui il
cliente ha scritto le risposte aperte.

### 14.3 La pagina dell'analisi

`GET /analysis/{id}`: la vede solo chi possiede il progetto (`owner_uid` uguale all'`uid` della
sessione). Un progetto inesistente o di un altro risponde `404` con lo stesso messaggio. Per ora
c'è solo il guscio, con chi è entrato in testata: qui arriverà la chat.

### 14.4 `POST /upload`

Una specifica già pronta: un `.md` con il `project_id` nel front matter.

```markdown
---
project_id: 1f251606-bdba-40c4-bbee-bfedc6e57f70
---
# …
```

| Caso | Risposta |
|---|---|
| Valido, progetto dell'utente | `201 {"received":true,"name":…,"project_id":…,"version":N}` |
| Sloggato | `401 NOT_LOGGED` |
| Senza `X-File-Name` | `400 MISSING_FILE_NAME` |
| Corpo vuoto | `400 EMPTY_FILE` |
| Oltre `upload.max_bytes` | `413 FILE_TOO_LARGE` |
| Non UTF-8 (un PDF, un Word) | `400 NOT_UTF8` |
| Front matter rotto | `400 INVALID_FRONT_MATTER` |
| Senza `project_id` | `400 MISSING_PROJECT_ID` |
| `project_id` non UUID | `400 INVALID_PROJECT_ID` |
| Progetto inesistente **o di un altro utente** | `404 PROJECT_NOT_FOUND` (stessa risposta: non si scopre quali id esistono) |
| sso, anagraphics o workspaces giù | `503 SSO_UNAVAILABLE` / `ANAGRAPHICS_UNAVAILABLE` / `WORKSPACES_UNAVAILABLE` |

In ogni caso d'errore **il file non si conserva**. Se è valido va a workspaces con
`X-Spec-Origin: third_party`: l'origine la decide il canale, e un file caricato che dichiara
`origin: system` viene salvato come `third_party`.

### 14.5 `review` e `billing` del progetto

`projectTerms()` in `src/server.js`, con driver, sconto e ambassador già ricontrollati
(§5.5, §5.6):

| Caso | `review` | `billing` |
|---|---|---|
| Nessun link | `{driver_uid: null, preset: false}` (lo assegnerà il sistema) | nessuno sconto; `ambassador_uid` se c'era un ambassador valido (§5.6) |
| Link di un driver abilitato (`?driver=` o `?discount=`) | il driver del link, `preset: true` | `discount_code` del link, se c'era |
| Link di un driver non abilitato, inesistente o proprio | `{driver_uid: null, preset: false}` | nessuno sconto |
| Lavoro autonomo (solo se chi invia è un driver) | il driver stesso, `preset: true` | `autonomous_work: true`, `discount_code: null`, `ambassador_uid: null` |

Il codice sconto del link e il lavoro autonomo **si escludono**. Il proprio link non arriva mai
qui: la pagina non emette i campi nascosti quando il link è del driver che compila. Un
`autonomous_work` mandato da chi non è driver si ignora.

---

## 15. Prossimi passi

1. Test di `driver_link.js` e di `prespec.js` con `node --test`.
2. La chat di analisi, nella pagina `/analysis/{id}`.
3. Collegare il bottone "Inizia" del `front-gate` a questa pagina.
4. Decidere cosa fa davvero il codice sconto: chi lo emette, su cosa si applica, quando scade.
   Oggi `discounts` ha una percentuale che nessuno usa, e "scaduto" è un messaggio senza una
   data dietro.
5. Decidere se il link `?driver=` deve lasciare traccia a valle: oggi sceglie il driver e basta,
   ma è anche l'unico modo per sapere che un progetto arriva da lui senza passare da uno sconto.

---

## 16. Changelog

| Data | Versione | Modifica |
|---|---|---|
| 2026-09-22 | 0.16.0 | **Lingue.** Tutti i testi della pagina, delle domande, dei messaggi e di `upload.js` nei cataloghi comuni (`commons/i18n/locales/`, chiavi `preanalyst.*`); `questions.js` tiene solo struttura e testi inglesi della pre-specifica, e le opzioni diventano `[codice, testo per la pre-specifica]`. Id delle sezioni in inglese. Selettore della lingua e `POST /locale`, che per chi è entrato salva la lingua nella sessione e nel profilo. `language` della pre-specifica = lingua della pagina. Configurazione: sezione `i18n`. |
| 2026-09-22 | 0.15.0 | Allineamento alla pagina "Lavora con noi". **Driver e sconto ricontrollati all'invio** (`src/project_driver.js`): valgono solo con un driver esistente, abilitato e diverso da chi compila; lo sconto porta il suo driver. Box ambassador: «Ti ha invitato a usare webtools.». Informativa del lavoro autonomo: a consumo con i token, più la fee di sistema; il link porta a `#lavoro-autonomo`. |
| 2026-09-22 | 0.14.0 | **Driver abilitati**: con `?driver=` o `?discount=` il driver trovato deve avere `enabled: true`. Nuovi stati `driver_disabled` e `discount_driver_disabled`: l'utente legge che con quel driver non si prosegue e che va contattato; il progetto lo assegniamo noi, e lo sconto di un driver non abilitato non viaggia col form. L'ambassador non richiede l'abilitazione. |
| 2026-09-22 | 0.13.0 | **Ambassador** (§5.6): `?ambassador=<uid di un driver>` mostra il box "Invito" se non ci sono link di un driver né lavoro autonomo; all'invio l'uid, ricontrollato con `GET /drivers/{uid}`, va in `billing.ambassador_uid`. Nuovi `src/ambassador.js`, `partials/ambassador_box.njk`, `findDriver()` in `anagraphics.js`. |
| 2026-09-22 | 0.12.0 | **Via lo sconto sulla fee del lavoro autonomo**: dalla pagina, dalla configurazione (`billing.autonomous_fee_discount_percent`) e da `billing` del progetto. Il blocco "Lavoro autonomo" dice che non c'è la quota del driver e che si paga a consumo più la fee di sistema, con il link «Vuoi saperne di più?» alla pagina "Lavora con noi" del front-gate, in una nuova scheda (senza scritte che lo annuncino). Configurazione nuova: `subsystems_infos.front_gate.url`. |
| 2026-09-21 | 0.11.0 | **Configurazione dal sottosistema di configurazione.** All'avvio si legge `GET /configuration/preanalyst` da anagraphics (client comune `commons/configuration/configuration_client.js`, copia in `src/commons/`); via tutte le variabili d'ambiente e tutti i default, tranne il bootstrap `WEBTOOLS_*`. Senza configurazione il server non parte. Il taglio delle risposte aperte (prima la costante `MAX_TEXT_LENGTH` in `prespec.js`) diventa `form.answer_max_chars`. |
| 2026-09-21 | 0.10.0 | **L'invio è collegato** (§14). `POST /submit` crea il progetto in anagraphics, scrive la pre-specifica in webtools-workspaces e manda a `/analysis/{id}`, pagina vuota riservata al proprietario. `submission_id` contro i doppi invii; driver e sconti nel progetto, in `review` e `billing`; cancellazione del progetto se la pre-specifica non si scrive. `POST /upload` accetta solo un `.md` con `project_id` nel front matter, verifica progetto e proprietario e lo conserva come `third_party`. Codici delle opzioni in inglese (`mobile`, `unknown`, …) con etichette inglesi per la pre-specifica. Il bottone d'invio sta nel cancello dell'accesso e si abilita col login. Nuova dipendenza `yaml`. `referral.js` rinominato **`driver_link.js`** (`resolveDriverLink`, `withoutOwnLink`): legge il link di un driver per il box, e non va confuso con i dati del progetto. |
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
