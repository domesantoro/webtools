# Sottosistema `anagraphics`

> Documentazione di riferimento per sviluppo, manutenzione, troubleshooting, bugfix e metriche.
> Ultimo aggiornamento: 2026-09-22 · versione del sottosistema: `0.7.0`.
> Codice: `webtools/anagraphics/` (percorsi relativi alla root del workspace `ftab - webtools/`).

---

## 0. Scheda rapida

| Voce | Valore |
|---|---|
| Cosa fa | API HTTP interna con la **configurazione di tutti i sottosistemi** (è il sottosistema di configurazione), l'anagrafica dei progetti, i driver e i loro codici sconto, gli **utenti** e le **sessioni** |
| Stack | Python 3.13 · FastAPI · uvicorn · pymongo · MongoDB 8 |
| Codice | `webtools/anagraphics/` |
| Avvio (background, slegato dal terminale) | `webtools/anagraphics/webtools_anagraphics.sh --start` |
| Arresto | `webtools/anagraphics/webtools_anagraphics.sh --stop` |
| Processo | `…/webtools/anagraphics/.venv/bin/python -m webtools_anagraphics` |
| PID / Log | `webtools/anagraphics/webtools_anagraphics.pid` / `webtools/anagraphics/webtools_anagraphics.log` |
| Indirizzo | `WEBTOOLS_ANAGRAPHICS_URL` in `webtools/configurator/bootstrap.env` (oggi `http://127.0.0.1:9100`) |
| Database | `WEBTOOLS_MONGO_URI` / `WEBTOOLS_MONGO_DB` in `bootstrap.env` (oggi `mongodb://localhost:27017`, DB `webtools`) |
| Collection | `configuration` (chiave `subsystem`), `projects` (chiave `project_id`), `drivers` (chiave `uid`), `discounts` (chiave `discount_code`), `users` (chiave `username`), `sessions` (chiave `token`) |
| Scritture | Sessioni, biglietti e lingua: `POST /sessions`, `DELETE /sessions/{token}`, `DELETE /sessions?uid=…`, `PUT /sessions/{token}/locale`, `PUT /users/{username}/locale`, `POST /tickets`, `DELETE /tickets/{ticket}`. Tutto il resto è di sola lettura |
| Accesso | Solo dagli IP in `access.allowed_ips` della sua configurazione; gli altri ricevono `403` |
| Configurazione | Letta all'avvio da Mongo (documento `anagraphics` di `configuration`). Nessun default: se manca, il server non parte (§7) |
| Autenticazione | Nessuna: l'unico controllo è il pool di IP. Chi autentica è `webtools_sso`, che usa questi dati |
| Test | `uv run pytest` (44 test, usa il DB `webtools_test`, cancellato alla fine) |
| Stato | Letture su sei collection, scritture su sessioni e biglietti. CRUD completo previsto più avanti |

Prova veloce, con il server acceso:
```sh
curl http://127.0.0.1:9100/configuration/front-gate   # {"subsystem":"front-gate","listen":{…},"subsystems_infos":{…},"screen_infos":{…}}
curl http://127.0.0.1:9100/projects/1f251606-bdba-40c4-bbee-bfedc6e57f70       # {"project_id":"1f251606-bdba-40c4-bbee-bfedc6e57f70"}
curl http://127.0.0.1:9100/drivers                                               # tutti i driver
curl http://127.0.0.1:9100/drivers/7633be3d-e701-42ca-9fea-6c6d1bb4b7d1          # il driver Dome
curl http://127.0.0.1:9100/drivers/7633be3d-e701-42ca-9fea-6c6d1bb4b7d1/discounts   # i suoi codici sconto
curl http://127.0.0.1:9100/discounts/e8013cf2-34eb-4bc3-8a34-b08fb24a1bf3        # un singolo codice sconto
```

---

## 1. Scopo e ruolo nel sistema

Il progetto è una "fabbrica" di piccoli software su misura, composta da più sottosistemi: il sito vetrina `front-gate`, i sistemi di pre-analisi e analisi, l'interfaccia dei driver, le demo e altri ancora (vedi `contesto/02. contesto_aggiornato.md`). `anagraphics` è la **fonte dati interna** condivisa:

- **Configurazioni dei sottosistemi** (collection `configuration`): **ogni** sottosistema legge da qui la propria configurazione all'avvio, cercandola per nome, e senza non parte. I documenti si scrivono in `webtools/configurator/configuration/<nome>.json` e li carica `webtools/configurator/load_configuration.sh` (§7). Anagraphics stesso legge la sua (documento `anagraphics`) direttamente da Mongo.
- **Progetti** (collection `projects`): ogni progetto cliente ha un documento, identificato da `project_id`. Nasce con `POST /projects` quando il cliente manda la pre-analisi (§6.3.1); i file del progetto (specifiche) non stanno qui ma in `webtools-workspaces`.
- **Driver** (collection `drivers`): le persone che supervisionano i progetti, identificate da `uid`.
- **Codici sconto** (collection `discounts`): ogni codice appartiene a un driver, identificato da `discount_code`.
- **Utenti** (collection `users`): chi può entrare nel sistema, identificato da `username`, con il blocco delle credenziali.
- **Sessioni** (collection `sessions`): chi è entrato e fino a quando, identificato dal `token`.

È un servizio **interno**: non è pensato per essere esposto su internet e oggi accetta solo chiamate da localhost.

**Che cosa non fa.** Utenti e sessioni stanno qui, ma il login no: `anagraphics` non confronta password e non decide se una sessione vale ancora. Conserva e restituisce. A verificare le credenziali, a generare i token e a giudicare le scadenze è `webtools_sso` (`docs/subsystems/sso/README.md`), che è l'unico a chiamare `GET /users/{username}/credential`. La regola che tiene insieme le due parti: **anagraphics è un archivio, non un'autorità**.

---

## 2. Scelte funzionali

| Scelta | Motivo |
|---|---|
| **Solo lettura, tranne le sessioni** | È la prima iterazione. Le scritture arriveranno con il CRUD completo; oggi i dati si inseriscono con il seed o con `mongosh` (§8.4). L'eccezione sono le sessioni, che nascono e muoiono di continuo: le scrive il sso (§5.6). |
| **Le credenziali si restituiscono, non si verificano** | Il confronto della password richiede di sapere quando una password è "giusta", cioè una politica di autenticazione. Quella sta nel sso, insieme a token e scadenze. Qui resta il formato conservato (§5.5). |
| **Chiavi con nome dedicato** (`subsystem`, `project_id`) al posto dell'`_id` di Mongo | Sono chiavi leggibili e stabili, pensate per essere usate dagli altri sottosistemi. L'`_id` resta un dettaglio interno di Mongo. |
| **Indice univoco su ogni chiave** | Garantisce un solo documento per sottosistema o progetto. Un doppio inserimento fallisce con `DuplicateKeyError`. |
| **`_id` mai restituito** | Le risposte contengono solo i dati di dominio. Inoltre `ObjectId` non si converte in JSON. |
| **Dati minimi** | Oggi `configuration` = `{subsystem}`; `projects` ha i campi di §5.2. Le strutture verranno estese; l'API restituisce **tutto il documento** (tranne `_id`), quindi i nuovi campi compaiono senza modificare il codice. |
| **Errori = stato HTTP + codice stabile** (`{"error": "PROJECT_NOT_FOUND", ...}`) | I consumer (Node, Python) decidono dallo stato HTTP (`res.ok`, `raise_for_status()`, axios) e distinguono il caso con un confronto di stringhe, senza interpretare testo. Un formato unico per tutti gli errori (§6.1). Scartato `200 + null`: renderebbe "non trovato" indistinguibile da un successo e nasconderebbe gli URL sbagliati. |
| **Pool di IP al posto dell'autenticazione** | Servizio interno su una sola macchina: il pool basta per ora. Il controllo avviene **prima** di qualsiasi altra logica. |
| **Conta solo l'IP della connessione** | Gli header `X-Forwarded-For` sono falsificabili, quindi non vengono considerati (§9.2). |

Dati di esempio caricati dal seed (la collection `configuration` non passa dal seed: la carica `webtools/configurator/load_configuration.sh`, §5.1):
- `projects`: `{"project_id": "1f251606-bdba-40c4-bbee-bfedc6e57f70"}`, un progetto di prova (senza proprietario: è precedente a `POST /projects`).

---

## 3. Scelte tecnologiche

| Componente | Versione installata | Perché |
|---|---|---|
| Python | 3.13.2 (nel venv creato da uv; il requisito è `>=3.12`) | Stack richiesto. uv ha scelto il 3.13 anche se sul sistema c'è il 3.14 |
| **FastAPI** | 0.141.1 | API piccola, JSON nativo, validazione dei parametri, documentazione OpenAPI automatica. Facile da estendere al CRUD |
| **uvicorn** | 0.53.0 | Server ASGI standard per FastAPI |
| **pymongo** (sincrono) | 4.18.1 | Driver ufficiale. Le route sono `def` sincrone: FastAPI le esegue in un threadpool, ed è sufficiente per il carico previsto |
| MongoDB | 8.0.5 (Homebrew, locale) | Documenti JSON flessibili, adatti a strutture che cresceranno |
| **uv** | 0.10.x | Gestisce venv, dipendenze e lock (`uv.lock`) con un solo strumento |
| pytest + httpx2 | 9.1.1 / 2.13.0 | `TestClient` di Starlette. `httpx2` al posto di `httpx`, che Starlette 1.x segnala come deprecato |

Scartati, per semplicità:
- **Motor / pymongo async**: non serve con questo carico;
- **Pydantic settings**: la configurazione arriva da Mongo, non dall'ambiente, e i campi sono pochi;
- **Docker**: il daemon non era attivo e Mongo è già installato in locale.

---

## 4. Architettura

### 4.1 Mappa dei file

