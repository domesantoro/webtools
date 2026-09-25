# sso-server

Path: `webtools/sso/src/server.js`
Examined: 2026-09-25

The sso's HTTP layer: five JSON routes for programs, four pages for people, the cookie, the bearer
token and the static files. Much of it is exemplary — the IP pool before anything else, the token in
a header and not in the URL with the reason given, the static path checked against `PUBLIC_DIR`
after normalising, a failed `issueTicket` that still sets the cookie it has earned, a logout that
clears the cookie **and** says in the log that the session is still alive if the store did not
answer ("It is to be looked at, not hidden", `:292-295`), and a missing `Secure` flag documented as
something that must be added outside localhost rather than left silent. Three findings.

---

## 1. The request's URL is built from the `Host` header, before the try and before the IP check

- `webtools/sso/src/server.js:365` —
  `const url = new URL(request.url, \`http://${request.headers.host ?? "localhost"}\`);`
- Shape: **5 — only the outcome that succeeds is handled**, with **6**
- Class: **the `Host` headers a request may carry.** The `??` shows the author did consider this
  class and handled one member of it — the header absent. It does not cover the header **present
  and empty**, which is a different member: `"" ?? "localhost"` is `""`, the base becomes `http://`,
  and `new URL` throws `ERR_INVALID_URL` (verified). The same happens for any value that is not a
  valid authority.
- Where the throw goes is what makes this worth raising. The line sits **above** the `try` that wraps
  everything else (`:377`), inside an `async` handler, so the rejection is not caught by the
  server's own error path: it is an unhandled rejection, which Node ends the **process** on by
  default. One request would stop the sso, and with it every subsystem's login — the one service
  whose absence the others can only report, not work around. It also sits above the IP-pool check
  (`:371-375`), so it happens before the request has been established as one we accept at all.
- Severity: `latent`, with the reachability partly **`uncertain`**. What would need to be known, and
  what this audit does not assert: whether Node's HTTP parser delivers a request whose `Host` header
  is empty or malformed, or rejects it before the handler. The defect does not depend on the answer —
  the value is used as an authority without being established as one, outside the only protection
  the file has — but the severity does.
- Smallest generalising change: build the URL inside the `try`, after the IP check, and treat a
  `Host` that is not an authority as a bad request; a fixed base would do just as well, since
  nothing here uses the host for anything.

## 2. "Empty" and "too large" arrive as the same answer, and both become `INVALID_BODY`

- `webtools/sso/src/server.js:118-128` — `readBody` returns `{ ok: false }` for a body over
  `maxBytes` (`:123`) and for a body of zero bytes (`:126`), with nothing to tell them apart —
  consumed at `:166`, `:192`, `:208`, all `400 INVALID_BODY`
- Shape: **6 — the world narrowed to fit the code**
- Class: **the ways a request body can be unusable.** There are at least three — absent, too large,
  not JSON — and the API contract this project sets itself is "correct HTTP status and a stable
  code, never prose to be interpreted". A body over the limit has a status of its own, `413`, and
  the rest of the repository uses it: `webtools/webtools-workspaces/src/server.js:52-60` answers
  `413 SPEC_TOO_LARGE`, and preanalyst answers `413` with a page of its own
  (`webtools/preanalyst/src/server.js:304-306`). Only here the caller is told that what it sent was
  malformed when what it sent was merely long.
- The comment above the function states a behaviour that is not implemented: "past `maxBytes` … the
  connection is closed". Nothing closes it; the loop stops reading and a response is written while
  the client may still be sending.
- Reachable with no change to anything: post more than `limits.body_max_bytes` to `/login`.
- Severity: `breaks-now`; the consequence is a misleading status and code on a request that failed
  anyway.
- Smallest generalising change: return which of the two happened, and let the handler answer `413`
  for one and `400` for the other.

## 3. A cookie value that is not percent-encoded takes the page down

- `webtools/sso/src/server.js:100-111` — `decodeURIComponent(piece.slice(separatore + 1).trim())`
- Shape: **4 — capability inferred from resemblance**
- Class: **the cookie values that may arrive under our name.** `decodeURIComponent` throws
  `URIError` on a malformed escape (`%`, `%zz`, a lone surrogate escape). The code treats every
  value bearing our cookie's name as one we wrote — and we do write well-formed ones. But cookies
  are keyed by host and path and **ignore the port**, which this repository knows and relies on
  (`webtools/commons/i18n/webtools_i18n.js:16-19`: "cookies ignore the port, so the one written by
  a subsystem is read by all of them"). Anything else served from `127.0.0.1` — another project on
  this machine, which `CLAUDE.md` says is the normal situation — can set `webtools_sso=%`, and an
  extension or a hand-edited cookie does it too.
- The throw is caught by the outer handler, so the answer is `500 INTERNAL_ERROR` — on
  `/ui/login`, `/ui/logout`, `/locale`, every time, for as long as the cookie lives. The user cannot
  get past the login page, and the sso is telling them it is broken.
- Severity: `latent`
- Smallest generalising change: decode inside a `try` and treat a value that cannot be decoded as no
  cookie at all — which is what it is.

---

## Noted, not raised as findings

- `:325-346` — `serveStatic` normalises, strips leading separators and then checks the result is
  still inside `PUBLIC_DIR`, so the escape is refused twice over; and the unknown extension falls
  back to `application/octet-stream` rather than to a guess. Both are the class treated as open.
- `:92-94` — the missing `Secure` attribute is written down as a condition of the environment, not
  assumed away: "No Secure because there is no HTTPS on localhost: outside here it must be added."
  That is the difference between a boundary stated and a boundary forgotten.
- `:157-160` — `reply` funnels both shapes of a result through one place, so a handler cannot answer
  a failure as if it were a success.
- **A different rule, recorded so it is not lost**: `CLAUDE.md` requires everything internal to be
  in English. This file has Italian identifiers — `separatore` (`:104`), `campi` (`:251`), `entrato`
  (`:268`), `uscito` (`:290`) — and three Italian section comments (`:49` *risposte*, `:113`
  *richiesta*, `:323` *statici*). Not a class-vs-instance defect.
