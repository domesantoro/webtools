# sanity — standing class-vs-instance audit

## What this is

A read-only, resumable audit of the `webtools` repository against the first rule under
"General rules" in `/Users/domenico/workspaces/webtools/CLAUDE.md`:

> **MANDATORY, INVIOLABLE: write for the class, never for the instance.**

The rule's own words are in `CLAUDE.md` and are the authority; this folder only records where the
code departs from them. Nothing here is a patch. The audit never edits code, configuration,
policies, templates or documentation, never runs a deployer or `load_configuration.sh`, never
writes to Mongo, never starts or stops a process, and never changes git state. It only writes
inside `sanity/`.

## The rule, in short

What is in front of the author is an *instance* of what the code has to serve. It is evidence about
the class, never a stand-in for it. Code that holds only for the instance passes the tests — the
tests are drawn from that same instance — and fails on the first other member of the class, which
was legitimate all along. Recognising the path that works and building on it *is* the defect.

## The six shapes hunted

1. **Partial-class requirement** — something only part of a class offers, treated as required
   rather than optional.
2. **Invented value** — an absence filled with a made-up value, where the honest answer is that
   nothing is there. Absent is absent; absent is not a default.
3. **Member logic outside its boundary** — behaviour specific to one member decided outside the
   module that is supposed to be the only place that knows about that member.
4. **Capability inferred from resemblance** — a member's capability deduced from a name, a version,
   a shape or a familiar-looking string, instead of being established explicitly.
5. **Only the success path** — only the outcome that succeeds is handled; other outcomes are left
   to a later pass.
6. **World narrowed to fit the code** — a value, an input or a scope chosen so that what was
   written becomes legal.

A *class* is any set the code must serve: the values a configured field may hold, the
implementations behind an interface, the inputs a function may receive, the states a thing may be
in, the locales, the shapes a response may take.

## Severities

- `breaks-now` — another legitimate member of the class is already reachable today, with the code
  and configuration as they stand.
- `latent` — it takes a change somebody is entitled to make (a new provider, a new locale, a
  configuration value edited in Mongo, a new state) to reach the other member.
- `stylistic` — the code is correct for the whole class, but the shape invites the defect, or the
  class boundary is stated less explicitly than it should be.
- `uncertain` — recorded when the answer depends on what some external thing actually supports.
  An uncertain item says what would need to be known and asserts nothing. Guessing what a member
  supports is itself the defect being hunted.

## Generated copies

`webtools/commons/` and `webtools/configurator/` hold the originals; the deployers under
`webtools/configurator/*_deployer/` write copies into the subsystems. A finding in a copy belongs
to its original: it is reported against the original path, and the finding notes that copies exist.
Copies are marked `skipped` in the inventory.

## Layout

- `inventory.md` — the unit list, computed once on the first run and never recomputed.
- `findings/<unit-slug>.md` — one file per unit examined, **including units with nothing to
  report**, which say so explicitly. Silence must be distinguishable from not having looked.
- `summary.md` — progress, counts, the `breaks-now` list and the `uncertain` list. Rewritten after
  every unit.

## How to resume

Re-run the same audit prompt. The agent reads `inventory.md`, does **not** recompute it, and
continues at the first row whose status is `pending`. After every single unit it writes the
finding file, flips that row to `done`, and rewrites `summary.md` — so an interrupted session
leaves a complete, consistent deliverable on disk.
