# sso-tests

Paths: `webtools/sso/tests/api.test.js`, `credentials.test.js`, `sessions.test.js`,
`tickets.test.js`, `i18n.test.js`, `configuration.test.js`
Examined: 2026-09-25

865 lines, and unusually good ones: the round trip is tested through real HTTP on a real server, the
four ways of failing a login are asserted to be **indistinguishable**, "with anagraphics down
nobody gets in and nobody is told they are out" is a test with the reasoning written inside it, and
`credentials.test.js` pins a cross-language contract with a block genuinely produced by the Python
side. The findings below are about the class the tests describe, not about their coverage.

---

## 1. The page tests assert one locale's exact wording

- `webtools/sso/tests/api.test.js:434` (`/Username o password non validi/`), `:464`
  (`/non è ancora attiva/`), `:497,499` (`/strumenti su misura/`, `/tailor-made tools/`)
- Shape: **6 — world narrowed to fit the code**
- Class: **the catalogue values.** A sentence in `it.json` is a product text, and `CLAUDE.md` says
  in so many words that such a text is dry, functional and rewritten when it can be shorter. These
  tests make four of them load-bearing: rewording a message — a change whose whole point is that it
  touches nothing but the catalogue — fails a test about the login flow, and the failure names the
  flow, not the sentence.
- The repository already knows the right answer, in this same directory:
  `webtools/sso/tests/i18n.test.js:22` — "Catalogues written here: the tests do not depend on the
  real texts" — and then builds its own two-language catalogue. One of the two files tests the
  mechanism, the other tests today's prose.
- Severity: `latent`
- Smallest generalising change: assert the marker the page owns (`notice-warn`, a data attribute,
  the status code) or the key, not the sentence a translator may change.

## 2. The double answers only with the members the code already handles

- `webtools/sso/tests/api.test.js:55-124` — `fakeAnagraphics`, whose failure vocabulary is
  `down` (`unavailable`) and `notFound(code)` with the four "the thing is not there" codes, plus
  `conflict`
- Shape: **6 — world narrowed to fit the code**
- Class: **the answers `src/anagraphics.js` can produce.** The real client also returns
  `not_found` with `code: "ROUTE_NOT_FOUND"` (`errors.py:64-65`) — our own failure wearing the
  costume of "the session is not there" — and it returns `unavailable` **with** a `code` for 400,
  403 and 503. Neither shape exists in the double, so the collapse recorded as finding 2 of
  `findings/sso-anagraphics-client.md` cannot fail a test: the specification these tests express is
  the one the code already satisfies.
- This is the shape the audited rule names outright — the tests are drawn from the same instance the
  code was written for — and it is what keeps that finding `latent` rather than visible.
- Severity: `latent`
- Smallest generalising change: let the double answer everything the real client can answer, `code`
  included, and say what the sso must do with each.

## 3. The settings the tests use are not settings the system can have

- `webtools/sso/tests/api.test.js:27-48` (`SETTINGS`, hand-built), `:289`
  (`sessionTtlSeconds: -1`), `:481` (`allowedIps: []`)
- Shape: **6 — world narrowed to fit the code**
- Class: **the configurations `loadSettings` can produce.** `session.ttl_seconds` is read with
  `{ min: 1 }` and `access.allowed_ips` with `stringList`, which refuses an empty list
  (`src/settings.js:16,24`, `commons/configuration_client.js:121-128`). Both tests reach the state
  they want by handing the server a configuration the configuration client would have refused — so
  what is asserted is the behaviour of the code on a member of the class that cannot exist, and the
  states that *can* exist (a session that expired because time passed, a caller genuinely outside
  the pool) are not the ones exercised.
- The other half is worse and is silent: because `SETTINGS` is written by hand, it is never checked
  against `loadSettings`. A field added to the real settings — the ordinary way this system grows —
  leaves every one of these tests passing against a settings object the running server no longer
  has, and the first sign of it is in production.
- Severity: `latent`
- Smallest generalising change: build the tests' settings through the same function the server uses,
  from a configuration object, so that the test's world and the running world are one class; keep
  the hand-built overrides only for what that function genuinely allows.