```
webtools/anagraphics/
├── pyproject.toml     # dipendenze (uv), config pytest; package = false (non si installa come pacchetto)
├── uv.lock            # versioni bloccate: non modificarlo a mano
├── README.md          # guida breve
├── webtools_anagraphics.sh   # CONTROLLO: --start / --stop (nohup + file PID verificato)
├── webtools_anagraphics.pid  # generato da --start, rimosso da --stop
├── webtools_anagraphics.log  # generato da --start (append)
├── webtools_anagraphics/     # pacchetto Python (nome specifico, niente nomi generici come "app")
│   ├── __init__.py
│   ├── __main__.py    # AVVIO: importa main (che legge la configurazione) e lancia uvicorn con proxy_headers=False; esce con 1 se la configurazione manca
│   ├── settings.py    # Settings + load_settings(): bootstrap dall'ambiente, il resto dal documento `anagraphics` in Mongo
│   ├── errors.py      # codici di errore (contratto API), ApiError, handler per 403/404/405/503/500
│   ├── db.py          # connect(), ensure_indexes(), find_*(); costanti CONFIGURATION/PROJECTS/DRIVERS/DISCOUNTS/PUBLIC
│   └── main.py        # oggetto FastAPI `app`, middleware del pool di IP, i 6 endpoint
├── scripts/
│   ├── seed.py        # indici univoci + upsert dei dati iniziali (idempotente); niente configurazioni
│   └── load_configuration.py  # carica configurator/configuration/*.json nella collection `configuration`
└── tests/
    └── test_api.py    # 44 test end-to-end su Mongo reale (DB webtools_test)
```

### 4.2 Ciclo di vita

- `webtools_anagraphics/main.py` legge le impostazioni e crea il client Mongo **all'import del modulo**, cioè all'avvio del server. Di conseguenza:
  - la configurazione cambiata dopo l'avvio non ha effetto: **serve un riavvio**;
  - leggere la configurazione vuol dire interrogare Mongo: **se Mongo è spento, o il documento `anagraphics` non c'è, il server non parte** (`webtools_anagraphics non parte: …` nel log, uscita 1). Se Mongo cade dopo l'avvio, le richieste rispondono `503` (§11).
- Il server **non crea gli indici** all'avvio: li crea `scripts/seed.py`.
- Non ci sono hook di startup o shutdown (lifespan): il client Mongo si chiude con il processo.

### 4.3 Percorso di una richiesta

```
client ──HTTP──> uvicorn (127.0.0.1:9100, proxy_headers=False)
                   │
                   ▼
          middleware allow_only_known_ips   (webtools_anagraphics/main.py)
          request.client.host ∈ access.allowed_ips ?
             │ no  → 403 {"error":"IP_NOT_ALLOWED"}      (nessuna query a Mongo)
             │ sì
             ▼
          routing FastAPI
             │ route sconosciuta → 404 {"error":"ROUTE_NOT_FOUND"}; metodo errato → 405 {"error":"METHOD_NOT_ALLOWED"}
             ▼
          get_configuration / get_project   (threadpool)
             │
             ▼
          db.find_* → collection.find_one({chiave: valore}, {"_id": 0})
             │ None → 404 {"error":"PROJECT_NOT_FOUND"|"CONFIGURATION_NOT_FOUND", <chiave>: <valore>}
             │ Mongo irraggiungibile (ConnectionFailure) → 503 {"error":"DATABASE_UNAVAILABLE"}
             │ qualsiasi altra eccezione → 500 {"error":"INTERNAL_ERROR"}   (traceback nel log)
             ▼
          200 + documento JSON
```

Il controllo IP viene **prima** del routing, quindi un IP fuori dal pool riceve `403` anche su route inesistenti e su `/docs`.

---

## 5. Modello dati (MongoDB)

**Database**: `webtools` (variabile `WEBTOOLS_MONGO_DB` di `bootstrap.env`). Gli indici li crea `scripts/seed.py` (`db.ensure_indexes`), non l'avvio del server.

| Collection | Chiave | Altri indici | Contenuto | Chi scrive |
|---|---|---|---|---|
| `configuration` | `subsystem` (univoco) | — | La configurazione di ogni sottosistema | `configurator/load_configuration.sh` |
| `projects` | `project_id` (univoco) | `submission_id` (univoco, sparse) | Un documento per progetto cliente | `webtools_preanalyst`, via API |
| `drivers` | `uid` (univoco) | — | Le persone che supervisionano i progetti | seed / `mongosh` |
| `discounts` | `discount_code` (univoco) | `driver.uid` | I codici sconto, col driver ridondato dentro | seed / `mongosh` |
| `users` | `username` (univoco) | `uid` (univoco) | Chi può entrare nel sistema, con le credenziali | seed + comando a mano (§8.5) |
| `sessions` | `token` (univoco) | `uid`, **TTL** su `expires_at` | Chi è entrato e fino a quando | `webtools_sso`, via API |
| `tickets` | `ticket` (univoco) | **TTL** su `expires_at` | Biglietti usa-e-getta per passare una sessione da un indirizzo a un altro | `webtools_sso`, via API |

`_id` è sempre un ObjectId automatico e non esce mai da nessuna risposta: nelle tabelle che seguono non viene più ripetuto.

### 5.1 `configuration`
| Campo | Tipo | Vincoli | Note |
|---|---|---|---|
| `_id` | ObjectId | automatico | Mai esposto |
| `subsystem` | string | **univoco** (indice `subsystem_1`) | Nome del sottosistema, es. `front-gate`. Distingue maiuscole e minuscole |

Gli altri campi dipendono dal sottosistema e l'API li restituisce così come sono. Sono **strutturati** (oggetti annidati per argomento: `listen`, `access`, `subsystems_infos`, `session`, …), non piatti.

**Da dove arrivano.** La fonte è un file per sottosistema, `webtools/configurator/configuration/<subsystem>.json`, senza il campo `subsystem` (lo dà il nome del file). `webtools/configurator/load_configuration.sh` li carica tutti: ogni documento viene **sostituito per intero** e quelli senza più un file vengono cancellati. Lo lancia `start.sh` prima di avviare i servizi. Modificare i documenti a mano in Mongo non serve: al prossimo avvio verrebbero sovrascritti.

Il significato di ogni campo sta nella documentazione del sottosistema che lo legge. Qui solo quello di anagraphics stesso:

| Campo | Tipo | Note |
|---|---|---|
| `access.allowed_ips` | string[] | Gli IP ammessi, **esatti** (niente CIDR). Non vuoto |
| `mongo.server_selection_timeout_ms` | int | Quanto aspettare Mongo in ogni richiesta prima di rispondere `503` |

### 5.2 `projects`
Fino alla 0.4.0 la collection si chiamava `anagraphics` (migrazione in §8.7).

| Campo | Tipo | Vincoli | Note |
|---|---|---|---|
| `_id` | ObjectId | automatico | Mai esposto |
| `project_id` | string | **univoco** (indice `project_id_1`) | **UUID** v4 in forma canonica minuscola, es. `1f251606-bdba-40c4-bbee-bfedc6e57f70`. Lo genera anagraphics in `POST /projects`: chi chiama non può sceglierlo |
| `owner_uid` | string | — | L'`uid` dell'utente (`users.uid`) che ha creato il progetto. Chi legge un progetto per conto di un utente confronta questo campo |
| `submission_id` | string | **univoco, sparse** (indice `submission_id_1`) | L'id dell'invio del form della pre-analisi. Lo stesso invio ripetuto trova il progetto già nato invece di crearne un altro. Sparse: un progetto può nascere anche per altre strade |
| `created_at` | datetime (UTC) | — | Momento della creazione |
| `state` | string | — | Stato nel flusso. Oggi solo `PREANALYSIS`, il primo |
| `review` | object | — | Chi supervisiona il progetto: `{driver_uid, preset}`. `preset: true` = driver **preimpostato** (dal link di un driver, o il driver stesso in un lavoro autonomo); `preset: false` = assegnato dal sistema. Alla creazione, senza link, `driver_uid` è `null` |
| `billing` | object | — | I dati economici: `{discount_code, autonomous_work, ambassador_uid}`. Il codice sconto del link e il lavoro autonomo **si escludono**: con il lavoro autonomo `discount_code` è `null`. `ambassador_uid` è l'uid del driver che ha invitato l'utente a lavorare con noi, o `null`; i progetti creati prima della 0.6.2 non hanno il campo. Fino alla 0.6.0 c'era anche `autonomous_fee_discount` (migrazione §8.8). Si conservano soltanto: il prezzo non si calcola qui |

### 5.3 `drivers`
| Campo | Tipo | Vincoli | Note |
|---|---|---|---|
| `_id` | ObjectId | automatico | Mai esposto |
| `uid` | string | **univoco** (indice `uid_1`) | **UUID** del driver, es. `7633be3d-e701-42ca-9fea-6c6d1bb4b7d1`. Come per `project_id`, il formato non viene validato dall'API |
| `username` | string | — | Identificativo di accesso del driver. Il login non è ancora gestito: oggi il campo è solo un dato |
| `screen_name` | string | — | Nome mostrato, es. `Dome` |
| `enabled` | bool | — | Abilitato a seguire i progetti dei clienti (dopo il colloquio). Un driver non abilitato può essere ambassador e fare lavoro autonomo, ma nessun cliente può averlo come driver: le regole le applica preanalyst |

Driver presenti:

| `uid` | `username` | `screen_name` | `enabled` | Note |
|---|---|---|---|---|
| `7633be3d-e701-42ca-9fea-6c6d1bb4b7d1` | `dome.santoro@gmail.com` | `Dome` | `true` | Il driver reale. Ha un codice sconto |
| `639718a3-ea41-4533-bdb8-73ac58b3b1b2` | `driver.prova@example.com` | `Prova` | `true` | **Dato di prova**, senza codici sconto: serve per vedere più di un driver nella lista e per il caso "driver esistente senza sconti" |
| `f234b930-e5d0-4e10-8a4f-1a8a13814370` | `driver.nonabilitato@example.com` | `Non abilitato` | `false` | **Dato di prova** con un codice sconto: serve per i casi "link" e "sconto" di un driver non abilitato |

### 5.4 `discounts`
| Campo | Tipo | Vincoli | Note |
|---|---|---|---|
| `_id` | ObjectId | automatico | Mai esposto |
| `discount_code` | string | **univoco** (indice `discount_code_1`) | **UUID** del codice sconto, es. `e8013cf2-34eb-4bc3-8a34-b08fb24a1bf3` |
| `driver.uid` | string | indice **non** univoco (`driver.uid_1`) | `uid` del driver a cui appartiene il codice |
| `driver.screen_name` | string | — | Nome del driver, **ridondato** |
| `percentage` | number | — | Percentuale di sconto in **punti percentuali**: `5` significa 5%, non 0,05 |

