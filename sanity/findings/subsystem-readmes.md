# subsystem-readmes

Paths: `webtools/preanalyst/README.md`, `webtools/sso/README.md`,
`webtools/front-gate/README.md`, `webtools/anagraphics/README.md`
Examined: 2026-09-26

Four short guides, 448 lines in all, each pointing at its full documentation and each repeating
the few things somebody needs before touching the subsystem. Two of the four have nothing to
report.

`webtools/sso/README.md` is the strongest. Its "Three things to know before using it" states, in
three sentences, the three distinctions the subsystem exists to keep: the sessions live in Mongo so
a restart logs nobody out; "**`logged: false` and `503` are not the same thing**… A `503` must not
be treated as a logout, or one Mongo failure will log everybody out"; and a refused login always
answers `INVALID_CREDENTIALS` whichever of the four reasons it was, with the reason in the log.
Its test count (47) is exact.

`webtools/front-gate/README.md` is accurate throughout, including the page templates renamed
earlier today (`what-it-is.njk`, `examples.njk`, `how-it-works.njk`, `pricing.njk`,
`contacts.njk`), which were checked against the directory. Its configuration table describes each
field by what the code does with it — "`http`/`https` only: the value ends up in an `href`",
"in euro cents, an integer ≥ 0" — rather than by the value it holds today.

Three findings, all in the two remaining files, all enumerations.

---

## 1. The Collections table names four of the seven collections

- `webtools/anagraphics/README.md`, "## Collections" — a table with four rows: `configuration`,
  `projects`, `drivers`, `discounts`
- `webtools/anagraphics/webtools_anagraphics/db.py:8-14` — seven: those four plus `USERS`,
  `SESSIONS`, `TICKETS`
- Contradicted twice on the same page: the opening paragraph — "holding the configuration of every
  subsystem…, the projects, the drivers and their discount codes, **the users and the sessions**"
  — and the Endpoints list — "**Users, sessions and tickets**: see the full documentation
  (§6.8–6.15)"
- The same section's neighbour: "`uv run pytest` # **70 tests**", where the two test files declare
  69 + 6 = **75**
- Shape: **6 — world narrowed to fit the code**
- Class: **the collections this subsystem holds.** The table is the only enumeration of them in
  this file, and it stops at the four that existed when it was written; the three added since are
  named in prose above and below it, so the file knows about them and the table does not. A reader
  who takes the table as the data model is missing the collection that holds every password's
  session and the one that holds the single-use login tokens.
- It is the same sentence as `findings/docs-anagraphics.md` 2 — which is short by one, `tickets` —
  written at a different time and short by three. Two documents, one class, two different partial
  answers.
- Severity: `latent`
- Smallest generalising change: three rows, or a sentence pointing at §5 of the full documentation,
  which enumerates all seven. And for the count: name the command, not the number.

---

## 2. The example documents show shapes that a migration in this repository exists to remove

- `webtools/anagraphics/README.md`, the `projects` row —
  `{"project_id": "…", "owner_uid": "…", "submission_id": "…", "created_at": …, **"state":
  "PREANALYSIS"**, "review": {…}, "billing": {…}}`
- What a project is now: `webtools/anagraphics/webtools_anagraphics/main.py:161-172` writes
  `"pipeline": {"state": "PREANALYSIS", "steps": []}` and no `state`, and
  `webtools/anagraphics/scripts/migrate_pipeline.py` exists **solely** to convert the old shape,
  `{"$set": {"pipeline": …}, "$unset": {"state": ""}}`
- `webtools/anagraphics/README.md`, the `drivers` row —
  `{"uid": "7633be3d-…", "username": "…", "screen_name": "Dome"}`, with no `enabled`, which
  `scripts/seed.py:17-43` writes on every driver, `db.py:21` publishes in the driver list, and the
  preanalyst branches on in five of the nine driver-link states
  (`docs/subsystems/preanalyst/README.md` §5)
- Shape: **6 — world narrowed to fit the code**
- Class: **the documents these collections hold.** Two examples, both describing a member that no
  longer exists: one a field that was migrated away, the other a field that was added. The first
  is the worse of the two, because the migration is right there in `scripts/` — the repository
  knows the old shape is gone and has a program to remove it, and the README still shows it.
