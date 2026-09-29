# anagraphics-settings-credentials-errors

Paths: `webtools/anagraphics/webtools_anagraphics/settings.py`,
`webtools/anagraphics/webtools_anagraphics/credentials.py`,
`webtools/anagraphics/webtools_anagraphics/errors.py`,
`webtools/anagraphics/webtools_anagraphics/__main__.py`
Examined: 2026-09-26

Four small files, and two of them have nothing to report. `settings.py` is the strictest reader of
configuration in the repository: no defaults, every field named in the message that refuses to
start, `bool` excluded from "positive integer" because Python would let `true` through as `1`
(`:47-51`), and `allowed_ips` checked for being a non-empty list of non-empty strings rather than
merely present (`:105-114`). `__main__.py` is the one entry point in the project that does not have
the `listen` problem recorded three times in `summary.md`: `uvicorn.run` on a port already taken
exits with a message, not with a stack trace.

All three findings are in `errors.py`, and they are one habit seen three times: a class of failures
is enumerated as far as the members that have actually occurred, and everything else is given the
code of whichever named member is nearest.

---

## 1. Only one branch of Mongo's failures is answered as a Mongo failure

- `webtools/anagraphics/webtools_anagraphics/errors.py:77-80` —
  `@app.exception_handler(ConnectionFailure)` → `503 DATABASE_UNAVAILABLE`
- `webtools/anagraphics/webtools_anagraphics/errors.py:82-85` — everything else →
  `500 INTERNAL_ERROR`
- Shape: **1 — partial-class requirement**, read from the other side, with **6 — world narrowed to
  fit the code**
- Class: **the ways Mongo can fail to answer.** Verified against the installed pymongo
  (`.venv/lib/python3.13/site-packages/pymongo/errors.py`): `ConnectionFailure` covers
  `AutoReconnect`, `NetworkTimeout`, `NotPrimaryError`, `ServerSelectionTimeoutError` and
  `WaitQueueTimeoutError` — the whole "we could not reach it" family, correctly. It does **not**
  cover the other branch of `PyMongoError`: `OperationFailure` and its descendants
  (`ExecutionTimeout`, `WriteError`, `WriteConcernError`, `WTimeoutError`, `BulkWriteError`),
  `ConfigurationError`, `DocumentTooLarge`, `InvalidOperation`. Those are answered
  `500 INTERNAL_ERROR`, which tells the caller the fault is in this process.
- Reachable without touching this code: credentials revoked or rotated on the Mongo instance while
  the server is running (`OperationFailure`, "Authentication failed"), a write concern that cannot
  be met on a replica set (`WriteConcernError`), an operation exceeding `maxTimeMS`
  (`ExecutionTimeout`). Each is a database problem the operator can act on, reported as a defect in
  anagraphics.
- The same file family already has the wider net and uses it: `settings.py:76` catches
  `PyMongoError`, the parent of both branches, for the one read it does at startup. The narrow
  catch is the one on the path that runs all day.
- Severity: `latent`
- Smallest generalising change: handle `PyMongoError` — one handler, two answers if they should
  differ: `ConnectionFailure` stays `503 DATABASE_UNAVAILABLE`, the rest gets a `DATABASE_ERROR`
  of its own at `503`, and `INTERNAL_ERROR` goes back to meaning what it says.

---

## 2. Two framework statuses have a code; every other one is told it is our fault

- `webtools/anagraphics/webtools_anagraphics/errors.py:61-68` — `if exc.status_code == 404:` →
  `ROUTE_NOT_FOUND`; `if exc.status_code == 405:` → `METHOD_NOT_ALLOWED`; then
  `return error_response(exc.status_code, INTERNAL_ERROR)`