Codici presenti: `e8013cf2-34eb-4bc3-8a34-b08fb24a1bf3`, del driver `Dome`, al 5%; `91165eb1-65d6-43a9-ade8-681ec3ebef8d`, del driver di prova `Non abilitato`, al 10%.

**Sulla ridondanza del driver.** `uid` e `screen_name` sono copiati dentro lo sconto di proposito: chi legge un codice sconto ha subito il nome da mostrare, senza una seconda lettura. Il prezzo è che **un cambio di `screen_name` in `drivers` non si propaga**: finché non c'è il CRUD va aggiornato a mano anche in `discounts` (§8.4). `uid` invece non cambia mai.

### 5.5 `users`
| Campo | Tipo | Vincoli | Note |
|---|---|---|---|
| `uid` | string | **univoco** (indice `uid_1`) | **UUID** della persona. È l'identificativo stabile: `username` può cambiare, `uid` no |
| `username` | string | **univoco** (indice `username_1`) | Quello che si digita al login. Oggi è l'indirizzo email. Distingue maiuscole e minuscole |
| `screen_name` | string | — | Nome mostrato, es. `Dome` |
| `active` | bool | — | `false` impedisce il login (lo controlla il sso). Il documento resta |
| `driver_uid` | string / assente | — | `uid` del documento in `drivers`, se questa persona è anche un driver |
| `credential` | oggetto / `null` | — | Il blocco della password, sotto. `null` significa "password mai impostata": l'utente esiste ma non può entrare |
| `locale` | string / assente | — | La lingua preferita (`it`, `en`, …). La scrive il sso al primo login e a ogni cambio di lingua; al login successivo la rimette nella sessione (§6.19) |

Il blocco `credential`:

| Campo | Esempio | Note |
|---|---|---|
| `algorithm` | `"scrypt"` | L'unico gestito oggi. Il sso rifiuta quello che non conosce |
| `params` | `{"n":16384,"r":8,"p":1,"dklen":32}` | **Dentro il documento, non nel codice**: il giorno che si alzano, le password vecchie restano verificabili con i propri |
| `salt` | base64 di 16 byte casuali | Diverso per ogni password |
| `hash` | base64 di 32 byte | Il risultato di scrypt su password e salt |
| `updated_at` | data | Quando è stata impostata |

**Perché scrypt.** Sta nella libreria standard sia di Python sia di Node: nessuna dipendenza in più né qui né nel sso, e lo stesso identico calcolo dalle due parti. Il formato si costruisce in un punto solo, `webtools_anagraphics/credentials.py`; chi verifica è `webtools/sso/src/credentials.js`. Il test `tests/credentials.test.js` del sso contiene un hash prodotto davvero da Python: se i due scrypt smettessero di calcolare la stessa cosa, fallisce quel test invece di un login.

La password **non si semina**: si imposta a parte, costruendo il blocco con `build_credential()` (§8.5). Non esiste ancora uno strumento dedicato: finché non c'è il CRUD è un comando a mano.

Utenti presenti:

| `uid` | `username` | `screen_name` | `driver_uid` | Note |
|---|---|---|---|---|
| `8ff93901-673e-44ba-b05b-56011395dcba` | `dome.santoro@gmail.com` | `Dome` | `7633be3d-…` | L'utente reale. Password di sviluppo impostata il 2026-09-21 |
| `214912a9-2cc4-4205-87b7-93ea71f6be72` | `driver.prova@example.com` | `Prova` | `639718a3-…` | **Dato di prova**, con una password nota di sviluppo. Va tolto quando si esce dalla PoC |

Le due password sono **password di sviluppo**, corte e note: vanno rifatte prima che il sistema sia raggiungibile da fuori questa macchina.

**Perché `uid` e `driver_uid` sono due cose diverse.** `users.uid` è l'identità della persona, `drivers.uid` è l'identità del ruolo di driver: un cliente è un utente e non è un driver. Il collegamento è esplicito in `driver_uid` invece che implicito nell'uguaglianza dei due uid, così si vede leggendo il documento.

### 5.6 `sessions`
| Campo | Tipo | Vincoli | Note |
|---|---|---|---|
| `token` | string | **univoco** (indice `token_1`) | 32 byte casuali in base64url (43 caratteri). Non contiene informazioni: è solo la chiave per ritrovare la sessione |
| `uid` | string | indice **non** univoco (`uid_1`) | La persona. Un utente può avere più sessioni aperte insieme |
| `username` | string | — | Copiato al login, per non dover rileggere l'utente |
| `issued_at` | data | — | Quando è entrata |
| `expires_at` | data | indice **TTL** (`expires_at_1`, `expireAfterSeconds: 0`) | Quando smette di valere |
| `data` | oggetto | — | Dati di sessione, liberi. Oggi contiene `screen_name` e `driver_uid` fotografati al login, e `locale`, la lingua della sessione, che cambia con `PUT /sessions/{token}/locale` |

**Il documento lo costruisce il sso.** Token, date e contenuto di `data` arrivano già fatti in `POST /sessions`: qui si controlla che i campi ci siano e si conserva. `GET /sessions/{token}` restituisce la sessione **anche se scaduta**, finché il TTL non l'ha rimossa: decidere se vale ancora è del sso.

**L'indice TTL è pulizia, non sicurezza.** Mongo passa a cancellare circa ogni 60 secondi, quindi una sessione scaduta può restare nell'archivio per un po'. Nessun consumer deve dedurre la validità dalla presenza del documento: si guarda `expires_at`.

**La fotografia dentro `data` invecchia**, come il driver dentro i codici sconto (§5.4): se cambia lo `screen_name`, le sessioni già aperte mostrano quello vecchio fino al login successivo.

### 5.7 `tickets`
| Campo | Tipo | Vincoli | Note |
|---|---|---|---|
| `ticket` | string | **univoco** (indice `ticket_1`) | 32 byte casuali in base64url |
| `token` | string | — | La sessione a cui dà accesso |
| `service` | string | — | Il sottosistema per cui è stato emesso, es. `http://127.0.0.1:9200` |
| `issued_at` | data | — | — |
| `expires_at` | data | indice **TTL** (`expires_at_1`) | Un minuto dopo l'emissione |

**A che serve.** Un cookie appartiene a un indirizzo solo: il sso, che sta sulla porta 9300, non può metterne uno per conto di preanalyst, che sta sulla 9200. Dopo il login il sso rimanda quindi il browser al sottosistema con un **biglietto** nell'indirizzo; il sottosistema lo scambia da server a server e riceve la sessione. Il token vero, che dura ore, non passa mai dall'indirizzo — dove finirebbe nella cronologia del browser, nei log e nei link condivisi.

**Vale una volta sola.** `DELETE /tickets/{ticket}` legge e cancella nello stesso momento (`find_one_and_delete`): due richieste con lo stesso biglietto non possono riuscire entrambe, nemmeno se arrivano insieme. Un biglietto letto da un log è quindi già consumato, e comunque scaduto dopo un minuto.

### 5.8 Regole per estendere i documenti
- Si possono **aggiungere campi** liberamente: l'API restituisce tutto il documento tranne `_id`.
- I valori devono essere **convertibili in JSON** da FastAPI: string, number, bool, null, liste, oggetti annidati e `datetime` vanno bene. Un `ObjectId` in un campo diverso da `_id`, un `Decimal128` o dati binari producono un **500** (§11). In quel caso vanno convertiti prima di restituire il documento.
- Non rinominare `subsystem`, `project_id`, `uid` o `discount_code` senza aggiornare `webtools_anagraphics/db.py`, `scripts/seed.py`, gli indici e i test.

---

## 6. Riferimento API

URL base: `http://127.0.0.1:9100`. Tutte le risposte, errori compresi, sono JSON.

### 6.1 Formato degli errori (contratto)

Ogni errore ha lo **stato HTTP corretto** e un body con un **codice stabile**:
```json
{"error": "<CODICE>", "<campo di contesto>": "<valore>"}
```
- Il campo `error` è sempre presente. I campi di contesto sono presenti solo dove indicato.
- I codici **fanno parte del contratto dell'API**: non si rinominano e non si riusano con altri significati. Sono definiti in `webtools_anagraphics/errors.py`.
- Non ci sono messaggi discorsivi: i consumer confrontano `error`, non devono interpretare testo.

| Stato | `error` | Contesto | Quando |
|---|---|---|---|
| `404` | `CONFIGURATION_NOT_FOUND` | `subsystem` | Nessuna conf per quel sottosistema |
| `404` | `PROJECT_NOT_FOUND` | `project_id` | Nessun progetto con quell'id |
| `404` | `DRIVER_NOT_FOUND` | `uid` | Nessun driver con quell'uid |
| `404` | `DISCOUNT_NOT_FOUND` | `discount_code` | Nessun codice sconto con quel codice |
| `404` | `USER_NOT_FOUND` | `username` | Nessun utente con quello username |
| `404` | `CREDENTIAL_NOT_SET` | `username` | L'utente esiste ma non ha una password impostata (`credential: null`) |
| `404` | `SESSION_NOT_FOUND` | — | Nessuna sessione con quel token: sconosciuto, già cancellato o rimosso dal TTL |
| `409` | `SESSION_EXISTS` | `token` | Esiste già una sessione con quel token. Non si sovrascrive |
| `404` | `TICKET_NOT_FOUND` | — | Nessun biglietto con quel codice: sconosciuto, già consumato o rimosso dal TTL |
| `409` | `TICKET_EXISTS` | — | Esiste già un biglietto con quel codice |
| `409` | `SUBMISSION_EXISTS` | — | Un `POST /projects` con il `submission_id` di un progetto di un altro utente |
| `400` | `INVALID_BODY` | — | Corpo di `POST /sessions`, `POST /tickets` o `POST /projects` mancante, incompleto o con campi non validi. Il dettaglio dei campi resta nel log, non nella risposta |
| `404` | `ROUTE_NOT_FOUND` | — | URL inesistente: di solito un bug nel consumer |
| `405` | `METHOD_NOT_ALLOWED` | — | Metodo non ammesso su una route esistente |
| `403` | `IP_NOT_ALLOWED` | — | IP del chiamante fuori da `access.allowed_ips` (§9) |
| `503` | `DATABASE_UNAVAILABLE` | — | MongoDB irraggiungibile, dopo il timeout di selezione del server (default 30 s) |
| `500` | `INTERNAL_ERROR` | — | Qualsiasi altro errore imprevisto; il traceback è nel log |

