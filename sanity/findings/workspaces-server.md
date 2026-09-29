# workspaces-server

Path: `webtools/webtools-workspaces/src/server.js`
Examined: 2026-09-26

One hundred and forty-two lines, and the most careful HTTP handler the audit has read. Three things
it gets right that other subsystems in this repository get wrong, each with the reason written down:

- `:115` builds the URL against the constant base `"http://localhost"`, not against the `Host`
  header. That is the defect recorded twice as `uncertain` in `summary.md`
  (`webtools/sso/src/server.js:365`, `webtools/front-gate/src/server.js:92`), and here it cannot
  arise.
- `:49-61` answers `413 SPEC_TOO_LARGE` **and then** closes, in that order, with the reason given:
  "first we answer, then we close, otherwise the client would never read the reason and would only
  see a dropped connection". The sso's equivalent (`breaks-now` 11) answers `400`, and its comment
  claims a close that nothing performs.
- `:118-120` normalises `::ffff:127.0.0.1` to `127.0.0.1` and says why — "it is the same IP written
  another way, not another caller" — which is one textual form of an address established explicitly
  instead of by resemblance.
- `:81-82` decodes with `{ fatal: true }`, "an invalid byte is an error, not a character silently
  replaced": a refusal to invent a value where the honest answer is that the bytes are not text.

Two findings, and the second is small.

---

## 1. One way of failing to store a file has a code; every other way is "our bug"

- `webtools/webtools-workspaces/src/server.js:87-93` — `writeSpec` is wrapped, and exactly one
  error is given a code: `if (error instanceof FrontMatterError) return sendError(response, 400,
  INVALID_FRONT_MATTER); throw error;`
- `webtools/webtools-workspaces/src/server.js:137-140` — everything else lands in the outer catch
  and is answered `500 INTERNAL_ERROR`
- Shape: **1 — partial-class requirement**, read from the other side, with **6 — world narrowed to
  fit the code**
- Class: **the ways a write to the workspace can fail.** `writeSpec`
  (`webtools/webtools-workspaces/src/store.js:61-91`) touches the filesystem four times — `mkdir`,
  `readdir`, `writeFile`, `link` — and every failure of any of them that is not `ENOENT` or
  `EEXIST` is rethrown. `ENOSPC` on a full disk, `EACCES` or `EROFS` on a root that is not
  writable, `EMFILE` under load, and the module's own
  `Error("too many concurrent writes on project …")` (`store.js:90`) all arrive at the same line
  and come back as the same code.
- `INTERNAL_ERROR` is not a neutral word here: the project's own rule is that an API error is
  "correct HTTP status and a stable code" and this file repeats it at `:11`. A `500 INTERNAL_ERROR`
  tells the caller the fault is in this process, so the preanalyst — which turns these codes into
  what the client sees — cannot tell "the disk is full, try later" from "workspaces has a defect",
  and neither can whoever reads the log. The distinction is available at the moment it is lost:
  `error.code` is `ENOSPC`, and it is thrown away one line before the answer is written.
- The likeliest member is the first one: `storage.root` is `~/webtools_data/workspaces`
  (`webtools/configurator/configuration/workspaces.json:7`), created by `mkdir(…, {recursive:
  true})` at the first upload. If the home directory is not writable by the user the service runs
  as, every upload in the system's life is a `500 INTERNAL_ERROR` and nothing ever says why.
- Severity: `latent`
- Smallest generalising change: read `error.code` and give the operational failures a code of their
  own — a `503 STORAGE_UNAVAILABLE` for the filesystem's refusals, a code for the concurrency
  ceiling — and keep `INTERNAL_ERROR` for what it says: the outcomes nobody has accounted for.

---

## 2. The one outcome detected in the error path is the one nothing is done about

- `webtools/webtools-workspaces/src/server.js:139` —
  `if (!response.headersSent) sendError(response, 500, INTERNAL_ERROR);`, with no `else`
- Shape: **5 — only the success path**
- Class: **the states the response can be in when the handler throws.** There are three: nothing
  written, headers written, headers and part of the body written. The first is answered. The other
  two are recognised — that is what `headersSent` is testing — and then left: `response.end()` is
  never called, so the socket stays open with a `content-length` promised and not delivered, and
  the caller waits for its own timeout with no error and no log line beyond the stack.
- It is not reachable today, and that is worth saying plainly: `sendJson` writes the head and ends
  in one call (`:34-43`), and `serveLatest` has nothing between its `writeHead` (`:104`) and its
  `end` (`:110`) that can throw. The test is there for a state the code cannot currently be in,
  which is why the missing branch has never been noticed.
- Severity: `stylistic` — correct for the class as the file stands; the shape invites the defect
  the moment a handler streams, and a streamed answer is exactly what a 10 MB specification invites.
- Smallest generalising change: `else response.destroy()`, or end the response — either is a
  decision, where saying nothing is not.

---

## Noted, not raised as findings

- `:8-9` — "It stores and does not decide: it does not check that the project exists, nor whose it
  is. **The caller does that**, before sending the file." A requirement placed on the class of
  callers and stated where the callers will read it. It is load-bearing on the read side too: any
  address in the IP pool can `GET /projects/{any id}/specs/latest`, so the only thing between one
  client's specification and another is that every caller keeps this promise. Stated is what the
  rule asks for; it remains a single sentence holding a boundary.
- `:68`, `:101` and `store.js:24-29` — the project id is validated in the handler *and* again in
  `specsDir`, and the reason the format check doubles as the path defence is written down: "an id
  that passes it contains neither `/` nor `..`, so it cannot escape the root". The segment is taken
  from `url.pathname` still percent-encoded, so `%2e%2e` reaches `isProjectId` as the literal text
  and is refused, and `/projects/../specs` is normalised by `new URL` to `/specs` and matches no
  route. Three ways in, all closed, and the reasoning recorded at the boundary that owns it.
- `:70-77` — the headers are validated before the body is read, so a request with a bad
  `X-Spec-Origin` is answered `400` while the client may still be uploading. Whether that answer
  reaches the client, or the upload dies first, depends on Node's dumping of an unconsumed request
  body. The `413` branch below it handles the equivalent situation deliberately (`:57-60`); these
  three early returns do not, and whether they need to is a question about Node rather than about
  this code. Not asserted, and not raised as an `uncertain` because no behaviour here depends on
  the answer — only the message the client sees.
- `:120-123` — `(request.socket.remoteAddress ?? "")` makes an absent address the empty string,
  which is in no pool, so the request is refused. An absence handled as a refusal. The log line it
  produces names no address, which is the one place the substitution shows.
- `:59` — `413 SPEC_TOO_LARGE` does not say what the limit is, so a caller that hits it cannot
  adapt without reading the configuration of another subsystem. A question about the API's
  usefulness, not about the audited rule.
- `:18-29` — the eleven error codes are exported constants, and the preanalyst's client restates
  two of them as literals without importing anything (`summary.md` records
  `webtools/preanalyst/src/workspaces.js:65`, which conflates `SPEC_NOT_FOUND` with
  `ROUTE_NOT_FOUND` and does not read the code at all). The contract is declared here and copied
  there because the two are separate packages; recorded against the copy, not here.
