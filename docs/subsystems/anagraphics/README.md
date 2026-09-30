# Subsystem `anagraphics`

> Reference documentation for development, maintenance, troubleshooting, bugfixing and metrics.
> Last updated: 2026-09-30 · subsystem version: `0.13.0`.
> Code: `webtools/anagraphics/` (paths relative to the root of the `ftab - webtools/` workspace).

---

## 0. Quick sheet

| Item | Value |
|---|---|
| What it does | An internal HTTP API holding the **configuration of every subsystem** (it is the configuration subsystem), the record of the projects, the **users** — the drivers among them — their discount codes and the **sessions** |
| Stack | Python 3.13 · FastAPI · uvicorn · pymongo · MongoDB 8 |
| Code | `webtools/anagraphics/` |
| Start (background, detached from the terminal) | `webtools/anagraphics/webtools_anagraphics.sh --start` |
| Stop | `webtools/anagraphics/webtools_anagraphics.sh --stop` |
| Process | `…/webtools/anagraphics/.venv/bin/python -m webtools_anagraphics` |
| PID / Log | `webtools/anagraphics/webtools_anagraphics.pid` / `webtools/anagraphics/webtools_anagraphics.log` |
| Address | `WEBTOOLS_ANAGRAPHICS_URL` in `webtools/configurator/bootstrap.env` (today `http://127.0.0.1:9100`) |
| Database | `WEBTOOLS_MONGO_URI` / `WEBTOOLS_MONGO_DB` in `bootstrap.env` (today `mongodb://localhost:27017`, DB `webtools`) |
| Collections | `configuration` (key `subsystem`), `projects` (key `project_id`), `discounts` (key `discount_code`), `users` (key `username`, and `driver.driver_uid` for whoever is a driver), `sessions` (key `token`), `tickets` (key `ticket`) |
| Writes | Sessions, tickets and language: `POST /sessions`, `DELETE /sessions/{token}`, `DELETE /sessions?uid=…`, `PUT /sessions/{token}/locale`, `PUT /users/{username}/locale`, `POST /tickets`, `DELETE /tickets/{ticket}`. Everything else is read-only |
| Access | Only from the IPs in `access.allowed_ips` of its configuration; the others get a `403` |
| Configuration | Read at startup from Mongo (the `anagraphics` document of `configuration`). No defaults: if it is missing, the server does not start (§7) |
| Authentication | None: the only check is the IP pool. The one who authenticates is `webtools_sso`, which uses this data |
| Tests | `uv run pytest` (116 tests, using the `webtools_test` DB, dropped at the end) |
| State | Reads on five collections, writes on sessions and tickets. A full CRUD is planned later |

Quick check, with the server running:
```sh
curl http://127.0.0.1:9100/configuration/front-gate   # {"subsystem":"front-gate","listen":{…},"subsystems_infos":{…},"screen_infos":{…}}
curl http://127.0.0.1:9100/projects/1f251606-bdba-40c4-bbee-bfedc6e57f70       # {"project_id":"1f251606-bdba-40c4-bbee-bfedc6e57f70"}
curl http://127.0.0.1:9100/drivers                                               # every driver
curl http://127.0.0.1:9100/drivers/7633be3d-e701-42ca-9fea-6c6d1bb4b7d1          # the driver Dome
curl http://127.0.0.1:9100/drivers/7633be3d-e701-42ca-9fea-6c6d1bb4b7d1/discounts   # their discount codes
curl http://127.0.0.1:9100/discounts/e8013cf2-34eb-4bc3-8a34-b08fb24a1bf3        # a single discount code
```

---

## 1. Purpose and role in the system

The project is a "factory" of small bespoke software, made of several subsystems: the showcase
site `front-gate`, the pre-analysis and analysis systems, the driver interface, the demos and
others still (see `contesto/02. current_context.md`). `anagraphics` is the shared **internal
data source**:

- **Subsystem configurations** (collection `configuration`): **every** subsystem reads its own
  configuration from here at startup, looking it up by name, and without it does not start. The
  documents are written in `webtools/configurator/configuration/<name>.json` and
  `webtools/configurator/load_configuration.sh` loads them (§7). Anagraphics itself reads its own
  (the `anagraphics` document) straight from Mongo.
- **Projects** (collection `projects`): every client project has a document, identified by
  `project_id`. It is born with `POST /projects` when the client sends the pre-analysis (§6.3.1);
  the project's files (specifications) do not live here but in `webtools-workspaces`.
- **Users** (collection `users`): who may enter the system, identified by `username`, with the
  credentials block. A user who is also a **driver** — one of the people who supervise the
  projects — carries the role inside their own document, in `driver`. Up to 0.11.0 the drivers were
  a collection of their own (migration in §8.12).
- **Discount codes** (collection `discounts`): each code belongs to a driver, identified by
  `discount_code`.
- **Sessions** (collection `sessions`): who has logged in and until when, identified by the
  `token`.

It is an **internal** service: it is not meant to be exposed on the internet and today it accepts
calls from localhost only.

**What it does not do.** Users and sessions live here, but the login does not: `anagraphics` does
not compare passwords and does not decide whether a session is still good. It stores and returns.
Verifying the credentials, generating the tokens and judging the expiries is `webtools_sso`'s job
(`docs/subsystems/sso/README.md`), which is the only one calling
`GET /users/{username}/credential`. The rule that holds the two parts together: **anagraphics is a
store, not an authority**.

---

## 2. Functional choices

| Choice | Reason |
|---|---|
| **Read-only, except the sessions** | It is the first iteration. Writes will come with the full CRUD; today data is inserted with the seed or with `mongosh` (§8.4). The exception is sessions, which are born and die constantly: the sso writes them (§5.6). |
| **Credentials are returned, not verified** | Comparing a password requires knowing when a password is "right", that is, an authentication policy. That lives in the sso, together with tokens and expiries. What stays here is the stored format (§5.5). |
| **Keys with a dedicated name** (`subsystem`, `project_id`) instead of Mongo's `_id` | They are readable, stable keys, meant to be used by the other subsystems. The `_id` stays an internal Mongo detail. |
| **A unique index on every key** | It guarantees one document per subsystem or project. A double insert fails with `DuplicateKeyError`. |
| **`_id` never returned** | The responses contain domain data only. Besides, `ObjectId` does not convert to JSON. |
| **Minimal data** | Today `configuration` = `{subsystem}`; `projects` has the fields of §5.2. The structures will be extended; the API returns **the whole document** (except `_id`), so new fields appear without changing the code. |
| **Errors = HTTP status + a stable code** (`{"error": "PROJECT_NOT_FOUND", ...}`) | The consumers (Node, Python) decide from the HTTP status (`res.ok`, `raise_for_status()`, axios) and tell the case apart with a string comparison, without interpreting prose. One format for every error (§6.1). `200 + null` was discarded: it would make "not found" indistinguishable from a success and would hide wrong URLs. |
| **An IP pool instead of authentication** | An internal service on a single machine: the pool is enough for now. The check happens **before** any other logic. |
| **Only the connection's IP counts** | The `X-Forwarded-For` headers can be forged, so they are not taken into account (§9.2). |

Example data loaded by the seed (the `configuration` collection does not go through the seed:
`webtools/configurator/load_configuration.sh` loads it, §5.1):
- `projects`: `{"project_id": "1f251606-bdba-40c4-bbee-bfedc6e57f70"}`, a test project (with no
  owner: it predates `POST /projects`).

---

## 3. Technological choices

| Component | Installed version | Why |
|---|---|---|
| Python | 3.13.2 (in the venv created by uv; the requirement is `>=3.12`) | The required stack. uv chose 3.13 even though the system has 3.14 |
| **FastAPI** | 0.141.1 | A small API, native JSON, parameter validation, automatic OpenAPI documentation. Easy to extend to a CRUD |
| **uvicorn** | 0.53.0 | The standard ASGI server for FastAPI |
| **pymongo** (synchronous) | 4.18.1 | The official driver. The routes are synchronous `def`s: FastAPI runs them in a threadpool, and that is enough for the expected load |
| MongoDB | 8.0.5 (Homebrew, local) | Flexible JSON documents, suited to structures that will grow |
| **uv** | 0.10.x | It handles venv, dependencies and lock (`uv.lock`) with a single tool |
| pytest + httpx2 | 9.1.1 / 2.13.0 | Starlette's `TestClient`. `httpx2` instead of `httpx`, which Starlette 1.x flags as deprecated |

Discarded, for simplicity:
- **Motor / async pymongo**: not needed with this load;
- **Pydantic settings**: the configuration comes from Mongo, not from the environment, and the
  fields are few;
- **Docker**: the daemon was not running and Mongo is already installed locally.

---

## 4. Architecture

### 4.1 File map

```
webtools/anagraphics/
├── pyproject.toml     # dependencies (uv), pytest config; package = false (not installed as a package)
├── uv.lock            # locked versions: do not edit by hand
├── README.md          # short guide
├── webtools_anagraphics.sh   # CONTROL: --start / --stop (nohup + a verified PID file)
├── webtools_anagraphics.pid  # generated by --start, removed by --stop
├── webtools_anagraphics.log  # generated by --start (appended)
├── webtools_anagraphics/     # the Python package (a specific name, no generic ones like "app")
│   ├── __init__.py
│   ├── __main__.py    # STARTUP: imports main (which reads the configuration) and runs uvicorn with proxy_headers=False; exits with 1 if the configuration is missing
│   ├── settings.py    # Settings + load_settings(): bootstrap from the environment, the rest from the `anagraphics` document in Mongo
│   ├── errors.py      # error codes (the API contract), ApiError, handlers for 403/404/405/503/500
│   ├── db.py          # connect(), ensure_indexes(), find_*(), set_configuration_field(); the CONFIGURATION/PROJECTS/DRIVERS/DISCOUNTS/PUBLIC constants; the wrapper that counts every Mongo operation (§4.4)
│   ├── provider_pricing.py  # which paths name a provider object (`<anything>.providers.<name>`): what keeps PUT …/pricing narrow
│   ├── commons/       # GENERATED by webtools/configurator/deploy.sh metrics: the metrics client. Not edited here
│   └── main.py        # the FastAPI `app` object, the IP pool and measurement middleware, the endpoints
├── scripts/
│   ├── seed.py        # unique indexes + upsert of the initial data (idempotent); no configurations
│   └── load_configuration.py  # loads configurator/configuration/*.json into the `configuration` collection
└── tests/
    └── test_api.py    # 78 end-to-end tests on a real Mongo (the webtools_test DB)
```

### 4.2 Life cycle

- `webtools_anagraphics/main.py` reads the settings and creates the Mongo client **when the module
  is imported**, that is, at server startup. As a result:
  - a configuration changed after the startup has no effect: **a restart is needed**;
  - reading the configuration means querying Mongo: **if Mongo is down, or the `anagraphics`
    document is not there, the server does not start** (`webtools_anagraphics is not starting: …`
    in the log, exit 1). If Mongo falls over after the startup, the requests answer `503` (§11).
- The server **does not create the indexes** at startup: `scripts/seed.py` creates them.
- There are no startup or shutdown hooks (lifespan): the Mongo client closes with the process.

### 4.3 The path of a request

```
client ──HTTP──> uvicorn (127.0.0.1:9100, proxy_headers=False)
                   │
                   ▼
          middleware allow_only_known_ips   (webtools_anagraphics/main.py)
          request.client.host ∈ access.allowed_ips ?
             │ no  → 403 {"error":"IP_NOT_ALLOWED"}      (no query to Mongo)
             │ yes
             ▼
          FastAPI routing
             │ unknown route → 404 {"error":"ROUTE_NOT_FOUND"}; wrong method → 405 {"error":"METHOD_NOT_ALLOWED"}
             ▼
          get_configuration / get_project   (threadpool)
             │
             ▼
          db.find_* → collection.find_one({key: value}, {"_id": 0})
             │ None → 404 {"error":"PROJECT_NOT_FOUND"|"CONFIGURATION_NOT_FOUND", <key>: <value>}
             │ Mongo unreachable (ConnectionFailure) → 503 {"error":"DATABASE_UNAVAILABLE"}
             │ any other exception → 500 {"error":"INTERNAL_ERROR"}   (traceback in the log)
             ▼
          200 + the JSON document
```

The IP check comes **before** the routing, so an IP outside the pool gets a `403` on non-existent
routes and on `/docs` too.

---

### 4.4 What it measures

Anagraphics sends measurements to `webtools_metrics` like every other subsystem, and it was the last
to start: until 2026-09-29 the one subsystem every other one depends on was the one nothing said
anything about. What it sends:

| metric | from | what it answers |
|---|---|---|
| `http.request` | the middleware in `main.py` | requests by route, method, status and duration. The route is the one **as written** — `/projects/{project_id}`, never a path with an id in it, or there would be a bucket per project |
| `http.error` | the same middleware, from `request.state.error_code` | which stable code was answered. `errors.error_response` leaves it on the request |
| `http.refused_ip` | the same middleware | a request from outside the pool: somebody knocking, or a subsystem started with the wrong configuration |
| `process.started` | `__main__.py` | a count that grows by itself is a process that keeps dying and coming back |
| `mongo.operation` | the wrapper in `db.py` | the database's own latency and failures, by collection and operation |
| `configuration.changed` | `PUT /configuration/{subsystem}/pricing` | a price changed while the system was running: the moment after which every cost figure means something else |

