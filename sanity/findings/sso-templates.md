# sso-templates

Paths: `webtools/sso/templates/login.njk`, `webtools/sso/templates/register.njk`
Examined: 2026-09-25

**Nothing to report against the class rule.**

Two short pages, both extending the shared layout, both with every value coming from outside written
through `{{ }}` and therefore escaped by nunjucks — which the comment at `login.njk:6-7` states as
the reason for the arrangement rather than leaving it to be noticed.

What was checked:

- **Every value from outside goes through escaping.** `next` (`login.njk:19,35`,
  `register.njk:15`) and `username` (`login.njk:23`) are the only ones, and there is no `| safe`
  anywhere in either file. In the two places where `next` lands in an `href` it is passed through
  `| urlencode` first, so it is encoded for the position it occupies (a query value) and not merely
  for HTML.
- **The optional parts of the layout are left absent, not filled in.** `commons/base.njk:13-22`
  declares `description` and `home_link` optional; neither page sets them, and the layout has a
  branch for each (`base.njk:40-45,55-65`). That is the rule's second clause honoured on both
  sides — what only part of the class offers is optional, and nothing is put in its place. The
  required variables (`title`, `locale`, `t`, `locale_switch`) are all supplied by
  `page.js:41-59` through `pageContext`.
- **No text in the templates.** Every visible string is a catalogue key under `sso.login.*` /
  `sso.register.*`; no Italian, no hard-coded sentence, no per-language template.
- **Nothing opens by itself**, and there is no script block: both pages are one form and two links.
- `register.njk` states, in its comment and on the page, that registration is not open. A page that
  says a thing does not exist yet is not an invented value: the absence is shown as an absence.

---

## Noted, not raised as findings

- `sso.login.title` is resolved twice — in `page.js:44` for `<title>` and again in `login.njk:13`
  for the heading. Harmless (it is one key used in two positions), recorded because a page that
  needed the two to differ would have to change both files.
- The two members of the error class — `invalid_credentials` (the user's) and `unavailable` (ours) —
  are shown with the same `notice notice-warn` presentation. A presentation choice, not a class
  defect; the decision about *which* text is shown is `page.js:49`, recorded as finding 5 of
  `findings/sso-settings-index-page.md`.
- `commons/base.njk` under `webtools/sso/templates/` is a generated copy and is byte-identical to
  `webtools/commons/templates/base.njk` (verified with `diff`). It is audited at the original, unit
  66.
