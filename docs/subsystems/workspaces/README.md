# Sottosistema `webtools-workspaces`

> Codice: `webtools/webtools-workspaces/`. Documento aggiornato al 2026-09-21, versione 0.2.0.

## 0. Scheda rapida

| | |
|---|---|
| Ruolo | Conserva i file dei progetti, oggi solo le specifiche, nel workspace di ogni progetto |
| Tecnologia | Node ≥ 20, `node:http`, una dipendenza (`yaml`) |
| Porta | **9400** (`listen.port` della configurazione) |
| Configurazione | Letta all'avvio da anagraphics (`GET /configuration/workspaces`). Nessun default: se manca, il server non parte (§4) |
| Avvio / arresto | `webtools/webtools-workspaces/webtools_workspaces.sh --start` / `--stop` |
| PID / Log | `webtools_workspaces.pid` / `webtools_workspaces.log`, nella cartella del sottosistema |
| Dati | Filesystem, sotto `storage.root` della configurazione (oggi `~/webtools_data/workspaces`) |
| Chi lo chiama | `webtools_preanalyst`, da server a server |
| Test | `npm test`: 13 test, nessun servizio acceso |

## 1. Ruolo

**Conserva e non decide.** Scrive le specifiche che gli arrivano e restituisce l'ultima. Non
verifica che il progetto esista, né di chi sia: lo fa chi chiama (preanalyst), prima di mandare
il file. È la stessa divisione di anagraphics.

Perché un servizio e non una cartella condivisa: quando le macchine saranno separate, il disco
sarà di una macchina sola. In più la difesa dai percorsi manipolati sta in un posto solo.

## 2. I file sul disco

```text
<storage.root>/
└── <project_id>/
    └── specs/
        ├── spec-v001.md
        └── spec-v002.md      ← vale l'ultima
```

- Il workspace di un progetto nasce alla prima specifica.
- `storage.root` sta **fuori dal repo**: sono file dei clienti, non codice.
- Il `project_id` deve essere un UUID in forma canonica minuscola. Il controllo sta in
  `commons/specs/spec_front_matter.js` (`isProjectId`) ed è anche la difesa dai percorsi: un id che lo
  passa non contiene né `/` né `..`.

### 2.1 Versioni

Ogni scrittura è una versione nuova e non si sovrascrive niente. Il file nasce **già completo**:
si scrive un temporaneo (`.incoming-<uuid>.tmp`) e lo si collega al nome della versione con
`link`, che fallisce se quel nome esiste già. In quel caso si riprova con il numero successivo,
fino a 20 volte. Di conseguenza:

- due scritture concorrenti non si prendono mai lo stesso numero;
- chi legge l'ultima versione non trova mai un file a metà.

### 2.2 La chiave riservata `webtools:`

Nel front matter di ogni file salvato il servizio scrive:

```yaml
webtools:
  origin: third_party        # system | third_party
  version: 2
  received_at: 2026-09-21T15:39:01.466Z
  uploaded_by: 8ff93901-673e-44ba-b05b-56011395dcba
```

La chiave si riscrive **sempre**, e quello che il file dichiarava lì dentro si scarta. `origin`
la decide chi chiama, in base al canale da cui il file è arrivato:
- `system`: la pre-specifica generata dal form;
- `third_party`: un file caricato.

Un file caricato che dichiara `origin: system` viene salvato come `third_party`. Il resto del
front matter e il corpo restano come sono.

Un file senza front matter ne riceve uno con la sola chiave riservata. Un front matter rotto
(YAML non valido, o non una mappa) viene rifiutato **prima** di toccare il disco: non resta
nemmeno la cartella del progetto.

## 3. API

Solo per i programmi. Errori: stato HTTP corretto e codice stabile, `{"error": "<CODICE>"}`.

### 3.1 `POST /projects/{project_id}/specs`

Corpo: il `.md` così com'è. Header obbligatori:
- `X-Spec-Origin: system | third_party`;
- `X-Uploaded-By: <uid>`.

