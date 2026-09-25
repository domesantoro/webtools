# sso-sessions-tickets

Paths: `webtools/sso/src/sessions.js`, `webtools/sso/src/tickets.js`
Examined: 2026-09-25

The two value objects of the sign-on: what a session document is and when it has stopped counting,
and the single-use receipt that carries a session from one address to another. Both files are
short, both are written in the open — the session's "photograph ages" is stated as a trade-off
(`sessions.js:19-21`), the ticket's whole reason for existing is argued before the first line of
code (`tickets.js:3-18`), and a session with no readable expiry is declared expired on the stated
ground that "if we do not know how long it is good for, it is not good" (`sessions.js:52-53`).
`buildSession` also reads an absent `screen_name` or `driver_uid` as `null` rather than inventing
one, which is the rule kept. Four findings, none of them reachable with the configuration as it
stands.

---

## 1. Only a timestamp that carries its offset is read correctly; a naked one is read as local time

- `webtools/sso/src/sessions.js:55` and `webtools/sso/src/tickets.js:41` —
  `Date.parse(session?.expires_at ?? "")`
- Shape: **4 — capability inferred from resemblance**
- Class: **the timestamps a store may hand back.** `Date.parse` has three outcomes on an ISO-8601
  string, not two: an offset-carrying form (`…T10:01:00.000Z`) is read as an instant; a naked form
  (`…T10:01:00`) is read as **local time**, by the language specification; and anything else is
  `NaN`. The guard covers the third. The second is not refused — it is accepted and silently
  displaced by the machine's UTC offset, which is exactly the member the guard cannot see.
- The displacement is not academic here. A ticket lives 60 s (`configuration/sso.json`, `ticket.ttl_seconds`);
  on a machine at UTC+2 a naked expiry is read two hours in the past, so **every** ticket comes back
  expired and no login ever completes. A session at `ttl_seconds: 28800` would lose two of its eight
  hours the same way.
- What keeps that from happening is one line in another subsystem, in another language:
  `webtools/anagraphics/webtools_anagraphics/db.py:32-35` — `tz_aware=True`, with the comment
  "session dates come back with their zone (UTC), not naked". That is the right decision, made
  deliberately. The defect is that the sso does not know it depends on it: nothing in `sessions.js`
  or `tickets.js` says the string must carry an offset, so removing `tz_aware` — an ordinary-looking
  cleanup, since pymongo's own default is `False` — silently breaks the sign-on from the far side of
  an HTTP boundary, and the safeguard that exists will not catch it.
- Severity: `latent`
- Smallest generalising change: refuse a timestamp that does not fix its instant instead of
  guessing one for it — parse it as a member of a stated shape, or state the requirement where the
  document crosses in.

## 2. `serviceOf`'s `null` is produced with care and never read, and its third outcome is a string

- `webtools/sso/src/tickets.js:49-55`, read at `webtools/sso/src/server.js:222-223`
- Shapes: **5 — only the success path**, and **2 — invented value**
- Class: **the URLs `serviceOf` may be handed.** The function names two outcomes: an origin, or
  `null` when the address does not parse. There is a third — a URL that parses perfectly well but
  has no origin (`file:`, `data:`, any non-special scheme): `new URL(...).origin` is then the
  **string** `"null"`, not `null`. That string is returned as if it were an origin, is written into
  the ticket as its `service`, and is later compared for equality against the service the exchanging
  subsystem declares (`auth.js:133`). Two different failures come back as two values that print the
  same.
- And the honest `null` that the `catch` takes such care to produce is never tested by anyone.
  `returnWithTicket` passes it straight to `issueTicket` → `buildTicket(token, null, …)` →
  `POST /tickets`, where anagraphics' model requires `service: str`
  (`webtools/anagraphics/webtools_anagraphics/main.py:433`) and answers `400 INVALID_BODY`
  (`webtools/anagraphics/webtools_anagraphics/errors.py:70-75`). The user gets the 503 page and the
  log says "ticket not issued" with a remote code: a fact the sso already knew before making the
  call is learnt back from another subsystem, described as something else.
- Not reachable today: `safeNext` only ever returns a member of `login.allowed_next`, and
  `httpUrlList` admits only `http:`/`https:`
  (`webtools/commons/configuration/configuration_client.js:129-146`). The guarantee is two modules
  away and nothing here states it.
- Severity: `latent`
- Smallest generalising change: return one thing that says "this address has no service", test it
  where it is produced, and do not let `"null"` pass for an origin.

## 3. `withTicket` assumes an absolute address where its own sibling does not

- `webtools/sso/src/tickets.js:59-63` — `new URL(next)`, unguarded, six lines below a `new URL(url)`
  wrapped in a `try`
- Shape: **6 — world narrowed to fit the code**
- Class: **the same class of input, `next`, in the same call.** `webtools/sso/src/server.js:222,228`
  hands the one value to both functions: `serviceOf` treats "it may not parse" as a case to answer
  for, `withTicket` treats it as impossible. One of the two readings of the class is right; they
  cannot both be. A relative `next` — the shape every HTML form and every other route in this
  repository would call an address — throws `TypeError` here.
- It is the shape that matters rather than a path: `safeNext` (`settings.js:47-56`) has a
  `settings.allowedNext[0] ?? "/"` fallback whose second half is precisely a relative address, and
  it is only unreachable because `stringList` refuses an empty list. Recorded against `settings.js`
  at unit 35; noted here because this is the function that would meet the value.
- Severity: `latent`
- Smallest generalising change: one statement of what `next` is, checked once, so that both
  functions in this module hold the same belief about it.

## 4. One predicate, written twice

- `webtools/sso/src/sessions.js:54-58` and `webtools/sso/src/tickets.js:40-44` — byte-for-byte the
  same body, over the same field name, imported into the same file under two names
  (`auth.js:13-14`)
- Shape: **6 — world narrowed to fit the code**, in its mild form
- Class: **the things that expire.** Sessions and tickets differ in everything except this, and the
  rule "no readable expiry means expired" is a property of the class, not of either member. Held in
  two places, it is the kind of rule that gets improved in one — finding 1 above is exactly such an
  improvement — and left behind in the other.
- Severity: `stylistic`
- Smallest generalising change: one `isExpired` over "something with an `expires_at`", imported by
  both.

---

## Noted, not raised as findings

- `sessions.js:45-46` — `user.screen_name ?? null`: an absence recorded as an absence, and the
  comment above says what ages and why. The rule kept, worth recording as such.
- `tickets.js:61` — `searchParams.set` means the one parameter the comment's promise does not cover
  is a `ticket` the caller had already put in `next`, which is overwritten without a word. Harmless
  as things stand, and it is the parameter this function owns.
- `sessions.js:28` `TOKEN_BYTES` and `tickets.js:22` `TICKET_BYTES` are separately declared with the
  same value, which is right: the two receipts are independent and nothing says they must match.
  Contrast with finding 4, where the duplication is of a rule rather than of a coincidence.
- The `service` written into the ticket is declared by the caller and nobody verifies it
  (`auth.js:131-139`, stated there as a known limit). Belongs to unit 31, already examined.
- `webtools/anagraphics/webtools_anagraphics/main.py:404` — an Italian comment
  ("Va in `data.locale`, accanto agli altri dati di sessione"), a `CLAUDE.md` breach of a different
  rule. Read here while checking the round-trip; it belongs to unit 44.
