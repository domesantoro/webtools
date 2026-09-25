# preanalyst-styles

Path: `webtools/preanalyst/public/styles.css`
Examined: 2026-09-25

The pre-analysis and analysis pages' local style. The file is disciplined about its boundary — it
says at the top that the tokens, header, cards, buttons and fields come from `commons.css`, which is
a generated copy, and it does not redefine them. It also handles `prefers-reduced-motion`
(`:566-568`), which is a user preference treated as a real member of a class rather than ignored.

---

## 1. The shared header's height is restated here as a local constant

- `webtools/preanalyst/public/styles.css:7-10` — the comment "The site's header is sticky
  (commons.css): 72px of minimum height plus 1.5px of border", and
  `:root { --header-height: 74px; }` — consumed at `:50`, `:53` and `:520`
- Shape: **6 — the world narrowed to fit the code**
- Class: **the heights the shared header may actually have.** `commons.css` sets
  `.header-inner { min-height: 72px }` (original:
  `webtools/commons/style/commons.css:218`). A *minimum* height is a floor, not a value: a longer
  brand or nav wrapping at some width, or a larger base font from the reader's own settings, makes
  the real header taller. This file turns that floor into a fixed 74 and positions three sticky
  elements against it.
- What breaks, and on what entitled change: the number is now written in three places —
  `webtools/commons/style/commons.css:218` (the `min-height`), `:309` (the mobile nav's `top: 72px`,
  the same measurement again), and here as the derived 74. Editing the header in
  `webtools/commons/style/` and running the style deployer — the documented way to change a shared
  part — updates the first two and leaves this one behind. The sticky column then either overlaps
  the header or floats below it, on a page nobody thought they had touched.
- Severity: `latent`
- Smallest generalising change: let `commons.css` publish the header's height as a token, since it
  is the boundary that owns the header, and have this file consume it instead of measuring it.

## 2. The fifth place that assumes the chat has exactly two roles

- `webtools/preanalyst/public/styles.css:340-342` — `.chat-turn-client` and `.chat-turn-system`,
  the only two turn styles
- Shape: **6 — the world narrowed to fit the code**
- Class: **the roles a stored chat entry may carry.** After `analyst.js:68`,
  `analysis_validator.js:99`, `page.js:198` and `templates/analysis.njk:60`, this is the fifth
  independent place encoding two members. Here the consequence is only that a third role would be
  unstyled — the mildest of the five — and it is recorded for completeness, because the count is
  the point: the assumption is now spread across the whole subsystem rather than held in one place.
- Severity: `stylistic`
- Smallest generalising change: none needed in this file on its own; it follows whatever the code
  decides.

---

## Noted, not raised as findings

- There is no `prefers-color-scheme: dark` anywhere in this file or in `commons.css`, so the pages
  are light-only. Given that `prefers-reduced-motion` *is* honoured, this reads as a design
  decision rather than an oversight, and a light-only site is a legitimate design. Recorded so the
  absence is on the record as observed rather than missed.
- `:37` — `.gate-layout-single` exists so the form does not widen across the page when the
  right-hand column is empty. That is the empty case treated as a real case rather than as a
  degenerate one; the opposite of what this audit hunts.
