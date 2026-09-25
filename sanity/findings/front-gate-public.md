# front-gate-public

Paths: `webtools/front-gate/public/js/main.js`, `webtools/front-gate/public/css/styles.css`
Examined: 2026-09-25

Eighteen lines of JavaScript and 542 of CSS. The JavaScript is the mobile menu and nothing else, and
it is written for the class it can meet: it checks that both elements are there before binding
anything (`main.js:5`), it keeps `aria-expanded` in step with the class it toggles, and it closes the
menu from a delegated handler rather than from a list of links. One finding.

Much of the stylesheet indexes elements by position — `.metric:nth-child(2)`, `.book:nth-child(5)`,
`.data-row:nth-child(4)`, `.board i:nth-child(n+5)`. That is **not** a finding: the markup those
selectors style is a drawing, written out literally in `index.njk:31-36` and in `esempi.njk`, of a
tool that does not exist. A picture is allowed to know how many strokes it has. They would be
findings the moment any of that markup came from a loop.

---

## 1. Colour decided outside the place that owns colour

- `webtools/front-gate/public/css/styles.css` — `#5b1f24` (three times), `#e7b3a3` (twice),
  `#d9d2c4`, `#b5cdb9`, `#8a6a48`, `#2b5a40`, sitting beside `var(--accent)`, `var(--sage-soft)`
  and the rest
- Shape: **3 — member logic outside its boundary**
- Class: **the palette.** `webtools/commons/style/commons.css:19-35` declares sixteen colour tokens
  on `:root` and every shared rule uses them: that file is the boundary where "what colour this
  system is" is decided. Nine literals in a subsystem's stylesheet are decisions about the same
  question, taken outside it — and two of them (`#e7b3a3` next to `var(--accent-soft)`, `#b5cdb9`
  next to `var(--sage-soft)`) are visibly derived from tokens, which is the derivation done by hand
  and then frozen.
- What makes it matter rather than merely untidy: the tokens are the mechanism by which a change of
  palette — a second theme, a dark variant, a client-facing rebrand — reaches every page at once.
  Every literal here is a place the change will not reach, and the page will be almost right, which
  is harder to see than wrong.
- Severity: `latent`
- Smallest generalising change: a token for each of them in `commons.css`, even a
  subsystem-specific one; the file already holds sixteen and the cost of a seventeenth is one line.

---

## Noted, not raised as findings

- `main.js:5` — `if (!toggle || !nav) return;`. The script is loaded by a layout used by seven
  pages; on any of them the header could be different, and the script says so rather than assuming.
- `main.js:12-17` — delegation with `event.target.closest('a')`, so a link added to the menu later
  is handled without this file being touched. Written for the class.
- The menu's markup is the front-gate's (`templates/partials/header.njk:15-22`) and its script is
  the front-gate's, but its CSS is in the **shared** stylesheet
  (`webtools/commons/style/commons.css:221-234,309-314,320-322`), where `.main-nav` and
  `.menu-toggle` are rules for markup no other subsystem emits — `commons/templates/base.njk` has no
  menu. A member's styling inside the shared boundary, which is finding 1 turned around. Recorded
  against unit 67, where the class lives.
- `commons.css:14-17` declares the four `@font-face` sources with **relative** paths
  (`fonts/inter.woff2`), which is what lets one generated copy work both at `public/commons.css`
  (sso, preanalyst) and at `public/css/commons.css` (front-gate). The one place where the
  difference between the two layouts was thought about; contrast with finding 1 of
  `findings/front-gate-templates.md`.
- `public/webtools_loader.js` is deployed into this subsystem and referenced by no template here.
  Belongs to units 50 and 64.
- `commons.css:301-303` — `.reveal` is a pure CSS animation with no `prefers-reduced-motion` branch,
  so a visitor who has asked their system for less motion gets it anyway. A class of users, not a
  class of code, and the file is the shared one: recorded against unit 67.
- `styles.css:9` — `.page-main { overflow: clip; }`, a shared layout class restyled locally. Same
  matter as `.site-shell`; see `findings/sso-runner.md` and unit 67.
