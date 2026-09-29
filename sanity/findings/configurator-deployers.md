# configurator-deployers

Paths: `webtools/configurator/deploy.sh`, `webtools/configurator/style_deployer/deploy.sh`,
`template_deployer/deploy.sh`, `script_deployer/deploy.sh`, `documents_deployer/deploy.sh`,
`i18n_deployer/deploy.sh`, `sso_deployer/deploy.sh`, `specs_deployer/deploy.sh`,
`configuration_deployer/deploy.sh`
Examined: 2026-09-26

Eight scripts, 428 lines, and the central decision in them is the audited rule applied
deliberately: every deployer enumerates its targets one `deploy_<name>` function at a time, and
each says why — "Every project has its own deploy function, with explicit targets: **the projects'
structure may differ and not all of them receive the style**" (`style_deployer:2-4`). That is
"what holds only for part of the class lives at the boundary that deals with that part, and is
established there explicitly", written as a shell script. `sso_deployer:6` and
`configuration_deployer:6-7` go further and say which subsystem receives *nothing*, and why.

The check that it works: `configurator-fe` is a full node subsystem with `templates/`, `public/`
and a runner, and it appears in exactly one deployer. That is correct, and both ends say so —
`configurator-fe/templates/configuration.njk:8` ("The page shell is its own, not
`commons/base.njk`") and `configurator-fe/public/styles.css:4` ("Self-contained: it does not
receive commons.css from the style deployer"). An absence stated at both ends is not an absence
anybody has to guess about.

The three findings are about what happens *around* that enumeration: an argument nobody matched, a
file nobody removed, and a copy that does not know it is one.

---

## 1. A deployer name that matches nothing is reported only when nothing matches

- `webtools/configurator/deploy.sh:50-56` — for each entry, `wanted` is computed and unmatched
  entries are skipped; the requested names themselves are never checked
- `webtools/configurator/deploy.sh:61-65` — `if (( done_count == 0 ))` is the only place a
  requested name is reported as unknown
- Shape: **5 — only the success path**
- Class: **the argument lists this script may be given.** Three members: all names known, no name
  known, and *some* names known. The first two are handled. The third runs the ones it recognised,
  counts them, and prints `Deploy done (1 sub-deployers).` — a success line — with no mention of
  the name it did not understand.
- It needs no typo to reach. The names are `style template script documents i18n sso specs
  configuration`, and the directories beside them are `style_deployer template_deployer …`. Asking
  for `./deploy.sh style templates` — the plural, which is what the directory of `.njk` files is
  called everywhere else — deploys the style, says it is done, and leaves every subsystem's
  `templates/commons/` exactly as it was. The operator has no reason to look again: the script
  said it deployed.
- What makes it worth `breaks-now` rather than a note is what these scripts are *for*. Their whole
  reason to exist is that a shared file must not drift from its copies; a deploy that silently does
  not happen is precisely the drift they prevent, reported as prevented.
- Severity: `breaks-now` — reachable today, with the code exactly as it stands.
- Smallest generalising change: before running anything, check every requested name against the
  list and refuse the whole invocation naming the ones that are not there, the way
  `webtools/anagraphics/scripts/load_configuration.py:148-155` refuses a `--reset` for a subsystem
  with no file.

---

## 2. Three deployers copy a set and none of them removes; two copy a directory and both rebuild it

- The three that copy by glob, adding and never removing:
  `webtools/configurator/template_deployer/deploy.sh:21` — `cp "$SOURCE"/*.njk "$target/"`;
  `webtools/configurator/script_deployer/deploy.sh:18` — `cp "$SOURCE"/*.js "$target/"`;
  `webtools/configurator/documents_deployer/deploy.sh:47-49` — `for policy in "$POLICIES"/*.md`
- The two that copy a directory, both of which rebuild it from scratch:
  `webtools/configurator/i18n_deployer/deploy.sh:21-22` — `rm -rf "$target/locales"` then
  `cp -R`, with the reason at `:10-11`: "The catalogues are copied from scratch, **so a language
  removed from the original disappears from the copies too**";
  `webtools/configurator/style_deployer/deploy.sh:18-19,30-31,41-42` — `rm -rf "$css/fonts"` then
  `cp -R`
- Shape: **5 — only the success path**
- Class: **the changes that can happen to a shared set.** A file added, a file changed, a file
  removed or renamed. The glob handles the first two and has no account of the third, and the
  question is not a hypothetical one in this directory: the deployer two files away states it
  as the reason for its own design.
- The worst member is the policies, because a stale policy is *selectable*. Which policy is used is
  a configured string — `"policy": "scope-v1"` at
  `webtools/configurator/configuration/preanalyst.json:43`, with `analysis-v1` and
  `analysis-validation-v1` at `:65,79` — and the preanalyst turns that string into a file name
  under its own `policies/` directory (`webtools/preanalyst/src/prevalidator.js:49,106-110`,
  `webtools/preanalyst/src/analyst.js:29,46-54`). Rename `scope-v1.md` to `scope-v2.md` in
  `webtools/configurator/policies/`, run the deployer: `webtools/preanalyst/policies/` now holds
  both, and a configuration in Mongo still naming `scope-v1` goes on prevalidating every request
  against a policy that no longer exists in the repository, with nothing anywhere saying so. The
  same holds for a shared template: `{% extends "commons/base.njk" %}` keeps resolving against the
  orphan after `base.njk` has been renamed, so the rename looks as if it worked.
- Severity: `latent` — it takes a removal or a rename in `commons/templates/`, `commons/script/` or
  `configurator/policies/`, which is an ordinary edit. (Two of the three targets have such an
  orphan waiting: nothing has been removed from them yet.)
- Smallest generalising change: what `i18n_deployer` already does — clear the target set and copy
  it whole — for the three deployers that copy a set. A named file is already safe; a glob is not.

---

## 3. Whether a generated copy says so is decided by each original, and two formats cannot say it at all

- `webtools/configurator/documents_deployer/deploy.sh:27-35` — `copy_policy` writes the banner
  itself: "GENERATED COPY: do not edit here. The original is … edit it there and run … again."
  It is the only place in the eight scripts where the act of copying marks its own output.
- Every other copy is a bare `cp`, so the marking has to be inside the original and travel with it.
  In most originals it is, and thoroughly: `commons/script/webtools_loader.js:3`,
  `commons/sso/sso_client.js:3`, `commons/sso/sso_popup.js:3`, `commons/templates/base.njk:4`,
  `commons/templates/loader.njk:4`, `commons/templates/locale_switch.njk:5`,
  `commons/configuration/configuration_client.js:6`, `commons/i18n/webtools_i18n.js:3`,
  `commons/specs/spec_front_matter.js:11`, and
  `configurator/documents/prespec.md.njk:55` — which puts it at the **bottom**, with the reason
  written at `:46-47` ("the file has to begin with `---`: anything before it, an empty line
  included, and the front matter is gone"). Ten originals, ten authors remembering.
- The ones where it is not, and which are sitting in the working tree unmarked right now:
  - `webtools/commons/style/commons.css`. Its header (`:1-11`) describes the stylesheet and says
    where it is served from, and says nothing about being copied — so
    `webtools/front-gate/public/css/commons.css`, `webtools/preanalyst/public/commons.css` and
    `webtools/sso/public/commons.css` are three files that look exactly like a local stylesheet.
    The irony is load-bearing: four of the ten warnings above end with the words "as for
    commons.css", pointing at the one artefact that does not carry one.
  - `webtools/commons/i18n/locales/en.json` and `it.json`, copied whole into three subsystems by
    `i18n_deployer:21-22`. JSON has no comment syntax, so these copies **cannot** be marked from
    inside the original. Nor can the font files under `commons/style/fonts/`.
- Shape: **3 — member logic outside its boundary**
- Class: **the files the deployers produce.** "This is a copy and editing it here is pointless" is
  a property of *having been copied*. It is decided in ten different originals by ten different
  authors — which works until an author forgets, as with `commons.css` — and for two formats it
  cannot be decided there at all, because the format has nowhere to put it. The copier is the one
  party that knows, in every case, that what it is writing is a copy, and exactly one of the eight
  deployers acts on that.
- The mechanism is already written and already proven to work end to end: the policies' banner is
  stripped before the text reaches a model by `webtools/preanalyst/src/analyst.js:52` and
  `src/prevalidator.js` (`text.replace(/^\s*<!--[\s\S]*?-->\s*/, "")`), so a deployer can mark
  a copy without changing what the file means.
- Severity: `latent` — nothing misbehaves until somebody edits one of the unmarked copies, at which
  point the edit is reverted by the next deploy with no message. The three `commons.css` copies are
  the likeliest place for that: a stylesheet is what one reaches for when a page looks wrong.
- Smallest generalising change: add the banner in the comment syntax of what is being copied, in
  the deployer, the way `copy_policy` does — and accept that `.json` and `.woff2` cannot carry one,
  which is a fact about those formats rather than something to guess at.

---

## Noted, not raised as findings

- `webtools/configurator/deploy.sh:30-39` — a sub-deployer that exists but is not executable is run
  with `bash` and the fact is printed, rather than stopping. Three outcomes of "can I run this
  file" and all three are handled. It is the counterexample to finding 1, in the same script.
- `webtools/configurator/deploy.sh:16-26` — the comment calls the list "the order of execution" and
  no sub-deployer states a dependency on another. `i18n_deployer:6-7` says its module "lands in the
  subsystem's `src/commons/i18n/`, next to configuration_client.js which the module imports", and
  `configuration` is the last entry in the list while `i18n` is the fifth — so `./deploy.sh i18n`
  alone, into a subsystem that has never had a full deploy, leaves a module next to an import that
  is not there. After a full run both are present in either order. An ordering that is asserted and
  constrained by nothing; noted rather than raised because no order currently breaks.
- `webtools/configurator/sso_deployer/deploy.sh:22-24` — `mkdir -p "$commons"` and then
  `cp "$SOURCE/sso_popup.js" "$public/sso_popup.js"` with no `mkdir -p "$public"`. `set -e` makes a
  missing `public/` a loud failure rather than a quiet one, so the outcome is handled, differently
  from its neighbour two lines up.
- `webtools/configurator/documents_deployer/deploy.sh:15-16` — "Which policy is used is said by the
  subsystem's configuration (`prevalidation.policy` for the preanalyst), not by this script." The
  deployer distributing all the policies and naming none is the right division, and it is the
  division that makes finding 2's stale policy selectable.
- `webtools/configurator-fe/` is a sixth node subsystem — `src/`, `templates/`, `tests/`,
  `webtools_configurator_fe.sh`, a live PID file — and it appears in no row of
  `sanity/inventory.md`. The inventory is not recomputed by this audit; recorded here so the gap is
  on the record. Its only contact with `commons/` is the configuration client, which is correct and
  is stated at both ends.
- `webtools/decision-maker/` and `webtools/metrics/` are empty directories. Nothing to deploy to
  and nothing that expects to receive.
