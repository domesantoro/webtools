# front-gate-templates

Paths: `webtools/front-gate/templates/layout.njk`, the seven page templates,
`templates/partials/{header,footer,start}.njk`
Examined: 2026-09-25

356 lines of templates with no text in them — every visible string is a key under `front_gate.*` —
and no `| safe` anywhere: the two values that come from outside the templates (`preanalystUrl`,
`standardPrice`) are written through `{{ }}` like everything else. The findings are about what the
showcase site shares with the other subsystems and what it has written again for itself.

---

## 1. The shared shell is re-implemented here, and the rule it states is the one broken

- `webtools/front-gate/templates/layout.njk:14-33` and `partials/header.njk:9-24`, against
  `webtools/commons/templates/base.njk`
- Shape: **6 — world narrowed to fit the code**
- Class: **the webtools sites.** `commons/templates/base.njk:2` says it is "the shared layout of the
  webtools sites", and the sso, the preanalyst and workspaces extend it. The front-gate does not: it
  has its own `<!doctype>`, its own `<head>`, and its own copy of the brand markup — the same
  `brand` / `brand-mark` / `brand-stack` classes and the same `common.brand.tagline` key, kept in
  step with the original by hand, in two files that do not know about each other.
- The cost is visible in the one line where the two disagree. `base.njk:31-33` states a rule and
  its reason: "Stylesheets are requested with **absolute** paths: pages may live under any path
  (/ui/login, for instance), and with a relative path the browser would look for them next to the
  page, where they are not." `layout.njk:21-23,31` uses `assets/mark.svg`, `css/commons.css`,
  `css/styles.css`, `js/main.js`, and `header.njk:11,17,21` and `footer.njk:8-9` link between pages
  the same way. It works, and it works for exactly one reason: every address in `PAGES`
  (`src/page.js:21-30`) is at the root. The first page put under a path — `/esempi/tracker.html`, a
  language prefix, anything — loads no stylesheet and no script, and the site looks broken rather
  than erroring.
- This is the audited rule in its plainest form: the arrangement that works for the addresses in
  front of the author, with the general rule already written down two directories away.
- Severity: `latent`
- Smallest generalising change: absolute paths here, which costs four characters; and, separately,
  a decision about whether the showcase site is a member of the shared-layout class or not.

## 2. The set of pages is declared three times

- `webtools/front-gate/src/page.js:21-30` (address → template),
  `templates/partials/header.njk:2-8` (the menu), `templates/partials/footer.njk:8-9` (the footer
  links), plus the `{% set page = … %}` in each of the seven templates
- Shape: **3 — member logic outside its boundary**
- Class: **the pages of the site.** Adding one means editing a template, a routing table, a menu
  list and a footer, and the four are joined by a string (`"contatti"`, `"che-cos-e"`) that nothing
  checks: `page` is set by the page itself and compared in two partials, so a typo in the `{% set %}`
  does not highlight the menu item and does not remove the self-link from the footer, silently and
  identically in both places. A page added to `PAGES` and not to the menu is reachable and invisible;
  one added to the menu and not to `PAGES` is a 404 in the navigation.
- Severity: `latent`
- Smallest generalising change: one list — the pages, with their template, their address and their
  menu label — read by the router and by the partials, so that a page is one entry.

## 3. A meta description is emitted whether there is one or not

- `webtools/front-gate/templates/layout.njk:20` —
  `<meta name="description" content="{{ description }}">`, unconditional
- Shape: **2 — invented value**
- Class: **the pages that may extend this layout.** All seven set `description` today; a page that
  does not gets `content=""`, which is not the same as having no description and is worse for the
  one purpose the tag has. The shared layout got this right and guards both optional tags
  (`commons/templates/base.njk:40-45`), and the header comment here calls `description` one of the
  things "the page sets", which is a requirement stated in a comment rather than in the template.
- Severity: `stylistic`
- Smallest generalising change: the `{%- if description %}` the shared layout already has.

---

## Noted, not raised as findings

- No text and no `| safe` in 356 lines of template, every string a catalogue key, and
  `quanto-costa.njk:4` interpolating the price through `t(..., { price: standardPrice })` rather
  than concatenating it. The i18n rule kept thoroughly.
- `partials/footer.njk:5` — `<span>*footer placeholder*</span>`: a literal placeholder, in English,
  written into the template rather than taken from a catalogue, and shown on every page of a public
  site. Not the audited rule (it is the "text only in the catalogues" rule, plus an unfinished
  page); recorded because it is visible to every visitor.
- `templates/commons/locale_switch.njk` is a generated copy, with "DO NOT EDIT THE COPY INSIDE A
  SUBSYSTEM" at the top. Audited at the original, unit 66.
- Each page opens its own `<main class="page-main">` inside the `main` block
  (`index.njk:7` and the six others), so the element that the stylesheet lays out belongs to the
  pages and not to the layout that owns the shell. A page that forgot it would lose the layout with
  no error; recorded as a smaller instance of finding 1.
- `partials/start.njk` states in its comment that the address comes from the configuration and that
  the server does not start without it — a dependency written where it is used.
