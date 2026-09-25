# preanalyst-server

Path: `webtools/preanalyst/src/server.js` (1208 lines)
Examined: 2026-09-25

The subsystem's HTTP surface. Much of it is careful about exactly the thing this audit hunts —
`pageState` (`:987-1000`) keeps "logged in", "not logged in" and "we do not know because the sso
does not answer" as three different outcomes and says so; `runPrevalidation` (`:512-536`) keeps the
project alive when the check fails rather than treating a failed check as a refusal; the refund
path at `:790-800` exists because the two halves of buying turns can come apart. `STATE_AFTER`
(`:500-504`) and `REJECTION_CASE` (`:1067-1070`) both looked like incomplete lookup tables and both
turn out to be complete against `verdict()` and `REJECTING` in
`webtools/preanalyst/src/prevalidator.js`; they are not findings.

Two findings are `breaks-now`.

---

## 1. `GET /analysis/{id}` opens an analysis step whatever state the project is in

- `webtools/preanalyst/src/server.js:941-950` (in `serveAnalysis`), calling `openAnalysisStep` at
  `:573-581`
- Shape: **5 — only the outcome that succeeds is handled** (and **6**: the code is correct only for
  the projects the author had in front of them)
- Class: **the pipeline states a project may be in when its owner opens `/analysis/{id}`.**
  `webtools/anagraphics/webtools_anagraphics/main.py:93-107` defines eleven: `PREANALYSIS`,
  `PREVALIDATION`, `UNDERSPECIFIED`, `ANALYSIS`, `DRIVER_VALIDATION`, `CLIENT_VALIDATION`,
  `DEVELOPMENT`, `ALPHA_TEST`, `DEMO`, `PAID`, `REJECTED`. The route checks the session, the
  project's existence and its owner — and never the state. It asks one question instead,
  `openAnalysisOf(project) === null`, and reads the answer as "this is an old project that predates
  the analysis step", which is one member of that class and not the others.
- **What is reachable today.** A client whose request is refused at the prevalidation gate is
  redirected to `/?rejected={projectId}` (`:425`), so the project id is in their address bar, and it
  is in the rejection PDF link as well. Editing that address to `/analysis/{projectId}` reaches
  `serveAnalysis`: they own the project, it exists, it has no open analysis step — so one is opened,
  with `turns_left: settings.analysis.maxTurns` and an empty chat, and the project is moved to
  `ANALYSIS`. Anagraphics does not stop it: `append_pipeline_step`
  (`webtools/anagraphics/webtools_anagraphics/db.py:85-97`) validates that the state is one of the
  eleven names and **does not validate the transition**, so `REJECTED → ANALYSIS` is written
  without complaint. The prevalidation gate — the thing the whole subsystem exists to enforce — is
  bypassed by editing a URL, and the client gets a full allocation of paid turns on a request that
  was refused.
- **The same fault has a second face**, on a change somebody is entitled to make. `openAnalysisOf`
  (`:584-587`) looks for a step that is still `open`. When the step that closes the analysis is
  built — it is in the flow, `DRIVER_VALIDATION` follows `ANALYSIS` — every reopening of
  `/analysis/{id}` on a finished project will find no *open* step, open a fresh one, and hand out
  `max_turns` more turns for nothing, repeatedly.
- This is not a gap the file is unaware of in general: the two neighbouring routes in the same
  file, `serveRejectionPdf` (`:922`) and `rejectedProject` (`:1090`), both check
  `pipeline.state !== "REJECTED"` explicitly. This route is the one where it was not asked.
- Severity: **`breaks-now`**
- Smallest generalising change: open the step only for a project whose state actually says the
  analysis is where it belongs, and answer the other states as what they are rather than as a
  project waiting to be migrated.

## 2. A credit that could not be read is recorded as a credit of zero

- `webtools/preanalyst/src/server.js:588-598` (`turnsCredit`), and the same substitution at `:598`,
  `:802` and `:826`
- Shape: **2 — an absence filled with an invented value**
- Class: **the outcomes of reading a user's turn credit.** `findUser` distinguishes three:
  the user was read, the user was not found, and anagraphics did not answer. `turnsCredit` maps all
  three onto the number `0` and hands it to the page, where it is indistinguishable from a user who
  genuinely has no turns left.
- The comment argues the case — "better to offer buying than to offer spending a credit we do not
  know is there" — and it is a fair argument about *which* of the two offers to show. It is not an
  argument for writing `0`, which is a claim about a fact, not a choice about a button. A client
  with turns in hand, during the seconds anagraphics is restarting or past its 5-second timeout, is
  shown a page stating they have none and offering to sell them more. "We could not read your
  credit" is the true answer and there is nowhere to put it.
- `Number(user.data.billing?.turns_credit ?? 0)` at `:597` invents in a second way: a user document
  without a `billing` block reads as zero credit. Such documents exist — the repository carries
  `webtools/anagraphics/scripts/migrate_user_billing.py` precisely because they did — so "not
  migrated yet" and "no turns" are the same number here too.
- Severity: **`breaks-now`** — anagraphics is a separate service on a 5-second timeout
  (`webtools/preanalyst/src/settings.js:22`), so the unavailable outcome is reachable today. The
  harm is bounded for now only because the purchase is a mock that grants turns free
  (`:813-828`); it stops being bounded the day the payment is real.
- Smallest generalising change: let the credit be unknown — a distinct value the page can render as
  "not available" — instead of collapsing three outcomes onto zero.

## 3. Static files are served with a content type known for four extensions and guessed for the rest

- `webtools/preanalyst/src/server.js:61-66` (`CONTENT_TYPES`) and `:1120` (the
  `?? "application/octet-stream"` fallback)
- Shape: **1 — what only part of the class has, treated as the whole**
- Class: **the file types that may live in `public/`.** Four extensions are named; `public/`
  currently holds only `.css` and `.js`, so two of the four are already speculative and the map has
  never been exercised beyond them.
- What breaks, on an entitled change: adding an image, a `.json`, a `.webmanifest` or a source map
  to `public/` — an ordinary thing to do — serves it as `application/octet-stream`. For a
  stylesheet or a script variant that is not a cosmetic problem: browsers refuse to execute or
  apply a resource whose declared type contradicts how it is used, so the failure shows up as a
  page that is silently unstyled or a script that silently does not run.
- Severity: `latent`
- Smallest generalising change: refuse to serve a file whose type is not known, rather than serving
  it under a type that is certainly wrong — an unserved file is a visible 404, a mis-typed one is a
  silent malfunction.

---

## Noted, not raised as findings

- `:1195-1205` — the catch-all logs and answers 500 without leaking the error to the client, and
  guards `headersSent`. Correct; it is also what turns the policy-file findings recorded against
  `analyst.js` and `analysis_validator.js` into a 500 rather than the documented failure.
- `:78-82` — `secondsUntil` resolves an unparseable expiry to 0, i.e. to "already expired". That
  is a substituted value, but it resolves towards refusing access, which is the direction that
  cannot grant anything. Below the bar.
- `:646` — chat and turns bodies are limited by `form.body_max_bytes`, the form's limit, rather
  than one of their own. Harmless today; a shared limit for two unrelated things is the seam where
  tightening one breaks the other.
