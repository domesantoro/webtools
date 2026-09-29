# commons-i18n-lib

Paths: `webtools/commons/i18n/webtools_i18n.js`, `webtools/commons/i18n/webtools_i18n_check.mjs`
(generated copies of the first in `webtools/{preanalyst,sso,front-gate}/src/commons/i18n/`; the
second is deliberately not distributed)
Examined: 2026-09-26

The three copies of `webtools_i18n.js`, and the `locales/` directories beside them, were diffed
against the originals on the day of examination and are identical.

`webtools_i18n.js` gets right the two things this audit has spent the run complaining about
elsewhere. `loadI18n:254-256` establishes a **cross-field** invariant — `fallback_locale` must be
among `locales` — and refuses to start otherwise; `readCatalog:65-69` establishes that every
configured locale has a catalogue file, naming the path in the message. Between them, the list of
languages in the configuration and the files on disk cannot silently disagree. And
`translate:157-167` answers "there is no text for this" by returning the key, "which is immediately
visible on the page", and logging it once: an absence shown rather than filled.

Three findings. One is in the library, two are in the checker that exists to keep raw keys off the
pages.

---

## 1. The cookie is matched in full and `Accept-Language` is truncated to its first subtag

- `webtools/commons/i18n/webtools_i18n.js:108` —
  `language: tag.split("-")[0].toLowerCase()`, so `pt-BR` becomes `pt`
- `webtools/commons/i18n/webtools_i18n.js:139-144` — `localeOf` compares the **cookie** against
  `this.locales` with no truncation (`:141`), and the truncated `Accept-Language` languages with
  `includes` (`:142`)
- The same exact comparison again at `:237` (`readChange`) and at `:191` (`choices`), both on full
  codes
- Shape: **6 — world narrowed to fit the code**
- Class: **the locale codes `i18n.locales` may hold.** Two today, `en` and `it`, both of which are
  a single subtag, so the truncation is invisible. Add `pt-BR`, `zh-Hant` or `en-GB` — the ordinary
  way this product grows, and the same class as
  `findings/anagraphics-main.md` 3 — and the three paths that read the cookie, the form and the
  switcher all work, while the one that reads the browser's own statement of preference stops
  working entirely: `pt-BR` is truncated to `pt`, `pt` is not in `locales`, no candidate matches,
  and the fallback is used. A browser configured for exactly the language on offer is given
  English.
- The truncation is not wrong in itself — it is what makes `it-IT` match `it`, which is the case
  the comment at `:100` illustrates. What is wrong is that it is the **only** comparison: the full
  tag is never tried first, so the function can match a general locale from a specific header and
  not a specific locale from the same header.
- Severity: `latent` — one locale added, which is a change the product exists to make.
- Smallest generalising change: try the full tag before the truncated one — two lines in the `find`
  at `:142` — so that `pt-BR` matches `pt-BR` when it is offered and `pt` when it is not.

---

## 2. The checker states that its second check covers composed keys, and it cannot

- `webtools/commons/i18n/webtools_i18n_check.mjs:13-15` — "Keys composed at runtime
  (`preanalyst.messages.${kind}.title`, the questions in questions.js) are invisible from here:
  **point 2 covers them, because they all start from English**."
- `webtools/commons/i18n/webtools_i18n_check.mjs:5-11` — point 1 is "keys used in the code and
  missing from the fallback catalogue", the one that exits 1; point 2 is "English keys missing from
  another language", explicitly "a worklist for whoever translates, not an error"
- `webtools/commons/i18n/webtools_i18n_check.mjs:30` — `KEY_CALL` matches only a **string literal**
  inside `t(`, `t_html(` or `has(`
- Shape: **6 — world narrowed to fit the code**
- Class: **the ways a key reaches `translate`.** Two: written out, and composed. Point 1 covers the
  first. Point 2 compares one catalogue against another and never asks whether a key is *used*, so
  it cannot say anything about a key that is missing from English — which is precisely the failure
  point 1 exists to catch, and precisely what puts a raw dotted key on a page. The sentence
  explains why a composed key **present** in English will be noticed as missing from Italian; it is
  offered as a reason why the composed case is covered, and the case that matters is the other one.
