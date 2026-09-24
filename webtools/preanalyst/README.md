# webtools_preanalyst

La **pre-analisi**: la pagina da cui il cliente entra nel flusso e, in futuro, la chat di analisi.
Node, con **nunjucks** per le pagine e **yaml** per il front matter delle specifiche.

- `POST /submit`: il form crea il progetto (anagraphics) con la sua pre-specifica .md
  (webtools-workspaces), la fa **prevalidare** e manda a `/analysis/{id}`, per ora vuota — oppure
  a `/?rejected={id}` se la richiesta non passa il cancello.
- `POST /upload`: una specifica .md già pronta, con il `project_id` nel front matter, per un
  progetto dell'utente.
- `GET /projects/{id}/rejection.pdf`: i dati del form dopo un rifiuto.

Il **prevalidator** (`src/prevalidator.js`) chiede a un modello se la richiesta sta dentro il
perimetro del servizio: sei esiti con la loro probabilità, più il flag interno `off_domain`. Due
esiti rifiutano — troppo grande, oppure roba che non potremmo costruire a nessuna dimensione — uno
rimanda l'utente al form, tre passano; il flag dice che è software sviluppabile ma non un webtool,
e non cambia il flusso. Il fornitore si
raggiunge attraverso `src/ai/`, una porta sola, e si cambia dalla configurazione (`ai.provider`).
I criteri stanno in `policies/`, copie generate da `configurator/policies/`: non si modificano qui.

Serve la chiave del fornitore in `webtools/configurator/secrets/preanalyst.json` (fuori da git):
senza, il server non parte.

Provare il prevalidator senza passare dal form — **fa una chiamata vera, quindi costa**:

```sh
set -a; source ../configurator/bootstrap.env; set +a
node scripts/prevalidate.js scripts/esempi/normale.md
```

Documentazione completa: `docs/subsystems/preanalyst/README.md` (nella root del workspace).

## Avvio e arresto

```sh
webtools/preanalyst/webtools_preanalyst.sh --start   # avvia in background, slegato dal terminale
webtools/preanalyst/webtools_preanalyst.sh --stop    # ferma
```

- PID: `webtools_preanalyst.pid`. Log: `webtools_preanalyst.log` (in append).
- `--stop` ferma solo il processo del file PID, e solo dopo aver verificato che sia
  `node …/webtools/preanalyst/src/index.js`.
- Debug in primo piano, da questa cartella: `set -a; source ../configurator/bootstrap.env; set +a; npm start` (Ctrl+C per fermarlo).
- Dopo un `git clone` o un cambio di versione: `npm install`.
- Test: `npm test` (`node --test`).

**Servono anche anagraphics, sso e webtools-workspaces accesi**. `webtools/configurator/start.sh`
li avvia tutti nell'ordine giusto.

## La pagina (`http://127.0.0.1:9200`)

Il form della pre-analisi (le domande stanno in `src/questions.js`). Il box del driver, a destra,
compare **solo** se nell'URL c'è `?discount=` o `?driver=`: chi arriva senza vede solo il form, e
la pagina non chiama nemmeno anagraphics.

**Il driver non si sceglie**: o lo porta il link, o lo assegniamo noi. Il box è informativo.

Un driver può mandare qui un cliente in due modi: `?discount=<codice sconto>`, che porta con sé uno
sconto, oppure `?driver=<uid>`, che **non ne porta nessuno**. In tutti e due i casi, se il driver
si trova, la tendina è bloccata.

