# commons-templates

Paths: `webtools/commons/templates/base.njk`, `webtools/commons/templates/loader.njk`,
`webtools/commons/templates/locale_switch.njk`
(generated copies in `webtools/{preanalyst,sso}/templates/commons/`; the front-gate receives
`locale_switch.njk` only)
Examined: 2026-09-26

All copies were diffed against the originals on the day of examination and are identical.

One hundred and twenty-five lines across three files, and `base.njk`'s header (`:1-33`) is the
model of what a shared artefact's contract should look like: the variables split into **required**
and **optional** with a sentence each, the five blocks listed, where the required ones come from
(`i18n.pageContext`), and why the stylesheets are requested with absolute paths — "pages may live
under any path (/ui/login, for instance), and with a relative path the browser would look for them
next to the page, where they are not" (`:31-33`). That is a partial-class property reasoned about
and written down at the boundary.

The optional variables are handled exactly as the rule asks: `description`, `noindex` and
`home_link` are each wrapped in an `{% if %}` and nothing is put in their place when they are
absent — no empty `<meta>`, no `#` href, no placeholder (`:40-45,55-65`).

Two findings.

---

## 1. The shared layout requires a file that the shared-parts mechanism does not distribute

- `webtools/commons/templates/base.njk:46` —
  `<link rel="icon" href="/assets/mark.svg" type="image/svg+xml">`
- What exists: `webtools/preanalyst/public/assets/mark.svg`,
  `webtools/sso/public/assets/mark.svg`, `webtools/front-gate/public/assets/mark.svg` — three
  files, byte-identical (md5 `adbf6c93…` for all three)
- What does not exist: any `mark.svg` under `webtools/commons/`, any deployer that copies one, and
  any row for it in the table at `webtools/configurator/README.md:140-147`
- Shape: **6 — world narrowed to fit the code**
- Class: **the subsystems that receive `base.njk`.** The template is distributed by
  `template_deployer` to whoever renders pages, and it names an absolute URL that the receiving
  subsystem must serve. The stylesheet it names on the next line is distributed by
  `style_deployer`; the fonts that stylesheet needs are distributed with it, and the deployer even
  rebuilds the `fonts/` directory so a removal propagates (`style_deployer:18-19`). The brand mark
  is the one thing in the shared layout that arrives by somebody remembering.
- The failure has the shape that makes this worth recording rather than filing under tidiness. A
  new subsystem added to `template_deployer` — which is the documented procedure,
  `webtools/configurator/README.md:226-230`, and which says nothing about assets — receives the
  layout, renders it, and serves a page whose favicon is a 404. Nothing reports it: the page works,
  the tab is blank, and the file the layout asked for is not one the deployer knows about. In the
  other direction, changing the mark means editing three files that no tool relates to each other,
  and the repository's own answer to that situation — "the original lives in `webtools/commons/`,
  and inside the subsystems there are **generated copies**" (`CLAUDE.md`) — has simply not been
  applied here.
- This is the same shape as finding 1 of `findings/sso-runner.md` (five copies of one script, no
  original), with one difference that makes it sharper: there the copies are referenced by nothing,
  here a **distributed** file names the copy by its URL, so the dependency is written down in
  `webtools/commons/` and the thing depended on is not.
- Severity: `latent` — it takes a new subsystem receiving the layout, or an edit to the mark.
- Smallest generalising change: `webtools/commons/style/assets/mark.svg` as the original and a line
  in `style_deployer` (which already copies a directory into each subsystem's static files) —
  three lines, and the row in the README's table that makes it findable.

---

## 2. The one required scalar is the one whose absence says nothing

- `webtools/commons/templates/base.njk:13-14` — "title **required**: it ends up in `<title>`,
  followed by ` — webtools`"
- `webtools/commons/templates/base.njk:39` — `<title>{{ title }} — webtools</title>`
- The other required variables, `:18-22` — `locale`, `t`, `locale_switch`: `t` is **called**
  (`:56,58,63`), so its absence is a render error naming it; `locale_switch.choices` is iterated
  in `locale_switch.njk:16`, so its absence is a render error too
- Shape: **5 — only the success path**
- Class: **the pages that extend this layout.** The header divides its variables into required and
  optional, which is the right division and the one the rule asks for. In the template body the
  division does not exist: the optional ones are guarded by `{% if %}`, and `title` — declared
  required — is interpolated bare. Nunjucks renders an undefined value as the empty string, so a
  page that forgets it produces `<title> — webtools</title>`: a valid page, indexed, bookmarked
  and shown in the tab as a dash.
- The contrast within the same header is what makes it a finding rather than a nitpick. Three of
  the four required variables cannot be forgotten, because the template uses them in ways that
  fail. The fourth can, and it is the one that is visible to a search engine and to the user's
  history rather than to a developer.
- Severity: `stylistic` — the code is correct for every page that exists today (all of them pass a
  title); the shape is what invites the defect.
- Smallest generalising change: `{{ title }}` becomes something that says so when it is not there —
  in a template the cheapest form is `{{ title if title else t("common.error.no_title") }}`, or
  rendering with nunjucks' `throwOnUndefined`, which would turn all four required variables into
  one rule instead of three-and-a-half.

---

## Noted, not raised as findings

- `base.njk:40-45,55-65` — `description`, `noindex` and `home_link` are each absent-or-present with
  nothing substituted: no empty meta tag, no `href="#"`, and the brand becomes a `<span>` rather
  than a link pointing nowhere (`:60-64`). Four decisions, all of them "absent is absent".
- `base.njk:35` — `<html lang="{{ locale }}">` takes the configured locale code straight into the
  `lang` attribute, as `webtools_i18n.js:180` takes it into `Intl.NumberFormat` and
  `webtools/preanalyst/src/analyst.js:100` takes it to a model. The `uncertain` about bare locale
  codes is already on the list in `summary.md`; this is a fourth consumer of the same value and is
  not re-raised.
- `base.njk:61` — `aria-label="webtools"`, an English literal where `:56` uses
  `t('common.brand.home')` for the same purpose in the other branch. It is the trademark rather
  than a sentence, and the rule it touches (text addressed to the user lives only in the
  catalogues) is not the one under audit.
- `locale_switch.njk:14-15` — the `return_to` is a hidden field rendered through autoescaping and
  then validated on the way back by `webtools_i18n.js:243` against `SAFE_PATH`. A value that
  leaves the server and comes back, checked on return rather than trusted.
- `locale_switch.njk:9-12` and `loader.njk:8-16` — both say what they need (`t`,
  `locale_switch`; `t` and the `data-webtools-loader` marker and the script that reads it) and
  which deployer puts them there. Every file in this unit states its own contract; `base.njk`'s is
  the most complete and is the one finding 2 is about.
- `loader.njk:18` — `role="status" aria-live="polite" aria-hidden="true"`; the script keeps
  `aria-hidden` in step with the visual state. Recorded at `findings/commons-loader.md`.
