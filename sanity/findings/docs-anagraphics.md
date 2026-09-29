# docs-anagraphics

Path: `docs/subsystems/anagraphics/README.md`
Examined: 2026-09-26

One thousand two hundred and seventy-five lines, and §13 "Known limits and technical debt" is the
most complete inventory of its own shortcomings in the repository: twenty-two entries, each naming
a real property of the design, including two this audit reached independently — "**Indexes created
by the seed only, not at server startup**" (recorded at `findings/anagraphics-main.md` 1) and "An
IP pool with **no CIDR** and no support for a reverse proxy". A document that lists the finding
before the auditor does has done its job.

§5.8's second rule is a genuine class statement, of the kind the audited rule asks for: the values
must be convertible to JSON by FastAPI, "an `ObjectId` in a field other than `_id`, a `Decimal128`
or binary data produce a **500**… they must be converted before the document is returned". That
names the members of the class that do not work, and what happens to them.

Three findings, all of them enumerations written from the state in front of the author.

A note before them: `webtools_anagraphics/errors.py`, `main.py` and `db.py` were edited on disk
while this audit was running (a new `INVALID_RANGE` code appeared in `errors.py`). The units 44–46
findings describe the files as they were read; §6.1 of this document is judged below against the
version this audit read, not against edits made after it.

---

## 1. "Fields can be added freely" is true of four of the six collections and false in both directions for the other two

- `docs/subsystems/anagraphics/README.md`, §5.8 — "**Fields can be added** freely: the API returns
  the whole document except `_id`."
- `docs/subsystems/anagraphics/README.md`, §14 — "**Adding a field to the documents** / No change
  to the code."
- What the code does: `webtools/anagraphics/webtools_anagraphics/db.py:17` —
  `PUBLIC = {"_id": 0}`, an exclusion, used for `configuration`, `projects`, `discounts`,
  `sessions` and `tickets`, where the sentence holds;
  `db.py:24` — `USER_PUBLIC = {"_id": 0, "credential": 0}`;
  `db.py:21` — `DRIVER_SUMMARY = {"_id": 0, "uid": 1, "screen_name": 1, "enabled": 1}`, an
  **inclusion** list of three fields, used by `GET /drivers`
- Shape: **6 — world narrowed to fit the code**
- Class: **the six collections the rule is written for.** It is stated as one rule and there are
  three behaviours. On `drivers` the rule is false in the direction of surprise-by-absence: a field
  added to a driver does not appear in `GET /drivers` at all, and "no change to the code" leaves
  the list unchanged while the single-driver read (`PUBLIC`) shows it — so the same new field is
  there on one route and not on another. On `users` it is false in the direction that matters more:
  the projection lists what must **not** come out, so a field added beside `credential` — a reset
  token, a second factor, an invitation code — is published by `GET /users/{username}` from the
  moment it is written, and this document has told the person adding it that doing so is free.
- It is the documentation half of `findings/anagraphics-db.md` 3. The code's shape invites the
  defect; this sentence sanctions it, and it is the sentence a person consults precisely when they
  are doing the thing that triggers it.
- Severity: `latent`
- Smallest generalising change: say which collections return the whole document and which have a
  projection of their own, with the two names (`USER_PUBLIC`, `DRIVER_SUMMARY`) so the reader can
  look. Better still, make `USER_PUBLIC` an inclusion list like its two neighbours, and the
  sentence becomes true with one exception instead of two.

---

## 2. The quick sheet counts the collections and the tests, and both counts are short

- `docs/subsystems/anagraphics/README.md:23` — "Collections | `configuration` (key `subsystem`),
  `projects` (key `project_id`), `drivers` (key `uid`), `discounts` (key `discount_code`), `users`
  (key `username`), `sessions` (key `token`)" — **six**, and `tickets` is not among them
- `docs/subsystems/anagraphics/README.md:24`, two columns to the left of that omission — "Writes |
  Sessions, **tickets** and language: … `POST /tickets`, `DELETE /tickets/{ticket}`"
- `docs/subsystems/anagraphics/README.md:31` — "State | Reads on **six** collections…"
- `webtools/anagraphics/webtools_anagraphics/db.py:8-14` — seven collection constants, `TICKETS`
  among them; §5.7 of this document describes the collection in full
- `docs/subsystems/anagraphics/README.md:30` — "Tests | `uv run pytest` (**70 tests**…)", where
  `tests/test_api.py` declares 69 and `tests/test_load_configuration.py` declares 6: **75**
- Shape: **6 — world narrowed to fit the code**
- Class: **the collections, and the tests, over time.** Both rows are counts, and a count written
  into prose describes the member that existed when it was typed. `tickets` was the last collection
  added and §5.7 was written for it; the summary row above was not revisited, so the one place a
  reader looks first for "what is in this database" is missing the collection that holds the
  single-use login tokens — and says so while listing, in the adjacent cell, the two routes that
  write it.
