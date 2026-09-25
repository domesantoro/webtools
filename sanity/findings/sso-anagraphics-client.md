# sso-anagraphics-client

Path: `webtools/sso/src/anagraphics.js`
Examined: 2026-09-25

The sso's only door to a database: users, credentials, sessions, tickets. The file states its
contract at the top and keeps it — no exception ever reaches the caller, the outcome carries *how*
it failed and not only that it failed, the code is compared and never the prose (`:11-12`), and the
one place where several statuses are deliberately merged says so and says why ("these are our
failures, not the user's", `:49-51`). Two findings.

---

## 1. `encodeURIComponent` is trusted to make a path segment, and it does not

- `webtools/sso/src/anagraphics.js:56` — `const encode = encodeURIComponent;`, used at
  `:60,65,70,75,85,90,95,106`
- Shape: **4 — capability inferred from resemblance**
- Class: **the strings that may arrive as a username or a token.** `encodeURIComponent` leaves `.`
  untouched — it is an unreserved character — so a value of `..` or `.` passes through unchanged and
  becomes a **dot segment** in the path. The URL is then parsed by `fetch`, and dot segments are
  removed at parse time: `http://127.0.0.1:9000/users/..` is the address of `/`, not of a user
  called `..`. The function that is there to keep a value inside one path segment does not do that
  for the one class of values that can leave it.
- Reachable with nothing changed. The username is whatever is typed into the login form
  (`server.js:253`, no shape imposed). Typing `..` sends `GET /` to anagraphics, which has no such
  route, so the answer is `404 ROUTE_NOT_FOUND`; the sso reads it as `not_found`, and
  `auth.js:34-36` writes `login refused: unknown user (..)`. **The consequence today is one wrong
  log line** — the answer to the client is the same refusal either way, and `/users/../credential`
  likewise lands on a route that does not exist. What is wrong is the reasoning, not today's
  outcome: the module believes it is naming a resource and it is naming a different one, and it is
  the only thing standing between an outside string and an internal address.
- The value also reaches anagraphics' own routing this way for the other seven calls — a session
  token or a ticket of `..` is sent to `/sessions` and `/tickets`, which **do** exist as collection
  routes (`main.py:379,438,459`) with methods on them.
- Severity: `breaks-now`
- Smallest generalising change: build the address with `new URL`/`URLSearchParams` or refuse a
  segment that is not a segment, rather than relying on an escaper whose job is a different one.

## 2. The `code` this file carries on a 404 is dropped by everyone who reads it

- `webtools/sso/src/anagraphics.js:46` — `{ ok: false, reason: "not_found", code: payload?.error }`,
  read at `webtools/sso/src/auth.js:35,87,120` as `result.reason === "not_found"` alone
- Shape: **6 — world narrowed to fit the code**
- Class: **the reasons anagraphics answers 404.** There are two kinds, and the API separates them
  properly: the thing is not there (`USER_NOT_FOUND`, `SESSION_NOT_FOUND`, `TICKET_NOT_FOUND`,
  `CREDENTIAL_NOT_SET`) and *the route* is not there (`ROUTE_NOT_FOUND`,
  `webtools/anagraphics/webtools_anagraphics/errors.py:64-65`). This file keeps the distinction —
  it is the reason `code` exists on the result — and every caller then treats the two as one:
  `readSession` answers `logged: false`, `login` answers "unknown user", `exchangeTicket` answers
  `TICKET_NOT_FOUND`. A route that moved, a path built wrong, a version skew between the two
  subsystems: each of them is reported as *the user is not who they say they are*, and a rename on
  the anagraphics side logs everybody out silently instead of failing loudly.
- The distinction is drawn by the layer below and thrown away by the layer above — the same shape
  already recorded for the preanalyst's client at `findings/preanalyst-anagraphics-client.md`, and
  here it is worse in one way and better in another: better because the code *is* transmitted, worse
  because it is transmitted and ignored, which looks from the inside like a decision.
- Finding 1 is the one route that reaches it today; otherwise it takes a route rename or a path
  typo, which is a change somebody is entitled to make.
- Severity: `latent`
- The decision belongs to `webtools/sso/src/auth.js` (unit 31, already examined). Recorded here
  because this is the file that owns the class of 404s and the only one that can see both members.
- Smallest generalising change: test the code, not only the reason — `ROUTE_NOT_FOUND` is our
  failure and belongs with `unavailable`, not with "it is not there".

---

## Noted, not raised as findings

- `:49-53` — 400, 403, 503 and 500 deliberately merged into `unavailable`, with the real code kept
  in the log and the argument written down. A collapse that is stated and reasoned, which is what
  distinguishes it from finding 2.
- `:7-9` — the header says `reason "conflict" → 409, token already there`. Anagraphics answers 409
  for `SESSION_EXISTS`, `TICKET_EXISTS`, `SUBMISSION_EXISTS` and `NOT_ENOUGH_TURNS`
  (`errors.py:28,30,32,36`); of these the sso can meet the first two. The documentation names one
  member of a class of two, and the `code` is carried, so nothing is lost in the code itself.
- `:30,41` return `unavailable` without a `code`, while `:53` returns one. A caller reading `.code`
  on an `unavailable` gets `undefined` for the network and the non-JSON cases. Consistent with the
  meaning (there is no remote code to report), recorded because the result shape varies with the
  branch.
- `deleteSessionsOfUser` (`:94-96`) is exported and called from nowhere. Not a class-rule matter.
- Anagraphics answers `400 INVALID_BODY` and never 422: `RequestValidationError` is converted
  (`errors.py:70-75`). So a body this client sends that fails validation arrives here as a 400 and
  is reported as `unavailable`, which is right — it is our defect, not the user's.
