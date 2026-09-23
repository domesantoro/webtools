# webtools_sso

**Autenticazione**: login, stato della sessione, logout. Tre rotte per i programmi e tre
pagine per le persone — qui sta **l'unica pagina del sistema in cui si digita una password**.
Node, con **nunjucks** per le pagine (unica dipendenza).

Documentazione completa: `docs/subsystems/sso/README.md` (nella root del workspace).

## Avvio e arresto

```sh
webtools/sso/webtools_sso.sh --start   # avvia in background, slegato dal terminale
webtools/sso/webtools_sso.sh --stop    # ferma
```

- PID: `webtools_sso.pid`. Log: `webtools_sso.log` (in append).
- `--stop` ferma solo il processo del file PID, e solo dopo aver verificato che sia
  `node …/webtools/sso/src/index.js`.
- Debug in primo piano, da questa cartella: `npm start` (Ctrl+C per fermarlo).
- Dopo un `git clone` o un cambio di versione: `npm install` (una sola dipendenza, nunjucks).

**Serve anche anagraphics acceso**, dove stanno utenti e sessioni:
```sh
webtools/anagraphics/webtools_anagraphics.sh --start
```

## Le rotte (`http://127.0.0.1:9300`)

Per i programmi, in JSON:

| Rotta | Che cosa fa | Risposta |
|---|---|---|
| `POST /login` | `{"username":…,"password":…}` | `201 {"logged":true,"session":{…}}` oppure `401 INVALID_CREDENTIALS` |
| `GET /session` | `Authorization: Bearer <token>` | `200 {"logged":true,"session":{…}}` oppure `200 {"logged":false}` |
| `POST /logout` | `Authorization: Bearer <token>` | `200 {"logged":false}`, ripetibile |
| `POST /tickets/exchange` | `{"ticket":…,"service":…}` | La sessione a cui il biglietto dà accesso |

Per le persone, in HTML: `GET`/`POST /ui/login`, `GET /ui/logout`, `GET /ui/register`.

Errori delle rotte JSON: stato HTTP corretto e codice stabile, `{"error":"<CODICE>"}`.

## Il giro del login, in breve

Il browser si logga qui, ma il cookie che il sso mette vale solo per **questo** indirizzo: un
cookie non attraversa due porte diverse. Allora il sso rimanda il browser al sottosistema con un
**biglietto** nell'indirizzo; il sottosistema lo scambia da server a server (`/tickets/exchange`),
riceve la sessione e si mette il **proprio** cookie. Il biglietto vale un minuto e una volta sola,
quindi può stare in un indirizzo; il token della sessione, che dura ore, non ci passa mai.

Chi torna qui da un secondo sottosistema non ridigita la password: il cookie del sso lo riconosce
e si emette solo un altro biglietto. Questa è la parte *single* del single sign-on.

Un sottosistema non deve scrivere niente di tutto questo a mano: c'è
`webtools/commons/sso/sso_client.js`, che si porta in casa con
`webtools/configurator/deploy.sh sso`.

Tre cose da sapere prima di usarlo:

- **Le sessioni stanno in Mongo, non qui dentro.** Il sso non ha un database: le scrive e le
  rilegge da anagraphics. Un riavvio del sso non slogga nessuno.
- **`logged: false` e `503` non sono la stessa cosa.** Il primo dice che la sessione non vale, il
  secondo che l'archivio non risponde e quindi non lo sappiamo. Un `503` non va trattato come un
  logout, o basterà un guasto di Mongo per sloggare tutti.
- **Un login rifiutato dà sempre `INVALID_CREDENTIALS`**, che l'utente non esista, sia
  disattivato, non abbia una password o l'abbia sbagliata. Quale dei quattro sia, sta nel log.

La sessione è lo stesso documento conservato in anagraphics: `token`, `uid`, `username`,
`issued_at`, `expires_at`, `data` (oggi `screen_name` e `driver_uid`, fotografati al login).
Dura 8 ore dal login e non si allunga con l'uso.

## Stile delle pagine

`public/commons.css` e `public/fonts/` sono **copie generate** dal deployer: non si modificano
qui. Si modifica `webtools/commons/style/` e si lancia `webtools/configurator/deploy.sh style`.
Lo stesso vale per `src/commons/configuration_client.js` (originale in
`webtools/commons/configuration/`, deployer `configuration`).
`public/styles.css` è lo stile locale delle due pagine e si modifica a mano.

## Password

Non si impostano da qui: si scrivono in anagraphics, col comando in
`docs/subsystems/anagraphics/README.md` §8.5. Chi lo lancia deve chiudere anche le sessioni già
aperte di quell'utente: la password nuova da sola non le ferma.

Il formato conservato (scrypt, con i parametri dentro il documento) è descritto in
`docs/subsystems/anagraphics/README.md` §5.5. Qui si verifica soltanto.

## Configurazione

Letta all'avvio da anagraphics (`GET /configuration/sso`); la fonte è
`webtools/configurator/configuration/sso.json`. Nessun default: se manca qualcosa il server
non parte e il log dice quale campo. Dall'ambiente arrivano solo le variabili di
`webtools/configurator/bootstrap.env`, che `--start` carica da sé. Il significato dei campi è
nella documentazione completa (§6).

## Test

```sh
npm test    # 35 test, nessun server da accendere
```

Al posto di anagraphics c'è un archivio finto, guasti compresi. `tests/credentials.test.js`
contiene un hash prodotto davvero da Python: tiene insieme le due implementazioni di scrypt.