Esempi di gestione lato consumer:
```python
# Python (requests)
r = requests.get(f"{BASE}/projects/{project_id}")
if r.ok:
    project = r.json()
elif r.json()["error"] == "PROJECT_NOT_FOUND":
    project = None
else:
    r.raise_for_status()
```
```js
// Node (fetch)
const res = await fetch(`${BASE}/projects/${projectId}`);
const body = await res.json();
if (res.ok) return body;
if (body.error === "PROJECT_NOT_FOUND") return null;
throw new Error(`anagraphics: ${res.status} ${body.error}`);
```

### 6.2 `GET /configuration/{subsystem}`
Restituisce la configurazione del sottosistema.

| Esito | Stato | Body |
|---|---|---|
| Trovata | `200` | il documento senza `_id`, es. `{"subsystem":"front-gate","listen":{"host":"127.0.0.1","port":9000},"subsystems_infos":{"preanalyst":{"url":"http://127.0.0.1:9200"}},"screen_infos":{"pricing":{"standard_price_cents":40000}}}` |
| Non trovata | `404` | `{"error":"CONFIGURATION_NOT_FOUND","subsystem":"<richiesto>"}` |
| Altri errori | `403` / `503` / `500` | vedi §6.1 |

### 6.3 `GET /projects/{project_id}`
Restituisce il progetto. Fino alla 0.4.0 era `GET /anagraphics/{project_id}`, che non esiste più.

| Esito | Stato | Body |
|---|---|---|
| Trovato | `200` | il documento senza `_id` (§5.2) |
| Non trovato | `404` | `{"error":"PROJECT_NOT_FOUND","project_id":"<richiesto>"}` |
| Altri errori | `403` / `503` / `500` | vedi §6.1 |

#### 6.3.1 `POST /projects`
Crea un progetto. Corpo: `{"owner_uid": "<uid>", "submission_id": "<id dell'invio, almeno 16 caratteri>", "review": {"driver_uid": …, "preset": true}, "billing": {"discount_code": …, "autonomous_work": false, "ambassador_uid": null}}` (`review` e `billing` facoltativi, con i default di §5.2). Le regole su chi è preimpostato e quale sconto vale le applica chi chiama (preanalyst). Anagraphics genera `project_id`, `created_at` e `state: "PREANALYSIS"`; un `project_id` nel corpo viene ignorato.

| Esito | Stato | Body |
|---|---|---|
| Creato | `201` | il documento completo |
| Stesso `submission_id`, stesso `owner_uid` | `200` | il progetto **già esistente**: non se ne crea un secondo |
| Stesso `submission_id`, altro `owner_uid` | `409` | `{"error":"SUBMISSION_EXISTS"}` (non si rivela il progetto dell'altro) |
| Corpo non valido | `400` | `{"error":"INVALID_BODY"}` |
| Altri errori | `403` / `503` / `500` | vedi §6.1 |

#### 6.3.2 `DELETE /projects/{project_id}`
Cancella un progetto. Serve a disfare un progetto rimasto a metà: preanalyst lo usa quando la pre-specifica non si riesce a scrivere.

| Esito | Stato | Body |
|---|---|---|
| Cancellato | `204` | — |
| Non trovato | `404` | `{"error":"PROJECT_NOT_FOUND","project_id":"<richiesto>"}` |

### 6.4 `GET /drivers`
Restituisce **tutti** i driver, ordinati per `uid`, con i soli campi `uid`, `screen_name` ed `enabled`.

| Esito | Stato | Body |
|---|---|---|
| Sempre | `200` | `{"drivers":[{"uid":…,"screen_name":…,"enabled":…}, …]}` |
| Nessun driver | `200` | `{"drivers":[]}` |
| Altri errori | `403` / `503` / `500` | vedi §6.1 |

**`username` non compare nella lista**, a differenza di `GET /drivers/{uid}`: una lista si legge per mostrare o scegliere un driver, e non c'è motivo di distribuire gli identificativi di accesso di tutti in una volta. La proiezione è la costante `DRIVER_SUMMARY` in `webtools_anagraphics/db.py`. Nota che non è una misura di sicurezza finché non c'è il login: chi può chiamare la lista può anche chiamare i singoli driver.

Nessuna paginazione e nessun filtro: i driver sono pochi. Se un giorno diventassero tanti, qui servono `limit`/`skip`.

### 6.5 `GET /drivers/{uid}`
Restituisce il driver.

| Esito | Stato | Body |
|---|---|---|
| Trovato | `200` | il documento senza `_id`, es. `{"uid":"7633be3d-…","username":"dome.santorogmail.com","screen_name":"Dome"}` |
| Non trovato | `404` | `{"error":"DRIVER_NOT_FOUND","uid":"<richiesto>"}` |
| Altri errori | `403` / `503` / `500` | vedi §6.1 |

### 6.6 `GET /drivers/{uid}/discounts`
Restituisce **tutti** i codici sconto del driver, ordinati per `discount_code`.

| Esito | Stato | Body |
|---|---|---|
| Driver esistente | `200` | `{"uid":"<richiesto>","discounts":[<documenti senza _id>]}` |
| Driver esistente senza codici | `200` | `{"uid":"<richiesto>","discounts":[]}` |
| Driver inesistente | `404` | `{"error":"DRIVER_NOT_FOUND","uid":"<richiesto>"}` |
| Altri errori | `403` / `503` / `500` | vedi §6.1 |

La distinzione è voluta: **lista vuota ≠ driver inesistente**. Il consumer non deve dedurre l'esistenza del driver dal numero di sconti, quindi l'endpoint verifica prima il driver e solo dopo legge i codici (due letture, non una).

### 6.7 `GET /discounts/{discount_code}`
Restituisce un singolo codice sconto, col driver ridondato dentro (§5.4).

| Esito | Stato | Body |
|---|---|---|
| Trovato | `200` | il documento senza `_id`, es. `{"discount_code":"e8013cf2-…","driver":{"uid":"7633be3d-…","screen_name":"Dome"},"percentage":5}` |
| Non trovato | `404` | `{"error":"DISCOUNT_NOT_FOUND","discount_code":"<richiesto>"}` |
| Altri errori | `403` / `503` / `500` | vedi §6.1 |

### 6.8 `GET /users/{username}`
L'utente **senza** il blocco delle credenziali. È la lettura normale, quella che possono fare tutti i sottosistemi del pool.

| Esito | Stato | Body |
|---|---|---|
| Trovato | `200` | es. `{"uid":"8ff93901-…","username":"dome.santoro@gmail.com","screen_name":"Dome","active":true,"driver_uid":"7633be3d-…"}` |
| Non trovato | `404` | `{"error":"USER_NOT_FOUND","username":"<richiesto>"}` |
| Altri errori | `403` / `503` / `500` | vedi §6.1 |

Non esiste una lista degli utenti: si leggono uno per uno, per username.

### 6.9 `GET /users/{username}/credential`
Algoritmo, parametri, salt e hash della password (§5.5). **La usa solo il sso**, per verificare un login.

| Esito | Stato | Body |
|---|---|---|
| Trovato | `200` | `{"username":"…","credential":{"algorithm":"scrypt","params":{…},"salt":"…","hash":"…","updated_at":"…"}}` |
| Utente inesistente | `404` | `{"error":"USER_NOT_FOUND","username":"<richiesto>"}` |
| Password mai impostata | `404` | `{"error":"CREDENTIAL_NOT_SET","username":"<richiesto>"}` |
| Altri errori | `403` / `503` / `500` | vedi §6.1 |

I due 404 sono distinti perché dicono due cose diverse a chi amministra. Al cliente il sso li unisce comunque in un solo `INVALID_CREDENTIALS`: chi prova a entrare non deve capire se un indirizzo è registrato.

### 6.10 `POST /sessions`
Conserva una sessione costruita dal sso. Qui non si genera niente: né il token né le date.

Corpo (JSON):

| Campo | Obbligatorio | Note |
|---|---|---|
| `token` | sì | Almeno 16 caratteri |
| `uid` | sì | La persona |
| `username` | sì | — |
| `issued_at` | sì | Data ISO 8601 |
| `expires_at` | sì | Data ISO 8601. Può essere già passata: non viene controllata |
| `data` | no | Oggetto libero, default `{}` |

| Esito | Stato | Body |
|---|---|---|
| Creata | `201` | il documento conservato |
| Token già presente | `409` | `{"error":"SESSION_EXISTS","token":"<inviato>"}` |
| Corpo non valido | `400` | `{"error":"INVALID_BODY"}` |
| Altri errori | `403` / `503` / `500` | vedi §6.1 |

Campi in più oltre a questi vengono ignorati: quello che deve sopravvivere va dentro `data`.

### 6.11 `GET /sessions/{token}`
La sessione, **anche se scaduta** (§5.6).

| Esito | Stato | Body |
|---|---|---|
| Trovata | `200` | il documento senza `_id` |
| Non trovata | `404` | `{"error":"SESSION_NOT_FOUND"}` |
| Altri errori | `403` / `503` / `500` | vedi §6.1 |

Il body del 404 non ripete il token: finirebbe nei log di chiunque, e un token è un segreto.

### 6.12 `DELETE /sessions/{token}`
Chiude una sessione.

| Esito | Stato | Body |
|---|---|---|
| Cancellata | `204` | vuoto |
| Non trovata | `404` | `{"error":"SESSION_NOT_FOUND"}` |
| Altri errori | `403` / `503` / `500` | vedi §6.1 |

Il 404 serve a distinguere "l'ho chiusa io adesso" da "non c'era". Il sso risponde comunque `logged: false` in entrambi i casi.

### 6.13 `DELETE /sessions?uid={uid}`
Chiude **tutte** le sessioni di un utente. Serve al cambio password e al blocco di un account.

| Esito | Stato | Body |
|---|---|---|
| Fatto | `200` | `{"uid":"<richiesto>","deleted":<numero>}` |
| Senza `uid` | `400` | `{"error":"INVALID_BODY"}` |
| Altri errori | `403` / `503` / `500` | vedi §6.1 |

Un `uid` inesistente risponde `200` con `deleted: 0`: la richiesta è "non deve restarne nessuna", e il risultato è quello.

### 6.14 `POST /tickets`
Conserva un biglietto costruito dal sso (§5.7).

Corpo (JSON): `ticket` (almeno 16 caratteri), `token` (almeno 16), `service`, `issued_at`, `expires_at`.

| Esito | Stato | Body |
|---|---|---|
| Creato | `201` | il documento conservato |
| Biglietto già presente | `409` | `{"error":"TICKET_EXISTS"}` |
| Corpo non valido | `400` | `{"error":"INVALID_BODY"}` |
| Altri errori | `403` / `503` / `500` | vedi §6.1 |

### 6.15 `DELETE /tickets/{ticket}`
**Consuma** il biglietto: lo restituisce e lo cancella nello stesso momento.

| Esito | Stato | Body |
|---|---|---|
| Consumato | `200` | il documento, che da adesso non esiste più |
| Sconosciuto, già usato o scaduto dal TTL | `404` | `{"error":"TICKET_NOT_FOUND"}` |
| Altri errori | `403` / `503` / `500` | vedi §6.1 |

Il 404 non ripete il biglietto, per la stessa ragione delle sessioni: finirebbe nei log.

### 6.16 Note sui parametri
- Il parametro di percorso è una stringa su **un solo segmento**: non può contenere `/`. I caratteri speciali vanno codificati nell'URL (`@` negli username va bene così com'è).
- La corrispondenza è esatta e distingue maiuscole e minuscole (`Front-Gate` ≠ `front-gate`).