**`mongo.operation` is counted by a wrapper, and no function in `db.py` mentions it.** `connect()`
hands back the database wrapped in `_MeasuredDatabase`, which hands out `_MeasuredCollection`s, and
those count the operations named in `MEASURED` as they pass. A query written tomorrow is counted the
day it is written and nobody has to remember — the same arrangement as the middleware that counts
the requests, for the same reason.

Two things the wrapper does not do. It does not catch: an exception goes on to the caller exactly as
it would have, measured on its way past, because a failure that changed into something else because
we were counting it would be a worse fault than not counting it. And it does not measure `find`,
which hands back a cursor: the work happens while the caller walks it, so a duration taken around
the call would be the time it took to decide to ask.

**The metrics client is built here, not by `load_metrics`.** That function reads a configuration
that came from anagraphics over HTTP, using the configuration client — which this subsystem
deliberately does not have, being the one that serves it. `settings._metrics_client()` reads the
same four fields with this file's own helpers and builds the same shared class. It is also why
`load_metrics` imports the configuration client inside the function rather than at the top of the
file.

Nothing waits for metrics: the client does not wait, does not throw and does not retry, so a metrics
that is down cannot make a request here slower or turn it into an error. What cannot be sent is lost.

---

## 5. Data model (MongoDB)

**Database**: `webtools` (the `WEBTOOLS_MONGO_DB` variable of `bootstrap.env`). The indexes are
created by `scripts/seed.py` (`db.ensure_indexes`), not by the server's startup.

| Collection | Key | Other indexes | Content | Who writes |
|---|---|---|---|---|
| `configuration` | `subsystem` (unique) | — | Every subsystem's configuration | `configurator/load_configuration.sh` |
| `projects` | `project_id` (unique) | `submission_id` (unique, sparse), `owner_uid`, `review.driver.uid`, `created_at` | One document per client project | `webtools_preanalyst`, through the API |
| `discounts` | `discount_code` (unique) | `driver.uid` | The discount codes, with the driver duplicated inside | seed / `POST /drivers/{uid}/discounts` |
| `users` | `username` (unique) | `uid` (unique), `driver.driver_uid` (unique, sparse) | Who may enter the system, with the credentials; the drivers are the ones carrying a `driver` | seed + a command by hand (§8.5) |
| `sessions` | `token` (unique) | `uid`, **TTL** on `expires_at` | Who has logged in and until when | `webtools_sso`, through the API |
| `tickets` | `ticket` (unique) | **TTL** on `expires_at` | Single-use tickets for handing a session from one address to another | `webtools_sso`, through the API |

`_id` is always an automatic ObjectId and never leaves any response: it is not repeated in the
tables that follow.

### 5.1 `configuration`
| Field | Type | Constraints | Notes |
|---|---|---|---|
| `_id` | ObjectId | automatic | Never exposed |
| `subsystem` | string | **unique** (index `subsystem_1`) | The subsystem's name, e.g. `front-gate`. Case-sensitive |

The other fields depend on the subsystem and the API returns them as they are. They are
**structured** (objects nested by subject: `listen`, `access`, `subsystems_infos`, `session`, …),
not flat.

**Where they come from.** The configuration that lives is **here, in this collection**. The files
in `webtools/configurator/configuration/<subsystem>.json` (without the `subsystem` field, which
the file name gives) are the **seed** — the values a new environment is born with — and the
**expected shape**: they say which fields exist. `webtools/configurator/load_configuration.sh`,
which `start.sh` runs before starting the services, adds **only the missing fields**: a field that
is there is not touched whatever value it holds, a field removed from a file stays, a subsystem
that no longer has a file is not deleted. A document changed here survives every restart; to take
it back to the file you need `./load_configuration.sh --reset <subsystem>`, which is the only way
to wipe those changes. The secrets of `configurator/secrets/` are the exception and **always
replace** the value they find: a rotated key must count.

What each field means is in the documentation of the subsystem that reads it. Here only
anagraphics' own:

| Field | Type | Notes |
|---|---|---|
| `access.allowed_ips` | string[] | The allowed IPs, **exact** (no CIDR). Not empty |
| `mongo.server_selection_timeout_ms` | int | How long to wait for Mongo in each request before answering `503` |

**The one field written from outside the files.** A `pricing` inside a provider object —
`<anything>.providers.<name>.pricing` — is written by `PUT /configuration/{subsystem}/pricing`
(§6.22), not by the seed:

```json
{"currency": "USD",
 "cents_per_million_tokens": {"input": 1500, "output": 7500},
 "updated_at": "2026-09-26T10:22:31Z"}
```

It is configuration like the rest and is read like the rest; what is different is where it comes
from. `load_configuration.sh` adds only the missing fields, so it never carries a price away — but
`--reset` does, like any other value changed in operation.

