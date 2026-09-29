# docs-preanalyst

Path: `docs/subsystems/preanalyst/README.md`
Examined: 2026-09-26

One thousand three hundred and eighty lines, and the best statement of the audited rule anywhere in
the repository is in it — better than `CLAUDE.md`'s own. §16.1, on the AI module:

> **A provider's configuration is the provider's own business.** `<section>.providers` is a map
> whose keys the configuration decides, so it is not read by enumerating it… **Only the selected
> provider must be complete**: an environment that uses one does not carry the keys of the others,
> and does not refuse to start for want of a key it would never spend. And **what a provider needs
> is not known upstream**… The registry is an allowlist and not a directory listing — the
> configuration chooses among the providers that exist, it does not name a module to load.

That is the rule's four clauses applied to one design, with the reasoning for each. §8 does the
same in miniature for a single field: `prevalidation.providers.anthropic.effort` is listed as
`(absent)` with "Left out, nothing is sent" — an optional configured value documented as optional,
with the consequence of its absence stated and nothing put in its place.

The two findings are both about the parts of the document that describe the **state** of the work
rather than its design. A statement of design describes a class; a statement of state describes one
member of it, the one the author was looking at.

A note on severity, applied to this unit and to the other documentation units: a document that is
wrong today is reachable today, but its consequence is realised only through a reader. These are
recorded as `latent` rather than `breaks-now`, and the falsity is stated plainly in each case.

---

## 1. The test suite is described four times, in four different ways, and none of them is the suite

- `docs/subsystems/preanalyst/README.md:33` (§0, the quick sheet) — "Tests | `npm test`
  (`node --test`): **16 tests** (§11)"
- `docs/subsystems/preanalyst/README.md`, §11 — "`npm test` (`node --test tests/*.test.js`),
  **21 tests**", followed by a table naming **four** files: `prevalidator.test.js`,
  `prevalidator_ai.test.js`, `analyst.test.js`, `server.test.js`
- `docs/subsystems/preanalyst/README.md`, §4.1, the file map — under `tests/`, **two** files:
  `prevalidator.test.js` and `server.test.js`
- What is on disk: **five** files — the four above plus `analysis_page.test.js` — carrying
  **43** `test(…)` declarations between them (7 + 14 + 6 + 14 + 2)
- Shape: **6 — world narrowed to fit the code**
- Class: **the test suite over time.** A count of tests written into prose can only ever describe
  the member that existed when the sentence was typed, and this document holds four such sentences,
  written at four moments, none of which is now. The file map — the part a person reads to find out
  what exists — is the furthest behind: it names two of the five files, and the missing ones
  include the whole of the analysis chat's coverage, which is the newest and least familiar part of
  the subsystem.
- The cost is not the arithmetic. §11 ends with "They are the functions that **decide**: the ones
  that can go wrong silently… `driver_link.js` stays uncovered and is the next candidate" — a
  statement about what is and is not covered, which is exactly what a person consults before
  changing something. A reader who takes §4.1 at its word believes the analysis page and the AI
  modules are untested, and a reader who takes §11 at its word believes there are 21 assertions
  where there are 43.
- Severity: `latent`
- Smallest generalising change: name the directory instead of its contents — "`npm test` runs
  everything in `tests/`" — and, where a count is genuinely wanted, produce it rather than write
  it. A sentence that has to be edited every time a test is added will be wrong every time one is
  added and the sentence is not.

---

## 2. The two sections whose job is to say what is not done are written from an earlier state

- `docs/subsystems/preanalyst/README.md`, §13 "Known limits and technical debt" — "**No
  server-side validation of the chosen driver**: it will be needed when there is a submission
  (§5.5)."
- `docs/subsystems/preanalyst/README.md`, §5.5, the section it points at — "On submission the value
  **is checked again on the server** (`linkTermsOf()` in `src/project_driver.js`): a hidden field
  does not stop anybody from sending whatever they like. The discount is read again… the driver is
  read again… If it does not count, the driver and the discount fall together and the system
  assigns the driver."
- `docs/subsystems/preanalyst/README.md`, §15 "Next steps", item 2 — "**The analysis chat**, in the
  `/analysis/{id}` page: what happens after a prevalidation that passes is still to be specified."
- `docs/subsystems/preanalyst/README.md`, §14.3 — eight hundred words describing that chat as
  built: the turns, the opening question, the two engines that decide when the analysis is
  complete, the four ways that judgement can go, the routes and their codes.
- Shape: **6 — world narrowed to fit the code**
- Class: **the states of the work this document describes.** §13 and §15 exist to answer one
  question — what is not there yet — and each is a snapshot that the sections above it have
  overtaken. A limit that has been closed and a next step that has been taken are not merely stale:
  they are the two entries a reader is most likely to act on, by building a thing that exists or by
  distrusting a check that is there.
- The rest of §13 is exact and unusually honest — the reload that re-submits a `POST` and pays for
  another prevalidation, the ceiling counted per project rather than per user, the project left
  with no pre-specification if anagraphics falls over at one precise moment, the hand-copied
  `mark.svg`. Those are the entries that describe properties rather than progress, and they have
  not gone stale.
- Severity: `latent`
- Smallest generalising change: keep in §13 and §15 only what is a property of the design (the
  reload that re-submits, the ceiling's scope, the absent draft) and move what is a property of the
  moment to where the moment is recorded — `contesto/todos.md` and the checkpoints — which the
  document already does for the mock at §14.3.2.

---

## Noted, not raised as findings

- §4.1 — the file map lists `src/prevalidator.js` **twice**, once in its alphabetical place and
  once again below with a different description. The same list omits three of the five test files
  (finding 1).
- §4.1 — `public/assets/mark.svg # copied by hand from front-gate/assets/ (**the brand is not in
  the deployer**)", and §13 repeats it as a known limit. The repository knows about the finding
  recorded at `findings/commons-templates.md` 1, records it in two places, and has not made the
  file a shared original. Documentation doing its job.
- §0 — "Stack | **Node 23** · the `node:http` module…", where `webtools/preanalyst/package.json:8-10`
  declares `"engines": { "node": ">=20" }`. A range in the manifest and a point in the prose; the
  point is the machine the author is on. The same shape as `findings/workspaces-runner.md` 2.
- §11 — "Checked by hand on 2026-09-20", with a table of eleven manual checks and their outcomes.
  Dating the table is what makes it honest: it says which member of the class was observed and
  when, rather than asserting the behaviour of every future one.
- §5.3 — `discount_expired` covering both "the code does not exist" and "the service is
  unreachable" is documented as "a **deliberate simplification**, explicitly asked for", with the
  two log lines that distinguish them printed side by side and a note that it "is to be revisited
  once the discount has a real economic value". The audit recorded the code-side entry as
  `breaks-now` 7; the document argues the case and states what makes it wrong later, which is the
  form a deliberate narrowing should take.
- §5.2 — "`driver_unknown` does not tell 'a deleted driver' from 'an invented uid': to the page
  they are the same thing". Two facts collapsed onto one answer, with the collapse named where it
  happens rather than discovered downstream.
- §7 — the routes table matches the dispatch in `webtools/preanalyst/src/server.js` (`/`,
  `/login-done`, `/session-fragment`, `/logout`, `/submit`, `/upload`, `/locale`, the five
  `/analysis/{id}` routes, the static fallback, `405`, `500`). The one table in the document that
  enumerates a class and enumerates all of it.
- §16.1 — "It used to start and fail on the first client's prevalidation with `unknown_provider`,
  which is a configuration mistake discovered by whoever is least able to fix it." A defect of
  exactly the kind this audit hunts, found, fixed, and the reasoning kept.
