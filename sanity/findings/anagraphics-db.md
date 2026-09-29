# anagraphics-db

Path: `webtools/anagraphics/webtools_anagraphics/db.py`
Examined: 2026-09-26

The Mongo layer, 284 lines, and the part of it that deals with the credit is the best-argued code
the audit has read so far: the condition lives inside the write (`:222-227`), the reason is written
down, and the two ways of getting `None` back are handed to the caller to tell apart.
`append_pipeline_step` gives the same reason for putting `$push` and `$set` in one update
(`:96-98`), and `consume_ticket` gives it a third time (`:281-283`). Three of the file's four writes
say explicitly why they are one write.

What follows is one place where that reasoning stops short, one where a string from outside is read
as if it came from inside, and one projection that decides the boundary by exception rather than by
list.

---

## 1. Nothing can leave `open`, and a step that has been superseded stays writable

- `webtools/anagraphics/webtools_anagraphics/db.py:93-105` — `append_pipeline_step` appends a step
  and sets the state, unconditionally; there is no `close_step` in this module and no write
  anywhere that changes an existing step's `result`
- `webtools/anagraphics/webtools_anagraphics/db.py:124-131` and `:155-162` — both finders select
  "the last step with this name **and** `result == "open"`"
- Shape: **5 — only the success path**, with **6 — world narrowed to fit the code**
- Class: **the lives a pipeline step can have.** The repository states that life twice, in two
  different ways, and implements neither as a mechanism.
  `main.py:146-148` says a step "closes" by *taking one of the other results*: "when it closes it
  takes one of the other results and from then on is never touched again". `db.py:113-114` says it
  is closed by *something else*: "grows until another step closes it". The first is not possible —
  no code path rewrites `result` — and the second does not do what the name says, because the
  appended closing step leaves the `open` record exactly as it was, still matching both finders.
- What is in front of the author is the one step that is open today: `analysis`, opened by
  `webtools/preanalyst/src/server.js:576-579` and, as of now, never closed by anything. On that
  instance the two accounts are indistinguishable. On the next member of the class they are not:
  when the analysis gate appends `{step: "analysis", result: "passed", state:
  "DRIVER_VALIDATION"}`, a `PATCH .../steps/analysis` that arrives afterwards — a slow chat
  request, a second tab, a retry — still finds the `open` record and writes the client's message
  and a new `turns_left` into a step that has decided. `openAnalysisOf`
  (`webtools/preanalyst/src/server.js:583-586`) applies the same rule and will keep serving the
  chat as open on a project that has moved on. The register of decisions ends up with a step that
  is both passed and open.
- Severity: `latent` — it takes the second gate being built, which is the next thing to be built.
- Smallest generalising change: make closing a write, not a convention — one `find_one_and_update`
  that sets the last open step's `result` to its outcome and the pipeline's state in the same
  update, with "is it still open" in the filter — and let `append_pipeline_step` refuse to append a
  second `open` step of a name that already has one.

---

## 2. A field name from the request body is written as a Mongo path

- `webtools/anagraphics/webtools_anagraphics/db.py:137` —
  `{"$set": {f"pipeline.steps.{index}.data.{field}": value for field, value in changes.items()}}`
- `webtools/anagraphics/webtools_anagraphics/db.py:168` — the same for `push`:
  `f"pipeline.steps.{index}.data.{field}"`
- `field` arrives as a key of `StepDataToUpdate.set` / `.push` (`main.py:213-214`), which are bare
  `dict` and `dict[str, list]`: any string a caller sends
- Shape: **4 — capability inferred from resemblance**
- Class: **the names a step's datum may have.** `data` is declared free — "its shape is decided by
  whoever takes the step: here it is stored, not interpreted" (`main.py:137-138`) — so the class of
  names is the class of strings. Mongo's update path is a *different* vocabulary that happens to be
  written with the same characters, and in it a `.` means "descend". The two are matched by
  spelling, which is the same reasoning the audit recorded at
  `webtools/preanalyst/src/prespec.js:118`.
- The names sent today have no dots (`missing`, `ready`, `turns_left`, `chat`, at
  `webtools/preanalyst/src/server.js:710-713,817-825`), so the instance in front of the author
  cannot show it. The first caller that stores a datum named after a file (`spec.md`), a model
  (`claude-opus-4.5`) or a version gets a nested object where it asked for a field, silently, and
  reads back something of a shape it never wrote. A name containing `$` is refused by Mongo and
  surfaces as a `500`, which is a second outcome neither endpoint accounts for.
