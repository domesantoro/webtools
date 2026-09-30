# webtools_anagraphics

An internal subsystem (Python + MongoDB) holding the configuration of every subsystem (it is the
configuration subsystem), the projects, the users — the drivers among them — their discount codes and the
sessions. Sessions, tickets and projects are written; the rest is read-only.

Full documentation: `docs/subsystems/anagraphics/README.md` (at the root of the workspace).

## Start and stop

```sh
webtools/anagraphics/webtools_anagraphics.sh --start   # starts it in the background, detached from the terminal
webtools/anagraphics/webtools_anagraphics.sh --stop    # stops it
```

- PID: `webtools_anagraphics.pid`. Log: `webtools_anagraphics.log` (appended).
- `--stop` stops only the process of the PID file, and only after checking that it is `…/webtools/anagraphics/.venv/bin/python -m webtools_anagraphics`.
- Debugging in the foreground, from this directory: `set -a; source ../configurator/bootstrap.env; set +a; uv run python -m webtools_anagraphics` (Ctrl+C to stop it).

The first time, from this directory:
```sh
uv sync                        # environment and dependencies
set -a; source ../configurator/bootstrap.env; set +a
uv run python -m scripts.seed  # indexes + initial data (can be re-run)
../configurator/load_configuration.sh   # the configuration of every subsystem
```

## Collections

| Collection | Key (unique index) | Example |
|---|---|---|
| `configuration` | `subsystem` | `{"subsystem": "front-gate", "listen": {…}, "subsystems_infos": {"preanalyst": {"url": …}}, "screen_infos": {"pricing": {"standard_price_cents": 40000}}}` — from `configurator/configuration/*.json` |
| `projects` | `project_id` (+ `submission_id`, sparse) | `{"project_id": "…", "owner_uid": "…", "submission_id": "…", "created_at": …, "pipeline": {…}, "review": {…}, "billing": {…}}` |
| `users` | `username` (+ `uid`, + `driver.driver_uid` sparse) | `{"uid": "8ff93901-…", "username": "dome.santoro@gmail.com", "screen_name": "Dome", "active": true, "driver": {"driver_uid": "7633be3d-…", "level": 1}}` — a user who is not a driver carries `"driver": null` |
| `discounts` | `discount_code` | `{"discount_code": "e8013cf2-…", "driver": {"uid": "7633be3d-…", "screen_name": "Dome"}, "percentage": 5}` |

In `discounts` the driver is **duplicated** on purpose (`uid` + `screen_name`): whoever reads a
discount need not read the driver again. A change of `screen_name` has to be propagated by hand,
though. `percentage` is in percentage points: `5` means 5%.

## Endpoints (`http://127.0.0.1:9100`)

- `GET /configuration/{subsystem}`: the subsystem's configuration, or `404 {"error":"CONFIGURATION_NOT_FOUND","subsystem":…}`.
- `GET /configuration`: `{"configurations":[…]}` with the configuration of every subsystem that is in Mongo, ordered by `subsystem`. No pagination. It is what the configurator's front end reads: the list of the subsystems that exist is here.
- `PUT /configuration/{subsystem}/pricing`: the price of what one provider consumes. Body
  `{"provider_path":"preanalyst.conversation.providers.anthropic","currency":"USD","cents_per_million_tokens":{"input":1500,"output":7500}}`;
  answers `{"pricing":{…}}` with the `updated_at` it wrote. It writes the **`pricing` key of that
  provider object and nothing else**: `provider_path` must name one — `<anything>.providers.<name>`
  — or it is `400 {"error":"NOT_A_PROVIDER_OBJECT","path":…}`; a path the document does not hold is
  `404 {"error":"PROVIDER_NOT_FOUND","path":…}`. The amounts are hundredths of the currency's unit,
  per million tokens, **one per kind of token**: the kinds are not a list here, they are the ones
  the provider declares. `updated_at` is written here and is not taken from the body.
