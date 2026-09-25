# sso-auth

Path: `webtools/sso/src/auth.js`
Examined: 2026-09-25

Where the sso decides: login, read a session, issue and exchange a ticket, logout, change language.
The file is written with the class in mind almost throughout — four different reasons to refuse a
login collapse into one answer **on purpose**, with the reason stated ("Knowing *which* of the four
is true would tell whoever is trying whether an address is registered") and the real cause kept in
the log; a store that does not answer is never turned into "not logged in", because "Saying no would
log everybody out at every Mongo failure" (`:88-89`); a repeated logout is not an error, because the
result asked for is true anyway; and a ticket that is valid for a session that has since been closed
is handled as its own case. Two findings.

---

## 1. A user whose `active` is not there is treated as active

- `webtools/sso/src/auth.js:42` — `if (user.active === false)`
- Shape: **2 — invented value**
- Class: **the values a user document's `active` may hold.** The test names one member and lets
  every other member — `true`, absent, `null`, `0`, `"no"`, `"false"` — mean "let them in". An
  absence is not `false`, but neither is it `true`: it is the absence of a decision, and here it is
  read as the permissive one.
- The rest of the repository reads this kind of flag the other way round, and says why:
  `webtools/preanalyst/src/driver_link.js:80,99` and
  `webtools/preanalyst/src/project_driver.js:39` all test `enabled !== true`, so a driver document
  without the field is not taken for an enabled one. Two conventions for the same kind of field, and
  the sso has the one where forgetting to write it grants rather than withholds.
- Today no code writes a user: the documents come from `webtools/anagraphics/scripts/seed.py:55,62`,
  which sets `"active": True`, and anagraphics has no endpoint that creates one. That is exactly why
  this is worth recording now — registration is in the flow (`/ui/register`, "not active yet",
  `webtools/sso/src/server.js:14`), and whoever writes it will produce the first user documents this
  project has ever created. A document written without the field is an account that logs in.
- Severity: `latent`
- Smallest generalising change: `user.active !== true`, and the same convention everywhere, so that
  a field nobody wrote never means permission.

## 2. Half of the language change is kept and the whole of it is reported as failed

- `webtools/sso/src/auth.js:162-168` — the session's locale is written first (`:162`), and if the
  **profile** write then fails the function returns `unavailable`
- Shape: **5 — only the outcome that succeeds is handled**
- Class: **the outcomes of a two-step write.** There are four, and only two are named here: both
  succeeded, or "it did not work". The mixed outcome — the session changed, the profile not — is
  real, and it is the one that actually happens when a write fails between two calls.
- The same file decides the opposite for the same operation twenty lines further up: at `:63-68`, a
  profile locale that cannot be saved is logged and the login goes on, "the language stays in the
  cookie and in the session". One of the two decisions is right for this class; they cannot both be.
- What the operator is told is wrong as well. The caller logs "language not saved in the session and
  in the profile" (`webtools/sso/src/server.js:318`) — and the session's language **was** saved, and
  the user will see it, and the next login will contradict it. The redirect still carries the cookie,
  so the page changes language and the JSON route answers `503`: three different accounts of one
  event.
- Severity: `latent`
- Smallest generalising change: decide which of the two writes makes the change real, report that,
  and log the other as the partial failure it is — as the login path already does.

---

## Noted, not raised as findings

- `:22-27` — `unavailable` and `refused` are single shared objects returned by reference from every
  path. Not a class-rule matter (nothing mutates them); recorded so it is on the record, as for
  `project_driver.js:22`.
- `:118-127` — "Unknown, already used, or removed by the TTL: to the caller it is the same thing" —
  a collapse that is stated, reasoned and safe, which is the difference between this and the
  collapses raised elsewhere in this audit.
- `:73-75` — a `409` on session creation is treated as a defect worth looking at rather than as an
  expected outcome, with the arithmetic given ("two random 32-byte tokens do not collide"). A class
  member excluded by argument, not by habit.
- `:31-39` — an unknown user is refused after one call, a real user after two calls and a password
  hash. The timing difference tells an attacker whether a username exists, which the comment at
  `:23-26` is otherwise at pains to hide. Not the rule being audited, and recorded only because that
  comment makes the intent explicit.