### 5.2 `projects`
Up to 0.4.0 the collection was called `anagraphics` (migration in §8.7).

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `_id` | ObjectId | automatic | Never exposed |
| `project_id` | string | **unique** (index `project_id_1`) | A **UUID** v4 in canonical lowercase form, e.g. `1f251606-bdba-40c4-bbee-bfedc6e57f70`. Anagraphics generates it in `POST /projects`: the caller cannot choose it |
| `owner_uid` | string | — | The `uid` of the user (`users.uid`) who created the project. Whoever reads a project on a user's behalf compares this field |
| `submission_id` | string | **unique, sparse** (index `submission_id_1`) | The id of the pre-analysis form submission. The same submission repeated finds the project already born instead of creating another. Sparse: a project can be born by other routes too |
| `created_at` | datetime (UTC) | — | The moment of creation |
| `description` | string | — | One sentence saying what the tool is for, in the client's language: the sentence that tells this project from the others in a list. Written by the analyst's points door once the analysis has succeeded (`PUT /projects/{id}/description`, §6.23), never at creation. **Absent on a project that has not been analysed, and on one whose door came back without a sentence**: absent is absent, and nothing is stored in its place. Added in 0.13.0 |
| `pipeline` | object | — | Where the project is along the flow and what has happened to it: `{state, steps}`. `state` is one of `PREANALYSIS`, `PREVALIDATION`, `UNDERSPECIFIED`, `ANALYSIS`, `DRIVER_VALIDATION`, `CLIENT_VALIDATION`, `DEVELOPMENT`, `ALPHA_TEST`, `DEMO`, `PAID`, `REJECTED`, `FAILED`, `FAILED_NO_DRIVERS` — the last two are not refusals: `FAILED` is where a run that did not get to the end leaves a project, and `FAILED_NO_DRIVERS` is an analysis that was written and that nobody could be given — `UNDERSPECIFIED` is the request sent back to the user because it said too little: it is not a refusal, and from there one starts again by rewriting. `steps` is an **ordered list** of the steps taken, not a map: a step can repeat, and the list is the register of the decisions taken on the project. Each step: `{step, result, decided_at, data}`, with `result` among `open`, `passed`, `rejected`, `underspecified` and `failed` and `data` free — its shape is decided by whoever takes the step, here it is stored and not interpreted. **`open` is the only one that has decided nothing**: the step has begun and lasts — it is the case of the rounds of questions, which open when the prevalidation passes and grow with every turn. `PREANALYSIS` covers the whole pre-analysis — the form, the prevalidation that passes and the rounds that follow — because there is no earlier moment to have a state for and the rounds *are* the pre-analysis; which of the two moments a project is at is read off the steps. While it is open its `data` is updated with `PATCH` (§6.20); when it closes it takes one of the other results and from then on is never touched again, like every other step. Up to 0.8.0 there was a flat `state` in place of all this (migration §8.9) |
| `review` | object | — | Who supervises the project: `{driver, preset}`. `driver` is the **copy** anagraphics makes — `{uid, screen_name, username}`, where `uid` is the driver's uid — or `null` when there is none. It deliberately carries neither the driver's `level` nor their `active`: those are states of the driver and not of this assignment (§5.5). `preset: true` = a **preset** driver (from a driver's link, or the driver themselves in autonomous work); `preset: false` = assigned by the system. What a caller **sends** is a uid and not a copy, in the field `driver_uid` (§6.3.1). Up to 0.4.x the stored form was a flat `review.driver_uid` |
| `billing` | object | — | The economic data: `{discount_code, autonomous_work, ambassador_uid}`. The link's discount code and autonomous work **exclude each other**: with autonomous work `discount_code` is `null`. `ambassador_uid` is the uid of the driver who invited the user to work with us, or `null`; projects created before 0.6.2 do not have the field. Up to 0.6.0 there was also `autonomous_fee_discount` (migration §8.8). They are only stored: the price is not worked out here |

### 5.3 `drivers` — removed in 0.12.0

There is no collection of drivers. A driver is a **user** carrying a `driver` object, and the
fields that were in this section are in §5.5: `uid` is `driver.driver_uid`, `screen_name` and
`username` are the person's own, and the boolean `enabled` became `driver.level`.

The section number is kept so that the references to §5.4 and §5.5 elsewhere in this document keep
pointing where they pointed. The migration is §8.12.

**Why they were merged.** The two documents described one person twice, and `drivers.username` was
a second copy of `users.username` kept in step by hand — recorded as debt until 0.11.0. The
boolean was also the wrong shape: the service already had three conditions (not a driver, a
driver, a driver who may supervise) and a boolean cannot carry the third.

### 5.4 `discounts`
| Field | Type | Constraints | Notes |
|---|---|---|---|
| `_id` | ObjectId | automatic | Never exposed |
| `discount_code` | string | **unique** (index `discount_code_1`) | The discount code's **UUID**, e.g. `e8013cf2-34eb-4bc3-8a34-b08fb24a1bf3` |
| `driver.uid` | string | a **non**-unique index (`driver.uid_1`) | The `uid` of the driver the code belongs to |
| `driver.screen_name` | string | — | The driver's name, **duplicated** |
| `percentage` | number | — | The discount percentage in **percentage points**: `5` means 5%, not 0.05 |

Codes present: `e8013cf2-34eb-4bc3-8a34-b08fb24a1bf3`, of the driver `Dome`, at 5%;
`91165eb1-65d6-43a9-ade8-681ec3ebef8d`, of the test driver at level 0, at 10%. A third code of the
second test driver exists in the running store and not in the seed.

**On duplicating the driver.** `uid` and `screen_name` are copied inside the discount on purpose:
whoever reads a discount code has the name to show straight away, with no second read. The price
is that **a change of the driver's `screen_name` does not propagate**: until there is a CRUD it
must be updated by hand in `discounts` too (§8.4). `driver.uid` here is the driver's uid — the one
in `users.driver.driver_uid` — and it never changes.

### 5.5 `users`
| Field | Type | Constraints | Notes |
|---|---|---|---|
| `uid` | string | **unique** (index `uid_1`) | The person's **UUID**. It is the stable identifier: `username` can change, `uid` cannot |
| `username` | string | **unique** (index `username_1`) | What is typed at the login. Today it is the email address. Case-sensitive |
| `screen_name` | string | — | The name shown, e.g. `Dome` |
| `active` | bool | — | `false` prevents the login (the sso checks it). The document stays |
| `driver` | object / `null` | `driver.driver_uid` **unique, sparse** (index `driver.driver_uid_1`) | The driver role: `null` for whoever is not a driver, otherwise `{driver_uid, level}`. **`null` and not absent**: every user has the field, and «not a driver» is a fact stated, not a field forgotten. The index is sparse precisely because `null` leaves the path `driver.driver_uid` absent, so the non-drivers are not in it and do not collide with one another. Up to 0.11.0 this was a flat `driver_uid` pointing at the `drivers` collection (migration §8.12) |
| `driver.driver_uid` | string | see above | The **driver's** UUID, e.g. `7633be3d-e701-42ca-9fea-6c6d1bb4b7d1`. It is not the person's `uid` and never becomes it. As for `project_id`, the format is not validated by the API |
| `driver.level` | int | — | What this driver may do. **0** not enabled, **1** enabled (after the interview), **2** `prj-admin`. From **1 upwards** a driver may supervise a client's project; at 0 they are still a driver and can be an ambassador and do autonomous work. The threshold lives in the two boundaries that decide it — the drivers' pool and the preanalyst's driver link — and not in the configuration: it is a rule of the service, and it moves under review. Level 2 is stored and **nothing reads it yet**: what it opens is specified together with the levels that come after it |
| `credential` | object / `null` | — | The password block, below. `null` means "password never set": the user exists but cannot get in |
| `locale` | string / absent | — | The preferred language (`it`, `en`, …). The sso writes it at the first login and at every language change; at the next login it puts it back into the session (§6.19) |
| `billing` | object | — | The person's economic data: today only `{turns_credit}`, the chat turns they have in credit and can move onto a project when the included ones run out. An integer, never negative: the check lives inside the write (§6.21). Users born before 0.10.0 do not have the field (migration §8.10) |

The `credential` block:

| Field | Example | Notes |
|---|---|---|
| `algorithm` | `"scrypt"` | The only one handled today. The sso refuses what it does not know |
| `params` | `{"n":16384,"r":8,"p":1,"dklen":32}` | **Inside the document, not in the code**: the day they are raised, old passwords stay verifiable with their own |
| `salt` | base64 of 16 random bytes | Different for every password |
| `hash` | base64 of 32 bytes | The result of scrypt on the password and the salt |
| `updated_at` | date | When it was set |

**Why scrypt.** It is in the standard library of both Python and Node: no extra dependency either
here or in the sso, and exactly the same computation on both sides. The format is built in one
place only, `webtools_anagraphics/credentials.py`; the one who verifies is
`webtools/sso/src/credentials.js`. The sso's `tests/credentials.test.js` holds a hash really
produced by Python: if the two scrypts stopped computing the same thing, that test fails instead
of a login.

The password is **not seeded**: it is set separately, building the block with
`build_credential()` (§8.5). There is no dedicated tool yet: until there is a CRUD it is a command
by hand.

Users the seed creates:

| `username` | `screen_name` | `driver` | Notes |
|---|---|---|---|
| `dome.santoro@gmail.com` | `Dome` | `{7633be3d-…, level 1}` | The real user. A development password set on 2026-09-21 |
| `driver.test@example.com` | `Test` | `{639718a3-…, level 1}` | **Test data**. No discount codes: it is there to see more than one driver in the list, and for the "driver who exists with no discounts" case |
| `driver.notenabled@example.com` | `Not enabled` | `{f234b930-…, level 0}` | **Test data** with a discount code: the "link" and "discount" cases of a driver who may not supervise. Before 0.12.0 this driver had no user at all, so the case could not be reached from a login |

The development passwords are short and known: they must be redone before the system is reachable
from outside this machine.

**The running store is not the seed.** It carries a user the seed does not (`policy.test@example.com`,
a client: `driver: null`), and its two test drivers were renamed by hand in Italian
(`driver.prova@example.com`/`Prova`, `driver.nonabilitato@example.com`/`Non abilitato`). The seed
cannot be re-run on it as it is: it would try to create `driver.test@example.com` with a
`driver_uid` the renamed user already holds, and the unique index would refuse it. Test data is
data and belongs in English — bringing the store back in line means renaming a login identity, so
it is asked for, not done in passing.

**Why `uid` and `driver.driver_uid` are two different things.** `users.uid` is the person's
identity, `driver.driver_uid` is the identity of the driver role: a client is a user and is not a
driver. Keeping them apart is also what made this merge cost nothing downstream — the discounts,
the copies on the projects and `billing.ambassador_uid` all point at the driver's uid, and not one
of them had to be rewritten.

### 5.6 `sessions`
| Field | Type | Constraints | Notes |
|---|---|---|---|
| `token` | string | **unique** (index `token_1`) | 32 random bytes in base64url (43 characters). It holds no information: it is only the key for finding the session again |
| `uid` | string | a **non**-unique index (`uid_1`) | The person. A user can have several sessions open at once |
| `username` | string | — | Copied at login, so as not to have to read the user again |
| `issued_at` | date | — | When they came in |
| `expires_at` | date | a **TTL** index (`expires_at_1`, `expireAfterSeconds: 0`) | When it stops counting |
| `data` | object | — | Session data, free. Today it holds `screen_name` and `driver` photographed at login time — `driver` being the same object the user document carries, `null` or `{driver_uid, level}` — and `locale`, the session's language, which changes with `PUT /sessions/{token}/locale` |

**The document is built by the sso.** The token, the dates and the content of `data` arrive
ready-made in `POST /sessions`: here we check that the fields are there and store it.
`GET /sessions/{token}` returns the session **even if expired**, until the TTL has removed it:
deciding whether it is still good is the sso's job.

**The TTL index is housekeeping, not security.** Mongo comes round to delete roughly every 60
seconds, so an expired session can stay in the store for a while. No consumer should infer
validity from the document's presence: look at `expires_at`.

**The photograph inside `data` ages**, like the driver inside the discount codes (§5.4): if the
`screen_name` changes, sessions already open show the old one until the next login.

### 5.7 `tickets`
| Field | Type | Constraints | Notes |
|---|---|---|---|
| `ticket` | string | **unique** (index `ticket_1`) | 32 random bytes in base64url |
| `token` | string | — | The session it gives access to |
| `service` | string | — | The subsystem it was issued for, e.g. `http://127.0.0.1:9200` |
| `issued_at` | date | — | — |
| `expires_at` | date | a **TTL** index (`expires_at_1`) | One minute after it was issued |

**What it is for.** A cookie belongs to one address only: the sso, which sits on port 9300, cannot
set one on behalf of the preanalyst, which sits on 9200. After the login the sso therefore sends
the browser back to the subsystem with a **ticket** in the address; the subsystem exchanges it
server to server and receives the session. The real token, which lasts hours, never travels
through the address — where it would end up in the browser's history, in logs and in shared links.

**It is good once.** `DELETE /tickets/{ticket}` reads and deletes at the same moment
(`find_one_and_delete`): two requests with the same ticket cannot both succeed, not even if they
arrive together. A ticket read from a log is therefore already consumed, and expired after a
minute anyway.

### 5.8 Rules for extending the documents
- **Fields can be added** freely: the API returns the whole document except `_id`.
- The values must be **convertible to JSON** by FastAPI: string, number, bool, null, lists, nested
  objects and `datetime` are fine. An `ObjectId` in a field other than `_id`, a `Decimal128` or
  binary data produce a **500** (§11). In that case they must be converted before the document is
  returned.
- Do not rename `subsystem`, `project_id`, `uid` or `discount_code` without updating
  `webtools_anagraphics/db.py`, `scripts/seed.py`, the indexes and the tests.

---

## 6. API reference

Base URL: `http://127.0.0.1:9100`. Every response, errors included, is JSON.

### 6.1 Error format (the contract)

Every error has the **correct HTTP status** and a body with a **stable code**:
```json
{"error": "<CODE>", "<context field>": "<value>"}
```
- The `error` field is always there. The context fields are there only where stated.
- The codes are **part of the API contract**: they are not renamed and not reused with other
  meanings. They are defined in `webtools_anagraphics/errors.py`.
- There are no prose messages: the consumers compare `error`, they must not interpret text.

| Status | `error` | Context | When |
|---|---|---|---|
| `404` | `CONFIGURATION_NOT_FOUND` | `subsystem` | No configuration for that subsystem |
| `404` | `PROVIDER_NOT_FOUND` | `path` | The configuration is there and holds nothing at that path (§6.22) |
| `400` | `NOT_A_PROVIDER_OBJECT` | `path` | The path holds something, and it is not a provider object (§6.22) |
| `404` | `PROJECT_NOT_FOUND` | `project_id` | No project with that id |
| `404` | `DRIVER_NOT_FOUND` | `uid` | No driver with that uid |
| `404` | `DISCOUNT_NOT_FOUND` | `discount_code` | No discount code with that code |
| `404` | `USER_NOT_FOUND` | `username` | No user with that username |
| `404` | `CREDENTIAL_NOT_SET` | `username` | The user exists but has no password set (`credential: null`) |
| `404` | `SESSION_NOT_FOUND` | — | No session with that token: unknown, already deleted or removed by the TTL |
| `409` | `SESSION_EXISTS` | `token` | A session with that token already exists. It is not overwritten |
| `404` | `TICKET_NOT_FOUND` | — | No ticket with that code: unknown, already consumed or removed by the TTL |
| `409` | `TICKET_EXISTS` | — | A ticket with that code already exists |
| `409` | `SUBMISSION_EXISTS` | — | A `POST /projects` with the `submission_id` of another user's project |
| `404` | `OPEN_STEP_NOT_FOUND` | `project_id`, `step` | No step yet open with that name on the project's pipeline (§6.20) |
| `409` | `NOT_ENOUGH_TURNS` | `uid` | The user's turn credit is not enough for what was asked (§6.21) |
| `400` | `INVALID_BODY` | — | The body of `POST /sessions`, `POST /tickets`, `POST /projects` or `PUT …/pricing` missing, incomplete or with invalid fields. The detail of the fields stays in the log, not in the response |
| `404` | `ROUTE_NOT_FOUND` | — | A non-existent URL: usually a bug in the consumer |
| `405` | `METHOD_NOT_ALLOWED` | — | A method not allowed on an existing route |
| `403` | `IP_NOT_ALLOWED` | — | The caller's IP outside `access.allowed_ips` (§9) |
| `503` | `DATABASE_UNAVAILABLE` | — | MongoDB unreachable, after the server selection timeout (30 s by default) |
| `500` | `INTERNAL_ERROR` | — | Any other unexpected error; the traceback is in the log |

Examples of handling on the consumer's side:
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
Returns the subsystem's configuration.

| Outcome | Status | Body |
|---|---|---|
| Found | `200` | the document without `_id`, e.g. `{"subsystem":"front-gate","listen":{"host":"127.0.0.1","port":9000},"subsystems_infos":{"preanalyst":{"url":"http://127.0.0.1:9200"}},"screen_infos":{"pricing":{"standard_price_cents":40000}}}` |
| Not found | `404` | `{"error":"CONFIGURATION_NOT_FOUND","subsystem":"<requested>"}` |
| Other errors | `403` / `503` / `500` | see §6.1 |

#### 6.2.1 `GET /configuration`
Returns the configuration of **every** subsystem in Mongo, ordered by `subsystem`. No pagination: there is one document per subsystem.

| Outcome | Status | Body |
|---|---|---|
| Always | `200` | `{"configurations":[ …the documents without `_id`, as in §6.2… ]}`; the empty list if the collection is empty |
| Other errors | `403` / `503` / `500` | see §6.1 |

A subsystem that no longer has a seed file in `configurator/configuration/` comes out here too: what lives is in Mongo, and the front end of the configurator has to show what is there, not what the files say. Whoever reads a single configuration keeps using §6.2: this route is for looking at the whole of it.

### 6.22 `PUT /configuration/{subsystem}/pricing`
Writes the price of what one **provider object** consumes. It is the only route that changes a
configuration, and it changes **one key**.

```json
{
  "provider_path": "preanalyst.conversation.providers.anthropic",
  "currency": "USD",
  "cents_per_million_tokens": {"input": 1500, "output": 7500, "cache_write": 1875, "cache_read": 150}
}
```

| Outcome | Status | Body |
|---|---|---|
| Written | `200` | `{"pricing":{"currency":"USD","cents_per_million_tokens":{…},"updated_at":"2026-09-26T10:22:31Z"}}` |
| No configuration for that subsystem | `404` | `{"error":"CONFIGURATION_NOT_FOUND","subsystem":"<requested>"}` |
| The document holds nothing at that path | `404` | `{"error":"PROVIDER_NOT_FOUND","path":"<provider_path>"}` |
| The path is not a provider object's | `400` | `{"error":"NOT_A_PROVIDER_OBJECT","path":"<provider_path>"}` |
| A body that is not a price | `400` | `{"error":"INVALID_BODY"}` |
| Other errors | `403` / `503` / `500` | see §6.1 |

**What a provider object is.** An object hanging from a `providers` branch —
`<anything>.providers.<name>` — wherever that branch is: each door of a subsystem has one, under
the section that door reads, and a subsystem may hold one that belongs to no door. The rule is the
path's next-to-last key, and it is the whole rule: nothing in anagraphics knows which providers
exist or what a door is called (`webtools_anagraphics/provider_pricing.py`).

**What is written.** The `pricing` key of that object, and nothing else — the other fields of the
object, and the rest of the document, are left exactly as they are. A route able to write any
field would be a different route.

**The amounts** are integers, hundredths of the unit of `currency`, per **million tokens**:
`1500` with `"USD"` is 15.00 dollars per million. There is **one amount per kind of token**, under
the names the kinds arrived with: two kinds are not the same thing, and one amount for both would
be a rate between them that nobody decided. The kinds are **not listed here** and are not checked
against a list — which kinds a provider counts is declared in the configuration
(`providers.<name>.token_kinds`), and a name anagraphics has never heard of is a price like any
other. What is checked is that an amount is a whole number of hundredths and is not negative, that
at least one kind is priced, and that `currency` is written as a currency is (ISO 4217: three
capital letters). Which currencies may be *chosen* is not anagraphics' business: that list belongs
to whoever offers the choice (`configurator-fe`, `pricing.currencies`).

**`updated_at`** is written here, in UTC, at the moment of the write, and is not taken from the
body: a date the caller chooses would be a claim about when something was done, not a record of
it. It is the date of the last change of **the price and the currency together**, because they are
written together.

**Writing again replaces the price whole**, `cents_per_million_tokens` included: a kind left out of
the body is no longer priced. Removing a price altogether is not done by this route — a body with
nothing priced in it is `400`, not a deletion.

The seed files in `configurator/configuration/` carry no prices: a new environment is born without
them, which is what it is — nobody has said what a token costs yet. The front end that fills this
in is `webtools/configurator-fe`, on its own page (`/providers/pricing`): the page that shows the
configuration does not write.

### 6.3 `GET /projects/{project_id}`
Returns the project. Up to 0.4.0 it was `GET /anagraphics/{project_id}`, which no longer exists.

| Outcome | Status | Body |
|---|---|---|
| Found | `200` | the document without `_id` (§5.2) |
| Not found | `404` | `{"error":"PROJECT_NOT_FOUND","project_id":"<requested>"}` |
| Other errors | `403` / `503` / `500` | see §6.1 |

#### 6.3.1 `POST /projects`
Creates a project. Body: `{"owner_uid": "<uid>", "submission_id": "<the submission's id, at least 16 characters>", "review": {"driver_uid": …, "preset": true}, "billing": {"discount_code": …, "autonomous_work": false, "ambassador_uid": null}}` (`review` and `billing` optional, with the defaults of §5.2). The rules about who is preset and which discount counts are applied by the caller (the preanalyst). Anagraphics generates `project_id`, `created_at` and `pipeline: {state: "PREANALYSIS", steps: []}`; a `project_id` in the body is ignored.

| Outcome | Status | Body |
|---|---|---|
| Created | `201` | the complete document |
| Same `submission_id`, same `owner_uid` | `200` | the project **already there**: a second one is not created |
| Same `submission_id`, another `owner_uid` | `409` | `{"error":"SUBMISSION_EXISTS"}` (the other's project is not revealed) |
| Invalid body | `400` | `{"error":"INVALID_BODY"}` |
| Other errors | `403` / `503` / `500` | see §6.1 |

#### 6.3.2 `POST /projects/{project_id}/pipeline/steps`
Appends a step to the project's pipeline and moves it to the state the step says. Body: `{"step": "prevalidation", "result": "passed", "state": "PREANALYSIS", "data": {…}}`.

- `step` and `state` are closed lists (§5.2): an invented name answers `400`, and nothing gets into
  the database.
- `result` is `open`, `passed`, `rejected`, `underspecified` or `failed`. `underspecified` is a step
  taken that sends the request back without closing anything: it sits between `passed` and
  `rejected`, and it **is counted** — whoever decides how many times one may go back looks at how
  many there already are in the list. `open` is a step that has begun and has decided nothing yet
  (§6.20).
- `state` is **where the step leads**, not a field of the step: the same outcome can lead to
  different places depending on the gate, so the caller decides it. In the document it ends up in
  `pipeline.state`, not inside the step.
- `decided_at` is set by anagraphics: when it happened is not the caller's choice.
- There is a single write (`$push` and `$set` together): there is no moment in which the step is
  there and the state is still the previous one.

| Outcome | Status | Body |
|---|---|---|
| Appended | `201` | the updated project |
| Project does not exist | `404` | `{"error":"PROJECT_NOT_FOUND","project_id":"<requested>"}` |
| Invalid body, a name outside the list | `400` | `{"error":"INVALID_BODY"}` |
| Other errors | `403` / `503` / `500` | see §6.1 |

#### 6.3.3 `DELETE /projects/{project_id}`
Deletes a project. It is for undoing a project left half-made: the preanalyst uses it when the
pre-specification cannot be written.

| Outcome | Status | Body |
|---|---|---|
| Deleted | `204` | — |
| Not found | `404` | `{"error":"PROJECT_NOT_FOUND","project_id":"<requested>"}` |

### 6.23 `GET /projects` — the lists

Returns the projects matching **one** filter, newest first (`created_at` descending). Added in 0.13.0,
for `projects-hub`, which is the first thing in the system that reads the register back.

| Query | Returns |
|---|---|
| `?owner_uid=<uid>` | the projects of that owner (`users.uid`) |
| `?driver_uid=<uid>` | the projects whose `review.driver.uid` is that driver's uid |
| `?without_driver=true` | the projects whose `review.driver` is `null` |

**Exactly one of the three**, and `400 INVALID_QUERY` for none and for more than one. They are not
refinements of one another — one names a person's projects, one a driver's, one the projects nobody
supervises — and two together would be a question about an intersection nobody asked for. Refusing is
this route saying it does not guess which of two filters was meant.

`without_driver` takes only `true`. `false` would have to mean "the projects that *do* have a driver",
which is a fourth question and not one this route answers, so it is refused rather than quietly ignored.

`state` is an extra filter, optional and **repeatable**, valid with all three and checked against the
list of §5.2: an invented name is a `400`, as on the steps route, and not an empty list. Given more than
once it means any one of those given.

**Which states a caller cares about is the caller's rule**, which is why it travels as a query and is
not written into this route: a filter that took one caller's list of states would be that caller's rule
living in everybody's API.

The projection is `{"_id": 0, "pipeline.steps": {"$slice": -1}}` — the whole document, minus every step
but the last. The last step is the one that says why a project failed (a failure is written into the
`data` of the step that failed; there is no `reason` field on a project), and what the slice leaves out
is what matters: the `preanalysis` step stays `open` and grows by two messages every turn, so a list of
twenty projects read whole would carry twenty entire conversations.

| Outcome | Status | Body |
|---|---|---|
| Found, or none | `200` | `{"projects":[…]}` — an empty list when none match, which is an answer |
| No filter, two filters, `without_driver=false`, an invented state | `400` | `{"error":"INVALID_QUERY"}` |
| Other errors | `403` / `503` / `500` | see §6.1 |

**No pagination**, as `GET /drivers` has none. It is a known limit (§11): the list of projects with no
driver is the one that can grow without a bound anybody chose.

Three indexes serve it, none unique: `owner_uid`, `review.driver.uid`, `created_at`. There is none for
`review.driver` being null: that filter matches whatever the other two do not, and Mongo would walk the
collection either way.

#### 6.23.1 `PUT /projects/{project_id}/description`

Writes the project's description. Body `{"description": "<non-empty>"}`; the spaces are taken off and a
sentence made only of spaces is refused. No maximum length: how long the sentence is belongs to whoever
writes it. Added in 0.13.0.

A route of its own and not a field on the steps route, for the same reason
`PUT /projects/{project_id}/review/driver` is one: it is a field of the project written after the
project was born, by whoever found it out, while the steps route appends to the register of decisions —
which writing a label is not.

| Outcome | Status | Body |
|---|---|---|
| Written | `200` | the updated project |
| Project does not exist | `404` | `{"error":"PROJECT_NOT_FOUND","project_id":"<requested>"}` |
| Empty, or only spaces, or no `description` | `400` | `{"error":"INVALID_BODY"}` |

#### 6.23.2 `POST /drivers/{uid}/discounts`

Creates a discount code for a driver. Body `{"percentage": <1..100>}`; the answer is the document as
§5.4 holds it. Added in 0.13.0 — until then codes were written by hand in `mongosh` (§8.4).

`discount_code` is a UUID generated here, like `project_id`: the caller does not choose it.
`driver.screen_name` is copied here out of the user who is that driver, and never taken from the body —
exactly as `_driver_copy` works, and for the same reason: the drivers live in this subsystem.

**The commercial range is not checked here.** `1..100` is what a percentage *is*; how much webtools is
willing to give away today is a policy of whoever offers the link, read from that subsystem's own
configuration (`links.discount` in `projects-hub`). Anagraphics stores and does not decide — the same
division by which it stores `review.preset` without applying the rule that sets it. Nor is a second
code at a percentage that already has one refused: whether to reuse one is the caller's rule.

| Outcome | Status | Body |
|---|---|---|
| Created | `201` | `{"discount_code":…,"driver":{"uid":…,"screen_name":…},"percentage":…}` |
| No such driver | `404` | `{"error":"DRIVER_NOT_FOUND","uid":"<requested>"}` |
| A percentage that is not one | `400` | `{"error":"INVALID_BODY"}` |

The `uid` is the **driver's**, not the person's: a code points at the driver, so a person's own uid
answers `404` like any other unknown one.

### 6.4 `GET /drivers`
Returns **every** driver, ordered by the driver's uid, with `uid`, `screen_name`, `level` and
`active`.

| Outcome | Status | Body |
|---|---|---|
| Always | `200` | `{"drivers":[{"uid":…,"screen_name":…,"level":…,"active":…}, …]}` |
| No drivers | `200` | `{"drivers":[]}` |
| Other errors | `403` / `503` / `500` | see §6.1 |

`uid` is the **driver's** uid (`users.driver.driver_uid`) and never the person's: what points at a
driver points at that one.

**A driver is not a document of its own**: the list is users carrying a `driver`, turned into this
shape by `_driver_view` in `webtools_anagraphics/main.py` — the one place that mapping is made, so
that the driver routes cannot answer with different shapes. The projection it reads is
`DRIVER_SUMMARY` in `db.py`, and it is **positive**: it names what comes out. The document behind
it is a person's, credential block included, so a projection by exclusion would let a field added
to a user tomorrow out through a route about drivers, without anybody choosing it.

**`username` does not appear in the list**, unlike in `GET /drivers/{uid}`: a list is read to show
or choose a driver, and there is no reason to hand out everybody's login identifiers at once. Note
that it is not a security measure while there is no login: whoever can call the list can also call
the individual drivers.

**`level` and `active` both come out**, because together they answer «may this driver be handed a
client's project» and that question is the caller's to answer: the pool and the preanalyst's driver
link each apply it (`level >= 1` and `active: true`), and neither could without both fields. This
route decides nothing.

No pagination and no filters: there are few drivers. If one day there were many, `limit`/`skip`
would be needed here.

### 6.5 `GET /drivers/{uid}`
Returns the driver. `uid` is the driver's uid, not the person's: asking for a person's `uid`
answers `404`, and so does asking for a user who is not a driver.

| Outcome | Status | Body |
|---|---|---|
| Found | `200` | `{"uid":"7633be3d-…","username":"dome.santoro@gmail.com","screen_name":"Dome","level":1,"active":true}` |
| Not found | `404` | `{"error":"DRIVER_NOT_FOUND","uid":"<requested>"}` |
| Other errors | `403` / `503` / `500` | see §6.1 |

The same view as the list plus `username`, which is the address the driver is reached at. It is the
person's `username`: since 0.12.0 there is no second copy of it to fall out of step.

### 6.6 `GET /drivers/{uid}/discounts`
Returns **every** discount code of the driver, ordered by `discount_code`.

| Outcome | Status | Body |
|---|---|---|
| The driver exists | `200` | `{"uid":"<requested>","discounts":[<documents without _id>]}` |
| The driver exists with no codes | `200` | `{"uid":"<requested>","discounts":[]}` |
| The driver does not exist | `404` | `{"error":"DRIVER_NOT_FOUND","uid":"<requested>"}` |
| Other errors | `403` / `503` / `500` | see §6.1 |

The distinction is deliberate: **an empty list ≠ a driver who does not exist**. The consumer must
not infer the driver's existence from the number of discounts, so the endpoint checks the driver
first and only then reads the codes (two reads, not one).

### 6.7 `GET /discounts/{discount_code}`
Returns a single discount code, with the driver duplicated inside (§5.4).

| Outcome | Status | Body |
|---|---|---|
| Found | `200` | the document without `_id`, e.g. `{"discount_code":"e8013cf2-…","driver":{"uid":"7633be3d-…","screen_name":"Dome"},"percentage":5}` |
| Not found | `404` | `{"error":"DISCOUNT_NOT_FOUND","discount_code":"<requested>"}` |
| Other errors | `403` / `503` / `500` | see §6.1 |

### 6.8 `GET /users/{username}`
The user **without** the credentials block. It is the ordinary read, the one every subsystem in
the pool may do.

| Outcome | Status | Body |
|---|---|---|
| Found | `200` | e.g. `{"uid":"8ff93901-…","username":"dome.santoro@gmail.com","screen_name":"Dome","active":true,"driver":{"driver_uid":"7633be3d-…","level":1},"billing":{"turns_credit":0}}`. A user who is not a driver carries `"driver":null` |
| Not found | `404` | `{"error":"USER_NOT_FOUND","username":"<requested>"}` |
| Other errors | `403` / `503` / `500` | see §6.1 |

There is no list of users: they are read one by one, by username.

#### 6.8.1 `GET /users?uid=…`
The same user and the same body, asked for by uid.

A project keeps `owner_uid` and no copy of the person who owns it (§5.2), so whoever has something
to say to a client has a uid and not an address: this is where the two are joined. It is used by
the analyst, when a run stops, and by projects-hub, when a driver closes a request.

| Outcome | Status | Body |
|---|---|---|
| Found | `200` | the same document as §6.8 |
| Not found | `404` | `{"error":"USER_NOT_FOUND","uid":"<requested>"}` |
| No `uid` in the query | `400` | `{"error":"INVALID_BODY"}` |
| Other errors | `403` / `503` / `500` | see §6.1 |

It is a query and not `/users/{uid}`, because that position already names a user by their username:
the same place meaning two things would be told apart by what the value looks like, which is a
guess. `DELETE /sessions?uid=…` is written this way for the same reason.

### 6.9 `GET /users/{username}/credential`
The algorithm, parameters, salt and hash of the password (§5.5). **Only the sso uses it**, to
verify a login.

| Outcome | Status | Body |
|---|---|---|
| Found | `200` | `{"username":"…","credential":{"algorithm":"scrypt","params":{…},"salt":"…","hash":"…","updated_at":"…"}}` |
| The user does not exist | `404` | `{"error":"USER_NOT_FOUND","username":"<requested>"}` |
| Password never set | `404` | `{"error":"CREDENTIAL_NOT_SET","username":"<requested>"}` |
| Other errors | `403` / `503` / `500` | see §6.1 |

The two 404s are told apart because they say two different things to whoever administers the
system. To the client the sso merges them into a single `INVALID_CREDENTIALS` anyway: whoever
tries to get in must not work out whether an address is registered.

### 6.10 `POST /sessions`
Stores a session built by the sso. Nothing is generated here: neither the token nor the dates.

Body (JSON):

| Field | Required | Notes |
|---|---|---|
| `token` | yes | At least 16 characters |
| `uid` | yes | The person |
| `username` | yes | — |
| `issued_at` | yes | An ISO 8601 date |
| `expires_at` | yes | An ISO 8601 date. It may already be past: it is not checked |
| `data` | no | A free object, `{}` by default |

| Outcome | Status | Body |
|---|---|---|
| Created | `201` | the stored document |
| Token already there | `409` | `{"error":"SESSION_EXISTS","token":"<sent>"}` |
| Invalid body | `400` | `{"error":"INVALID_BODY"}` |
| Other errors | `403` / `503` / `500` | see §6.1 |

Extra fields beyond these are ignored: what has to survive goes inside `data`.

### 6.11 `GET /sessions/{token}`
The session, **even if expired** (§5.6).

| Outcome | Status | Body |
|---|---|---|
| Found | `200` | the document without `_id` |
| Not found | `404` | `{"error":"SESSION_NOT_FOUND"}` |
| Other errors | `403` / `503` / `500` | see §6.1 |

The 404's body does not repeat the token: it would end up in everybody's logs, and a token is a
secret.

### 6.12 `DELETE /sessions/{token}`
Closes a session.

| Outcome | Status | Body |
|---|---|---|
| Deleted | `204` | empty |
| Not found | `404` | `{"error":"SESSION_NOT_FOUND"}` |
| Other errors | `403` / `503` / `500` | see §6.1 |

The 404 is there to tell "I have just closed it" from "it was not there". The sso answers
`logged: false` in both cases anyway.

### 6.13 `DELETE /sessions?uid={uid}`
Closes **all** of a user's sessions. It is for password changes and for blocking an account.

| Outcome | Status | Body |
|---|---|---|
| Done | `200` | `{"uid":"<requested>","deleted":<number>}` |
| Without `uid` | `400` | `{"error":"INVALID_BODY"}` |
| Other errors | `403` / `503` / `500` | see §6.1 |

A `uid` that does not exist answers `200` with `deleted: 0`: the request is "none must be left",
and that is the result.

### 6.14 `POST /tickets`
Stores a ticket built by the sso (§5.7).

Body (JSON): `ticket` (at least 16 characters), `token` (at least 16), `service`, `issued_at`,
`expires_at`.

| Outcome | Status | Body |
|---|---|---|
| Created | `201` | the stored document |
| Ticket already there | `409` | `{"error":"TICKET_EXISTS"}` |
| Invalid body | `400` | `{"error":"INVALID_BODY"}` |
| Other errors | `403` / `503` / `500` | see §6.1 |

### 6.15 `DELETE /tickets/{ticket}`
**Consumes** the ticket: it returns it and deletes it at the same moment.

| Outcome | Status | Body |
|---|---|---|
| Consumed | `200` | the document, which from now on no longer exists |
| Unknown, already used or expired by the TTL | `404` | `{"error":"TICKET_NOT_FOUND"}` |
| Other errors | `403` / `503` / `500` | see §6.1 |

The 404 does not repeat the ticket, for the same reason as the sessions: it would end up in the
logs.

### 6.16 Notes on the parameters
- The path parameter is a string on **a single segment**: it cannot contain `/`. Special
  characters must be URL-encoded (`@` in usernames is fine as it is).
- The match is exact and case-sensitive (`Front-Gate` ≠ `front-gate`).

### 6.19 `PUT /users/{username}/locale` and `PUT /sessions/{token}/locale`
The user's preferred language and the session's. The sso calls them: at the first login (if the
profile has no language yet) and when the language is changed from the pages' switcher.

Body (JSON): `{"locale": "it"}`. Here we only check that it is a language code (`^[a-z]{2,3}$`):
which languages exist is decided by the sso, from its own configuration (`i18n.locales`).

| Outcome | Status | Body |
|---|---|---|
| Done (user) | `200` | the user without `credential`, with `locale` |
| Done (session) | `200` | the session, with `data.locale`; the rest of `data` stays as it was |
| The user does not exist | `404` | `{"error":"USER_NOT_FOUND","username":"<requested>"}` |
| The session does not exist | `404` | `{"error":"SESSION_NOT_FOUND"}` |
| Invalid code | `400` | `{"error":"INVALID_BODY"}` |
| Other errors | `403` / `503` / `500` | see §6.1 |

### 6.20 `PATCH /projects/{project_id}/pipeline/steps/{step}`

Updates the data of the **last open step** with that name. Body:

```json
{ "set": { "turns_left": 4 }, "push": { "chat": [{"role": "client", "text": "…"}] } }
```

`set` rewrites fields of `data`, `push` appends to lists inside `data`; they can be used together,
and that is the chat's case, appending two messages and rewriting the remaining turns at the same
moment — they are the same thing seen from two sides.

**`open` only.** A step that has decided something is not rewritten: the list of steps is the
register of those decisions, and rewriting one would mean changing the past. Without an open step
with that name the answer is `404 OPEN_STEP_NOT_FOUND`, and **nothing is created**: the step is
opened by whoever runs that phase, with `POST .../steps`, not by whoever writes inside it.

It returns the updated project. `404 PROJECT_NOT_FOUND` if the project does not exist.

### 6.21 `POST /users/{uid}/billing/turns/spend` and `.../grant`

They move turns on the user's credit. Body `{"turns": 3}`, always **positive**: the direction is
said by the route, not by the sign, or a `0` or a `-3` would become a way of saying the other
thing. A non-positive value is `400 INVALID_BODY`.

| | |
|---|---|
| `spend` | draws turns down. **The check that the credit is enough lives inside the write**, not in an earlier read: two requests at once cannot spend the same credit twice, because the second no longer matches the condition. If it is not enough, `409 NOT_ENOUGH_TURNS` and nothing was drawn |
| `grant` | adds turns. The field is born here if it was not there: a user with no credit is a user with zero credit. This is where the payment will arrive; today only the preanalyst's fake purchase arrives here |

Both return the updated user, without the `credential` block. `404 USER_NOT_FOUND` if the `uid`
does not exist — and `spend` tells that apart from insufficient credit, because one is a failure
and the other is an answer to the user.

### 6.17 Routes generated by FastAPI
They are reachable, always from allowed IPs only:
- `GET /docs`: the Swagger interface;
- `GET /redoc`;
- `GET /openapi.json`: the schema.

Any other route answers `404 {"error":"ROUTE_NOT_FOUND"}`.

### 6.18 Examples
```sh
curl -i http://127.0.0.1:9100/configuration/front-gate
curl -s http://127.0.0.1:9100/drivers
curl -s http://127.0.0.1:9100/projects/1f251606-bdba-40c4-bbee-bfedc6e57f70
curl -s http://127.0.0.1:9100/drivers/7633be3d-e701-42ca-9fea-6c6d1bb4b7d1
curl -s http://127.0.0.1:9100/drivers/7633be3d-e701-42ca-9fea-6c6d1bb4b7d1/discounts
curl -s http://127.0.0.1:9100/discounts/e8013cf2-34eb-4bc3-8a34-b08fb24a1bf3
curl -s -w " [%{http_code}]\n" http://127.0.0.1:9100/projects/nonexistent   # {"error":"PROJECT_NOT_FOUND","project_id":"nonexistent"} [404]
curl -s -w " [%{http_code}]\n" http://127.0.0.1:9100/drivers/nonexistent/discounts   # {"error":"DRIVER_NOT_FOUND","uid":"nonexistent"} [404]

# users
curl -s http://127.0.0.1:9100/users/dome.santoro@gmail.com
curl -s -w " [%{http_code}]\n" http://127.0.0.1:9100/users/dome.santoro@gmail.com/credential   # 404 CREDENTIAL_NOT_SET until there is a password

# sessions (normally the sso writes them, this is not done by hand)
curl -s -X POST http://127.0.0.1:9100/sessions -H 'content-type: application/json' \
  -d '{"token":"test-token-0123456789","uid":"214912a9-2cc4-4205-87b7-93ea71f6be72","username":"driver.test@example.com","issued_at":"2026-09-21T10:00:00Z","expires_at":"2026-09-21T18:00:00Z"}'
curl -s http://127.0.0.1:9100/sessions/test-token-0123456789
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE http://127.0.0.1:9100/sessions/test-token-0123456789   # 204
curl -s -X DELETE "http://127.0.0.1:9100/sessions?uid=214912a9-2cc4-4205-87b7-93ea71f6be72"
```

---

## 7. Configuration

No default values: if anything is missing, the server writes the reason in the log
(`webtools_anagraphics is not starting: …`) and exits with 1.

**From the environment** comes only what is needed to reach the configuration. The control script
loads it from `webtools/configurator/bootstrap.env`:

| Variable | Read by | Notes |
|---|---|---|
| `WEBTOOLS_ANAGRAPHICS_URL` | `settings.py` | Our address, `http://host:port`: the server listens there. The other subsystems use the same variable to call us, so there is one place to change it |
| `WEBTOOLS_CONFIGURATION_TIMEOUT_MS` | `settings.py` | How long to wait for Mongo when reading the configuration, at startup |
| `WEBTOOLS_MONGO_URI` | `settings.py` | Also `scripts/seed.py` and `scripts/load_configuration.py` |
| `WEBTOOLS_MONGO_DB` | `settings.py` | The tests set it to `webtools_test` |

**Everything else** is the `anagraphics` document of the `configuration` collection (§5.1), read
straight from Mongo: anagraphics cannot ask itself for its configuration over HTTP before it is
running. Edit `webtools/configurator/configuration/anagraphics.json` and run
`webtools/configurator/start.sh --restart` again.

| Field | Notes |
|---|---|
| `access.allowed_ips` | who may call. It is a check on the connection's IP, not an authorisation |
| `mongo.server_selection_timeout_ms` | how long to wait for Mongo once running |
| `subsystems_infos.metrics.url`, `.timeout_ms` | where the measurements go, and how long one send may take |
| `metrics.log_failures` | whether a send that failed is written to our log. `false` in the seed: if metrics breaks while every subsystem logs every failure, the logs fill the disk |
| `metrics.pending_max` | the bound on the measurements still in hand. Past it one is dropped, which is what losing a measurement already means here |

The configuration is read **once at startup**: after a change, a restart is needed.

---

## 8. Operational commands

The `uv` commands are run from `webtools/anagraphics/`; the control script works from any
directory.

### 8.1 Setup (once only)
```sh
uv sync                        # creates .venv and installs the dependencies (the development ones too)
uv run python -m scripts.seed  # indexes + initial data; can be re-run
../configurator/load_configuration.sh   # the configuration of every subsystem
```

The seed and `load_configuration.py` read `WEBTOOLS_MONGO_URI` and `WEBTOOLS_MONGO_DB` from the
environment: `load_configuration.sh` loads them by itself, for the seed run
`set -a; source ../configurator/bootstrap.env; set +a` first.

### 8.2 Start and stop

The script `webtools/anagraphics/webtools_anagraphics.sh` is used. It works from any directory.

```sh
webtools/anagraphics/webtools_anagraphics.sh --start   # starts it in the background
webtools/anagraphics/webtools_anagraphics.sh --stop    # stops it
```

**`--start`**
- Starts `…/webtools/anagraphics/.venv/bin/python -m webtools_anagraphics` with `nohup`: the
  server stays up even if the terminal is closed.
- Writes the PID in `webtools_anagraphics.pid` and appends stdout and stderr (access logs and
  tracebacks) to `webtools_anagraphics.log`. Before every start it adds a
  `=== start <date> ===` line to the log.
- Loads the variables of `webtools/configurator/bootstrap.env` into the environment.
- Waits up to 10 s for the `Uvicorn running on` message:
  - if it arrives: `webtools_anagraphics started (PID …)`, exit 0;
  - if the process dies: it prints the last lines of the log, deletes the PID file, exit 1.
- If the server is already running it does not start a second one:
  `… is already running (PID …)`.
- If `.venv` is missing, it asks you to run `uv sync`.

**`--stop`**
- Reads the PID from the file and, **before killing it, checks** that that process's command line
  is exactly `…/webtools/anagraphics/.venv/bin/python -m webtools_anagraphics`.
- Sends `SIGTERM` and waits up to 10 s. If the process does not exit, it sends `SIGKILL`. Then it
  deletes the PID file.
- If the PID file is missing, or points at a process that is not ours (a PID reused after a crash,
  for instance), **it kills nothing**: it deletes the file and prints `… is not running`.

**Why this way:**
- It does not stop by process name: `pkill -f` with a pattern would hit other projects on the Mac
  too.
- It does not stop by port: the port might be taken by another program.
- It uses the PID saved at startup, checked against the full command line, which contains the path
  of this project's venv.
- The script runs `.venv/bin/python` directly, not `uv run`: that way the saved PID is the
  server's and not a wrapper process's.

**Useful checks**
```sh
curl http://127.0.0.1:9100/configuration/front-gate          # does it answer? {"subsystem":"front-gate",…}
tail -f webtools/anagraphics/webtools_anagraphics.log         # the log in real time
```

**Starting in the foreground, for debugging** (Ctrl+C to stop it), from `webtools/anagraphics/`:
```sh
set -a; source ../configurator/bootstrap.env; set +a
uv run python -m webtools_anagraphics
```

> ⚠️ **Do not** start it with `uvicorn webtools_anagraphics.main:app`: without
> `--no-proxy-headers` uvicorn trusts `X-Forwarded-For` for requests from localhost, and the IP
> pool can be bypassed (§9.2).
>
> ⚠️ **Do not** run `python scripts/seed.py`: it fails with
> `ModuleNotFoundError: No module named 'webtools_anagraphics'`. Use
> `uv run python -m scripts.seed` from `webtools/anagraphics/`.

### 8.3 Local MongoDB (Homebrew)
| Item | Value |
|---|---|
| Config | `/usr/local/etc/mongod.conf` |
| Data | `/usr/local/var/mongodb` |
| Log | `/usr/local/var/log/mongodb/mongo.log` |
| Listens on | `127.0.0.1`, `::1` (local only) |

```sh
brew services list | grep mongo              # state
brew services start mongodb-community        # start (if it is down)
brew services restart mongodb-community
mongosh --quiet --eval 'db.runCommand({ping:1})'   # answers { ok: 1 }
```

### 8.4 Inspecting and changing the data (until there is a CRUD)
```sh
mongosh webtools --quiet --eval 'db.configuration.find({}, {_id:0}).toArray()'
mongosh webtools --quiet --eval 'db.projects.find({}, {_id:0}).toArray()'
# the drivers: the users who carry a `driver`
mongosh webtools --quiet --eval 'db.users.find({"driver.driver_uid":{$exists:true}}, {_id:0, username:1, screen_name:1, active:1, driver:1}).toArray()'
mongosh webtools --quiet --eval 'db.discounts.find({}, {_id:0}).toArray()'
# the users without the credentials block
mongosh webtools --quiet --eval 'db.users.find({}, {_id:0, credential:0}).toArray()'
# who has a password set, without printing it
mongosh webtools --quiet --eval 'db.users.find({}, {_id:0, username:1, "credential.updated_at":1}).toArray()'
# the open sessions, without the whole token
mongosh webtools --quiet --eval 'db.sessions.find({}, {_id:0, username:1, issued_at:1, expires_at:1}).toArray()'
mongosh webtools --quiet --eval 'db.projects.getIndexes()'

# a new UUID: python3 -c 'import uuid; print(uuid.uuid4())'
# adding or updating a project (upsert, it respects the unique index)
mongosh webtools --quiet --eval 'db.projects.updateOne({project_id:"<uuid>"}, {$set:{project_id:"<uuid>"}}, {upsert:true})'

# deleting a project
mongosh webtools --quiet --eval 'db.projects.deleteOne({project_id:"<uuid>"})'

# making an existing user a driver (level 0; 1 after the interview)
mongosh webtools --quiet --eval 'db.users.updateOne({username:"<username>"}, {$set:{driver:{driver_uid:"<new uuid>", level:0}}})'

# raising or lowering a driver's level
mongosh webtools --quiet --eval 'db.users.updateOne({"driver.driver_uid":"<uuid>"}, {$set:{"driver.level":1}})'

# taking the role away: null, never $unset — every user has the field (§5.5)
mongosh webtools --quiet --eval 'db.users.updateOne({"driver.driver_uid":"<uuid>"}, {$set:{driver:null}})'

# adding a discount code to a driver. From 0.13.0 there is a route for this
# (§6.23.2), which projects-hub uses: by hand is for a code at a percentage
# outside what that subsystem offers.
mongosh webtools --quiet --eval 'db.discounts.updateOne({discount_code:"<uuid>"}, {$set:{discount_code:"<uuid>", driver:{uid:"<driver uuid>", screen_name:"<name>"}, percentage:5}}, {upsert:true})'

# changing a driver's screen_name: the copy in the discounts must be updated too (§5.4)
mongosh webtools --quiet --eval 'db.users.updateOne({"driver.driver_uid":"<uuid>"}, {$set:{screen_name:"<new>"}}); db.discounts.updateMany({"driver.uid":"<uuid>"}, {$set:{"driver.screen_name":"<new>"}})'
```
To make initial data permanent, add it to the `PROJECTS` / `DISCOUNTS` / `USERS` lists in
`scripts/seed.py` and re-run the seed — after checking it agrees with what is in the store: a user
whose `driver.driver_uid` is already held by another one is refused by the unique index (§5.5). The seed **does not touch
passwords already set**: `credential` is written only when the user is created (`$setOnInsert`).

Passwords are not written with `mongosh`: the `credential` block has to be built with scrypt, and
§8.5 is what does it.

### 8.5 Setting a user's password

There is no dedicated tool: the `credential` block is built with `build_credential()` and written
onto the user, who must already exist.

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
    raise SystemExit(f"user not found: {username}")
database[db.USERS].update_one(
    {"username": username}, {"$set": {"credential": build_credential(getpass("password: "))}}
)
print("sessions closed:", db.delete_sessions_of_user(database, user["uid"]))
'
```

Two things not to lose along the way:

- the password is **typed in** (`getpass`), not passed as an argument: from the arguments it would
  end up in the shell history and in the process list;
- after the change, that user's **open sessions must be closed**
  (`delete_sessions_of_user`): changing a password is mostly useful when one suspects somebody
  else has got in, and an already open session is not stopped by the new password.

### 8.6 Tests
```sh
uv run pytest        # 116 tests, about two seconds; Mongo must be running
uv run pytest -v     # with the names of the individual tests
```

---

### 8.7 Migration to 0.5.0: `anagraphics` → `projects`

Once per database, **before** starting 0.5.0. Then the seed creates the new index on
`submission_id` (it does not touch the passwords):

```sh
mongosh webtools --quiet --eval 'db.anagraphics.renameCollection("projects")'
uv run python -m scripts.seed
```

Run on the `webtools` database on 2026-09-21.

### 8.8 Migration to 0.6.1: away with `billing.autonomous_fee_discount`

Autonomous work no longer has a discount on the fee. Once per database; the field, if it stays, is
returned as it is anyway:

```sh
mongosh webtools --quiet --eval 'db.projects.updateMany({"billing.autonomous_fee_discount": {$exists: true}}, {$unset: {"billing.autonomous_fee_discount": ""}})'
```

Run on the `webtools` database on 2026-09-22 (2 projects).

### 8.9 Migration to 0.9.0: `state` → `pipeline`

The flat `state` field becomes the `pipeline` object, with the state and the list of steps.
`steps` is born empty: of the projects that already exist we do not know which steps they went
through, and inventing them would be worse than not having them.

The script is idempotent and has a dry run:

```sh
cd webtools/anagraphics
set -a; source ../configurator/bootstrap.env; set +a
.venv/bin/python -m scripts.migrate_pipeline --dry-run
.venv/bin/python -m scripts.migrate_pipeline
```

Run on the `webtools` database on 2026-09-23 (4 projects).

### 8.10 Migration to 0.10.0: `billing.turns_credit` on the users

Every user gets the `billing` block with the turn credit, at **zero**: nobody has bought anything
yet, and granting turns to people who were already there would be inventing a purchase that never
happened.

The field would create itself at the first `grant` (`$inc` on a missing field starts from zero),
but then it would exist only for those who have bought, and reading "no credit" instead of "zero
credit" is a distinction nobody wants to make.

```sh
cd webtools/anagraphics
set -a; source ../configurator/bootstrap.env; set +a
.venv/bin/python -m scripts.migrate_user_billing --dry-run
.venv/bin/python -m scripts.migrate_user_billing
```

Run on the `webtools` database on 2026-09-24 (2 users).

### 8.11 Migration to 0.11.0: the rounds of questions are the pre-analysis

The state `ANALYSIS` **disappears** and the step `analysis` becomes `preanalysis` (§5.2). There is
no separate state for the rounds of questions any more: a project is born in `PREANALYSIS` and
stays there through the form, the prevalidation that passes and the rounds that follow, because
there is no earlier moment to have a state for and the rounds *are* the pre-analysis. Which of the
two moments a project is at is read off the steps, where the prevalidation either has decided or
has not.

A project left in `ANALYSIS` could take no further step: the list is closed, so the next write
would be validated against names that no longer contain it. The same script renames the
preanalyst's configuration branches — the turns to `preanalysis`, the two doors towards a model to
`preanalyst` — and it **moves** the values instead of reseeding them, because those branches carry
what was changed in operation: the turns included, and the price per million tokens configurator-fe
wrote. `load_configuration.sh` adds only what is missing, so on its own it would leave the document
with both shapes.

```sh
cd webtools/anagraphics
set -a; source ../configurator/bootstrap.env; set +a
.venv/bin/python -m scripts.migrate_preanalysis_rename --dry-run
.venv/bin/python -m scripts.migrate_preanalysis_rename
```

Run on the `webtools` database on 2026-09-28 (12 projects in `PREANALYSIS` afterwards, 5 steps
renamed, and the preanalyst's configuration).

### 8.12 Migration to 0.12.0: the `drivers` collection into `users.driver`

The collection `drivers` **disappears** and the role moves inside the person: `users.driver_uid`
becomes `users.driver`, which is `null` or `{driver_uid, level}` (§5.5). The boolean `enabled`
becomes the level: `true` → **1**, anything else → **0**. Nothing is promoted by the migration —
level 2 (`prj-admin`) is given by hand, never guessed out of the old data.

The driver's uid is **not** rewritten, so the discount codes, the copies on the projects and
`billing.ambassador_uid` go on pointing at what they always pointed at. That is the whole reason
this merge cost nothing downstream.

Two things are reported and not repaired, because repairing them means inventing data: a user whose
`driver_uid` names a driver that is not there (the level cannot be known, so the user is **skipped**
and keeps the old field), and a driver with no user (they cannot be logged in as, and making up a
person for them is not a migration's business).

```sh
cd webtools/anagraphics
set -a; source ../configurator/bootstrap.env; set +a
.venv/bin/python -m scripts.migrate_user_driver --dry-run
.venv/bin/python -m scripts.migrate_user_driver
```

The script **does not drop** the collection: no migration here deletes anything. After reading the
report, and only then:

```sh
mongosh webtools --quiet --eval 'db.drivers.drop()'
```

The new unique sparse index on `driver.driver_uid` arrives with `db.ensure_indexes`, which the seed
calls; on a store where the seed is not re-run it has to be called by hand:

```sh
cd webtools/anagraphics
set -a; source ../configurator/bootstrap.env; set +a
.venv/bin/python -c 'from pymongo import MongoClient; from webtools_anagraphics import db; \
from webtools_anagraphics.settings import mongo_target; uri, name = mongo_target(); \
db.ensure_indexes(MongoClient(uri)[name])'
```

**`scripts/migrate_project_driver.py` was deleted** by this same work: it turned `review.driver_uid`
into `review.driver` by reading the `drivers` collection, so it becomes unrunnable. It had nothing
left to do on this store (no project carried the old shape). An environment that has not run it
must do so **before** this migration, taking the script from the git history.

Run on the `webtools` database on 2026-09-29 (3 users: two drivers at level 1 and one client at
`null`; one orphan driver reported, then given a user by hand; the index created; the collection
left in place awaiting the drop).

---

## 9. Security and the IP pool

### 9.1 How it works
The `allow_only_known_ips` middleware in `webtools_anagraphics/main.py` compares
`request.client.host` with `settings.allowed_ips`, a `frozenset` of strings:
- the comparison is **exact**: no subnets or CIDR, no name resolution;
- if the IP is not in the pool it answers `403` and does **not** query Mongo;
- if `request.client` is not there (a rare case), the request is refused.

### 9.2 Proxy headers (important)
By default uvicorn has `proxy_headers=True` and trusts `127.0.0.1`. In that configuration a
request from localhost with `X-Forwarded-For: <ip>` makes `request.client.host` become `<ip>`.

That is why the service is started **only** with `webtools_anagraphics.sh --start` (or
`python -m webtools_anagraphics` in the foreground). Both go through
`webtools_anagraphics/__main__.py`, which sets `proxy_headers=False`.

Checked on 2026-09-19: with `-H "X-Forwarded-For: 10.0.0.1"`
- running uvicorn directly → `403` (the connection's IP is replaced);
- running `python -m webtools_anagraphics` → `200` (the connection's real IP counts).

If in future the service sits behind a reverse proxy, this will have to be revisited: with
`proxy_headers=False` every request will appear to come from the proxy's IP.

### 9.3 Network
- With `WEBTOOLS_ANAGRAPHICS_URL=http://127.0.0.1:9100` the server is not reachable from other
  machines, whatever `access.allowed_ips` says.
- With `127.0.0.1` the server **does not listen on IPv6**: `http://[::1]:9100` does not answer.
  `::1` in `access.allowed_ips` is only of use when listening on `::`. `curl http://localhost:9100`
  works anyway, because after the IPv6 attempt it falls back to IPv4.
- To accept calls from another machine **both** things are needed: the URL's host on the right
  interface and the caller's IP in `access.allowed_ips`.

### 9.4 What is missing, by choice
- Authentication and authorisation.
- TLS: the service speaks HTTP in the clear.
- Rate limiting.
- Authentication on MongoDB: the local instance has no credentials.

---

## 10. Tests

The file `tests/test_api.py` runs end-to-end tests against the **real Mongo**.

- At the top of the file, **before the `webtools_anagraphics` imports**, the bootstrap variables
  are set with `WEBTOOLS_MONGO_DB=webtools_test` and the configuration's `anagraphics` document is
  written into `webtools_test`. This is needed because the settings are read when
  `webtools_anagraphics.main` is imported: without the document the import would fail, and with
  the import before the variables the tests would use the production `webtools` DB.
- Four tests (`test_settings_*`) exercise the startup: configuration read, bootstrap variable
  missing, document missing, field missing. In every missing case `load_settings()` raises
  `ConfigurationError`.
- A module fixture creates the indexes, inserts the `front-gate` configuration, the project
  `1f251606-…`, the discount code and **three users**: two drivers (one at level 1 with the discount
  code, one at level 0 without, to tell an empty list from a driver who does not exist) and one who
  is not a driver at all, `driver: null`. At the end it **drops** `webtools_test`. The two drivers
  are the seed's, so the list can be checked by hand too.
- `TestClient` uses the host `"testclient"` by default, which is not in the pool. That is why the
  tests pass `client=("127.0.0.1", 50000)` and, for the `403` case, `client=("10.0.0.1", 50000)`.

| Test | What it checks |
|---|---|
| `test_configuration_found` | 200 and the exact body, without `_id` |
| `test_configuration_not_found` | 404 + `{"error":"CONFIGURATION_NOT_FOUND","subsystem":…}` |
| `test_project_found` | 200 and the exact body, without `_id` |
| `test_project_not_found` | 404 + `{"error":"PROJECT_NOT_FOUND","project_id":…}` |
| `test_driver_found` | 200 and the exact body: the driver's uid, the name, `username`, `level`, `active` |
| `test_drivers_list` | 200 + `{"drivers":[…]}` with both drivers, ordered by the driver's uid and **without** `username` |
| `test_a_user_who_is_not_a_driver_is_not_in_the_list` | A `driver: null` is in no list, and their person's `uid` is not a driver's: 404 |
| `test_a_driver_route_does_not_let_the_person_out` | No `credential`, `billing` or `locale` in the answer, and the `uid` published is the driver's |
| `test_driver_not_found` | 404 + `{"error":"DRIVER_NOT_FOUND","uid":…}` |
| `test_discount_found` | 200 and the exact body, with the driver duplicated |
| `test_discount_not_found` | 404 + `{"error":"DISCOUNT_NOT_FOUND","discount_code":…}` |
| `test_discounts_of_driver` | 200 + `{"uid":…,"discounts":[…]}` |
| `test_discounts_of_driver_without_discounts` | 200 + an **empty** list, not a 404 |
| `test_discounts_of_unknown_driver` | 404 + `DRIVER_NOT_FOUND`, not an empty list |
| `test_user_found` | 200 and the exact body, **without** the `credential` block |
| `test_user_not_found` | 404 + `{"error":"USER_NOT_FOUND","username":…}` |
| `test_user_credential` | 200 + `{"username":…,"credential":{…}}` |
| `test_user_credential_not_set` | 404 + `CREDENTIAL_NOT_SET` for the user with `credential: null` |
| `test_user_credential_of_unknown_user` | 404 + `USER_NOT_FOUND`, told apart from the previous one |
| `test_session_lifecycle` | Creation (201), an identical read back, deletion (204), then 404 on both reading and deleting |
| `test_session_keeps_free_data` | The content of `data` comes back as it was |
| `test_session_expired_is_still_returned` | An already expired session is stored and read back: the expiry is judged by the sso |
| `test_session_duplicate_token` | 409 + `SESSION_EXISTS`, no overwriting |
| `test_session_invalid_body` | 400 + `INVALID_BODY` for an empty body, a token that is too short, an unreadable date |
| `test_session_not_found` | 404 + `SESSION_NOT_FOUND`, without repeating the token |
| `test_delete_sessions_of_user` | Closes only that `uid`'s sessions, and says how many |
| `test_delete_sessions_of_user_without_sessions` | 200 + `deleted: 0`, not a 404 |
| `test_ticket_is_consumed_once` | Creation, a consumption returning the document, and a second consumption getting a 404 |
| `test_ticket_duplicate` | 409 + `TICKET_EXISTS` |
| `test_ticket_invalid_body` | 400 + `INVALID_BODY` for an empty body and a ticket that is too short |
| `test_ip_outside_pool_is_rejected` | 403 + `IP_NOT_ALLOWED` on every read, on a non-existent route **and on the writes** |
| `test_unknown_route` | 404 + `ROUTE_NOT_FOUND` |
| `test_method_not_allowed` | 405 + `METHOD_NOT_ALLOWED` |
| `test_database_unavailable` | 503 + `DATABASE_UNAVAILABLE` (a simulated query raising `ServerSelectionTimeoutError`) |
| `test_internal_error` | 500 + `INTERNAL_ERROR` (a simulated query raising `RuntimeError`) |

Also checked by hand on 2026-09-20, with the real server, the six endpoints and the 404s of
drivers and discounts.

Checked by hand on 2026-09-19, with the real server:
- every code above;
- Mongo really down → `503 DATABASE_UNAVAILABLE`;
- `X-Forwarded-For` ignored.

A known, harmless warning remains, internal to Starlette:
`anyio.abc.BlockingPortal alias is deprecated`.

---

## 11. Troubleshooting

| Symptom | Likely cause | Check / solution |
|---|---|---|
| `403 {"error":"IP_NOT_ALLOWED"}` from localhost | 1) The server started with `uvicorn` directly and a client sending `X-Forwarded-For`. 2) `access.allowed_ips` without `127.0.0.1`. 3) The server listening on `::` and the client arriving as `::1` or `::ffff:127.0.0.1` | Start it with `webtools_anagraphics.sh --start`. Check `configurator/configuration/anagraphics.json` and that it has been loaded. Look at the IP in the access log (`INFO: <ip>:<port> - "GET ..."`) and add it to the pool |
| `503 {"error":"DATABASE_UNAVAILABLE"}` after about **30 s** | Mongo down or unreachable. The log holds `MongoDB unreachable: …` | `mongosh --eval 'db.runCommand({ping:1})'`; `brew services start mongodb-community`; check `WEBTOOLS_MONGO_URI`. The wait is `mongo.server_selection_timeout_ms` of the configuration |
| `404 PROJECT_NOT_FOUND` / `CONFIGURATION_NOT_FOUND` on data that "should be there" | The seed or `load_configuration.sh` not run, a different `WEBTOOLS_MONGO_DB`, a key written with different capitals, spaces in the value | `mongosh webtools --eval 'db.projects.find({},{_id:0})'`; compare the exact value |
| `404 {"error":"ROUTE_NOT_FOUND"}` | The route does not exist: a typo in the path or an extra `/` | Use `/configuration/<name>` or `/projects/<id>`; see `/docs` |
| `500 {"error":"INTERNAL_ERROR"}` on a particular document | A field not convertible to JSON (`ObjectId`, `Decimal128`, binary) | The traceback is in the server's log (`ValueError`/`TypeError` during serialisation). Convert the field or adapt the response |
| `DuplicateKeyError` while inserting data | The unique index on `subsystem` or `project_id` | Use `updateOne(..., {upsert:true})` instead of `insertOne` |
| `ModuleNotFoundError: No module named 'webtools_anagraphics'` | The seed run as a file (`python scripts/seed.py`) or from a different directory | From `webtools/anagraphics/`: `uv run python -m scripts.seed` |
| `[Errno 48] Address already in use` (printed by `--start`) | Port 9100 taken by another program or by an instance started without the script | `lsof -nP -iTCP:9100 -sTCP:LISTEN` to see who it is. If it is not ours, change the port in `WEBTOOLS_ANAGRAPHICS_URL` (`bootstrap.env`): it holds for every subsystem |
| `--start` says "already running" but the server does not answer | A stuck process | `…/webtools_anagraphics.sh --stop` and then `--start`; look at the log |
| `--start` fails with "Environment missing" | `.venv` not created | `cd webtools/anagraphics && uv sync` |
| `--start` fails with `webtools_anagraphics is not starting: …` | Configuration missing or wrong: a bootstrap variable missing, Mongo down, the `anagraphics` document not loaded, a field missing | The message says which. `webtools/configurator/load_configuration.sh`, then `--start` again |
| `--start` fails with other log lines | An error at startup (import) | The message printed is the tail of `webtools_anagraphics.log` |
| Configuration changes have no effect | It is read only at startup, and it must be loaded into Mongo first | `webtools/configurator/start.sh --restart` (loads and restarts) |
| Code changes have no effect | The server has no automatic reload | `--stop` and `--start`. In development you can use `uv run uvicorn webtools_anagraphics.main:app --reload --no-proxy-headers --host 127.0.0.1 --port 9100` |
| The tests write into the `webtools` DB | Somebody moved the `webtools_anagraphics` imports above the setting of the bootstrap variables in `tests/test_api.py` | Restore the order (§10) |
| Every test fails with a timeout | Mongo down | Start Mongo (§8.3) |
| `http://[::1]:9100` does not answer | The server listens on IPv4 only | Normal with `127.0.0.1` in `WEBTOOLS_ANAGRAPHICS_URL` (§9.3) |

