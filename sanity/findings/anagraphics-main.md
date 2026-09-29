# anagraphics-main

Path: `webtools/anagraphics/webtools_anagraphics/main.py`
Examined: 2026-09-26

The internal API, and the first file in this audit that is written the way the rule asks for more
often than not: `spend_turns` puts the credit check inside the write and then tells "no such user"
apart from "not enough credit" (`:260-267`); `PipelineStep.data` is stored and explicitly not
interpreted (`:136-138`); `get_discounts_of_driver` distinguishes a driver with no discounts from a
driver who is not there (`:308-312`); `remove_sessions_of_user` says why a count of zero is a
correct answer (`:461-464`). What follows is where it does not.

Three of the five are about the same habit seen from different sides: a property that the code
depends on — the database has the indexes, the caller knows which transitions are legal, the
exception means the thing it usually means — is taken from the situation in front of the author
instead of being established where the code can see it.

---

## 1. The API's uniqueness guarantees rest on indexes the server never creates and never checks

- `webtools/anagraphics/webtools_anagraphics/main.py:22` — `database = db.connect(settings)`, and
  nothing else happens at startup. `db.ensure_indexes` (`db.py:41-66`) is called from
  `scripts/seed.py:91` and from `tests/test_api.py:101`, and from nowhere in the server.
- The three places that depend on it: `main.py:173-184` (`except DuplicateKeyError` →
  "the same submission again"), `main.py:382-388` (`except DuplicateKeyError` → `SESSION_EXISTS`),
  `main.py:441-444` (`except DuplicateKeyError` → `TICKET_EXISTS`).
- Shape: **4 — capability inferred from resemblance**, with **5 — only the success path**
- Class: **the databases this server may be pointed at.** Which one it is comes from the
  environment (`settings.py:88-90`, `WEBTOOLS_MONGO_URI` / `WEBTOOLS_MONGO_DB` out of
  `bootstrap.env`): a second environment, a restore into a new database name, a developer's own
  copy are all ordinary members. The member the code was written against is the one where
  `scripts/seed.py` has been run.
- On a member where it has not, nothing fails loudly. `insert_project` never raises, so a double
  click on the form creates **two projects for one submission** — the comment at `:94` («if it
  arrives twice, there is still one project») is then simply untrue. `insert_session` accepts a
  repeated token, so `find_session` returns whichever of the two Mongo finds first. `insert_ticket`
  accepts a repeated ticket. None of this is visible in a response: the endpoints take the success
  path, which is the only one there is when the constraint is absent.
