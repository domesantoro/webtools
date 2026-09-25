# preanalyst-page

Path: `webtools/preanalyst/src/page.js`
Examined: 2026-09-25

Prepares the data the templates render; no HTML is built here, which is the rule and is followed.
Two places in this file are the rule applied deliberately well and are worth naming, because they
are the standard the findings are measured against:

- `optional()` at `:231` uses `ui.has()` so that a hint or a placeholder the catalogue does not
  carry is simply absent, rather than being filled with the key or an empty string.
- `summaryData` at `:175-178`: "If the discount is there but the percentage could not be read
  again, we stay silent instead of writing a discount with no number." That is exactly the
  distinction between absent and zero that the provider files get wrong.

---

## 1. The catalogue of upload error codes is a list of the codes this file knew about, but the class is open

- `webtools/preanalyst/src/page.js:268-281` (`UPLOAD_ERRORS`) and `:283-290` (`uploadMessages`)
- Shape: **1 — what only part of the class has, treated as the whole**
- Class: **the error codes `POST /upload` can answer with.** Twelve are listed. The route does not
  own them all: at `webtools/preanalyst/src/server.js:246` it answers
  `fail(400, stored.code)`, passing through whatever the **workspaces** subsystem rejected the
  specification with. Workspaces declares its own set
  (`webtools/webtools-workspaces/src/server.js:18-29`), and four of the ones it can return on a
  400 are not in this list: `SPEC_TOO_LARGE`, `EMPTY_SPEC`, `INVALID_ORIGIN`, `MISSING_UPLOADER`.
  The list was drawn from the codes this file raises itself, and a pass-through was not part of
  that picture.
- What breaks, and on what entitled change: `upload.max_bytes` (preanalyst, 10485760) and
  `storage.spec_max_bytes` (workspaces, 10485760) are two independent configured values in two
  different documents that happen to be equal today. Lower the workspaces one — an ordinary
  operational edit, and the obvious one if disk fills — and every file between the two limits
  passes the preanalyst's check, is refused by workspaces, and arrives at the browser as a code
  with no text.
- **The damage is contained downstream**, and this should be said plainly rather than overstated:
  `webtools/preanalyst/public/upload.js:168-170` does `texts.errors[code] || texts.failed`, so an
  unknown code becomes the generic failure message instead of breaking the page. The defect is
  that a user who is told nothing more than "it failed" cannot act, when the system knew exactly
  what was wrong.
- Severity: `latent`
- Smallest generalising change: derive the list from the codes the route can actually answer,
  pass-throughs included, rather than from the ones raised in this subsystem.

## 2. Turns used are computed by halving the message count

- `webtools/preanalyst/src/page.js:198` (`Math.floor(chat.messages.length / 2)`) and `:211-212`,
  where it becomes `used` and `total`
- Shape: **6 — the world narrowed to fit the code**
- Class: **the chat histories a project may hold.** The arithmetic is correct only if the messages
  are strictly alternating pairs of exactly two roles. That holds today because
  `webtools/preanalyst/src/server.js:741-752` pushes both messages in one write — and it is the
  third appearance of the same assumption, after `analyst.js:68` and `analysis_validator.js:99`.
- What breaks: any entry that is not half of a pair — a third role, a note, a client message
  stored without its reply — makes `used` wrong, and with it `total`, which is what the page shows
  as the turn counter. The counter is the thing the client watches before deciding to buy more
  turns, so it is not a cosmetic number.
- Note that the derivation was chosen for a good reason, stated at `:196-199`: with bought turns
  `max_turns` is no longer the total. The reason is sound; the way of getting there assumes the
  shape of the history rather than reading a count.
- Severity: `latent`
- Smallest generalising change: count the turns actually spent — the step already writes
  `turns_left` on every turn and could as easily write what it spent — instead of inferring it from
  the length of the transcript.

---

## Noted, not raised as findings

- `:217` — `warn_when_left = maxTurns - warnFromTurn` goes negative for some legitimate
  configurations. Recorded as finding 2 of `findings/preanalyst-settings.md`; this is the
  consuming line.
- `:307` — `access.session.data?.screen_name ?? access.session.username` falls back to the username
  when there is no screen name. That is a second real name for the same person, not an invented
  value; not a finding.
- **Italian identifiers**, against the `CLAUDE.md` rule that everything internal is in English:
  `campi` (`:45`, `:48`, `:51`, `:53`, `:55`), `dati` (`:79`, `:82`), `colonna` (`:78`, `:80`),
  `usati` (`:198`, `:211`, `:212`), `codici` (`:261`, `:262`). A different rule from the one this
  audit enforces, recorded because it was read here.