- Severity: `latent`
- Smallest generalising change: state the boundary — reject a key containing `.` or starting with
  `$` with a code of its own, since this module is the only place that knows the names are being
  turned into paths. `data` stays free; what stops being free is the escape into the document
  around it.

---

## 3. The ordinary user read says what must not come out, so anything new comes out

- `webtools/anagraphics/webtools_anagraphics/db.py:24` —
  `USER_PUBLIC = {"_id": 0, "credential": 0}`, used by `find_user`, `find_user_by_uid`,
  `set_user_locale`, `spend_user_turns` and `grant_user_turns` (`:197,204-211,214-227,230-241,245`)
- Four lines above it, for the same collection: `USER_CREDENTIAL = {"_id": 0, "username": 1,
  "credential": 1}` (`:28`) — a list of what comes out
- Shape: **6 — world narrowed to fit the code**
- Class: **the fields a user document may hold.** It is an open class and it is already growing
  from outside this file: `scripts/seed.py:50-65` writes `active` and `driver_uid`,
  `credentials.build_credential` writes `credential`, `set_user_locale` writes `locale`. The
  exclusion projection is correct for exactly the fields that exist today, which is the definition
  of code written for the instance. The next secret next to `credential` — a reset token, a
  second-factor secret, an invitation code — is public from the moment it is written, and nothing
  in this file has to change for that to happen.
- What keeps it from being worse is not this file: `GET /users/{username}` is reachable only from
  the IP pool (`main.py:28-36`), and the two callers pick named fields rather than forwarding the
  document (`webtools/sso/src/sessions.js:38-49`, `webtools/preanalyst/src/server.js:599`). Both of
  those are properties of other modules.
- Severity: `stylistic` — correct for the class as it stands today, and shaped so that a change
  nobody would think to review here changes what leaves the process.
- Smallest generalising change: make `USER_PUBLIC` a list of the fields the ordinary read returns,
  the way `USER_CREDENTIAL` and `DRIVER_SUMMARY` (`:21`) already are, so that a new field is
  invisible until somebody decides it should not be.

---

## Noted, not raised as findings

- `:119-131` and `:150-162` — "the last step with this name that is still open" is written twice,
  nine lines each, identical but for `$set` against `$push`. The same shape as the five copies of
  the runner script (`findings/sso-runner.md`), at a much smaller scale and inside one file, where
  a reader can see both at once. Not raised.
- `:41-66` — `ensure_indexes` handles the outcome where the index is absent or already identical.
  An index that exists with different options makes `create_index` raise `OperationFailure`, and
  `scripts/seed.py:91` then aborts before writing any data, having created whichever indexes came
  earlier in the list. It is a real unhandled outcome, but reaching it takes editing an index
  definition in this very function, where the person editing is looking straight at it. Noted.
- `:31-38` — `connect` builds a `MongoClient` and returns; pymongo connects lazily, so no failure
  can occur here. The server is nonetheless known to have reached Mongo, because
  `settings.load_settings()` read the configuration out of it two lines earlier
  (`main.py:21-22`), and a later loss is answered `503 DATABASE_UNAVAILABLE`
  (`errors.py:77-80`). Handled, in another file.
- `:47` — `unique=True, sparse=True` on `submission_id`, with the reason written down: a project
  can be born by other routes with no form behind it, and `scripts/seed.py:13-15` is exactly such a
  project. A partial-class property placed at the boundary that deals with that part, which is what
  the rule asks for.
- `:59-66` — the two TTL indexes are called housekeeping and the comment says in as many words that
  whoever reads a session or a ticket must check the expiry themselves rather than rely on the
  deletion. `webtools/sso/src/sessions.js:52-57` does. The class of "a session that is still in the
  collection" is stated where it is created.
- `:214-227` against `:230-241` — `spend_user_turns` will not match a user with no
  `billing.turns_credit` field, `grant_user_turns` creates it from zero with `$inc`. The asymmetry
  is right in both directions and the reason for the second is written down.
- `:73-77` — `list_configurations` returns every configuration document that is there, "including a
  subsystem that no longer has a seed file: the configuration that lives is this one, not the
  files'". The class is the collection, not the directory, and the file says so.