### 6.19 `PUT /users/{username}/locale` e `PUT /sessions/{token}/locale`
La lingua preferita dell'utente e quella della sessione. Le chiama il sso: al primo login (se il profilo non ha ancora una lingua) e quando si cambia lingua dal selettore delle pagine.

Corpo (JSON): `{"locale": "it"}`. Qui si controlla solo che sia un codice di lingua (`^[a-z]{2,3}$`): quali lingue esistono lo decide il sso, dalla sua configurazione (`i18n.locales`).

| Esito | Stato | Body |
|---|---|---|
| Fatto (utente) | `200` | l'utente senza `credential`, con `locale` |
| Fatto (sessione) | `200` | la sessione, con `data.locale`; il resto di `data` resta com'era |
| Utente inesistente | `404` | `{"error":"USER_NOT_FOUND","username":"<richiesto>"}` |
| Sessione inesistente | `404` | `{"error":"SESSION_NOT_FOUND"}` |
| Codice non valido | `400` | `{"error":"INVALID_BODY"}` |
| Altri errori | `403` / `503` / `500` | vedi §6.1 |

### 6.17 Route generate da FastAPI
Sono raggiungibili, sempre solo da IP consentiti:
- `GET /docs`: interfaccia Swagger;
- `GET /redoc`;
- `GET /openapi.json`: lo schema.

Qualsiasi altra route risponde `404 {"error":"ROUTE_NOT_FOUND"}`.

### 6.18 Esempi
```sh
curl -i http://127.0.0.1:9100/configuration/front-gate
curl -s http://127.0.0.1:9100/drivers
curl -s http://127.0.0.1:9100/projects/1f251606-bdba-40c4-bbee-bfedc6e57f70
curl -s http://127.0.0.1:9100/drivers/7633be3d-e701-42ca-9fea-6c6d1bb4b7d1
curl -s http://127.0.0.1:9100/drivers/7633be3d-e701-42ca-9fea-6c6d1bb4b7d1/discounts
curl -s http://127.0.0.1:9100/discounts/e8013cf2-34eb-4bc3-8a34-b08fb24a1bf3
curl -s -w " [%{http_code}]\n" http://127.0.0.1:9100/projects/inesistente   # {"error":"PROJECT_NOT_FOUND","project_id":"inesistente"} [404]
curl -s -w " [%{http_code}]\n" http://127.0.0.1:9100/drivers/inesistente/discounts   # {"error":"DRIVER_NOT_FOUND","uid":"inesistente"} [404]

# utenti
curl -s http://127.0.0.1:9100/users/dome.santoro@gmail.com
curl -s -w " [%{http_code}]\n" http://127.0.0.1:9100/users/dome.santoro@gmail.com/credential   # 404 CREDENTIAL_NOT_SET finché non c'è la password

# sessioni (normalmente le scrive il sso, non si fa a mano)
curl -s -X POST http://127.0.0.1:9100/sessions -H 'content-type: application/json' \
  -d '{"token":"token-di-prova-0123456789","uid":"214912a9-2cc4-4205-87b7-93ea71f6be72","username":"driver.prova@example.com","issued_at":"2026-09-21T10:00:00Z","expires_at":"2026-09-21T18:00:00Z"}'
curl -s http://127.0.0.1:9100/sessions/token-di-prova-0123456789
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE http://127.0.0.1:9100/sessions/token-di-prova-0123456789   # 204
curl -s -X DELETE "http://127.0.0.1:9100/sessions?uid=214912a9-2cc4-4205-87b7-93ea71f6be72"
```

---

## 7. Configurazione

Nessun valore di default: se manca qualcosa, il server scrive il motivo nel log (`webtools_anagraphics non parte: …`) ed esce con 1.

**Dall'ambiente** arriva solo quello che serve a raggiungere la configurazione. Lo script di controllo lo carica da `webtools/configurator/bootstrap.env`:

| Variabile | Letta da | Note |
|---|---|---|
| `WEBTOOLS_ANAGRAPHICS_URL` | `settings.py` | Il nostro indirizzo, `http://host:porta`: il server si mette in ascolto lì. Gli altri sottosistemi usano la stessa variabile per chiamarci, quindi c'è un solo posto dove cambiarlo |
| `WEBTOOLS_CONFIGURATION_TIMEOUT_MS` | `settings.py` | Quanto aspettare Mongo per leggere la configurazione, all'avvio |
| `WEBTOOLS_MONGO_URI` | `settings.py` | Anche `scripts/seed.py` e `scripts/load_configuration.py` |
| `WEBTOOLS_MONGO_DB` | `settings.py` | I test la impostano a `webtools_test` |

**Tutto il resto** è il documento `anagraphics` della collection `configuration` (§5.1), letto direttamente da Mongo: anagraphics non può chiedere la configurazione a sé stesso via HTTP prima di essere acceso. Si modifica `webtools/configurator/configuration/anagraphics.json` e si rilancia `webtools/configurator/start.sh --restart`.

La configurazione si legge **una volta all'avvio**: dopo una modifica bisogna riavviare.

---

## 8. Comandi operativi

I comandi `uv` si lanciano da `webtools/anagraphics/`; lo script di controllo funziona da qualsiasi cartella.

### 8.1 Setup (una volta sola)
```sh
uv sync                        # crea .venv e installa le dipendenze (anche quelle di sviluppo)
uv run python -m scripts.seed  # indici + dati iniziali; si può rilanciare
../configurator/load_configuration.sh   # la configurazione di tutti i sottosistemi
```

Il seed e `load_configuration.py` leggono `WEBTOOLS_MONGO_URI` e `WEBTOOLS_MONGO_DB` dall'ambiente: `load_configuration.sh` li carica da sé, per il seed si lancia prima `set -a; source ../configurator/bootstrap.env; set +a`.

### 8.2 Avvio e arresto

Si usa lo script `webtools/anagraphics/webtools_anagraphics.sh`. Funziona da qualsiasi cartella.

```sh
webtools/anagraphics/webtools_anagraphics.sh --start   # avvia in background
webtools/anagraphics/webtools_anagraphics.sh --stop    # ferma
```

**`--start`**
- Avvia `…/webtools/anagraphics/.venv/bin/python -m webtools_anagraphics` con `nohup`: il server resta attivo anche chiudendo il terminale.
- Scrive il PID in `webtools_anagraphics.pid` e accoda stdout e stderr (log di accesso e traceback) in `webtools_anagraphics.log`. Prima di ogni avvio aggiunge al log una riga `=== start <data> ===`.
- Carica nell'ambiente le variabili di `webtools/configurator/bootstrap.env`.
- Aspetta fino a 10 s il messaggio `Uvicorn running on`:
  - se arriva: `webtools_anagraphics avviato (PID …)`, uscita 0;
  - se il processo muore: stampa le ultime righe del log, cancella il file PID, uscita 1.
- Se il server è già in esecuzione non ne avvia un secondo: `… è già in esecuzione (PID …)`.
- Se manca `.venv`, chiede di lanciare `uv sync`.

**`--stop`**
- Legge il PID dal file e, **prima di ucciderlo, verifica** che la riga di comando di quel processo sia esattamente `…/webtools/anagraphics/.venv/bin/python -m webtools_anagraphics`.
- Manda `SIGTERM` e aspetta fino a 10 s. Se il processo non esce, manda `SIGKILL`. Poi cancella il file PID.
- Se il file PID manca, o punta a un processo che non è il nostro (per esempio un PID riusato dopo un crash), **non uccide nulla**: cancella il file e stampa `… non è in esecuzione`.

**Perché così:**
- Non si ferma per nome del processo: `pkill -f` con un pattern colpirebbe anche altri progetti sul Mac.
- Non si ferma per porta: la porta potrebbe essere occupata da un altro programma.
- Si usa il PID salvato all'avvio, verificato sulla riga di comando completa, che contiene il percorso del venv di questo progetto.
- Lo script lancia direttamente `.venv/bin/python`, non `uv run`: così il PID salvato è quello del server e non di un processo wrapper.

**Controlli utili**
```sh
curl http://127.0.0.1:9100/configuration/front-gate          # risponde? {"subsystem":"front-gate",…}
tail -f webtools/anagraphics/webtools_anagraphics.log         # log in tempo reale
```

**Avvio in primo piano, per il debug** (Ctrl+C per fermarlo), da `webtools/anagraphics/`:
```sh
set -a; source ../configurator/bootstrap.env; set +a
uv run python -m webtools_anagraphics
```

> ⚠️ **Non** avviare con `uvicorn webtools_anagraphics.main:app`: senza `--no-proxy-headers` uvicorn si fida di `X-Forwarded-For` per le richieste da localhost, e il pool di IP può essere aggirato (§9.2).
>
> ⚠️ **Non** lanciare `python scripts/seed.py`: fallisce con `ModuleNotFoundError: No module named 'webtools_anagraphics'`. Usa `uv run python -m scripts.seed` da `webtools/anagraphics/`.