- The blind spot is not a corner. Eleven call sites compose their key today:
  `webtools/preanalyst/src/page.js:157,158,246,252,255,295,296` — the messages, every question's
  legend, label and option, the upload's statuses and errors —
  `webtools/sso/src/page.js:49` — every login error — and
  `webtools/preanalyst/templates/macros/fields.njk:15,27,46`, where the key is a variable. Those
  are the majority of the text on the two subsystems that talk to a client, and none of it is
  checked.
- Severity: `latent` — nothing is asserted about whether any of those keys is missing today; what
  is asserted is that the check reports `0` for a class it cannot see, under a comment saying it
  is covered.
- Smallest generalising change: say what is true — that composed keys are not checked — and, if
  the coverage is wanted, have the checker take the *prefixes* it can see
  (`preanalyst.messages.`, `preanalyst.upload.errors.`) and report the English keys under them, so
  a person can compare them against the codes the code can produce.

---

## 3. The subsystems that have pages are a hand-written list inside the checker

- `webtools/commons/i18n/webtools_i18n_check.mjs:28` —
  `const SUBSYSTEMS = ["front-gate", "preanalyst", "sso", "commons/templates"];`
- Shape: **6 — world narrowed to fit the code**
- Class: **the places a translation key can be used.** The list is the set of directories the
  checker walks, written out once, with nothing reconciling it against anything. It is the same
  shape as `webtools/configurator/start.sh:38-44` and `stop.sh:22-28`
  (`findings/configurator-start-stop.md` 1): an enumeration of a class of subsystems, maintained by
  memory.
- The reconciliation that would catch a mistake exists one directory away and is not used: the set
  of subsystems that receive the i18n module is decided by
  `webtools/configurator/i18n_deployer/deploy.sh:26-45`, which lists the same three names. Two
  lists of the same three subsystems, in two files, and a new recipient added to one of them is not
  added to the other by anything.
- The failure is quiet in the way that matters for a checker: a subsystem missing from the list is
  not reported as unchecked, it is reported as having no keys, and the final line
  ("`N` keys used in full, `M` in the en catalogue") still says the check passed.
- Severity: `latent`
- Smallest generalising change: derive the list from the deployer's targets, or walk
  `webtools/*/` and skip what has no `templates/`, so that "this subsystem is not checked" has to
  be a decision rather than an omission.

---

## Noted, not raised as findings

- `:254-256` — `fallback_locale` must be among `locales`, checked at load and refused with both
  values in the message. A relationship between two configured fields, established at the boundary
  that reads them. The audit has recorded several places where such a relationship is assumed; this
  is the one where it is enforced.
- `:65-69` — a locale in the configuration with no catalogue file stops the subsystem, naming the
  path. The reverse — a catalogue file not listed in `locales` — is silently not offered, which is
  the honest reading (a translation in progress is not a language on offer) and is not stated
  anywhere.
- `:90-93` — a `{placeholder}` with no matching variable is left on the page as `{mb}` rather than
  replaced with an empty string. Absent shown, not invented, in the same spirit as `translate`
  returning the key.
- `:95-98` — `escapeHtml` passes a `nunjucks.runtime.SafeString` through unchanged and escapes
  everything else, so a value the template has already marked safe is not double-escaped while a
  value from outside always is. The distinction between the two kinds of value is made explicitly,
  which is what `:44-47` promises.
- `:223-245` — `readChange` "does not answer: it tells the caller what to answer, so every server
  uses its own responses". The boundary between the shared logic and the three servers stated in
  the shared half. The consequence is that what to do with the connection after a `413` is each
  server's decision, and `webtools/webtools-workspaces/src/server.js:49-61` is the only place in
  the repository that has thought about it.
- `:243` — a `return_to` that fails `SAFE_PATH` becomes `/`, so "no return address" and "a return
  address we will not use" are the same outcome. A redirect has to go somewhere, so this is the
  defensible kind of substitution; the reason for the pattern is written at `:57-59` and the reason
  for the fallback is not.
- `:178-186` — `Intl.NumberFormat(locale, …)` with a bare locale code. The `uncertain` about which
  ICU data a given Node build carries is already on the list in `summary.md`
  (`webtools/sso/tests/i18n.test.js:50-51`); not re-raised.
- `webtools_i18n_check.mjs:17` — "This is not distributed to the subsystems: it runs on the
  original", and `:27` — "the original is looked at, not the copies in src/commons", enforced by
  the skip at `:43`. A tool that knows the difference between an original and a copy, in a
  repository where that difference is load-bearing.
