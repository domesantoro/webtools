# webtools_anagraphics

Sottosistema interno (Python + MongoDB) con le configurazioni dei sottosistemi, l'anagrafica dei progetti, i driver e i loro codici sconto.
Per ora espone solo API di lettura.

Documentazione completa: `docs/subsystems/anagraphics/README.md` (nella root del workspace).

## Avvio e arresto

```sh
webtools/anagraphics/webtools_anagraphics.sh --start   # avvia in background, slegato dal terminale
webtools/anagraphics/webtools_anagraphics.sh --stop    # ferma
```

- PID: `webtools_anagraphics.pid`. Log: `webtools_anagraphics.log` (in append).
- `--stop` ferma solo il processo del file PID, e solo dopo aver verificato che sia `…/webtools/anagraphics/.venv/bin/python -m webtools_anagraphics`.
- Debug in primo piano, da questa cartella: `uv run python -m webtools_anagraphics` (Ctrl+C per fermarlo).

Prima volta, da questa cartella:
```sh
uv sync                        # ambiente e dipendenze
uv run python -m scripts.seed  # indici + dati iniziali (si può rilanciare)
```

## Collection

| Collection | Chiave (indice univoco) | Esempio |
|---|---|---|
| `configuration` | `subsystem` | `{"subsystem": "front-gate"}` |
| `anagraphics` | `project_id` | `{"project_id": "1f251606-bdba-40c4-bbee-bfedc6e57f70"}` |
| `drivers` | `uid` | `{"uid": "7633be3d-…", "username": "dome.santoro@gmail.com", "screen_name": "Dome"}` |
| `discounts` | `discount_code` | `{"discount_code": "e8013cf2-…", "driver": {"uid": "7633be3d-…", "screen_name": "Dome"}, "percentage": 5}` |

In `discounts` il driver è **ridondato** di proposito (`uid` + `screen_name`): chi legge uno sconto non deve rileggere il driver. Un cambio di `screen_name` va però propagato a mano. `percentage` è in punti percentuali: `5` significa 5%.

## Endpoint (`http://127.0.0.1:8100`)

- `GET /configuration/{subsystem}`: la conf del sottosistema, oppure `404 {"error":"CONFIGURATION_NOT_FOUND","subsystem":…}`.
- `GET /anagraphics/{project_id}`: il progetto, oppure `404 {"error":"PROJECT_NOT_FOUND","project_id":…}`.
- `GET /drivers`: `{"drivers":[…]}` con tutti i driver, ordinati per `uid`, con i soli `uid` e `screen_name` (niente `username`). Nessuna paginazione.
- `GET /drivers/{uid}`: il driver, oppure `404 {"error":"DRIVER_NOT_FOUND","uid":…}`.
- `GET /drivers/{uid}/discounts`: `{"uid":…, "discounts":[…]}` con tutti i codici del driver. Un driver senza codici dà `200` e lista vuota; un driver inesistente dà `404 DRIVER_NOT_FOUND`.
- `GET /discounts/{discount_code}`: il codice sconto, oppure `404 {"error":"DISCOUNT_NOT_FOUND","discount_code":…}`.

L'`_id` di Mongo non compare mai nelle risposte.

Ogni errore ha lo stato HTTP corretto e un codice stabile, `{"error": "<CODICE>"}`: `CONFIGURATION_NOT_FOUND`, `PROJECT_NOT_FOUND`, `DRIVER_NOT_FOUND`, `DISCOUNT_NOT_FOUND`, `ROUTE_NOT_FOUND`, `METHOD_NOT_ALLOWED`, `IP_NOT_ALLOWED` (403), `DATABASE_UNAVAILABLE` (503), `INTERNAL_ERROR` (500).
I codici sono definiti in `webtools_anagraphics/errors.py`, e la tabella completa è nella documentazione (§6.1).

## Pool di IP

Le richieste da IP fuori da `ALLOWED_IPS` ricevono `403`. Conta solo l'IP reale della connessione: `webtools_anagraphics/__main__.py` avvia uvicorn con `proxy_headers=False`.
Non avviare con `uvicorn webtools_anagraphics.main:app` direttamente.

## Variabili d'ambiente

Vengono passate con `--start`, per esempio `PORT=8200 ./webtools_anagraphics.sh --start`.

| Variabile | Default |
|---|---|
| `MONGO_URI` | `mongodb://localhost:27017` |
| `MONGO_DB` | `webtools` |
| `ALLOWED_IPS` | `127.0.0.1,::1` |
| `HOST` | `127.0.0.1` |
| `PORT` | `8100` |

## Test

```sh
uv run pytest        # 17 test
```

I test usano il database `webtools_test`, che viene cancellato alla fine.

In `drivers` c'è anche un driver di prova (`Prova`, `639718a3-…`), senza codici sconto.