- Shape: **2 — invented value**, with **1 — partial-class requirement**
- Class: **the statuses a `StarletteHTTPException` may carry.** Two of them have been seen, because
  two of them are what routing produces; the handler is written for those two and then fills the
  absence with a value instead of leaving it absent. The result is a response that contradicts
  itself: a `401`, a `403`, a `413` or a `422` raised anywhere in the stack comes back as
  `{"error": "INTERNAL_ERROR"}` at a status that says the request was the problem. A caller reading
  the code — which is what `CLAUDE.md` says the code is for, "never prose to be interpreted" — is
  told to look in the wrong place, and the honest answer ("something raised an HTTP error we have
  no code for") is exactly what is not said.
- This is also the one handler that writes nothing to the log, so the status that arrived is not
  recoverable afterwards either.
- Severity: `latent`
- Smallest generalising change: give the unnamed case its own code (`HTTP_ERROR`) and log
  `exc.status_code` and `exc.detail`, so that an unenumerated member is recorded as unenumerated
  rather than renamed.

---

## 3. Every validation failure is called a bad body, including the ones with no body

- `webtools/anagraphics/webtools_anagraphics/errors.py:70-75` —
  `@app.exception_handler(RequestValidationError)` → `400 INVALID_BODY`, for every validation
  failure whatever part of the request it came from
- The two routes where the failing part is not a body:
  `main.py:218` — `step_name: PipelineStepName` is a **path** parameter, so
  `PATCH /projects/{id}/pipeline/steps/anything-else` is `400 INVALID_BODY`;
  `main.py:460` — `def remove_sessions_of_user(uid: str)` makes `uid` a required **query**
  parameter, so `DELETE /sessions` with no query string is `400 INVALID_BODY` on a request that
  carries no body at all
- Shape: **6 — world narrowed to fit the code**
- Class: **the parts of a request that can fail validation** — body, path, query, header. FastAPI
  raises one exception type for all four and puts the location in `exc.errors()`, which this
  handler reads only to write it to the log and then discards. The code that goes back names the
  member the author had in front of them.
- The decision that the *detail* stays out of the contract is deliberate and right, and is written
  down (`:72-73`). What is not intended is that the stable part of the answer — the code — should
  be wrong: a caller that gets `INVALID_BODY` and re-checks its body finds nothing wrong with it.
- Severity: `latent` — the two callers in the repository always send a step name from a literal and
  always send `uid` (`webtools/preanalyst/src/anagraphics.js:111`,
  `webtools/sso/src/anagraphics.js`), so reaching it takes a new caller or a hand-made request from
  the IP pool.
- Smallest generalising change: read the `loc` of the first error and answer `INVALID_BODY`,
  `INVALID_PATH` or `INVALID_QUERY` accordingly — the information is already in the exception the
  handler is holding.

---

## Noted, not raised as findings

- `credentials.py:32-33` — `MAXMEM = 64 * 1024 * 1024`, a ceiling derived by hand from today's
  `PARAMS` in the file whose whole purpose is that those parameters can be raised. Already recorded
  in full, against the more dangerous of the two copies, at `findings/sso-credentials.md` finding 1
  (`webtools/sso/src/credentials.js:15`), which also names this file. Not counted twice. On this
  side the failure would be loud, at the moment a credential is built; on the sso's side it is a
  silent `false` that refuses a correct password.
- `credentials.py:30-34` — `ALGORITHM`, `PARAMS`, `MAXMEM` and `SALT_BYTES` are constants in the
  code, where `CLAUDE.md` says every configurable value is served by the configuration subsystem.
  A different rule from the one this audit is about.
- `credentials.py` has no caller: `build_credential` is invoked from nothing in the repository, and
  `docs/subsystems/anagraphics/README.md:914-930` gives the command to paste instead. Recorded at
  `findings/sso-credentials.md:95`.
- `settings.py:63-69` — `_listen_address` turns `WEBTOOLS_ANAGRAPHICS_URL` into the host and port
  to bind. `bootstrap.env:8-10` states that the one value does two jobs: "Where anagraphics is. The
  others call it here; anagraphics gets from it the address and the port to listen on." That makes
  any deployment where the bind address differs from the reachable one unrepresentable, and it is a
  property of the bootstrap rather than of this file; judged at unit 52, where `bootstrap.env` is
  the unit.
- `settings.py:97` — `timeout_raw.isdigit()` as the test for "is an integer literal". They are two
  different vocabularies: `"²".isdigit()` is `True` and `int("²")` raises `ValueError`, which would
  end the startup with a traceback instead of the `ConfigurationError` message two lines below.
  Unreachable by anyone writing an ordinary `bootstrap.env`; noted because it is the same reasoning
  as finding 2 of `findings/anagraphics-db.md`.
- `settings.py:54-60` — `_field` treats a field whose value is `null` in Mongo and a field that is
  absent as the same thing. Both end in "does not start", which is the honest outcome for both.
- `errors.py:82-85` — "The traceback is written to the log by uvicorn anyway" is **true**, and was
  checked rather than assumed: `starlette/middleware/errors.py:186` re-raises the exception after
  the installed handler has produced the response. A claim about another party's behaviour that
  happens to be correct.
- `errors.py:45-53` and `main.py:35` — the IP middleware returns `error_response(...)` directly
  instead of raising `ApiError`, because a middleware runs outside `ExceptionMiddleware` and a
  raise there would not reach the handler. The one place where the two mechanisms differ is the one
  place the code uses the other mechanism.
- `__main__.py:19-24` — the only entry point in the repository that survives its own failures:
  `ConfigurationError` is caught and printed as a sentence, and `uvicorn.run` on a port already
  taken exits with a logged message. The three node subsystems' `src/index.js` do neither
  (`breaks-now` 10, 13, 14).
- `__main__.py:29-31` — `proxy_headers=False` with the reason written down, and `main.py:30-32`
  repeats it from the other side. A property that only holds if both are true, stated at both ends.