- The test count matters for the same reason as at `findings/docs-preanalyst.md` 1: §10 goes on to
  describe what the suite covers, and a reader deciding whether a change is covered is reading a
  description of a smaller suite than the one that exists.
- Severity: `latent`
- Smallest generalising change: for the collections, list them from `db.py`'s constants — they are
  seven lines — or drop the count and let §5 be the enumeration, which it already is and which is
  complete. For the tests, name the command and not the number.

---

## 3. The error table names three producers of `INVALID_BODY`, and at least eight produce it

- `docs/subsystems/anagraphics/README.md`, §6.1, the `INVALID_BODY` row — "The body of
  `POST /sessions`, `POST /tickets` or `POST /projects` missing, incomplete or with invalid fields.
  The detail of the fields stays in the log, not in the response."
- What produces it: `webtools/anagraphics/webtools_anagraphics/errors.py:70-75` — a single handler
  for **every** `RequestValidationError`, whatever route and whatever part of the request. Besides
  the three named, that is `PATCH /projects/{id}/pipeline/steps/{step}` (§6.20),
  `PUT /users/{username}/locale` and `PUT /sessions/{token}/locale` (§6.19),
  `POST /users/{uid}/billing/turns/spend` and `.../grant` (§6.21) — and two cases with no body at
  all: an unknown step name in the **path** (`main.py:218`) and a missing `uid` in the **query**
  (`main.py:460`)
- Shape: **6 — world narrowed to fit the code**
- Class: **the requests that can fail validation.** The table's "When" column is where the contract
  is written down, and it enumerates the three routes that existed when the handler was written.
  Five routes have been added since and each of them answers this code; two of them answer "the
  body is invalid" to a request that carries no body, which is the code-side finding recorded at
  `findings/anagraphics-settings-credentials-errors.md` 3.
- The rest of §6.1 is exact — nineteen codes, each with its status and its context fields, matching
  `errors.py` line for line as this audit read it — which is what makes the one row that describes
  *when* rather than *what* stand out.
- Severity: `latent`
- Smallest generalising change: describe the rule instead of the list — "any request whose body,
  path or query parameters fail validation, on any route" — which is both shorter and true, and
  which makes the code-side defect visible to whoever writes it down.

---

## Noted, not raised as findings

- §13 — twenty-two entries, including "Indexes created by the seed only, not at server startup",
  "An IP pool with no CIDR", "the driver duplicated inside the discounts does not update itself",
  "`drivers.username` remains a disconnected piece of data: the real user is in `users`… The two
  `username`s coincide today by copying, not by constraint", and "In `drivers` and in `users` there
  is test data (`Test`): it must be removed before the system takes real clients". Every one of
  those is a class-vs-instance observation, found by the author and written down.
- §13 — "If Mongo does not answer, the error arrives after 30 s, **pymongo's default timeout**",
  and §6.1 — "after the server selection timeout (**30 s by default**)". The number is configured,
  not defaulted: `mongo.server_selection_timeout_ms: 30000` in
  `webtools/configurator/configuration/anagraphics.json:6`, read by
  `webtools_anagraphics/settings.py:121-124`. It coincides with pymongo's own default, which is
  what makes the wording easy to write; in a project whose rule is that there are no default
  values, calling a configured number a default is the one word that should not be there.
- §0:4 — "subsystem version: `0.9.0`", matching `main.py:24`'s `FastAPI(version="0.9.0")` and not
  `pyproject.toml:3`'s `0.1.0`. Three statements of one version, two of which agree; recorded at
  `findings/anagraphics-runner.md` 2.
- §0:20-21 — "Address | … (**today** `http://127.0.0.1:9100`)" and "Database | … (**today**
  `mongodb://localhost:27017`…)". The word "today" is doing exactly the work this audit keeps
  asking for: it says which member of the class is being described, so the sentence cannot be read
  as a property of the class.
- §5.8 — "Do not rename `subsystem`, `project_id`, `uid` or `discount_code` without updating
  `webtools_anagraphics/db.py`, `scripts/seed.py`, the indexes and the tests." A statement of what
  else has to change, which is the thing missing from `webtools/configurator/README.md:226-230`
  (recorded at `findings/configurator-readme.md`).
- §10 — the tests' setup is explained including *why* the environment variables are set before the
  imports ("the settings are read when `webtools_anagraphics.main` is imported: without the
  document the import would fail, and with the import before the variables the tests would use the
  production `webtools` DB") and why the fixture holds two drivers and two users ("to tell an empty
  list from a driver who does not exist"). The reasons for the test data, recorded with the data.