| Esito | Stato | Body |
|---|---|---|
| Salvato | `201` | `{"project_id": …, "version": N}` |
| Id non valido | `400` | `INVALID_PROJECT_ID` |
| Origine mancante o sconosciuta | `400` | `INVALID_ORIGIN` |
| `X-Uploaded-By` mancante | `400` | `MISSING_UPLOADER` |
| Corpo vuoto | `400` | `EMPTY_SPEC` |
| Non UTF-8 | `400` | `NOT_UTF8` |
| Front matter rotto | `400` | `INVALID_FRONT_MATTER` |
| Oltre `storage.spec_max_bytes` | `413` | `SPEC_TOO_LARGE` (si risponde prima, poi si chiude) |

### 3.2 `GET /projects/{project_id}/specs/latest`

L'ultima versione, `text/markdown`, con l'header `X-Spec-Version`. Se il progetto non ha
specifiche, `404 SPEC_NOT_FOUND`. Serve agli step successivi.

### 3.3 Comuni

`403 IP_NOT_ALLOWED` fuori dal pool, `404 ROUTE_NOT_FOUND`, `405 METHOD_NOT_ALLOWED`,
`500 INTERNAL_ERROR`.

## 4. Configurazione

Il server legge la sua configurazione **all'avvio** da anagraphics, `GET /configuration/workspaces`. La fonte è `webtools/configurator/configuration/workspaces.json`; la carica in Mongo `webtools/configurator/load_configuration.sh` (lo fa già `start.sh`). Nessun default: se manca il documento o un campo, il server scrive `webtools_workspaces non parte: …` con il percorso del campo ed esce con 1. Dopo una modifica: `webtools/configurator/start.sh --restart`.

Dall'ambiente arrivano solo `WEBTOOLS_ANAGRAPHICS_URL` e `WEBTOOLS_CONFIGURATION_TIMEOUT_MS`, che `--start` carica da `webtools/configurator/bootstrap.env`. Debug in primo piano: `set -a; source ../configurator/bootstrap.env; set +a; npm start`.

| Campo | Oggi | |
|---|---|---|
| `listen.host` | `127.0.0.1` | |
| `listen.port` | `9400` | |
| `access.allowed_ips` | `["127.0.0.1", "::1"]` | Il pool: confronto esatto sull'IP della connessione |
| `storage.root` | `~/webtools_data/workspaces` | Assoluto, oppure con `~/` all'inizio (si espande nella home di chi avvia il server) |
| `storage.spec_max_bytes` | `10485760` (10 MB) | |

## 5. File

```text
webtools/webtools-workspaces/
├── package.json
├── webtools_workspaces.sh     # --start / --stop, PID con riga di comando verificata
├── src/
│   ├── index.js               # avvio: legge la configurazione, o esce con 1
│   ├── settings.js            # la configurazione `workspaces` da anagraphics → impostazioni del server
│   ├── server.js              # rotte e codici d'errore
│   ├── store.js               # il filesystem: versioni, scrittura atomica, lettura
│   └── commons/               # COPIE GENERATE dai deployer: non si modificano qui
│       ├── configuration_client.js   # da configurator/configuration_deployer
│       └── spec_front_matter.js      # da configurator/specs_deployer
└── tests/
    ├── store.test.js          # front matter, versioni, timbro, concorrenza
    └── api.test.js            # le rotte, su una radice temporanea
```

Dopo un clone serve `npm install` in questa cartella.

## 6. Limiti noti

- **Autenticazione tra servizi**: c'è solo il pool di IP, come per anagraphics e il sso.
- **Nessuna cancellazione**: le versioni si accumulano. Anche un progetto cancellato da
  anagraphics lascia il suo workspace, se ne aveva uno.
- **Nessun elenco delle versioni** e nessuna lettura di una versione precisa: oggi serve solo l'ultima.
- **Nessun backup** della radice.

## 7. Changelog

| Data | Versione | Modifica |
|---|---|---|
| 2026-09-21 | 0.2.0 | **Configurazione dal sottosistema di configurazione.** All'avvio si legge `GET /configuration/workspaces` da anagraphics (client comune `commons/configuration/configuration_client.js`); via `HOST`, `PORT`, `ALLOWED_IPS`, `WORKSPACES_ROOT`, `SPEC_MAX_BYTES` e i loro default. Senza configurazione il server non parte. |
| 2026-09-21 | 0.1.0 | Creazione: `POST /projects/{id}/specs` e `GET /projects/{id}/specs/latest`, versioni con scrittura atomica, chiave riservata `webtools:` nel front matter, 13 test. |