Where to look:
- **the server's log**: `webtools/anagraphics/webtools_anagraphics.log` if started with `--start`
  (§8.2), otherwise the terminal's stdout. It holds the uvicorn access logs and the tracebacks;
- **Mongo's log**: `/usr/local/var/log/mongodb/mongo.log`.

---

## 12. Metrics and observability

Current state: **no dedicated metrics**. There are no `/health` or `/metrics` endpoints and no
structured logging. What is available today is this.

| What | How |
|---|---|
| Traffic and outcomes | The uvicorn access log in `webtools_anagraphics.log`: `INFO: 127.0.0.1:61935 - "GET /projects/1f251606-bdba-40c4-bbee-bfedc6e57f70 HTTP/1.1" 200 OK`. Counting by code: `grep -c '" 403' webtools_anagraphics.log`, and so on |
| Service state | `curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" http://127.0.0.1:9100/configuration/front-gate` (200 = the service and Mongo are up) |
| Mongo's state | `mongosh --eval 'db.runCommand({ping:1})'` |
| Data volume | `mongosh webtools --quiet --eval 'db.projects.countDocuments()'` (the same for `configuration`) |
| Sizes and indexes | `mongosh webtools --quiet --eval 'db.projects.stats()'` |
| Slow queries | Mongo's profiler: `db.setProfilingLevel(1, {slowms: 50})`, then `db.system.profile.find()` |