## 4. A helper that reads the first `Set-Cookie` and hopes

- `webtools/sso/tests/api.test.js:177-182` — `cookieFrom`:
  `response.headers.getSetCookie?.()[0] ?? …`, then a regex for the name
- Shape: **6 — world narrowed to fit the code**
- Class: **the `Set-Cookie` headers one response may carry.** A successful form login sets two — the
  sso's session cookie and the shared language cookie — and this helper looks only at the first,
  then searches it for a name it may not contain. It works because of the order in which
  `server.js` happens to write them; nothing states that order, and the same file elsewhere
  (`:451,529,536`) iterates over all the headers, which is the reading that does not depend on it.
- When it does fail it fails quietly in one place: `:456` passes the result straight to
  `sso.page(...)`, so a `null` cookie turns "log out an open session" into "log out with no session",
  and the assertions on the redirect still hold.
- Severity: `latent`
- Smallest generalising change: search every `Set-Cookie` header for the name asked for — the helper
  already takes the name as an argument.

## 5. An exact `Intl` output is asserted, and one of the two was already patched for it

- `webtools/sso/tests/i18n.test.js:50-51` — `i18n.euro("it", 40000).replace(/\s/g, " ")` equals
  `"400 €"`, and `i18n.euro("en", 40050)` equals `"€400.50"` with no such treatment
- Shape: **4 — capability inferred from resemblance**
- Class: **the strings a runtime's `Intl.NumberFormat` produces.** They are not stable across ICU
  versions or across Node builds: the separator between number and symbol has changed from a
  no-break space to a narrow no-break space, which is exactly what the `replace` on the Italian line
  is compensating for. Having met the problem once, the test then asserts the English form
  character for character.
- Severity: `uncertain` — what would need to be known is which Node builds this project is run on
  (`package.json` says only `node: >=20`) and whether their ICU data render `en`-`EUR` as
  `€400.50` on all of them. Nothing is asserted here; the point on the record is that the test
  treats one runtime's output as the definition.

---

## Noted, not raised as findings

- `credentials.test.js:4-7` — "The block below is not made up: it really was produced by
  `credentials.py`". A class that spans two languages, pinned with evidence rather than with a
  re-implementation. The best thing in this directory.
- `credentials.test.js:33-47` asserts, as the specification, that every malformed credential block
  returns exactly `false` — which is the collapse recorded as finding 2 of
  `findings/sso-credentials.md`. Distinguishing "we could not check" from "wrong password" would
  make this test fail, so the defect is written down as the requirement.
- `sessions.test.js:43-53` and `tickets.test.js:28-34` test the expiry only with offset-carrying
  timestamps (`…Z`) and with unparseable ones. The middle member — a naked ISO string, silently read
  as local time — is the one finding 1 of `findings/sso-sessions-tickets.md` is about, and it is
  absent from both.
- `tickets.test.js:36-39` asserts `serviceOf("not an address") === null`, so the `null` outcome is
  specified here and handled by nobody (finding 2 of `findings/sso-sessions-tickets.md`).
- `api.test.js:481-483` — the comment says an empty pool is "the most direct way of being outside".
  It is also a configuration that cannot be loaded; see finding 3.
- Italian identifiers and values throughout, against the English rule: `api.test.js` `campi`,
  `tentativi`, `corpi`, `entrato`, `uscito`, `ripetuto`, `metodoSbagliato`, `iniziali`, `conservato`,
  `italiano`, `un-token-qualsiasi`, `sito-finto.example`, the section comment
  `/* --- le pagine e i biglietti */`; `credentials.test.js` `malfatti`, `password-di-prova`,
  `password-sbagliata`; `tickets.test.js` `biglietti`, `biglietto`; `sessions.test.js` `"domani"`;
  `i18n.test.js` `richiesta`, `vero`. A different `CLAUDE.md` rule from the one audited here, and
  the same list the earlier units have been accumulating.
- `configuration.test.js` and `i18n.test.js` exercise the **generated copies** under `src/commons/`.
  The originals are units 61 and 62; nothing here is attributed to the copy.