### 8.3 MongoDB locale (Homebrew)
| Voce | Valore |
|---|---|
| Config | `/usr/local/etc/mongod.conf` |
| Dati | `/usr/local/var/mongodb` |
| Log | `/usr/local/var/log/mongodb/mongo.log` |
| Ascolta su | `127.0.0.1`, `::1` (solo locale) |

```sh
brew services list | grep mongo              # stato
brew services start mongodb-community        # avvio (se è spento)
brew services restart mongodb-community
mongosh --quiet --eval 'db.runCommand({ping:1})'   # risponde { ok: 1 }
```

### 8.4 Ispezionare e modificare i dati (finché non c'è il CRUD)
```sh
mongosh webtools --quiet --eval 'db.configuration.find({}, {_id:0}).toArray()'
mongosh webtools --quiet --eval 'db.projects.find({}, {_id:0}).toArray()'
mongosh webtools --quiet --eval 'db.drivers.find({}, {_id:0}).toArray()'
mongosh webtools --quiet --eval 'db.discounts.find({}, {_id:0}).toArray()'
# gli utenti senza il blocco delle credenziali
mongosh webtools --quiet --eval 'db.users.find({}, {_id:0, credential:0}).toArray()'
# chi ha una password impostata, senza stamparla
mongosh webtools --quiet --eval 'db.users.find({}, {_id:0, username:1, "credential.updated_at":1}).toArray()'
# le sessioni aperte, senza il token intero
mongosh webtools --quiet --eval 'db.sessions.find({}, {_id:0, username:1, issued_at:1, expires_at:1}).toArray()'
mongosh webtools --quiet --eval 'db.projects.getIndexes()'

# nuovo UUID: python3 -c 'import uuid; print(uuid.uuid4())'
# aggiungere o aggiornare un progetto (upsert, rispetta l'indice univoco)
mongosh webtools --quiet --eval 'db.projects.updateOne({project_id:"<uuid>"}, {$set:{project_id:"<uuid>"}}, {upsert:true})'

# eliminare un progetto
mongosh webtools --quiet --eval 'db.projects.deleteOne({project_id:"<uuid>"})'

# aggiungere un driver
mongosh webtools --quiet --eval 'db.drivers.updateOne({uid:"<uuid>"}, {$set:{uid:"<uuid>", username:"<username>", screen_name:"<nome>"}}, {upsert:true})'

# aggiungere un codice sconto a un driver
mongosh webtools --quiet --eval 'db.discounts.updateOne({discount_code:"<uuid>"}, {$set:{discount_code:"<uuid>", driver:{uid:"<uuid driver>", screen_name:"<nome>"}, percentage:5}}, {upsert:true})'

# cambiare lo screen_name di un driver: va aggiornata anche la copia negli sconti (§5.4)
mongosh webtools --quiet --eval 'db.drivers.updateOne({uid:"<uuid>"}, {$set:{screen_name:"<nuovo>"}}); db.discounts.updateMany({"driver.uid":"<uuid>"}, {$set:{"driver.screen_name":"<nuovo>"}})'
```
Per rendere permanenti i dati iniziali, aggiungili alle liste `CONFIGURATIONS` / `PROJECTS` / `DRIVERS` / `DISCOUNTS` / `USERS` in `scripts/seed.py` e rilancia il seed. Il seed **non tocca le password già impostate**: `credential` si scrive solo alla creazione dell'utente (`$setOnInsert`).

Le password non si scrivono con `mongosh`: il blocco `credential` va costruito con scrypt, e a farlo è §8.5.

### 8.5 Impostare la password di un utente

Non c'è uno strumento dedicato: si costruisce il blocco `credential` con `build_credential()` e lo si scrive sull'utente, che deve già esistere.

```sh
uv run python -c '
from getpass import getpass
from webtools_anagraphics import db
from webtools_anagraphics.credentials import build_credential
from webtools_anagraphics.settings import load_settings

username = input("username: ")
database = db.connect(load_settings())
user = database[db.USERS].find_one({"username": username}, {"_id": 0, "uid": 1})
if user is None:
    raise SystemExit(f"utente non trovato: {username}")
database[db.USERS].update_one(
    {"username": username}, {"$set": {"credential": build_credential(getpass("password: "))}}
)
print("sessioni chiuse:", db.delete_sessions_of_user(database, user["uid"]))
'
```

Due cose da non perdere per strada:

- la password si fa **digitare** (`getpass`), non si passa come argomento: dagli argomenti finirebbe nella cronologia della shell e nell'elenco dei processi;
- dopo il cambio vanno **chiuse le sessioni aperte** di quell'utente (`delete_sessions_of_user`): cambiare password serve soprattutto quando si sospetta che sia entrato qualcun altro, e una sessione già aperta non la ferma la password nuova.

### 8.6 Test
```sh
uv run pytest        # 44 test, circa 1 secondo; serve Mongo acceso
uv run pytest -v     # con il nome dei singoli test
```

---

### 8.7 Migrazione alla 0.5.0: `anagraphics` → `projects`

Una volta sola per database, **prima** di avviare la 0.5.0. Poi il seed crea l'indice nuovo su `submission_id` (non tocca le password):

```sh
mongosh webtools --quiet --eval 'db.anagraphics.renameCollection("projects")'
uv run python -m scripts.seed
```

Eseguita sul database `webtools` il 2026-09-21.

### 8.8 Migrazione alla 0.6.1: via `billing.autonomous_fee_discount`

Il lavoro autonomo non ha più uno sconto sulla fee. Una volta sola per database; il campo, se resta, viene comunque restituito così com'è:

```sh
mongosh webtools --quiet --eval 'db.projects.updateMany({"billing.autonomous_fee_discount": {$exists: true}}, {$unset: {"billing.autonomous_fee_discount": ""}})'
```

Eseguita sul database `webtools` il 2026-09-22 (2 progetti).

---

## 9. Sicurezza e pool di IP

### 9.1 Come funziona
Il middleware `allow_only_known_ips` in `webtools_anagraphics/main.py` confronta `request.client.host` con `settings.allowed_ips`, un `frozenset` di stringhe:
- il confronto è **esatto**: niente sottoreti o CIDR, niente risoluzione di nomi;
- se l'IP non è nel pool risponde `403` e **non** interroga Mongo;
- se `request.client` non c'è (caso raro), la richiesta viene rifiutata.

### 9.2 Header del proxy (importante)
Di default uvicorn ha `proxy_headers=True` e considera attendibile `127.0.0.1`. In quella configurazione una richiesta da localhost con `X-Forwarded-For: <ip>` fa sì che `request.client.host` diventi `<ip>`.

Per questo il servizio si avvia **solo** con `webtools_anagraphics.sh --start` (o `python -m webtools_anagraphics` in primo piano). Entrambi passano da `webtools_anagraphics/__main__.py`, che imposta `proxy_headers=False`.

