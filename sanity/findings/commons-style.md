# commons-style

Path: `webtools/commons/style/commons.css`
(generated copies in `webtools/preanalyst/public/commons.css`, `webtools/sso/public/commons.css`,
`webtools/front-gate/public/css/commons.css`, each with `fonts/` beside it)
Examined: 2026-09-26

The three copies were diffed against the original on the day of examination and are identical.

Three hundred and fifty-five lines, and the parts that concern this audit are the decisions written
down rather than assumed. `:305` and `:355` both answer `prefers-reduced-motion`, once globally and
once for the loader's spinner, and the second keeps the colour that shows the thing is a spinner
rather than simply stopping it. `:67-73` removes the focus ring from links and keeps it on buttons
and fields, with five lines saying why and naming the exception (`a.btn` "is a link only in the
markup"): a member of the class treated differently, identified explicitly rather than by
resemblance. The header states what the file is for and, in the same breath, what it is **not** for
— "It holds only the parts that generalise… The styles specific to each site stay in its local
.css, loaded afterwards" (`:5-7`).

Two findings, and the first is the one flagged in passing at `findings/sso-runner.md` and deferred
to this unit.

---

## 1. The shared layout's own two classes are defined in no shared stylesheet

- `webtools/commons/templates/base.njk:52,70` — the distributed layout wraps every page in
  `<div class="site-shell">` and `<main class="page-main">`
- `webtools/commons/style/commons.css` — neither selector appears anywhere in the file
- The three definitions that exist, each in a file no deployer touches:
  - `webtools/sso/public/styles.css:6-7` —
    `.site-shell { display: flex; flex-direction: column; min-height: 100vh; }`,
    `.page-main { flex: 1; display: flex; align-items: center; }`
  - `webtools/preanalyst/public/styles.css:12-13` — the same `.site-shell`,
    `.page-main { flex: 1; }`
  - `webtools/front-gate/public/css/styles.css:6,9` — `.site-shell { min-height: 100vh; }` and
    `.page-main { overflow: clip; }`, with no flex column at all
- Shape: **6 — world narrowed to fit the code**
- Class: **the subsystems that receive `base.njk`.** The markup is shared, distributed by
  `template_deployer`, and carries class names that are part of the contract as much as the block
  names are. The rules that make that markup a page — the column that fills the viewport, the main
  region that takes the slack so the footer sits at the bottom — are written once per subsystem, in
  the local stylesheet, which is precisely the file the header of `commons.css` says is for "the
  styles specific to each site".
- Two things follow, and both are visible today. A new subsystem added to `template_deployer`
  receives the shell and no layout for it: the page renders, the footer floats up under the
  content, and nothing anywhere connects the missing rules to the markup that arrived. And the
  three that exist already disagree — the sticky-footer column is in two of them and not in the
  third — so "the shared layout" does not lay out the same way on the three sites, without that
  ever having been decided.
- The front-gate is the interesting member: it does **not** use `base.njk`
  (`template_deployer/deploy.sh:10-11`, it "has a shell of its own") and it uses the same two class
  names anyway. So the names have escaped the artefact that defines them and are now a convention
  held by nothing.
- Severity: `latent` — a new subsystem, or a change to the shell's markup with two of the three
  stylesheets updated.
- Smallest generalising change: put `.site-shell` and `.page-main` in `commons.css`, beside
  `.container` and `.section` (`:78-80`), which are the shared layout's other classes and are
  already there. The local stylesheets keep what is local — the sso's centred card, the
  front-gate's `overflow: clip` — and stop re-deciding what the shell is.

---

## 2. The file states its distribution as one recipient's arrangement, while the mechanism it uses is general

- `webtools/commons/style/commons.css:9-10` — "Distribution: this file is served as
  **css/commons.css**, with the fonts next to it in **css/fonts/**."
- What the deployer actually does (`webtools/configurator/style_deployer/deploy.sh:13-43`):
  `front-gate/public/css/` — so `/css/commons.css`, matching the comment;
  `preanalyst/public/` and `sso/public/` — so `/commons.css`, with the fonts at `/fonts/`
- `webtools/commons/templates/base.njk:47` — the shared layout asks for `/commons.css`, which is
  the two the comment does not describe
- Shape: **6 — world narrowed to fit the code**
- Class: **the places this stylesheet is served from.** Three, and the sentence describes one. The
  file's actual mechanism is right for all three and right on purpose: `@font-face src:
  url("fonts/…")` (`:14-17`) is **relative to the stylesheet**, so the fonts are found wherever the
  pair is put, and `style_deployer` copies the directory beside the file every time. The code
  generalises; only the sentence describing it does not.
- It matters because this is the sentence somebody adding a fourth recipient will read to find out
  where the file goes, and it will tell them a path that two of the three existing recipients do
  not use — and `webtools/commons/templates/base.njk:47`, which is the thing that has to agree,
  names the other one.
- Severity: `stylistic`
- Smallest generalising change: say the rule instead of the instance — "served beside the page's
  own stylesheet, with `fonts/` next to it; the path differs per subsystem and the font URLs are
  relative for that reason" — which is what the file already does and does not claim.

---

## Noted, not raised as findings

- `:67-73` — the focus ring kept on buttons, fields and checkboxes and removed from links, with the
  reason ("a vermilion rectangle around a word in the middle of a sentence is more visible than the
  link itself") and the exception named. It is a decision about a class of users — people
  navigating by keyboard — argued rather than drifted into, and a link that shows no focus at all
  is a cost that argument accepts. Whether the trade is right is a question about accessibility,
  not about the audited rule.
- `:305,355` — `prefers-reduced-motion` answered twice. The file has no `prefers-color-scheme`, so
  the palette is light-only: one user preference served, another not. Choosing a single palette is
  a design decision, unlike dropping a locale, and it is not recorded as a departure.
- `:19-48` — every colour, family, radius and shadow is a token on `:root`, so the local
  stylesheets extend a vocabulary rather than repeating values.
  `webtools/sso/public/styles.css` and the other two use `var(--surface)`, `var(--ink)` and the
  rest throughout. The part of the shared style that generalises does generalise; finding 1 is
  about the two classes that were left out of it.
- `:46` — `--grain` is a `data:` URL carrying an SVG filter, so the page's texture needs no second
  request and no file for a deployer to forget. The opposite choice from `mark.svg`
  (`findings/commons-templates.md` 1), which is a file, in three copies, with no original.
- `:1-11` — the header says what the file holds, what it deliberately does not, and how it is
  distributed. It is the one shared original with no "DO NOT EDIT THE COPY" line, which is why
  three copies of it sit in the subsystems looking like local stylesheets; recorded at
  `findings/configurator-deployers.md` 3.
