# front-gate — sito vetrina

Un piccolo server Node (`webtools_front_gate`) rende le pagine del sito dai template in
`templates/` e serve i file statici di `public/`. I valori che le pagine ricevono vengono dalla
configurazione del front-gate in anagraphics (`GET /configuration/front-gate`).

## Configurazione

Letta **all'avvio** da anagraphics (`GET /configuration/front-gate`); la fonte è
`webtools/configurator/configuration/front-gate.json`, caricata in Mongo da
`webtools/configurator/load_configuration.sh` (lo fa già `start.sh`). Nessun default: se
anagraphics non risponde, o un campo manca o non è valido, il server scrive
`webtools_front_gate non parte: …` con il percorso del campo ed esce con 1. Un cambio si vede
dopo `webtools/configurator/start.sh --restart`.

| Campo | Uso |
|---|---|
| `listen.host`, `listen.port` | Dove il server si mette in ascolto (oggi `127.0.0.1:9000`) |
| `subsystems_infos.preanalyst.url` | Il tasto "Inizia" apre questo indirizzo, nella stessa scheda: il form della pre-analisi. Solo `http`/`https`: il valore finisce in un `href` |
| `screen_infos.pricing.standard_price_cents` | Il prezzo del tier standard, in centesimi di euro, intero ≥ 0: `40000` diventa "400 €" in italiano e "€400" in inglese (i decimali compaiono solo se ci sono centesimi) |
| `i18n.locales`, `i18n.fallback_locale` | Le lingue offerte (`["en", "it"]`) e quella di riserva (`en`) |
| `i18n.cookie_name`, `i18n.cookie_max_age_seconds` | Il cookie della lingua, **uguale in tutti i sottosistemi** (`webtools_locale`), e quanto dura |
| `i18n.body_max_bytes` | Il corpo più grande accettato da `POST /locale` |

Dall'ambiente arrivano solo le variabili di `webtools/configurator/bootstrap.env`, che `--start`
carica da sé.

## Struttura

```
front-gate/
├── package.json
├── webtools_front_gate.sh   avvio e arresto (--start | --stop), con file PID
├── src/
│   ├── index.js             avvio del server: legge la configurazione, o esce con 1
│   ├── server.js            rotte: pagine e file statici
│   ├── page.js              indirizzo → template, e dati passati ai template
│   ├── settings.js          la configurazione `front-gate` da anagraphics → impostazioni
│   ├── commons/configuration_client.js   copia generata dal deployer `configuration`
│   └── commons/i18n/        copia generata dal deployer `i18n`: modulo delle lingue e cataloghi
├── templates/               le pagine (.njk, nunjucks con autoescape)
│   ├── index.njk, che-cos-e.njk, esempi.njk, come-funziona.njk, quanto-costa.njk, contatti.njk
│   ├── lavora-con-noi.njk   ambassador, driver, lavoro autonomo
│   ├── layout.njk           il guscio comune: head, header, footer
│   └── partials/
│       ├── header.njk       menu, selettore della lingua e Contatti, con la voce corrente evidenziata
│       ├── footer.njk
│       └── start.njk        il tasto "Inizia"
└── public/                  file statici
    ├── css/styles.css       stile locale
    ├── css/commons.css      copia generata dal deployer dello stile, come css/fonts/
    ├── js/main.js           menu mobile
    └── assets/mark.svg
```

`css/commons.css` e `css/fonts/` non si modificano qui: l'originale sta in `webtools/commons/style/`
e si distribuisce con `webtools/configurator/deploy.sh style`. Lo stesso per
`src/commons/configuration_client.js`: originale in `webtools/commons/configuration/`, deployer
`configuration`.

## Avvio

```sh
./webtools_front_gate.sh --start   # in background, PID in webtools_front_gate.pid, log in webtools_front_gate.log
./webtools_front_gate.sh --stop
set -a; source ../configurator/bootstrap.env; set +a; npm start   # in primo piano, per debug
```

Le dipendenze si installano con `npm install`.

## Rotte

| Richiesta | Risposta |
|---|---|
| `GET /`, `GET /<pagina>.html` | la pagina, resa da `templates/<pagina>.njk` |
| `GET /<file>` | `public/<file>` |
| `POST /locale` | il selettore della lingua (`locale`, `return_to`): scrive il cookie comune e torna alla pagina (`303`). `400 {"error":"INVALID_LOCALE"}`, `413 {"error":"BODY_TOO_LARGE"}` |
| file inesistente, o fuori da `public/` | `404 {"error":"ROUTE_NOT_FOUND"}` |
| altro metodo diverso da `GET`/`HEAD` | `405 {"error":"METHOD_NOT_ALLOWED"}` |
| errore imprevisto | `500 {"error":"INTERNAL_ERROR"}` |

Ogni pagina estende `layout.njk`, imposta `page`, `title` e `description` e riempie il blocco
`main`. Header e footer esistono in un posto solo: una voce di menu si aggiunge in
`partials/header.njk`.

## Lingue

Nei template non c'è testo: ogni frase è una chiave, `{{ t("front_gate.<pagina>.<pezzo>") }}`,
e i testi stanno nei cataloghi comuni `webtools/commons/i18n/locales/<lingua>.json`, sotto
`front_gate`. Le frasi con un pezzo marcato dentro usano `t_html`. Le pagine sono nella lingua
del cookie `webtools_locale` (comune a tutti i sottosistemi), oppure in quella di
`Accept-Language`, oppure in inglese. Gli indirizzi delle pagine sono gli stessi in tutte le
lingue.

Per controllare che ogni chiave usata esista: `node webtools/commons/i18n/webtools_i18n_check.mjs`.

## Note sui contenuti

- "Lavora con noi" è l'ultima voce del menu, prima di "Inizia". Ci rimanda anche il blocco del
  lavoro autonomo della pre-analisi.

- Nessun nome di brand definitivo è stato inventato: il servizio si chiama "webtools"; "webtool" resta il nome comune del prodotto ("un webtool").
- Nessun indirizzo email è stato inventato: la pagina Contatti contiene un placeholder esplicito da
  sostituire prima della pubblicazione.
- Nessun testo legale è stato inventato: privacy, cookie, condizioni e dati fiscali vanno aggiunti
  quando saranno noti configurazione reale e dati del fornitore.