- `GET /projects/{project_id}`: the project, or `404 {"error":"PROJECT_NOT_FOUND","project_id":…}`.
- `GET /projects`: the projects matching **one** filter, newest first — `?owner_uid=`, `?driver_uid=`
  or `?without_driver=true`, plus an optional repeatable `?state=`. None of the three, or two of
  them, or a state that does not exist, is `400 {"error":"INVALID_QUERY"}`: they are not refinements
  of one another, and this route does not guess which was meant. Each project comes back whole minus
  every step but the last — the last is the one that says why a run failed, and the `preanalysis`
  step grows by two messages a turn. No pagination.
- `POST /projects`: creates a project (anagraphics generates the id); the same `submission_id` a second time returns `200` and the project already born. `DELETE /projects/{project_id}`: deletes it.
- `PUT /projects/{project_id}/description`: one sentence saying what the tool is for, written by the
  analyst once the analysis has succeeded. Body `{"description":"…"}`, non-empty once the spaces are
  off.
- Users, sessions and tickets: see the full documentation (§6.8–6.15).
- `GET /drivers`: `{"drivers":[…]}` with every driver, ordered by the driver's uid, carrying `uid`, `screen_name`, `level` and `active` (no `username`). No pagination. There is no collection of drivers: it is the users who carry a `driver`.
- `GET /drivers/{uid}`: the driver, or `404 {"error":"DRIVER_NOT_FOUND","uid":…}`.
- `GET /drivers/{uid}/discounts`: `{"uid":…, "discounts":[…]}` with every code of the driver. A driver with no codes gives `200` and an empty list; a driver who does not exist gives `404 DRIVER_NOT_FOUND`.
- `POST /drivers/{uid}/discounts`: a new code for that driver. Body `{"percentage":<1..100>}`, answers
  `201` with the document. The code and the driver's name are written here, never taken from the body.
  **How much webtools is willing to give away is not checked here**: that is the policy of whoever
  offers the link, and it reads its own configuration. Anagraphics stores and does not decide.
- `GET /discounts/{discount_code}`: the discount code, or `404 {"error":"DISCOUNT_NOT_FOUND","discount_code":…}`.

Mongo's `_id` never appears in the responses.

Every error has the correct HTTP status and a stable code, `{"error": "<CODE>"}`:
`CONFIGURATION_NOT_FOUND`, `PROJECT_NOT_FOUND`, `DRIVER_NOT_FOUND`, `DISCOUNT_NOT_FOUND`,
`INVALID_QUERY`, `INVALID_BODY`, `ROUTE_NOT_FOUND`, `METHOD_NOT_ALLOWED`, `IP_NOT_ALLOWED` (403),
`DATABASE_UNAVAILABLE` (503), `INTERNAL_ERROR` (500).
The codes are defined in `webtools_anagraphics/errors.py`, and the full table is in the
documentation (§6.1).

## The IP pool

Requests from IPs outside `access.allowed_ips` get a `403`. Only the connection's real IP counts:
`webtools_anagraphics/__main__.py` starts uvicorn with `proxy_headers=False`.
Do not start it with `uvicorn webtools_anagraphics.main:app` directly.

## Configuration

No defaults: if anything is missing the server does not start
(`webtools_anagraphics is not starting: …` in the log).

- From the environment, loaded by `--start` from `webtools/configurator/bootstrap.env`:
  `WEBTOOLS_ANAGRAPHICS_URL` (the listening host and port come from it),
  `WEBTOOLS_CONFIGURATION_TIMEOUT_MS`, `WEBTOOLS_MONGO_URI`, `WEBTOOLS_MONGO_DB`.
- The rest from the `anagraphics` document of the `configuration` collection, read from Mongo at
  startup: it is written in `webtools/configurator/configuration/anagraphics.json`.

`scripts/load_configuration.py` loads the files of `configurator/configuration/` and, given a
second directory, deep-merges the **secrets** of `configurator/secrets/` on top (the API keys,
which cannot live in git). `configurator/load_configuration.sh` does that.

## Tests

```sh
uv run pytest        # 116 tests
```

The tests use the `webtools_test` database, which is dropped at the end.

`users` also holds two test drivers: `Test` (`639718a3-…`, level 1, no discount codes) and `Not enabled` (`f234b930-…`, level 0, with a code).
