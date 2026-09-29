# commons-specs

Path: `webtools/commons/specs/spec_front_matter.js`
(generated copies in `webtools/preanalyst/src/commons/` and
`webtools/webtools-workspaces/src/commons/`)
Examined: 2026-09-26

Both copies were diffed against the original on the day of examination and are identical.

Seventy-six lines, and the one in the repository that thinks hardest about the class of inputs it
may be handed. `split` (`:34-42`) refuses to treat a `---` in the middle of a document as front
matter, because in markdown it is a horizontal rule — the reason is written above the function —
and strips a byte-order mark first. `parse` distinguishes "no front matter" (`data: null`) from
"front matter that is empty" (`data: {}`), and `webtools/webtools-workspaces/tests/store.test.js:19-27`
tests all three cases including the BOM. `toMap` (`:70-76`) refuses a front matter that is a list
rather than a map, which is the shape that would otherwise sail through `toJS()`.

One thing was checked rather than assumed. A front matter containing a YAML document-end marker
(`...`) followed by more keys is a second document, and a library that quietly parsed the first
would silently discard the rest of the client's metadata. Running it: `YAML.parseDocument` puts
"Source contains multiple documents" into `document.errors`, `parseDocument` (`:62-68`) turns that
into a `FrontMatterError`, and `webtools/webtools-workspaces/src/server.js:91` answers
`400 INVALID_FRONT_MATTER`. The outcome is handled; nothing is raised.

Two findings, both `stylistic`: what the module owns, and what it does not say it owns.

---

## 1. The shape of the reserved key is stated as an example here and as a literal there, and they already disagree

- `webtools/commons/specs/spec_front_matter.js:20` — `export const RESERVED_KEY = "webtools";`,
  with `:14-16`: "The `webtools:` key is **reserved for the system**: it is written by whoever
  stores the file (`stamp`), and whatever an uploaded file declares in there counts for nothing."
- `webtools/commons/specs/spec_front_matter.js:5-7` — the module's own illustration of what goes
  under it: `origin: third_party`, `version: 2`
- `webtools/webtools-workspaces/src/store.js:71-76` — what is actually written:
  `{ origin, version, received_at: now.toISOString(), uploaded_by: uploadedBy }` — four fields
- `webtools/commons/specs/spec_front_matter.js:53-60` — `stamp(text, values)` takes `values`
  opaquely and writes whatever it is given
- Shape: **3 — member logic outside its boundary**
- Class: **the things that may appear under `webtools:`.** The module declares the key reserved,
  which is a claim of ownership, and then owns only the key and not its contents. What goes inside
  is decided by each caller, in another package, and the module's header documents a shape that no
  caller produces: two fields where the one writer writes four. That is not a stale comment by
  accident — it is what happens when the statement of a shape lives somewhere that nothing checks
  it against.
- The class already has a second member on the horizon and the repository says so:
  `webtools/configurator/documents/prespec.md.njk` is written by the preanalyst and
  `webtools/preanalyst/src/prespec.js:19-20` records that "The front matter's `webtools:` key is
  not written here: webtools-workspaces stamps it when it stores the file." Two packages know
  about the reserved key; one writes it; the module that reserved it describes a third shape.
- Severity: `stylistic` — nothing misbehaves. A reader of a stored specification who takes the
  module's header as the definition of `webtools:` is reading a description of a file that does not
  exist.
- Smallest generalising change: put the shape where the key is reserved — a documented set of
  fields, or a `stamp` that takes them by name — so that the module owns the whole of what it says
  it owns, and the illustration cannot drift from the only writer.

---

## 2. One identifier format, stated three times, in three languages, by three parties that do not refer to each other

- `webtools/commons/specs/spec_front_matter.js:22-28` —
  `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/`, with the comment "a UUID in
  canonical lowercase form, **as anagraphics generates it**"
- `webtools/anagraphics/webtools_anagraphics/main.py:161-162` — the generator:
  `"project_id": str(uuid4())`, with no statement of a format anywhere
- `webtools/anagraphics/tests/test_api.py:171-172` — a third, partial statement:
  `assert len(project["project_id"]) == 36 and project["project_id"][14] == "4"`
- Shape: **6 — world narrowed to fit the code**
- Class: **the identifiers anagraphics may mint.** Today they are `uuid4` in Python's canonical
  lowercase form, and all three statements agree about that member. None of the three is derived
  from another: the regex names its source in prose, the generator names nothing, and the test
  checks two characteristics of the string rather than the format. A change on the generating
  side — a uuid7 for time-ordering, an identifier with a prefix, the uppercase form — passes the
  test at `test_api.py:172` (length 36, a `4` at position 14 is not asserted for uuid7… it would
  fail there), and fails silently useful ways downstream: `isProjectId` refuses it, so
  `webtools/webtools-workspaces/src/server.js:68` answers `400 INVALID_PROJECT_ID` for every
  upload of every project, and the message names the id rather than the mismatch.
- The regex itself is right, and its comment explains why it is a **format** check doing a second
  job — "whoever builds a path from it knows it contains neither `/` nor `..`" — which is the
  derivation `webtools/webtools-workspaces/src/store.js:24-25` relies on. That is the part worth
  keeping; what is missing is that the party which decides the format does not state it.
- Severity: `stylistic`
- Smallest generalising change: state the format where it is generated — a named constant in
  anagraphics with the pattern beside `uuid4()`, asserted by its own test — and have this comment
  point at it. One producer, one statement, and the consumers checking against a rule rather than
  against a memory of one.

---

## Noted, not raised as findings

- `:57` — `toMap(document.toJS());` in `stamp`, called for the exception it may throw and with its
  return value discarded. It is load-bearing: without it a front matter that is a YAML sequence
  reaches `document.set(RESERVED_KEY, values)` on a node that is not a map. A guard written to look
  like dead code, which is the shape somebody tidies away.
- `:18` — `import YAML from "yaml"`, a dependency declared in neither this file nor
  `webtools/commons/` (which has no manifest at all) and hand-written into the two recipients'
  `package.json`. Recorded at `findings/workspaces-runner.md` 1.
- `:37-41` — `split` returns `{ frontMatter: "", body }` for `---\n---\n` and
  `{ frontMatter: null, body }` for a file with none, so the two are distinguishable all the way up
  to `parse`'s `data: {}` against `data: null`. The distinction between "empty" and "absent" kept
  intact through three functions.
- `:38` — a single U+FEFF is stripped and the result is what `stamp` writes back, so a stored file
  loses its byte-order mark. The one transformation the module performs on a document it was only
  asked to stamp.
- `:59` — `` `---\n${document.toString()}---\n${body}` ``. The rebuilt document keeps the client's
  key order and comments, because `parseDocument` preserves them; the fences are normalised to
  `\n` while a CRLF body keeps its own endings, so a stamped file can carry both.