First candidates if metrics were needed: a `/health` endpoint with a ping to Mongo, JSON logging
with request durations, a Prometheus exporter.

---

## 13. Known limits and technical debt

- Read-only except the sessions, the projects' own writes and the discount codes: for
  configurations and users there is still no write endpoint (a CRUD is planned). Making somebody a
  driver, or changing their level, is a `mongosh` command (§8.4).
- **`GET /projects` has no pagination**, as `GET /drivers` has none: the whole answer comes back.
  The set that can grow without a bound anybody chose is the one with no driver, which is exactly
  the one somebody watches when something has gone wrong.
- **Anybody in the IP pool can read `GET /users/{username}/credential`**, not only the sso: while
  the pool is only this Mac's localhost the difference does not exist, but the day the subsystems
  sit on different machines authentication between services is needed, not a list of IPs.
- No check on who creates or deletes a session: whoever is in the pool can create a session for
  any `uid`. The note above holds.
- No schema or validation of the documents in Mongo (neither `$jsonSchema` nor Pydantic models on
  the responses, except the body of `POST /sessions`).
- The driver duplicated inside the discounts does not update itself: a change of `screen_name`
  must be propagated by hand (§5.4).
- ~~`drivers.username` remains a disconnected piece of data~~ — **closed in 0.12.0**: there is one
  `username`, the person's, and the driver has no second copy of it to fall out of step.
