# workspaces-tests

Paths: `webtools/webtools-workspaces/tests/api.test.js`,
`webtools/webtools-workspaces/tests/store.test.js`
Examined: 2026-09-26

One hundred and ninety-seven lines, and they test the things that are hard to test rather than the
things that are easy. `store.test.js:84-101` fires ten concurrent `writeSpec` calls at one project
and asserts three separate properties of the result — every version number distinct and contiguous,
no temporary file left behind, and each file's stamped version matching its own name — which is the
whole of the `link`-based allocation checked as a behaviour rather than as an implementation.
`api.test.js:58-69` walks eight different bad requests and then asserts
`readdir(<root>/<project>)` rejects with `ENOENT`: not merely that each was refused, but that the
refusals left nothing on disk. `:61` sends `..%2F..%2Fetc` as a project id, so the path defence is
exercised in its encoded form, which is the form that actually arrives.

Two findings, both about where the suites stop rather than about what they assert.

---

## 1. The server is tested on a settings object the tests write, and the one that the subsystem builds is tested by nothing

- `webtools/webtools-workspaces/tests/api.test.js:15-19` —
  `createServer({ allowedIps: ["127.0.0.1", "::1"], root, specMaxBytes: 1024 })`, and the same
  three-field literal again at `:85`
- `webtools/webtools-workspaces/src/settings.js:11-25` — `loadSettings` returns **five** fields:
  `host`, `port`, `allowedIps`, `root`, `specMaxBytes`
- `webtools/webtools-workspaces/src/settings.js:27-35` — `absoluteRoot`, three branches (`~`,
  already absolute, refused with a `ConfigurationError`), imported by no test
- Shape: **6 — world narrowed to fit the code**
- Class: **the settings objects `createServer` may be given.** The suite establishes that it works
  on one member, and that member is not produced by the subsystem: it is assembled by hand in the
  test file, with the fields the server currently reads. The member the subsystem actually runs on
  — whatever `loadSettings` returns from the configuration in Mongo — is never joined to the server
  by any test, so nothing in the repository asserts that the two halves fit.
- What that costs is specific rather than theoretical. The one piece of real logic in `settings.js`
  is `absoluteRoot`, and it is the piece the audit has just recorded a finding against
  (`findings/workspaces-settings-index.md` 2, the root that is absolute and wrong): its three
  branches, including the refusal, are asserted nowhere, so the behaviour that decides where every
  client's files go is established by reading the code and by nothing else. And a field added to
  `loadSettings` because the server needs it will be present in production and absent in every
  test, which is the failure mode this shape always has.
- The suite is otherwise built to exercise the real thing end to end — a real socket at `:23`, real
  `fetch` calls, a real temporary directory — which makes the one hand-built value stand out.
- Severity: `latent`
- Smallest generalising change: test `absoluteRoot` directly, which costs three assertions, and
  build the test server from the same shape `loadSettings` returns so that a new field has one
  place to be forgotten rather than two.

---

## 2. The concurrency guarantee is demonstrated at one point and its edge is named by a constant nobody tests

- `webtools/webtools-workspaces/tests/store.test.js:84-101` — ten concurrent writes, asserted to
  produce versions 1 to 10
- `webtools/webtools-workspaces/src/store.js:20-22` — `MAX_ATTEMPTS = 20`, "Past this number of
  concurrent writes on the same project something is wrong: better an error than an endless loop",
  and `:90` — `throw new Error("too many concurrent writes on project …")`
- Shape: **6 — world narrowed to fit the code**
- Class: **the numbers of concurrent writes the store may receive.** The retry loop gives the
  *n*-th simultaneous writer up to *n* − 1 collisions, so the guarantee the test demonstrates holds
  up to roughly twenty writers and then stops — at which point an upload fails with an `Error` that
  `webtools/webtools-workspaces/src/server.js:137-140` turns into `500 INTERNAL_ERROR`. Ten was
  chosen comfortably inside the ceiling, so the test shows the mechanism working and says nothing
  about where it stops working, and the sentence that does say it is an assertion about the world
  ("something is wrong") rather than about the code.
- The branch at `:90` is the only one in `store.js` that no test reaches, and it is the one that
  produces a failed upload of a client's specification.
- Severity: `stylistic` — the code is right for the class it serves, and what is missing is the
  statement of where that class ends. It is the same kind of observation as
  `findings/preanalyst-tests-rest.md` and `findings/front-gate-runner.md` 2.
- Smallest generalising change: one test at the ceiling — `MAX_ATTEMPTS + 1` concurrent writes,
  asserting whatever should happen — so that the limit becomes a decision with a name instead of a
  number that has never been reached.

---

## Noted, not raised as findings

- `api.test.js:68` — after eight refused uploads, `assert.rejects(readdir(path.join(root,
  project)), { code: "ENOENT" })`. The refusal and its absence of side effects asserted together,
  which is exactly what `store.js:63-65` was written to guarantee ("a refused file must not leave
  even the project's directory behind"). The property and its test were designed as a pair.
- `api.test.js:84-89` — the IP-pool test covers one route and one method. The equivalent test in
  `webtools/anagraphics/tests/test_api.py:605-628` covers ten paths and four writes, for the same
  property in a subsystem with the same rule. Two suites, one property, two depths.
- `store.test.js:99` — the test rebuilds the file name (`spec-v${…padStart(3, "0")}.md`) instead of
  importing it, because `fileName` is not exported. That makes the assertion an independent
  statement of the convention rather than a tautology, which is the right choice; it also means the
  convention is written in two places.
- Nothing in either suite drives a filesystem failure, so `findings/workspaces-server.md` 1 (every
  way of failing to store a file except one answered as `INTERNAL_ERROR`) is neither confirmed nor
  contradicted by a test.
- `store.test.js:56-57` and `api.test.js:71-77` both assert the "no specifications" case, and
  neither separates "the project directory does not exist" from "it exists and holds no
  `spec-vNNN.md`". Both are `null` and both are `404 SPEC_NOT_FOUND`, which is a deliberate
  conflation in `store.js`; untested as a distinction because there is none.
- `api.test.js:60` — the project id used for the invalid case is still the Italian string
  `"non-un-uuid"`. Today's rename of Italian identifiers, log lines and test data did not reach it.
  Recorded as an observation only: the audited rule is a different one, and the caller's brief says
  that breach is closed.
- `store.test.js:19-47` — five tests of the front matter module, including the case that matters
  most for a markdown document (`:23-24`: "A `---` in the middle of a document is a markdown
  horizontal rule") and a byte-order mark at `:25`. The module itself is `commons/specs`, unit 65;
  its tests live here, in one of the two subsystems that receive a copy of it.