Verifica fatta il 2026-09-19: con `-H "X-Forwarded-For: 10.0.0.1"`
- lanciando uvicorn diretto → `403` (l'IP della connessione viene sostituito);
- lanciando `python -m webtools_anagraphics` → `200` (conta l'IP reale della connessione).

Se in futuro il servizio starà dietro un reverse proxy, andrà rivisto: con `proxy_headers=False` tutte le richieste risulteranno provenire dall'IP del proxy.

### 9.3 Rete
- Con `WEBTOOLS_ANAGRAPHICS_URL=http://127.0.0.1:9100` il server non è raggiungibile da altre macchine, qualunque sia `access.allowed_ips`.
- Con `127.0.0.1` il server **non ascolta su IPv6**: `http://[::1]:9100` non risponde. `::1` in `access.allowed_ips` serve solo ascoltando su `::`. `curl http://localhost:9100` funziona lo stesso, perché dopo il tentativo IPv6 ripiega su IPv4.
- Per accettare chiamate da un'altra macchina servono **entrambe** le cose: l'host dell'URL sull'interfaccia giusta e l'IP del chiamante in `access.allowed_ips`.

### 9.4 Cosa manca, per scelta
- Autenticazione e autorizzazione.
- TLS: il servizio parla HTTP in chiaro.
- Rate limiting.
- Autenticazione su MongoDB: l'istanza locale non ha credenziali.

---

## 10. Test

Il file `tests/test_api.py` esegue test end-to-end sul **Mongo reale**.

- In cima al file, **prima degli import di `webtools_anagraphics`**, vengono impostate le variabili di bootstrap con `WEBTOOLS_MONGO_DB=webtools_test` e si scrive in `webtools_test` il documento `anagraphics` della configurazione. Serve perché le impostazioni si leggono all'import di `webtools_anagraphics.main`: senza documento l'import fallirebbe, e con l'import prima delle variabili i test userebbero il DB `webtools` di produzione.
- Quattro test (`test_settings_*`) provano l'avvio: configurazione letta, variabile di bootstrap mancante, documento mancante, campo mancante. In tutti i casi mancanti `load_settings()` lancia `ConfigurationError`.
- Una fixture di modulo crea gli indici, inserisce la conf `front-gate`, il progetto `1f251606-…`, **due** driver (uno col codice sconto, uno senza, per distinguere lista vuota da driver inesistente), il codice sconto e **due utenti** (uno con credenziali, uno con `credential: null`), e alla fine **cancella** `webtools_test`. Sono gli stessi due driver del seed, così la lista è verificabile anche a mano.
- `TestClient` usa di default l'host `"testclient"`, che non è nel pool. Per questo i test passano `client=("127.0.0.1", 50000)` e, per il caso `403`, `client=("10.0.0.1", 50000)`.

| Test | Verifica |
|---|---|
| `test_configuration_found` | 200 e body esatto, senza `_id` |
| `test_configuration_not_found` | 404 + `{"error":"CONFIGURATION_NOT_FOUND","subsystem":…}` |
| `test_project_found` | 200 e body esatto, senza `_id` |
| `test_project_not_found` | 404 + `{"error":"PROJECT_NOT_FOUND","project_id":…}` |
| `test_driver_found` | 200 e body esatto, senza `_id` |
| `test_drivers_list` | 200 + `{"drivers":[…]}` con entrambi i driver, ordinati per `uid` e **senza** `username` |
| `test_driver_not_found` | 404 + `{"error":"DRIVER_NOT_FOUND","uid":…}` |
| `test_discount_found` | 200 e body esatto, col driver ridondato |
| `test_discount_not_found` | 404 + `{"error":"DISCOUNT_NOT_FOUND","discount_code":…}` |
| `test_discounts_of_driver` | 200 + `{"uid":…,"discounts":[…]}` |
| `test_discounts_of_driver_without_discounts` | 200 + lista **vuota**, non 404 |
| `test_discounts_of_unknown_driver` | 404 + `DRIVER_NOT_FOUND`, non lista vuota |
| `test_user_found` | 200 e body esatto, **senza** il blocco `credential` |
| `test_user_not_found` | 404 + `{"error":"USER_NOT_FOUND","username":…}` |
| `test_user_credential` | 200 + `{"username":…,"credential":{…}}` |
| `test_user_credential_not_set` | 404 + `CREDENTIAL_NOT_SET` per l'utente con `credential: null` |
| `test_user_credential_of_unknown_user` | 404 + `USER_NOT_FOUND`, distinto dal precedente |
| `test_session_lifecycle` | Creazione (201), rilettura identica, cancellazione (204), poi 404 sia in lettura sia in cancellazione |
| `test_session_keeps_free_data` | Il contenuto di `data` torna indietro com'era |
| `test_session_expired_is_still_returned` | Una sessione già scaduta si conserva e si rilegge: la scadenza la giudica il sso |
| `test_session_duplicate_token` | 409 + `SESSION_EXISTS`, nessuna sovrascrittura |
| `test_session_invalid_body` | 400 + `INVALID_BODY` per corpo vuoto, token troppo corto, data illeggibile |
| `test_session_not_found` | 404 + `SESSION_NOT_FOUND`, senza ripetere il token |
| `test_delete_sessions_of_user` | Chiude solo le sessioni di quell'`uid`, e dice quante |
| `test_delete_sessions_of_user_without_sessions` | 200 + `deleted: 0`, non 404 |
| `test_ticket_is_consumed_once` | Creazione, consumo che restituisce il documento, e secondo consumo che trova 404 |
| `test_ticket_duplicate` | 409 + `TICKET_EXISTS` |
| `test_ticket_invalid_body` | 400 + `INVALID_BODY` per corpo vuoto e biglietto troppo corto |
| `test_ip_outside_pool_is_rejected` | 403 + `IP_NOT_ALLOWED` su tutte le letture, su una route inesistente **e sulle scritture** |
| `test_unknown_route` | 404 + `ROUTE_NOT_FOUND` |
| `test_method_not_allowed` | 405 + `METHOD_NOT_ALLOWED` |
| `test_database_unavailable` | 503 + `DATABASE_UNAVAILABLE` (query simulata che solleva `ServerSelectionTimeoutError`) |
| `test_internal_error` | 500 + `INTERNAL_ERROR` (query simulata che solleva `RuntimeError`) |

Verificati anche a mano il 2026-09-20, col server vero, i sei endpoint e i 404 di driver e sconti.

Verificati a mano il 2026-09-19, col server vero:
- tutti i codici sopra;
- Mongo spento davvero → `503 DATABASE_UNAVAILABLE`;
- `X-Forwarded-For` ignorato.

Resta un warning noto e innocuo, interno a Starlette: `anyio.abc.BlockingPortal alias is deprecated`.

---

## 11. Troubleshooting

| Sintomo | Causa probabile | Verifica / soluzione |
|---|---|---|
| `403 {"error":"IP_NOT_ALLOWED"}` da localhost | 1) Server avviato con `uvicorn` diretto e client che invia `X-Forwarded-For`. 2) `access.allowed_ips` senza `127.0.0.1`. 3) Server in ascolto su `::` e client arrivato come `::1` o `::ffff:127.0.0.1` | Avvia con `webtools_anagraphics.sh --start`. Controlla `configurator/configuration/anagraphics.json` e che sia stato caricato. Guarda l'IP nel log di accesso (`INFO: <ip>:<porta> - "GET ..."`) e aggiungilo al pool |
| `503 {"error":"DATABASE_UNAVAILABLE"}` dopo circa **30 s** | Mongo spento o irraggiungibile. Nel log compare `MongoDB non raggiungibile: …` | `mongosh --eval 'db.runCommand({ping:1})'`; `brew services start mongodb-community`; controlla `WEBTOOLS_MONGO_URI`. L'attesa è `mongo.server_selection_timeout_ms` della configurazione |
| `404 PROJECT_NOT_FOUND` / `CONFIGURATION_NOT_FOUND` su un dato che "dovrebbe esserci" | Seed o `load_configuration.sh` non eseguiti, `WEBTOOLS_MONGO_DB` diverso, chiave scritta con maiuscole diverse, spazi nel valore | `mongosh webtools --eval 'db.projects.find({},{_id:0})'`; confronta il valore esatto |
| `404 {"error":"ROUTE_NOT_FOUND"}` | La route non esiste: errore di battitura nel percorso o `/` in più | Usa `/configuration/<nome>` o `/projects/<id>`; vedi `/docs` |
| `500 {"error":"INTERNAL_ERROR"}` su un documento specifico | Campo non convertibile in JSON (`ObjectId`, `Decimal128`, binari) | Traceback nel log del server (`ValueError`/`TypeError` durante la serializzazione). Converti il campo o adatta la risposta |
| `DuplicateKeyError` inserendo dati | Indice univoco su `subsystem` o `project_id` | Usa `updateOne(..., {upsert:true})` invece di `insertOne` |
| `ModuleNotFoundError: No module named 'webtools_anagraphics'` | Seed lanciato come file (`python scripts/seed.py`) o da una cartella diversa | Da `webtools/anagraphics/`: `uv run python -m scripts.seed` |
| `[Errno 48] Address already in use` (stampato da `--start`) | Porta 9100 occupata da un altro programma o da un'istanza avviata senza lo script | `lsof -nP -iTCP:9100 -sTCP:LISTEN` per vedere chi è. Se non è nostro, cambia la porta in `WEBTOOLS_ANAGRAPHICS_URL` (`bootstrap.env`): vale per tutti i sottosistemi |
| `--start` dice "già in esecuzione" ma il server non risponde | Processo bloccato | `…/webtools_anagraphics.sh --stop` e poi `--start`; guarda il log |
| `--start` fallisce con "Ambiente mancante" | `.venv` non creato | `cd webtools/anagraphics && uv sync` |
| `--start` fallisce con `webtools_anagraphics non parte: …` | Configurazione assente o sbagliata: variabile di bootstrap mancante, Mongo spento, documento `anagraphics` non caricato, campo mancante | Il messaggio dice quale. `webtools/configurator/load_configuration.sh`, poi di nuovo `--start` |
| `--start` fallisce con altre righe di log | Errore all'avvio (import) | Il messaggio stampato è la coda di `webtools_anagraphics.log` |
| Le modifiche alla configurazione non hanno effetto | Si legge solo all'avvio, e va prima caricata in Mongo | `webtools/configurator/start.sh --restart` (carica e riavvia) |
| Le modifiche al codice non hanno effetto | Il server non ha il reload automatico | `--stop` e `--start`. In sviluppo si può usare `uv run uvicorn webtools_anagraphics.main:app --reload --no-proxy-headers --host 127.0.0.1 --port 9100` |
| I test scrivono nel DB `webtools` | Qualcuno ha spostato gli import di `webtools_anagraphics` sopra l'impostazione delle variabili di bootstrap in `tests/test_api.py` | Ripristina l'ordine (§10) |
| I test falliscono tutti con timeout | Mongo spento | Avvia Mongo (§8.3) |
| `http://[::1]:9100` non risponde | Il server ascolta solo su IPv4 | Normale con `127.0.0.1` in `WEBTOOLS_ANAGRAPHICS_URL` (§9.3) |

Dove guardare:
- **log del server**: `webtools/anagraphics/webtools_anagraphics.log` se avviato con `--start` (§8.2), altrimenti lo stdout del terminale. Contiene i log di accesso uvicorn e i traceback;
- **log di Mongo**: `/usr/local/var/log/mongodb/mongo.log`.

---

## 12. Metriche e osservabilità

Stato attuale: **nessuna metrica dedicata**. Non esistono endpoint `/health` o `/metrics` né logging strutturato. Le informazioni disponibili oggi sono queste.

| Cosa | Come |
|---|---|
| Traffico ed esiti | Log di accesso uvicorn in `webtools_anagraphics.log`: `INFO: 127.0.0.1:61935 - "GET /projects/1f251606-bdba-40c4-bbee-bfedc6e57f70 HTTP/1.1" 200 OK`. Conteggio per codice: `grep -c '" 403' webtools_anagraphics.log`, ecc. |
| Stato del servizio | `curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" http://127.0.0.1:9100/configuration/front-gate` (200 = servizio e Mongo attivi) |
| Stato di Mongo | `mongosh --eval 'db.runCommand({ping:1})'` |
| Volume dei dati | `mongosh webtools --quiet --eval 'db.projects.countDocuments()'` (idem per `configuration`) |
| Dimensioni e indici | `mongosh webtools --quiet --eval 'db.projects.stats()'` |
| Query lente | Profiler di Mongo: `db.setProfilingLevel(1, {slowms: 50})`, poi `db.system.profile.find()` |

Primi candidati se servissero metriche: un endpoint `/health` con ping a Mongo, un logging JSON con durata delle richieste, un exporter Prometheus.

---

## 13. Limiti noti e debito tecnico