- Both users have a **development password**, short and known: it must be redone before the system
  takes real clients.
- Setting a password is a command by hand (§8.5): no dedicated tool, no check on the length, and
  whoever writes it must remember to close the open sessions.
- Nothing validates `driver.level` on the way in: a level nobody has defined, or a value that is
  not a whole number, can be written by hand. The two boundaries that read it refuse what they do
  not recognise (`level >= 1` on a real integer), so a broken document costs a driver their work
  rather than handing out something it should not — but the store accepts it.
- `GET /drivers/{uid}/discounts` and `GET /drivers` return everything, with no pagination and no
  filters: fine while the numbers stay small.
- In `users` there is test data (`Test`, `Not enabled`): it must be removed before the system
  takes real clients.
- Whoever is in the pool can also create tickets for any session: the same note on authentication
  between services holds.
- Expired sessions and tickets stay in the store until the TTL comes round (about a minute): fine
  for a read, not for counting "how many sessions are open".
- The Mongo client is created when the module is imported, with no lifespan: hard to replace in
  the tests, no explicit close.
- Indexes created by the seed only, not at server startup.
- If Mongo does not answer, the error arrives after 30 s, pymongo's default timeout.
- An IP pool with no CIDR and no support for a reverse proxy.
- No authentication, TLS, rate limiting, `/health` or metrics.
- No containerisation and no management as a service (launchd/systemd): the server is started by
  hand with `webtools_anagraphics.sh --start`, it does not come back by itself after a crash or a
  reboot of the Mac, and the log grows with no rotation.
