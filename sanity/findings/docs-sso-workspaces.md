# docs-sso-workspaces

Paths: `docs/subsystems/sso/README.md`, `docs/subsystems/workspaces/README.md`
Examined: 2026-09-26

Four hundred and twelve lines and one hundred and sixty-four, and the first thing to record about
them is what the two larger documents got wrong and these two did not: **both test counts are
exact**. The sso's §9 says 47 and `tests/*.test.js` declares 25 + 3 + 4 + 6 + 4 + 5 = 47; the
workspaces' §0 says 13 and its two files declare 8 + 5 = 13. `findings/docs-preanalyst.md` 1 and
`findings/docs-anagraphics.md` 2 are about the same kind of sentence in the same kind of table, and
here it holds.

The sso's §1.1 is the best piece of explanation in the repository — why a cookie is needed, why a
ticket is needed, and the three alternatives rejected with the reason for each — and §1.3 states
the division the whole subsystem rests on in one line: "anagraphics is a store, the sso is the
authority".

The workspaces' §0 has the cell this audit has been asking for all run: "Port | **9400**
(`listen.port` of the configuration)". The value and where the value really comes from, in one
cell — which is precisely what `webtools/webtools-workspaces/README.md:11` does not do
(`findings/workspaces-runner.md` 2).

Two findings, one per document.

---

## 1. The sso's error table calls itself the contract and is missing the two newest codes

- `docs/subsystems/sso/README.md`, §5.1 — "The JSON routes follow the project's contract: correct
  HTTP status and a **stable code**", followed by a table of **eleven** codes
- What the subsystem exports and returns: `webtools/sso/src/auth.js:16-20` and
  `webtools/sso/src/server.js:32-38` — **thirteen**. The two the table does not list are
  `INVALID_LOCALE` (`server.js:34`) and `BODY_TOO_LARGE`, both produced by `POST /locale` through
  `handleLocale` (`server.js:310-312`, `return sendError(response, change.status, change.code)`)
  out of `webtools/commons/i18n/webtools_i18n.js:62-63`
- The same document uses one of them two sections later: §5.2's row for `POST /session/locale`
  ends "`400 INVALID_LOCALE` · `400` · `503`"