- `docs/subsystems/anagraphics/README.md:188` states the division ("created by `scripts/seed.py`
  (`db.ensure_indexes`), not by the server's startup"), which records the decision but does not
  establish the property: the server still assumes at run time something no run-time step checks.
- Severity: `latent`
- Smallest generalising change: call `ensure_indexes` at startup — it is idempotent — or read
  `list_indexes()` for the collections the API constrains and refuse to start when one is missing,
  the same way `load_settings` refuses to start on a missing configuration field.

---

## 2. The vocabulary of the pipeline is enforced here, the moves on it are left to each caller

- `webtools/anagraphics/webtools_anagraphics/main.py:187-202` — `add_pipeline_step` writes
  `step.state` into `pipeline.state` and appends the step, whatever the project's current state is
  and whatever the combination means
- The vocabulary it validates: `PipelineState` (`:104-118`, 11 values), `PipelineStepName`
  (`:120-129`, 8 values), `result` (`:152`, 5 values)
- Shape: **3 — member logic outside its boundary**
- Class: **the callers of this route.** Today there is one, the preanalyst. The flow named in
  `contesto/02. current_context.md` has more coming — the analysis engine, the driver's console,
  the α-test, the payment — and each of them will decide for itself which of the 8 × 5 × 11 = 440
  accepted combinations are moves on the flow and which are nonsense. The handful that are legal
  is a property of the pipeline, and the pipeline is declared **in this file**: `:100-103` says in
  as many words that the names "are a contract" and that "an invented name must not be able to get
  into the database". The contract stops at the spelling.
- What that costs is already recorded once: `findings/preanalyst-server.md` finding 1, the
  `breaks-now` at `server.js:941-950`, is a client moving their own project `REJECTED → ANALYSIS`
  by editing a URL — and the reason it works is that this route accepts the move. That consequence
  is counted there and is not counted again here; what is counted here is that the module which
  owns the vocabulary declines to own the transitions, so every future caller has to be told.
- Severity: `latent` — for the class of callers. The one reachable consequence today is already a
  `breaks-now` under another unit.
- Smallest generalising change: put the allowed `(current state, step, result) → state` moves next
  to the two `Literal`s that already live here, and answer `409` for a move that is not one. The
  data needed is in hand: `append_pipeline_step` already reads the project.

---

## 3. A locale is checked against a shape only two of the world's locale codes have

- `webtools/anagraphics/webtools_anagraphics/main.py:347-351` — `LocaleToStore.locale`,
  `Field(pattern=r"^[a-z]{2,3}$")`, used by `PUT /users/{username}/locale` (`:354`) and
  `PUT /sessions/{token}/locale` (`:402`)
- Shape: **6 — world narrowed to fit the code**
- Class: **the locale codes this product may have.** The catalogues hold `en` and `it` today
  (`webtools/commons/i18n/locales/`), and both are two lowercase letters. `pt-BR`, `en-GB`,
  `zh-Hant` and `sr-Latn` are ordinary locale codes and none of them matches. The docstring at
  `:348-349` is explicit that this module does **not** decide which languages exist — "Which
  languages exist is known by the caller (the sso, from its own configuration): here we only check
  that it is a language code" — and then the check is narrower than the thing it names. The pattern
  was drawn from the two members in front of the author.
- Adding a locale is a change somebody is entitled to make, and the failure is quiet in the place
  it matters: the sso's `PUT` comes back `400 INVALID_BODY`, the chosen language is not stored on
  the user or the session, and the only trace is `logger.warning("invalid body on %s: …")`
  (`errors.py:74`). The user picks their language, the page changes for the current request from
  the cookie, and the choice is not there next time.
- Severity: `latent`
- Smallest generalising change: check the shape a locale tag actually has (a subtag, optionally
  followed by `-` and further subtags), or — since the module says it does not decide which
  languages exist — check only what it needs to be safe to store, which is a short non-empty string
  with no `$` and no `.`.

---

## 4. Which unique index was violated is read from the situation, not from the exception

- `webtools/anagraphics/webtools_anagraphics/main.py:175-181` — `except DuplicateKeyError:` is
  followed immediately by `find_project_by_submission(...)`, and when that comes back `None` the
  answer is `409 SUBMISSION_EXISTS`
- The `projects` collection has two unique indexes, `project_id` and `submission_id`
  (`db.py:43,47`)
- Shape: **4 — capability inferred from resemblance**
- Class: **the constraints a write on `projects` can violate.** The handler treats the exception as
  meaning one of the two. It holds today only because the other key is a fresh `uuid4` (`:162`),
  which is an argument about probability, not about the class: `DuplicateKeyError` carries
  `details["keyPattern"]`, so which constraint failed is a fact the code can have and chooses not
  to ask for.
- The day a third unique index is added to `projects` — a natural key on the owner, an external
  reference — every violation of it is answered `409 SUBMISSION_EXISTS`, a code that names the
  wrong field, and the caller retries a submission that was never the problem.
- Severity: `latent`
- Smallest generalising change: read the index name or key pattern off the exception and answer for
  the constraint that actually failed; anything else re-raises and becomes a `500`, which is the
  honest answer for a constraint nobody has written a code for.

---

## 5. One PATCH, one to N writes, and no account of a partial application

- `webtools/anagraphics/webtools_anagraphics/main.py:226-241` — `if body.set:` is one write, then
  `for field, values in body.push.items():` is one more write per field; each can raise or come
  back `None` on its own
- The docstring above it, `:208-211`: "`set` rewrites a field, `push` appends to a list. They can
  be used together: the chat appends two messages and rewrites the remaining turns at the same
  moment, **and they are the same thing seen from two sides**."
- The caller that does exactly that: `webtools/preanalyst/src/server.js:817-825`, one PATCH with
  `set` and `push` together
- Shape: **5 — only the success path**
- Class: **the outcomes of a multi-field update.** All-applied is one of them. Some-applied is
  another, and it is reachable without anything exotic: Mongo becoming unreachable between the two
  writes, or — needing nothing at all but a second tab — another request closing the open step
  between them, at which point `push_to_open_step` returns `None` and the endpoint raises
  `404 OPEN_STEP_NOT_FOUND`. The caller is then told the step was not found, and the `set` has
  already been written into it.
- The same file is the place that shows how it is done right: `append_pipeline_step` is "one single
  write: `$push` and `$set` together, so there is no moment in which the step is there and the
  state is still the previous one" (`db.py:96-98`). The reason given there applies here word for
  word and was not applied.
- What goes wrong concretely in the chat: the two messages are pushed and `turns_left` is not
  rewritten, or `turns_left` is rewritten and the messages are lost, and the error the client sees
  says neither.
- Severity: `latent`
- Smallest generalising change: build one `$set`/`$push` update document from `body.set` and
  `body.push` and send it as a single `find_one_and_update`, with the "is the step still open"
  condition in the filter — which is what `spend_turns` already does for the credit
  (`db.py:222-227`).

---

## Noted, not raised as findings

- `:28-36` — the IP pool compares the connection's host against `settings.allowed_ips` by string
  equality, and the seed already carries **both** textual forms of loopback,
  `["127.0.0.1", "::1"]` (`webtools/configurator/configuration/anagraphics.json:3`). The two
  members of the class are named rather than inferred from one looking like the other. The opposite
  of the defect being hunted, recorded because it is the kind of place where it usually is.
- `:33` — `request.client.host if request.client else None`, and `None` is not in the pool, so it
  is refused. An absence handled as an absence, with no invented default.
- `:262-267` — "Not enough credit, or no such user: for the caller the fact is the same … but the
  two cases are told apart, because one is an answer to the user and the other is a failure." This
  is precisely the distinction the preanalyst collapses at `server.js:588-598` (`breaks-now` 2).
  The layer below already distinguishes them; the layer above throws the distinction away.
- `:323-330` and `:354` key on `username`; `:252`, `:271` and `db.find_user_by_uid` key on `uid`.
  One collection addressed by two identifiers across one API, which is why
  `webtools/preanalyst/src/server.js` has to hold both. A question about the shape of the API, not
  about the audited rule.
- `:371-376` — `token` is `Field(min_length=16)` while `uid` and `username` are bare `str`, so an
  empty `uid` is stored and `DELETE /sessions?uid=` then matches those sessions. Same at `:429-435`
  for `TicketToStore.service`. Input validation, not a class defect of the audited rule.
- `:24` — `FastAPI(title="anagraphics", version="0.9.0")`, a version written in the code next to
  the one in `pyproject.toml`. Judged at unit 49, where both are in view.
- `:459-465` — `DELETE /sessions` takes `uid` as a required query parameter, so a call without it
  is a `RequestValidationError` and is answered `400 INVALID_BODY` on a request that has no body.
  The collapse of every validation failure onto one code belongs to `errors.py`; recorded at unit
  46.
- `:284-290` — `DELETE /projects/{id}` deletes a project in any pipeline state, for any caller in
  the IP pool. The comment says what it is for ("whoever created a project and could not complete
  it"), and nothing in the route says that is what it is being used for. It is the same missing
  boundary as finding 2 and is not counted twice.