- The tests require a real Mongo, running.

---

## 14. How to extend (a checklist)

**Adding a field to the documents**
No change to the code. Update `scripts/seed.py` if the field is to be part of the initial data,
update §5 of this document and check that the value is convertible to JSON.

**Adding an endpoint**
1. Add the query in `webtools_anagraphics/db.py`, with the `PUBLIC` projection.
2. Add the route in `webtools_anagraphics/main.py`: the IP middleware protects it automatically.
3. For the error cases raise `errors.ApiError(status, CODE, **context)`. If a new code is needed,
   add it as a constant in `webtools_anagraphics/errors.py` and document it in §6.1: do not reuse
   existing codes with other meanings.
4. Add the tests in `tests/test_api.py`: 200, the errors with their exact body, 403.
5. Document it in §6.

**Adding a collection**
A constant in `webtools_anagraphics/db.py`, an index in `ensure_indexes()`, initial data in
`scripts/seed.py`, cleanup already covered by the tests' `drop_database`, documentation in §5. If
the collection points at another one (as `discounts` → the drivers, now inside `users`), a **non**-unique index on the
linking field is needed too.

**Adding a configurable value**
Not an environment variable: a field in
`webtools/configurator/configuration/anagraphics.json`, in the right group (or in a new one).
Then a field in `Settings` and a read in `load_settings()`, with no default. Document it in §5.1.
The environment is left for the bootstrap only (§7).