- The examples are not decoration. `docs/subsystems/anagraphics/README.md` §8.4 ("Inspecting and
  changing the data (until there is a CRUD)") tells the operator to write `mongosh` upserts by
  hand, and this table is the nearest thing to a template for them: a project written from it goes
  into the collection with a flat `state` that nothing reads and no `pipeline` that everything
  reads, and a driver written from it has no `enabled`, which `resolveDriverLink` reads as "not
  `true`" and therefore as disabled.
- Severity: `latent`
- Smallest generalising change: copy the examples from what the code writes — `main.py:161-172`
  and `scripts/seed.py` — or drop them and point at §5 of the full documentation, where both
  shapes are current.

---

## 3. The preanalyst's Tests section names three of the five files and calls the rest uncovered

- `webtools/preanalyst/README.md`, "## Tests" — "They cover the functions that **decide**: how the
  prevalidator's answer is read… (`tests/prevalidator.test.js`), which provider is selected…
  (`tests/prevalidator_ai.test.js`), and the counting of the rounds of whoever has been sent back
  (`tests/server.test.js`). … **`src/driver_link.js` and the rest are left uncovered: a known
  hole, not a choice.**"
- `webtools/preanalyst/tests/` — five files. The two not named are `analyst.test.js` (14 tests) and
  `analysis_page.test.js` (7), which between them cover the analysis chat, the two AI engines and
  the analysis page — "the rest", in the sentence's own words
- Shape: **6 — world narrowed to fit the code**
- Class: **the test suite over time.** The sentence is not merely an incomplete list: it closes
  with a verdict about everything it did not name, and that verdict is wrong for two fifths of the
  suite. A reader deciding whether to trust a change to the analysis chat is told there are no
  tests for it, when there are twenty-one.
- The same file, eleven lines from the top, has the sentence that does not go stale: "Tests:
  `npm test` (`node --test`)." One command, no enumeration, no count, still true.
- It is the third instance of this shape in the audit, after `findings/docs-preanalyst.md` 1 and
  `findings/docs-anagraphics.md` 2, and it is the one that draws a conclusion from the omission.
- Severity: `latent`
- Smallest generalising change: name the directory and, if the coverage gap is worth stating, state
  it as a property — "`src/driver_link.js` has no tests" — rather than as everything not listed
  above.

---

## Noted, not raised as findings

- `webtools/sso/README.md` and `webtools/front-gate/README.md` — nothing to report. Both were read
  in full and checked against their subsystems: the sso's routes, codes and test count, and the
  front-gate's file tree, configuration fields and route table, all match.
- `webtools/preanalyst/README.md`, "Style and shared parts" and `webtools/sso/README.md`, "The
  pages' style" — each lists its generated copies by name and says which deployer writes them,
  which is what `webtools/configurator/README.md:226-230` asks a subsystem's documentation to do.
  `webtools/front-gate/README.md` does it in prose for `css/commons.css`, `css/fonts/` and
  `src/commons/configuration_client.js`, and its file tree omits `templates/commons/`, the one
  generated template it receives (`locale_switch.njk`).
- `webtools/preanalyst/README.md` — "`public/assets/mark.svg` is a copy by hand of the
  front-gate's." Two READMEs now treat the front-gate as the origin of the brand mark, and the
  front-gate is not an origin in any mechanism: the file exists three times with no original and no
  deployer (`findings/commons-templates.md` 1). The hand-copy is named where it happens, which is
  the best a document can do about it.
- `webtools/anagraphics/README.md`, the error codes — nine of the nineteen, followed by "the full
  table is in the documentation (§6.1)". A subset that says it is a subset, which is why it is not
  a finding: the two enumerations above it do not.
- `webtools/anagraphics/README.md`, the `discounts` row — "In `discounts` the driver is
  **duplicated** on purpose (`uid` + `screen_name`)… A change of `screen_name` has to be propagated
  by hand, though." The denormalisation, its reason and its cost, in three lines, in the file a
  person reads before touching the collection.
- `webtools/preanalyst/README.md` — "The key of the **selected** provider is needed in
  `webtools/configurator/secrets/preanalyst.json`… The others are not read, and are not needed."
  The rule of `docs/subsystems/preanalyst/README.md` §16.1 restated in two sentences: only the
  selected member of the class must be complete.
