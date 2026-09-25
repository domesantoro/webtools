# preanalyst-template-analysis

Path: `webtools/preanalyst/templates/analysis.njk`
Examined: 2026-09-25

The analysis page. Structurally this template is careful in the way the rules ask: no HTML is
composed in JavaScript (the two message models are `<template>` elements at `:190-201`, cloned and
filled with `textContent`), every user-facing string comes from the catalogue, the warning and the
out-of-turns box are rendered switched off rather than written by the browser, and the
turns-exhausted state is decided server-side at `:78` and `:112` so the page never flashes a field
that cannot be used. One finding, and it is the same one as elsewhere.

---

## 1. The fourth place that assumes the chat has exactly two roles

- `webtools/preanalyst/templates/analysis.njk:60` and `:61` —
  `{{ "client" if messaggio.role == "client" else "system" }}`
- Shape: **6 — the world narrowed to fit the code**
- Class: **the roles a stored chat entry may carry.** Same class as `analyst.js:68`,
  `analysis_validator.js:99` and `page.js:198`; this is the fourth independent site that encodes
  "two members, one of which is `client`", and the only one that decides what the *client sees*.
- What breaks: an entry with a third role is displayed to the client with the system's name and
  the system's styling — it is attributed to webtools. Of the four sites this is the one where a
  wrong attribution is visible to the person who matters, and it is also the one that would be
  noticed last, because a page that renders is a page that looks fine.
- Severity: `latent`
- Smallest generalising change: as elsewhere — render only the roles that have a name and a style,
  and let an unknown one be conspicuous rather than absorbed.

---

## Noted, not raised as findings

- `:8-11` — the template's own header says "TODAY ONLY THE ANSWER IS FAKE: the server picks it from
  a fixed list in the catalogue." That has not been true since the analyst was built: the answer
  comes from `ask()` in `webtools/preanalyst/src/analyst.js`, through
  `webtools/preanalyst/src/server.js:695`. The same stale claim is repeated at
  `webtools/preanalyst/src/page.js:189`. A comment that describes behaviour the code no longer has
  is the next reader's wrong premise; not a class defect, recorded because it was read here.
- `:59` — `messaggio` is an Italian identifier, against the `CLAUDE.md` rule that everything
  internal is in English. A different rule.
- `:98`, `:114`, `:176` — these consume `chat.total` and `chat.used`, which are derived by halving
  the transcript length. Recorded as finding 2 of `findings/preanalyst-page.md`.