**The configuration of a new subsystem**
A file `webtools/configurator/configuration/<name>.json`; the subsystem reads it at startup with
`GET /configuration/<name>` (the Node subsystems with
`commons/configuration/configuration_client.js`). Nothing needs changing here.

**Moving to a CRUD**
Points to decide:
- Pydantic models for validating the input;
- handling of `DuplicateKeyError`, to be translated into a `409`;
- authentication beyond the IP pool;
- who is allowed to write.

---

## 15. Changelog

| Date | Version | Change |
|---|---|---|
| 2026-09-30 | 0.13.0 | **The register can be read back** (§6.23), for `projects-hub`. A new `GET /projects` with three exclusive filters — an owner, a driver, no driver — and an optional repeatable `state`: none or two of the three is a `400 INVALID_QUERY`, because they are not refinements of one another and two together would be a question about an intersection nobody asked for. Which states a caller cares about travels as a query and is not written into the route: anagraphics applies the filter it is given and decides nothing. The projection keeps only the **last** step, which is the one that says why a project failed, and leaves out the `preanalysis` step that grows by two messages every turn. Three new indexes on `projects`, none unique: `owner_uid`, `review.driver.uid`, `created_at`. A new `description` field (§5.2) with `PUT /projects/{id}/description` that writes it: absent on a project nobody analysed, and nothing stored in its place. A new `POST /drivers/{uid}/discounts` (§6.23.2), so a code is no longer written by hand in `mongosh`: the code and the driver's name are written here, and the commercial range is not checked here — it is the policy of whoever offers the link. A new error code, `INVALID_QUERY`. Tests from 96 to 116. |
| 2026-09-29 | 0.12.0 | **The `drivers` collection into `users.driver`, with a level** (§5.3, §5.5). A driver is no longer a document of their own: a user carries `driver`, which is `null` or `{driver_uid, level}`. The boolean `enabled` becomes a graded `level` — 0 not enabled, 1 enabled, 2 `prj-admin` — because the service already had three conditions and a boolean cannot carry the third; level 2 is stored and nothing reads it yet. `GET /drivers` and `GET /drivers/{uid}` keep their paths and answer `level` and `active` in place of `enabled`, built by the one new `_driver_view`; the projections become positive, because the document behind them is a person's. The driver's uid is unchanged, so the discounts, the copies on the projects and `billing.ambassador_uid` needed no rewriting, and `drivers.username` — a second copy kept in step by hand — is gone. New unique sparse index on `driver.driver_uid`. Migration `scripts/migrate_user_driver.py` (§8.12), run on 3 users; `scripts/migrate_project_driver.py` deleted, since it read the collection that no longer exists. Tests from 84 to 96. |
| 2026-09-28 | 0.11.0 | **The rounds of questions are the pre-analysis** (§5.2). The state `ANALYSIS` disappears and the step `analysis` becomes `preanalysis`: a project is born in `PREANALYSIS` and stays there through the form, the prevalidation that passes and the rounds that follow, because there is no earlier moment to have a state for and the rounds *are* the pre-analysis — which of the two moments it is at is read off the steps. The list is closed, so a project left in the old state could take no further step: migration `scripts/migrate_preanalysis_rename.py` (§8.11), run on 12 projects and on the preanalyst's configuration, whose branches become `preanalysis` (the turns) and `preanalyst` (the two doors towards a model), with the values they were carrying. |
| 2026-09-24 | 0.10.0 | **The open step and the turn credit.** A new `open` result for a pipeline step that has begun and has decided nothing yet — it is the analysis chat, which opens when the project reaches `ANALYSIS` and grows with every turn. A new `PATCH /projects/{id}/pipeline/steps/{step}` (§6.20) that updates the `data` of the **last open step** with that name, with `set` and `push`: closed steps stay untouchable, because the list is the register of the decisions taken. The user gets the `billing` block with `turns_credit`, and two routes for moving it (§6.21): `spend` checks that the credit is enough **inside** the write, so two requests at once cannot spend it twice; `grant` increases it, and that is where the payment will arrive. Migration `scripts/migrate_user_billing.py` (§8.10), run: 2 users. Tests from 62 to 70. |
| 2026-09-23 | 0.9.2 | **The configuration that lives is in Mongo.** `scripts/load_configuration.py` no longer replaces the documents whole at every start: it adds **only the missing fields**, and deletes neither a field removed from a file nor a subsystem that no longer has one. The files in `configurator/configuration/` become the seed and the expected shape. A new `--reset [subsystem …]`, the only way to take the documents back to the files. The secrets stay an exception and always replace: a rotated key must count. Before, a value changed in operation disappeared at the first `start.sh`, silently. Tests from 56 to 62 (`tests/test_load_configuration.py`). |
| 2026-09-23 | 0.9.1 | Two more entries in the pipeline's closed lists (§5.2): the state `UNDERSPECIFIED` and the `result` `underspecified`, for the request that goes back to the user because it said too little (preanalyst §16.6). Nothing else changes: the documents already written stay valid. Tests from 55 to 56. |
| 2026-09-23 | 0.9.0 | **The project's pipeline** (§5.2): the flat `state` field becomes the `pipeline` object with the state and the ordered list of the steps taken — the register of decisions. A new `POST /projects/{id}/pipeline/steps` (§6.3.2), with closed lists for the names of the steps and the states: an invented name does not get into the database. Migration §8.9. `scripts/load_configuration.py` accepts a second directory, the **secrets**, and deep-merges it onto the configuration before writing it into Mongo: API keys are configuration, but they cannot live in git. Tests from 50 to 55. |
| 2026-09-22 | 0.8.0 | **The language.** New `PUT /users/{username}/locale` and `PUT /sessions/{token}/locale` (§6.19): the `users.locale` and `sessions.data.locale` fields. The sso uses them to remember the chosen language between one login and the next. Tests from 45 to 50. |
| 2026-09-22 | 0.7.0 | The drivers' **`enabled`** field (allowed to supervise projects), in the `GET /drivers` list too (`DRIVER_SUMMARY`). `Dome` and `Test` enabled; a new test driver who is not enabled, `Not enabled`, with a discount code at 10%. Data updated with the seed on 2026-09-22. |
| 2026-09-22 | 0.6.2 | A new `billing.ambassador_uid` (`null` by default): the driver who invited the user. The rules on when it counts are applied by the preanalyst. Tests from 44 to 45. |
| 2026-09-22 | 0.6.1 | `billing.autonomous_fee_discount` removed: autonomous work no longer has a discount on the fee (migration §8.8). A `POST /projects` body still holding it does not error: the field is ignored. |
| 2026-09-21 | 0.6.0 | **A configuration subsystem for everybody.** Anagraphics' configuration read at startup from its document in `configuration` (`access.allowed_ips`, `mongo.server_selection_timeout_ms`); host and port from `WEBTOOLS_ANAGRAPHICS_URL`. No more defaults and no more `HOST`, `PORT`, `MONGO_URI`, `MONGO_DB`, `ALLOWED_IPS` variables: from the environment only the `WEBTOOLS_*` bootstrap. Without configuration the server does not start. The configurations no longer live in the seed: a new `scripts/load_configuration.py`, which loads `configurator/configuration/*.json`. Tests from 40 to 44. |
| 2026-09-19 | 0.1.0 | Creation: the read API for `configuration`/`anagraphics`, the IP pool, the seed, the tests. |
| 2026-09-19 | 0.1.0 | Fix: startup through `__main__.py` with `proxy_headers=False`. Before, with uvicorn directly, `X-Forwarded-For` from localhost replaced the client's IP. |
| 2026-09-19 | 0.1.0 | The package renamed from `app` to `webtools_anagraphics`, so as not to have generic names among the Mac's processes. |
| 2026-09-19 | 0.1.0 | The test project `demo-001` deleted and replaced by `1f251606-bdba-40c4-bbee-bfedc6e57f70`: `project_id`s are UUIDs. |
| 2026-09-19 | 0.1.0 | Errors: HTTP status + a stable code (`{"error": "…"}`), no more prose (`{"detail": "…"}`). New codes: `CONFIGURATION_NOT_FOUND`, `PROJECT_NOT_FOUND`, `ROUTE_NOT_FOUND`, `METHOD_NOT_ALLOWED`, `IP_NOT_ALLOWED`, `DATABASE_UNAVAILABLE` (503, previously 500), `INTERNAL_ERROR`. |
| 2026-09-19 | 0.1.0 | The `webtools_anagraphics.sh --start/--stop` script: nohup, a PID file and a stop only after checking the command line. It replaces `pkill -f` and stopping by port. |
| 2026-09-21 | 0.5.0 | The `anagraphics` collection becomes **`projects`** (migration §8.7) and `GET /anagraphics/{id}` becomes `GET /projects/{id}`. New `POST /projects` (anagraphics generates the id; a unique sparse `submission_id` makes the form submission idempotent) and `DELETE /projects/{id}`. New fields of the project: `owner_uid`, `submission_id`, `created_at`, `state`, `review` (the driver and `preset`), `billing` (the discount and the discount on the autonomous work fee). A new code: `SUBMISSION_EXISTS`. Tests from 33 to 40. |
| 2026-09-21 | 0.4.0 | The `tickets` collection (key `ticket`, a TTL on `expires_at`) with `POST /tickets` and `DELETE /tickets/{ticket}`, which consumes the ticket by reading it. The sso needs it to hand a session from one address to another, which a cookie cannot do (§5.7). New codes: `TICKET_NOT_FOUND`, `TICKET_EXISTS`. Tests from 30 to 33. |
| 2026-09-21 | 0.3.0 | The `users` collection (key `username`, with the `credential` block in scrypt) and `sessions` (key `token`, a TTL index on `expires_at`). New endpoints: `GET /users/{username}`, `GET /users/{username}/credential`, `POST /sessions`, `GET /sessions/{token}`, `DELETE /sessions/{token}`, `DELETE /sessions?uid=…`. The subsystem's **first writes**. New codes: `USER_NOT_FOUND`, `CREDENTIAL_NOT_SET`, `SESSION_NOT_FOUND`, `SESSION_EXISTS`, `INVALID_BODY`. The Mongo client with `tz_aware=True`. Tests from 17 to 30. The login stays out of here: `webtools_sso` does it. |
| 2026-09-20 | 0.2.1 | `GET /drivers`, the list of every driver, with `uid` and `screen_name` only. The `username` of the driver `Dome` corrected to `dome.santoro@gmail.com`. The test driver `Test` added. Tests from 16 to 17. |
| 2026-09-20 | 0.2.0 | The `drivers` collection (key `uid`) and `discounts` (key `discount_code`, the driver duplicated, `percentage` in percentage points). Three new endpoints: `GET /drivers/{uid}`, `GET /drivers/{uid}/discounts`, `GET /discounts/{discount_code}`. New codes: `DRIVER_NOT_FOUND`, `DISCOUNT_NOT_FOUND`. The first driver: `Dome`, with a discount code at 5%. Tests from 9 to 16. The login not handled. |
