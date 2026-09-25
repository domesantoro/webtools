# sso-credentials

Path: `webtools/sso/src/credentials.js`
Examined: 2026-09-25

The reader of the `credential` block that `webtools/anagraphics/webtools_anagraphics/credentials.py`
writes. It is one of the most class-minded files in the repository: the scrypt parameters are taken
from **the document**, not from constants here, and the reason is written down — "the day they are
raised, old passwords stay verifiable with their own" (`:8-9`, repeated in the Python module at
`:17-18`); an algorithm that is not the one known is refused rather than assumed (`:30`); the
comparison is constant-time, with the reason given. Three findings, one of which undoes the file's
own stated principle.

---

## 1. Every scrypt parameter comes from the document except the one that decides whether scrypt runs

- `webtools/sso/src/credentials.js:15` — `const MAXMEM = 64 * 1024 * 1024;`, with the comment
  "128 * n * r with n=16384 and r=8 makes 16 MB: Node's default is not enough", passed at `:57`
- Shapes: **6 — world narrowed to fit the code**, and **1 — partial-class requirement**
- Class: **the parameter sets a stored credential may carry.** The file is built so that the class
  has more than one member: that is the whole argument of `:8-9`. `n`, `r`, `p` and `dklen` are read
  from the document; `maxmem` is a constant, and it was computed from *today's* member. It is a
  ceiling on the memory scrypt is allowed to use, and scrypt needs roughly `128 * n * r` bytes — so
  the constant is not an independent limit, it is a function of the two values the file has just
  gone to the trouble of not assuming.
- The arithmetic: with `r = 8`, `n = 16384` needs 16 MB, `n = 32768` needs 32 MB, `n = 65536` needs
  64 MB, and `n = 131072` needs 128 MB and **exceeds the ceiling**. Raising the work factor is the
  one change the module's own comment anticipates, it is the ordinary response to faster hardware,
  and it is made in `credentials.py:31` — in the other subsystem, in the other language, with
  nothing there to say that a second constant must move with it (`credentials.py:33` holds its own
  `MAXMEM`, at the same value, which is what makes the two look independent).
- What happens then is the worst available outcome: `scrypt` throws, `:58-60` catches it, logs it,
  and returns `false` — and `false` from this function means *wrong password*. Every user whose
  password was hashed with the new parameters is told their credentials are invalid
  (`auth.js:57-59`, `INVALID_CREDENTIALS`), and there is no way to tell from the outside that the
  system stopped being able to check passwords at all. The raise would look successful on the
  machine where it was made and fail for everybody whose block was rewritten.
- Severity: `latent`
- Smallest generalising change: derive the ceiling from the parameters actually read
  (`128 * n * r`, with headroom), so it is one fact about the class rather than a photograph of one
  member. The same value hard-coded in `credentials.py:33` is also a value outside the configurator,
  against the `CLAUDE.md` configuration rule — noted below.

## 2. "Anything that does not add up is false" — including "we could not check"

- `webtools/sso/src/credentials.js:26-33,36-39,46-53,58-61` — six distinct refusals, one `false`;
  the caller at `webtools/sso/src/auth.js:57-59` then logs `wrong password (${username})`
- Shape: **2 — invented value**
- Class: **the outcomes of verifying a password.** There are three kinds, not two: it matches, it
  does not match, and *we were unable to tell* — an algorithm nobody here handles, parameters that
  are not there, a hash of the wrong length, scrypt refusing to run. The third kind is answered with
  the second, which is a statement of fact about the user's password that this function is not in a
  position to make.
- The collapse is deliberate at the door — `auth.js:22-26` argues, correctly, that the *client* must
  not learn which of four reasons applies. That argument is about the answer sent out over HTTP. It
  says nothing about the log line, which is written for the operator and which asserts the one
  member the function cannot distinguish: the six `console.error` lines above it carry the truth,
  but the line that names the event names it wrongly, and a log is read by searching for the line
  that names the event.
- This is also what makes finding 1 invisible rather than loud, and the same for a credential
  document written by a future writer that this reader does not understand.
- Severity: `latent`
- Smallest generalising change: return the three outcomes, keep sending one answer to the client,
  and let the operator's line say which of the three happened.

## 3. A decoder is trusted to validate, and the guard that actually validates looks redundant

- `webtools/sso/src/credentials.js:26-28` — "broken base64" named as one of the things the `try` at
  `:43-49` catches
- Shape: **4 — capability inferred from resemblance**
- Class: **the strings that may sit in `salt` and `hash`.** `Buffer.from(value, "base64")` does not
  refuse invalid input: it drops the characters it does not recognise and returns whatever is left,
  and it throws only when the argument is not a string at all. So of the class named in the comment,
  the `catch` covers the missing field and not the malformed one. What actually stops a malformed
  value is the length test at `:50` — a guard that reads like belt-and-braces and is in fact the
  only thing standing there.
- The behaviour today is right; the account of why it is right is not, and that is what makes it
  worth recording: the two lines are five apart, and the one that does the work is the one a tidying
  hand would remove.
- Severity: `stylistic`
- Smallest generalising change: say which check refuses what, or validate the encoding explicitly
  rather than relying on a decoder that repairs its input.

---

## Noted, not raised as findings

- `:30` — an unknown algorithm is refused, not guessed at, and the value that was found is logged.
  That is shape 4 avoided on purpose, and the reason the file is otherwise exemplary.
- **Passwords are compared as unnormalised UTF-8 bytes**, here and in
  `credentials.py:40` (`password.encode("utf-8")`). Nothing on either side normalises, so a password
  containing a character with more than one Unicode representation is a different password depending
  on the input method that produced it. Not raised as a finding because no code path in this
  repository sets a password yet — `build_credential` is called only from a script
  (`webtools/anagraphics/scripts/seed.py:49`) — so reaching it takes a deliberate choice of a
  non-ASCII password. Whoever builds registration decides this, and should decide it rather than
  inherit it.
- `credentials.py:33` and `credentials.js:15` hold the same memory ceiling as two independent
  constants in two languages, and `credentials.py:31` holds the parameters. All three are
  configuration by the `CLAUDE.md` rule (no constants in the code) and none of them comes from
  anagraphics. A different rule from the one this audit enforces; it is also the mechanism of
  finding 1.
- `webtools/sso/tests/credentials.test.js:5` — the fixture's password is Italian
  (`password-di-prova`, and `password-sbagliata` at `:27`), against the English rule. Belongs to
  unit 37.