| Caso | Cosa succede |
|---|---|
| `?discount=`, sconto valido e driver trovato | Nome del driver nel box, avviso verde con la percentuale |
| `?discount=`, lettura fallita | "Non è applicabile: probabilmente è scaduto", e il driver lo assegniamo noi |
| `?discount=`, driver dello sconto non trovato | "Non è applicabile: il driver non si trova, contattalo" |
| `?driver=`, uid trovato | Nome del driver nel box, nessun avviso |
| `?driver=`, uid non trovato | "Il driver di questo link non si trova, contattalo" |
| `?driver=` o `?discount=`, driver non abilitato | "Non è abilitato a seguire progetti, con lui non possiamo proseguire: contattalo"; il driver lo assegniamo noi e lo sconto non si applica |
| Tutti e due i parametri | Vince `discount`; `driver` viene ignorato e la cosa finisce nel log |
| Elenco dei driver irraggiungibile | `200`: il box dice che non riesce a identificarlo, e il form resta compilabile |
| `?ambassador=<uid>` senza gli altri due, uid di un driver | Box "Invito" con il nome; sparisce se si segna il lavoro autonomo. Uid sconosciuto: nessun box |

Le letture verso anagraphics le fa **questo server**, mai il browser: anagraphics accetta solo
chiamate dagli IP del suo pool.

## L'accesso

La pagina si compila **anche da sloggati**: il conto serve per proseguire, e lo si chiede lì. In
testata c'è "Entra" oppure il nome di chi è entrato con "Esci". Il bottone d'invio è abilitato solo
per chi è entrato; da sloggati sotto c'è il riquadro che chiede di entrare o registrarsi.

Il login **si apre in una finestra a parte**, di proposito: quello che si è scritto nel form non è
salvato da nessuna parte, e se il login sostituisse questa pagina andrebbe perso. Finito il login
la finestra **si chiude da sola** e questa pagina **si aggiorna sul posto** — cambiano testata e
riquadro, il form non viene toccato. Senza JavaScript funziona lo stesso, ma si torna a mano.

"Esci" (`GET /logout`) toglie il nostro cookie e manda al sso, che chiude la sessione: si esce da
tutti i sottosistemi, non solo da qui.

Col sso spento la pagina resta usabile e lo dice: **niente ferma la pre-analisi**.

Il dialogo col sso sta tutto in `src/commons/sso_client.js`, che è una copia generata.

## Stile e parti comuni

- `public/commons.css`, `public/fonts/`, `src/commons/sso_client.js`,
  `src/commons/configuration_client.js`, `public/sso_popup.js` e `templates/commons/base.njk`
  sono **copie generate** dal deployer: non modificarle qui. Si modificano gli originali in
  `webtools/commons/` e si lancia `webtools/configurator/deploy.sh`.

## Dov'è l'HTML

In `templates/`, non nel codice: `page.njk` è la pagina, `macros/fields.njk` disegna i campi a
partire dai dati di `src/questions.js`, `partials/driver_box.njk` è il box del driver.
`templates/commons/base.njk` è il guscio comune, ed è una copia generata.

`src/page.js` non contiene HTML: prepara i dati e basta. L'escape lo fa nunjucks da sé, e questo è
il motivo principale della scelta: qui ogni valore arriva dall'URL o dal database.
- `public/styles.css` è lo stile **locale** di questa pagina, e si modifica a mano.
- `public/assets/mark.svg` è una copia a mano di quello del front-gate.

## Configurazione

Letta all'avvio da anagraphics (`GET /configuration/preanalyst`); la fonte è
`webtools/configurator/configuration/preanalyst.json`. Nessun default: se manca qualcosa il
server non parte e il log dice quale campo. Dall'ambiente arrivano solo le variabili di
`webtools/configurator/bootstrap.env`, che `--start` carica da sé. Il significato dei campi è
nella documentazione completa (§8).

## Test

```sh
cd webtools/preanalyst
npm test
```

Coprono le funzioni che **decidono**: come si legge la risposta del prevalidator e che cosa se ne
fa (`tests/prevalidator.test.js`), e il conteggio dei giri di chi è tornato indietro
(`tests/server.test.js`). Non chiamano il fornitore, non hanno bisogno dei server accesi e non
costano niente. Restano scoperti `src/driver_link.js` e il resto: buco noto, non una scelta.
