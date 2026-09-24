# webtools_anagraphics

Sottosistema interno (Python + MongoDB) con la configurazione di tutti i sottosistemi (è il sottosistema di configurazione), i progetti, i driver e i loro codici sconto, gli utenti e le sessioni.
Si scrivono sessioni, biglietti e progetti; il resto è in sola lettura.

Documentazione completa: `docs/subsystems/anagraphics/README.md` (nella root del workspace).

## Avvio e arresto

```sh
webtools/anagraphics/webtools_anagraphics.sh --start   # avvia in background, slegato dal terminale
webtools/anagraphics/webtools_anagraphics.sh --stop    # ferma
```

- PID: `webtools_anagraphics.pid`. Log: `webtools_anagraphics.log` (in append).
- `--stop` ferma solo il processo del file PID, e solo dopo aver verificato che sia `…/webtools/anagraphics/.venv/bin/python -m webtools_anagraphics`.
- Debug in primo piano, da questa cartella: `set -a; source ../configurator/bootstrap.env; set +a; uv run python -m webtools_anagraphics` (Ctrl+C per fermarlo).

Prima volta, da questa cartella:
```sh
uv sync                        # ambiente e dipendenze
set -a; source ../configurator/bootstrap.env; set +a
uv run python -m scripts.seed  # indici + dati iniziali (si può rilanciare)
../configurator/load_configuration.sh   # la configurazione di tutti i sottosistemi
```

## Collection

| Collection | Chiave (indice univoco) | Esempio |
|---|---|---|
| `configuration` | `subsystem` | `{"subsystem": "front-gate", "listen": {…}, "subsystems_infos": {"preanalyst": {"url": …}}, "screen_infos": {"pricing": {"standard_price_cents": 40000}}}` — da `configurator/configuration/*.json` |
| `projects` | `project_id` (+ `submission_id`, sparse) | `{"project_id": "…", "owner_uid": "…", "submission_id": "…", "created_at": …, "state": "PREANALYSIS", "review": {…}, "billing": {…}}` |
| `drivers` | `uid` | `{"uid": "7633be3d-…", "username": "dome.santoro@gmail.com", "screen_name": "Dome"}` |
| `discounts` | `discount_code` | `{"discount_code": "e8013cf2-…", "driver": {"uid": "7633be3d-…", "screen_name": "Dome"}, "percentage": 5}` |

In `discounts` il driver è **ridondato** di proposito (`uid` + `screen_name`): chi legge uno sconto non deve rileggere il driver. Un cambio di `screen_name` va però propagato a mano. `percentage` è in punti percentuali: `5` significa 5%.

## Endpoint (`http://127.0.0.1:9100`)

- `GET /configuration/{subsystem}`: la conf del sottosistema, oppure `404 {"error":"CONFIGURATION_NOT_FOUND","subsystem":…}`.
- `GET /projects/{project_id}`: il progetto, oppure `404 {"error":"PROJECT_NOT_FOUND","project_id":…}`.
- `POST /projects`: crea un progetto (l'id lo genera anagraphics); lo stesso `submission_id` una seconda volta restituisce `200` e il progetto già nato. `DELETE /projects/{project_id}`: lo cancella.
- Utenti, sessioni e biglietti: vedi la documentazione completa (§6.8–6.15).
- `GET /drivers`: `{"drivers":[…]}` con tutti i driver, ordinati per `uid`, con i soli `uid`, `screen_name` ed `enabled` (niente `username`). Nessuna paginazione.
- `GET /drivers/{uid}`: il driver, oppure `404 {"error":"DRIVER_NOT_FOUND","uid":…}`.
- `GET /drivers/{uid}/discounts`: `{"uid":…, "discounts":[…]}` con tutti i codici del driver. Un driver senza codici dà `200` e lista vuota; un driver inesistente dà `404 DRIVER_NOT_FOUND`.
- `GET /discounts/{discount_code}`: il codice sconto, oppure `404 {"error":"DISCOUNT_NOT_FOUND","discount_code":…}`.

L'`_id` di Mongo non compare mai nelle risposte.

Ogni errore ha lo stato HTTP corretto e un codice stabile, `{"error": "<CODICE>"}`: `CONFIGURATION_NOT_FOUND`, `PROJECT_NOT_FOUND`, `DRIVER_NOT_FOUND`, `DISCOUNT_NOT_FOUND`, `ROUTE_NOT_FOUND`, `METHOD_NOT_ALLOWED`, `IP_NOT_ALLOWED` (403), `DATABASE_UNAVAILABLE` (503), `INTERNAL_ERROR` (500).
I codici sono definiti in `webtools_anagraphics/errors.py`, e la tabella completa è nella documentazione (§6.1).

## Pool di IP

Le richieste da IP fuori da `access.allowed_ips` ricevono `403`. Conta solo l'IP reale della connessione: `webtools_anagraphics/__main__.py` avvia uvicorn con `proxy_headers=False`.
Non avviare con `uvicorn webtools_anagraphics.main:app` direttamente.

## Configurazione

Nessun default: se manca qualcosa il server non parte (`webtools_anagraphics non parte: …` nel log).

- Dall'ambiente, caricate da `--start` da `webtools/configurator/bootstrap.env`: `WEBTOOLS_ANAGRAPHICS_URL` (da qui host e porta di ascolto), `WEBTOOLS_CONFIGURATION_TIMEOUT_MS`, `WEBTOOLS_MONGO_URI`, `WEBTOOLS_MONGO_DB`.
- Il resto dal documento `anagraphics` della collection `configuration`, letto da Mongo all'avvio: si scrive in `webtools/configurator/configuration/anagraphics.json`.

`scripts/load_configuration.py` carica i file di `configurator/configuration/` e, se gli si dà una seconda cartella, ci fonde sopra in profondità i **segreti** di `configurator/secrets/` (le chiavi delle API, che non possono stare in git). Lo fa `configurator/load_configuration.sh`.

## Test

```sh
uv run pytest        # 62 test
```

I test usano il database `webtools_test`, che viene cancellato alla fine.

In `drivers` c'è anche un driver di prova (`Prova`, `639718a3-…`), senza codici sconto.