- Shape: **6 — world narrowed to fit the code**
- Class: **the answers a consumer of this API can receive.** The table is the place the contract is
  written down, and §5.1's third bullet in the sister document states what a table like this is
  for: "the consumers compare `error`, they must not interpret text". A consumer written from this
  table has two codes it has never heard of, and with `BODY_TOO_LARGE` a whole status — `413` does
  not appear anywhere in the table — so the sensible fallback ("an unknown 4xx is a bug in my
  request") is the wrong reading of a body that was simply too long.
- The two missing codes are the language switcher's, which is the most recently added route: the
  table describes the subsystem as it was before it, and §5.3, written at the same time as the
  route, describes `POST /locale` without naming its errors at all.
- Severity: `latent`
- Smallest generalising change: add the two rows, and — because this is the second document in the
  audit whose error table has fallen behind its `errors` constants
  (`findings/docs-anagraphics.md` 3) — derive the table from the exported constants, which in both
  subsystems sit together in one place for exactly that reason.

---

## 2. The workspaces' concurrency guarantee is stated without the bound the same paragraph gives it

- `docs/subsystems/workspaces/README.md`, §2.1 — "a temporary one (`.incoming-<uuid>.tmp`) is
  written and then linked to the version's name with `link`, which fails if that name already
  exists. In that case the next number is tried, **up to 20 times**. As a result:
  - **two concurrent writes never take the same number**;
  - whoever reads the last version never finds a half-written file."
- `webtools/webtools-workspaces/src/store.js:20-22,68,90` — `MAX_ATTEMPTS = 20`, and past it
  `throw new Error("too many concurrent writes on project …")`, which
  `webtools/webtools-workspaces/src/server.js:137-140` answers as `500 INTERNAL_ERROR`
- Shape: **6 — world narrowed to fit the code**
- Class: **the numbers of simultaneous writes to one project.** The guarantee as written is
  unconditional — *never* — and it is drawn as a consequence ("As a result") from a mechanism the
  preceding sentence has just bounded. Both statements are in the same paragraph, eleven words
  apart, and the second is true only for the members below the bound. The twenty-first concurrent
  writer does not take somebody else's number; it gets no number at all, and its client is told the
  fault is in the code.
- The second bullet — the half-written file — is genuinely unconditional, which makes the pairing
  misleading: two claims presented identically, one of which holds for the whole class and one of
  which does not.
- It is the documentation half of `findings/workspaces-tests.md` 2, where the suite demonstrates
  the guarantee at ten writers and asserts nothing about where it stops.
- Severity: `latent`
- Smallest generalising change: say what happens past the bound — "beyond twenty simultaneous
  writes on the same project the write fails rather than taking a wrong number" — which keeps the
  guarantee, names its edge, and tells the reader what the `500` they may one day see means.

---

## Noted, not raised as findings

- `docs/subsystems/sso/README.md`, §11 — twelve known limits, and they are properties rather than
  progress: no rate limiting; "**An unknown user answers faster** than one with a wrong password,
  because scrypt is not even run: by measuring the times one can work out whether an address is
  registered"; no TLS and "`Secure` must be added to the cookies"
  (which is `findings/commons-sso-client.md` 2 from the other side); "**There is one IP pool** for
  both the program routes and the pages, which are meant for people's browsers instead". Each names
  a class the current design does not serve, and says what the day of reckoning looks like.
- `docs/subsystems/sso/README.md`, §5.3 — "`next` must start with one of the addresses in
  `login.allowed_next`, otherwise it is **replaced with the first of the list** (and the fact goes
  in the log)". The substitution recorded at `findings/sso-settings-index-page.md` is documented,
  including the log line, so the behaviour is a decision rather than an accident.
- `docs/subsystems/sso/README.md`, §12 — four checklists for four classes of change, and the last
  one ("Changing the password algorithm") is the rule applied to a future class: "The new algorithm
  is added to `src/credentials.js` **keeping** the old one… and the passwords are converted at the
  first successful login or reset." A migration designed for the members that already exist rather
  than for the one being introduced.
- `docs/subsystems/sso/README.md`, §12, "Adding a subsystem with a login", step 1 — "Its address in
  `login.allowed_next`". Singular, where the configuration today holds **two** spellings of the one
  address (`http://127.0.0.1:9200` and `http://localhost:9200`,
  `webtools/configurator/configuration/sso.json:19`). Which spellings a browser may present is the
  question recorded at `findings/configurator-configuration-rest.md` 2; the checklist does not
  mention that more than one entry is usually needed.
- `docs/subsystems/sso/README.md`, §0 — "Stack | **Node 23** · …", where
  `webtools/sso/package.json` declares `"node": ">=20"`. The same point-for-a-range as
  `findings/docs-preanalyst.md`'s note.
- `docs/subsystems/workspaces/README.md`, §4 — `access.allowed_ips`: "The pool: **an exact
  comparison on the connection's IP**", and `storage.root`: "Absolute, or starting with `~/`
  (expanded in the home of whoever starts the server)". Two configured values described by what the
  code does with them rather than by what they are today.
- `docs/subsystems/workspaces/README.md`, §6 — four known limits, all about the product (no
  deletion, no version list, no backup, no authentication between services). None of the three
  findings this audit recorded against the subsystem is among them: the root that is never checked
  at startup (`findings/workspaces-settings-index.md` 2), the hard-link requirement
  (`findings/workspaces-store.md` 2) and the replacing decode on the way out
  (`findings/workspaces-store.md` 1). A limits list is not required to be exhaustive; recorded so
  the gap between the two lists is on the record.
- `docs/subsystems/workspaces/README.md`, §1 — "Why a service and not a shared directory: when the
  machines are separated, the disk will belong to one machine only. On top of that, the defence
  against manipulated paths lives in one place." A design decision justified by a member of the
  class that does not exist yet, which is what writing for the class looks like.
