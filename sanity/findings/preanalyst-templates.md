# preanalyst-templates

Paths: `webtools/preanalyst/templates/page.njk`, `message.njk`, `login_done.njk`,
`macros/fields.njk`, `partials/*.njk`, `fragments/*.njk`
(`templates/analysis.njk` is unit 8; `templates/commons/` are generated copies)
Examined: 2026-09-25

The page and its parts. The templates are disciplined about the things this audit usually catches
elsewhere: no text outside the catalogues, values that carry markup passed through `t_html` with the
reason given (`partials/driver_box.njk:24-25`), a nested piece built with `{% set %}` and only then
marked `| safe`, so the driver's name is still escaped (`:33-36`), and every field kind the data
declares is rendered, including the two that no question uses yet (`macros/fields.njk:47-56`, see
`findings/preanalyst-questions.md`). Two findings.

---

## 1. The driver box enumerates the link states by hand, and has no branch for a state it does not know

- `webtools/preanalyst/templates/partials/driver_box.njk:26-46` — a chain of
  `{% elif box.link.state == "…" %}` over seven literal strings, ending in `{%- endif %}` with no
  `else`
- Shape: **6 — the world narrowed to fit the code**
- Class: **the states `src/driver_link.js` may produce.** That module is the boundary that owns
  them: it lists all nine in its header, exports each as a constant, and holds the two "recognised"
  ones in a set so that no one has to repeat the list (`src/driver_link.js:39-55`). Here the list is
  written again, as strings, and only seven of the nine appear — correctly, since `driver_applied`
  is the resolved branch above and `own_link` is handled in `partials/driver_work.njk:27-29`. The
  problem is not today's coverage, which is complete; it is that the coverage is a coincidence of
  two lists and that nothing happens when they stop matching.
- A tenth state — and `findings/preanalyst-driver-link.md` finding 1 asks for exactly that, to stop
  telling a client that a discount has expired when it could not be read — renders a box with the
  generic lead, no notice, and no sign that anything was meant to be said. The client sees a driver
  box that explains nothing; no error, no log line, nothing in a test.
- Severity: `latent`
- Smallest generalising change: give the chain an `else` that is visibly wrong (or let the server
  hand the template the sentence's key, which is the boundary that knows the state), so that an
  unhandled member cannot pass for a handled one.

## 2. The right-hand column is composed twice, and the two copies must agree by hand

- `webtools/preanalyst/templates/page.njk:88-92` and
  `webtools/preanalyst/templates/fragments/driver.njk:5` — the same three
  `{% if aside.<block>.show %}{{ …render(…) }}{% endif %}` in the same order
- Shape: **3 — member logic outside its boundary**
- Class: **the blocks the aside column contains.** The fragment exists precisely so that what the
  browser puts in place of the column after a login is what the server would have rendered
  (`fragments/driver.njk:1`). That guarantee is not expressed anywhere: it is two lists that happen
  to be identical. A fourth block, a changed order, or a condition that grows a term is a change in
  one file that leaves the other rendering the previous page — and the divergence only shows after a
  login, in the one path that is hardest to see.
- Severity: `stylistic` — the two agree today.
- Smallest generalising change: let the page include the fragment instead of repeating it, so there
  is one composition and the column cannot be rendered two ways.

---

## Noted, not raised as findings

- **A different rule, recorded so it is not lost**: `CLAUDE.md` requires everything internal to be
  in English, identifiers included. Four Italian identifiers live in these templates —
  `page.njk:3` (`campi`) and `:64-65` (`sezione`), `partials/driver_box.njk:33` (`chi`) and `:62`
  (`campo`). They match `codici` and `campi` in `src/page.js:262,45`, which belong to unit 7 and are
  recorded here only because the same hand wrote both. Not a class-vs-instance defect.
- `partials/rejection_dialog.njk:29,31` — the catalogue key is composed at runtime,
  `"preanalyst.rejection." ~ rejection.case ~ ".title"`. A key built this way is invisible to
  `webtools/commons/i18n/webtools_i18n_check.mjs`, which says so in its own header, and a key missing
  from English prints itself on the page (`webtools/commons/i18n/webtools_i18n.js:160-164`). The
  class of `rejection.case` values is small, closed and complete today
  (`src/server.js:1067-1076`, with `?? "not_recognised"` covering the rest), so this is the known
  limit of the checker rather than a defect here; `message.njk` reaches the same composed keys
  through `renderMessage` (`src/page.js:155-158`).
- `partials/access.njk:21-22,39-42` — three `target="_blank"` links without `rel="noopener"`, while
  `partials/driver_work.njk:41` has it. Not the rule being audited; recorded because it is the same
  kind of inconsistency as finding 2, in the same directory.
- `partials/upload_box.njk:15` — the browser's messages travel as a JSON attribute, autoescaped by
  nunjucks and parsed by `public/upload.js:31`. The reason ("the browser has no catalogues") is
  written where it is done, and the boundary is the right one.
- `login_done.njk:20-26` — both outcomes of the login round trip have a text, and the header says
  why the page has any text at all: "No window should be left speechless". A case handled because it
  was thought about, not because it occurred.