- Sola lettura tranne le sessioni: per configurazioni, progetti, driver, sconti e utenti non c'è ancora nessun endpoint di scrittura (CRUD previsto).
- **Chiunque sia nel pool di IP può leggere `GET /users/{username}/credential`**, non solo il sso: finché il pool è il solo localhost di questo Mac la differenza non esiste, ma il giorno in cui i sottosistemi stanno su macchine diverse serve un'autenticazione tra servizi, non un elenco di IP.
- Nessun controllo di chi crea o cancella una sessione: chi è nel pool può creare una sessione per qualsiasi `uid`. Vale la nota sopra.
- Nessuno schema o validazione dei documenti in Mongo (né `$jsonSchema` né modelli Pydantic sulle risposte, tranne il corpo di `POST /sessions`).
- Il driver ridondato dentro gli sconti non si aggiorna da solo: un cambio di `screen_name` va propagato a mano (§5.4).
- `drivers.username` resta un dato scollegato: l'utente vero sta in `users`, col suo `driver_uid`. I due `username` oggi coincidono per copia, non per vincolo.
- Entrambi gli utenti hanno una **password di sviluppo**, corta e nota: va rifatta prima di uscire dalla PoC.
- Impostare una password è un comando a mano (§8.5): niente strumento dedicato, nessun controllo sulla lunghezza, e chi lo scrive deve ricordarsi di chiudere le sessioni aperte.
- `GET /drivers/{uid}/discounts` e `GET /drivers` restituiscono tutto, senza paginazione né filtri: va bene finché i numeri restano piccoli.
- In `drivers` e in `users` c'è un dato di prova (`Prova`): va tolto quando il sottosistema smette di essere una PoC.
- Chi è nel pool può anche creare biglietti per una sessione qualsiasi: vale la stessa nota sull'autenticazione tra servizi.
- Le sessioni e i biglietti scaduti restano nell'archivio fino al passaggio del TTL (circa un minuto): vanno bene per una lettura, non per contare "quante sessioni sono aperte".
- Client Mongo creato all'import del modulo, senza lifespan: difficile sostituirlo nei test, niente chiusura esplicita.
- Indici creati solo dal seed, non all'avvio del server.
- Se Mongo non risponde, l'errore arriva dopo 30 s, il timeout di default di pymongo.
- Pool di IP senza CIDR e senza supporto a un reverse proxy.
- Nessuna autenticazione, TLS, rate limiting, `/health` o metriche.
- Nessuna containerizzazione né gestione come servizio (launchd/systemd): il server si avvia a mano con `webtools_anagraphics.sh --start`, non riparte da solo dopo un crash o un riavvio del Mac, e il log cresce senza rotazione.
- I test richiedono un Mongo reale e acceso.

---

## 14. Come estendere (checklist)

**Aggiungere un campo ai documenti**
Nessuna modifica al codice. Aggiorna `scripts/seed.py` se il campo deve far parte dei dati iniziali, aggiorna §5 di questo documento e verifica che il valore sia convertibile in JSON.

**Aggiungere un endpoint**
1. Aggiungi la query in `webtools_anagraphics/db.py`, con proiezione `PUBLIC`.
2. Aggiungi la route in `webtools_anagraphics/main.py`: il middleware IP la protegge automaticamente.
3. Per i casi di errore solleva `errors.ApiError(stato, CODICE, **contesto)`. Se serve un codice nuovo, aggiungilo come costante in `webtools_anagraphics/errors.py` e documentalo in §6.1: non riusare codici esistenti con altri significati.
4. Aggiungi i test in `tests/test_api.py`: 200, errori con body esatto, 403.
5. Documenta in §6.

**Aggiungere una collection**
Costante in `webtools_anagraphics/db.py`, indice in `ensure_indexes()`, dati iniziali in `scripts/seed.py`, pulizia già coperta dal `drop_database` dei test, documentazione in §5. Se la collection punta a un'altra (come `discounts` → `drivers`), serve anche un indice **non** univoco sul campo di collegamento.

**Aggiungere un valore configurabile**
Non una variabile d'ambiente: un campo in `webtools/configurator/configuration/anagraphics.json`, nel gruppo giusto (o in uno nuovo). Poi campo in `Settings` e lettura in `load_settings()`, senza default. Documenta in §5.1. L'ambiente resta per il solo bootstrap (§7).

**Configurazione di un sottosistema nuovo**
Un file `webtools/configurator/configuration/<nome>.json`; il sottosistema lo legge all'avvio con `GET /configuration/<nome>` (i sottosistemi Node con `commons/configuration/configuration_client.js`). Qui non serve cambiare niente.

**Passare al CRUD**
Punti da decidere:
- modelli Pydantic per validare l'input;
- gestione di `DuplicateKeyError`, da tradurre in `409`;
- autenticazione oltre al pool di IP;
- chi è autorizzato a scrivere.

---

## 15. Changelog

| Data | Versione | Modifica |
|---|---|---|
| 2026-09-22 | 0.8.0 | **La lingua.** Nuovi `PUT /users/{username}/locale` e `PUT /sessions/{token}/locale` (§6.19): campo `users.locale` e `sessions.data.locale`. Li usa il sso per ricordare la lingua scelta tra un login e l'altro. Test da 45 a 50. |
| 2026-09-22 | 0.7.0 | Campo **`enabled`** dei driver (abilitato a seguire i progetti), anche nella lista `GET /drivers` (`DRIVER_SUMMARY`). `Dome` e `Prova` abilitati; nuovo driver di prova non abilitato, `Non abilitato`, con un codice sconto al 10%. Dati aggiornati con il seed il 2026-09-22. |
| 2026-09-22 | 0.6.2 | Nuovo `billing.ambassador_uid` (default `null`): il driver che ha invitato l'utente. Le regole su quando vale le applica preanalyst. Test da 44 a 45. |
| 2026-09-22 | 0.6.1 | Tolto `billing.autonomous_fee_discount`: il lavoro autonomo non ha più uno sconto sulla fee (migrazione §8.8). Un corpo di `POST /projects` che lo contiene ancora non dà errore: il campo si ignora. |
| 2026-09-21 | 0.6.0 | **Sottosistema di configurazione per tutti.** Configurazione di anagraphics letta all'avvio dal suo documento in `configuration` (`access.allowed_ips`, `mongo.server_selection_timeout_ms`); indirizzo e porta da `WEBTOOLS_ANAGRAPHICS_URL`. Niente più default né variabili `HOST`, `PORT`, `MONGO_URI`, `MONGO_DB`, `ALLOWED_IPS`: dall'ambiente solo il bootstrap `WEBTOOLS_*`. Senza configurazione il server non parte. Le configurazioni non stanno più nel seed: nuovo `scripts/load_configuration.py`, che carica `configurator/configuration/*.json`. Test da 40 a 44. |
| 2026-09-19 | 0.1.0 | Creazione: API di lettura `configuration`/`anagraphics`, pool di IP, seed, test. |
| 2026-09-19 | 0.1.0 | Fix: avvio tramite `__main__.py` con `proxy_headers=False`. Prima, con uvicorn diretto, `X-Forwarded-For` da localhost sostituiva l'IP del client. |
| 2026-09-19 | 0.1.0 | Pacchetto rinominato da `app` a `webtools_anagraphics`, per non avere nomi generici tra i processi del Mac. |
| 2026-09-19 | 0.1.0 | Progetto di prova `demo-001` eliminato e sostituito da `1f251606-bdba-40c4-bbee-bfedc6e57f70`: i `project_id` sono UUID. |
| 2026-09-19 | 0.1.0 | Errori: stato HTTP + codice stabile (`{"error": "…"}`), niente più testi discorsivi (`{"detail": "…"}`). Nuovi codici: `CONFIGURATION_NOT_FOUND`, `PROJECT_NOT_FOUND`, `ROUTE_NOT_FOUND`, `METHOD_NOT_ALLOWED`, `IP_NOT_ALLOWED`, `DATABASE_UNAVAILABLE` (503, prima 500), `INTERNAL_ERROR`. |
| 2026-09-19 | 0.1.0 | Script `webtools_anagraphics.sh --start/--stop`: nohup, file PID e arresto solo dopo aver verificato la riga di comando. Sostituisce `pkill -f` e l'arresto per porta. |
| 2026-09-21 | 0.5.0 | La collection `anagraphics` diventa **`projects`** (migrazione §8.7) e `GET /anagraphics/{id}` diventa `GET /projects/{id}`. Nuovi `POST /projects` (l'id lo genera anagraphics; `submission_id` univoco sparse rende idempotente l'invio del form) e `DELETE /projects/{id}`. Campi nuovi del progetto: `owner_uid`, `submission_id`, `created_at`, `state`, `review` (driver e `preset`), `billing` (sconto e sconto sulla fee del lavoro autonomo). Codice nuovo: `SUBMISSION_EXISTS`. Test da 33 a 40. |
| 2026-09-21 | 0.4.0 | Collection `tickets` (chiave `ticket`, TTL su `expires_at`) con `POST /tickets` e `DELETE /tickets/{ticket}`, che consuma il biglietto leggendolo. Serve al sso per passare una sessione da un indirizzo a un altro, cosa che un cookie non sa fare (§5.7). Codici nuovi: `TICKET_NOT_FOUND`, `TICKET_EXISTS`. Test da 30 a 33. |
| 2026-09-21 | 0.3.0 | Collection `users` (chiave `username`, con il blocco `credential` in scrypt) e `sessions` (chiave `token`, indice TTL su `expires_at`). Endpoint nuovi: `GET /users/{username}`, `GET /users/{username}/credential`, `POST /sessions`, `GET /sessions/{token}`, `DELETE /sessions/{token}`, `DELETE /sessions?uid=…`. **Prime scritture** del sottosistema. Codici nuovi: `USER_NOT_FOUND`, `CREDENTIAL_NOT_SET`, `SESSION_NOT_FOUND`, `SESSION_EXISTS`, `INVALID_BODY`. Client Mongo con `tz_aware=True`. Test da 17 a 30. Il login resta fuori di qui: lo fa `webtools_sso`. |
| 2026-09-20 | 0.2.1 | `GET /drivers`, la lista di tutti i driver, con i soli `uid` e `screen_name`. `username` del driver `Dome` corretto in `dome.santoro@gmail.com`. Aggiunto il driver di prova `Prova`. Test da 16 a 17. |
| 2026-09-20 | 0.2.0 | Collection `drivers` (chiave `uid`) e `discounts` (chiave `discount_code`, driver ridondato, `percentage` in punti percentuali). Tre endpoint nuovi: `GET /drivers/{uid}`, `GET /drivers/{uid}/discounts`, `GET /discounts/{discount_code}`. Codici nuovi: `DRIVER_NOT_FOUND`, `DISCOUNT_NOT_FOUND`. Primo driver: `Dome`, con un codice sconto al 5%. Test da 9 a 16. Login non gestito. |
