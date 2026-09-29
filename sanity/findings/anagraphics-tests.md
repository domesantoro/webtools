# anagraphics-tests

Paths: `webtools/anagraphics/tests/test_api.py`,
`webtools/anagraphics/tests/test_load_configuration.py`
Examined: 2026-09-26

The larger of the two is the most complete suite in the repository: every route, every error code
asserted as a whole response body rather than a status, the IP pool checked on reads *and* writes
(`:605-628`), the expired session that must still come back (`:500-509`), the ticket that must fail
the second time (`:578-582`). `test_load_configuration.py` is better still — 88 lines that test one
thing each, and `test_a_field_that_is_there_is_never_touched` (`:27-37`) is the whole class stated
at once: `0`, `False`, `None` and `""` are values, and anyone reading truthiness instead of
presence would lose all four.

The findings are of the kind the audited rule predicts for tests specifically: "it passes the
tests, because the tests are drawn from that same instance". Two of them are places where a
narrowing recorded elsewhere in this audit is written down here as the specification, so correcting
it will read as breaking the suite; the third is the suite itself holding only under one order.

---

## 1. Three narrowings recorded against the code are asserted here as intended behaviour

- `webtools/anagraphics/tests/test_api.py:322-333` —
  `test_add_pipeline_step_with_invented_names` asserts that `step`, `state` and `result` outside the
  three `Literal`s are refused. The tests around it assert that *any* legal value may follow any
  other: `:275-282` posts `failed` then `passed` on one project; `:296-310` goes
  `UNDERSPECIFIED → UNDERSPECIFIED → ANALYSIS`; `:285-293` goes straight to `REJECTED`. Nothing
  asserts that a combination of legal names can be refused, because none is.
- `webtools/anagraphics/tests/test_api.py:461-465` —
  `test_locale_must_be_a_language_code` asserts that `"Italian"`, `""` and a missing field are
  `400 INVALID_BODY`, and nothing asserts what happens to `pt-BR` or `en-GB`.
- `webtools/anagraphics/tests/test_api.py:649-656` — `test_database_unavailable` raises
  `ServerSelectionTimeoutError`, the one member of the Mongo failure class the handler covers, and
  `:659-667` raises `RuntimeError` for the other handler. Nothing raises `OperationFailure`.
- Shape: **6 — world narrowed to fit the code**
- Class: **what the suite establishes as the contract.** Each of these three is the exact boundary
  recorded as a finding against the code — `findings/anagraphics-main.md` 2 and 3,
  `findings/anagraphics-settings-credentials-errors.md` 1 — and in each case the test is written up
  to that boundary and stops. The test is not wrong about the code; it is written from the same
  instance the code was written from, which is why it cannot notice.
- What that costs is specific and is the reason it is raised rather than noted: the suite is now
  the obstacle to the fix. Adding transition validation to `add_pipeline_step` breaks
  `test_add_pipeline_step_appends_in_order` and `test_add_pipeline_step_underspecified`; widening
  the locale pattern breaks nothing but is certified by nothing either; widening the Mongo handler
  to `PyMongoError` breaks `test_internal_error` if the monkeypatched failure is ever a pymongo
  one. A person making any of the three will see red tests and read them as a regression.
- The same pattern is already recorded once in `summary.md`, for the two-role chat:
  "`tests/analyst.test.js:110` asserts it as the specification, so fixing the code will read as
  breaking the tests."
- Severity: `latent`
- Smallest generalising change: for each of the three, add the assertion that names the boundary as
  a decision rather than as an accident — a test that a move the flow does not allow is refused (or
  a comment saying no move is refused and why), a test that says what a regional locale does, a
  test that raises an `OperationFailure`. A boundary nobody has written a test for is a boundary
  nobody has decided.

---

## 2. The test for "a decided step is not rewritten" exercises the case that cannot fail

- `webtools/anagraphics/tests/test_api.py:717-728` — `test_closed_step_is_not_updated`, docstring
  "A step that has decided something is not rewritten: it is the register of decisions." It posts a
  `prevalidation` step with `result: "passed"` — a step that was **never open** — and asserts that
  PATCHing `prevalidation` answers `404 OPEN_STEP_NOT_FOUND`.
- Shape: **6 — world narrowed to fit the code**
- Class: **the ways a step can come to have decided something.** There are two. One is the step
  that arrives already decided, which is what this test posts and which `update_open_step` can
  never match because no record of it has `result == "open"`. The other is the one the property was
  written for: a step opened, worked in, and then superseded — the analysis chat, which is the only
  `open` step that exists (`main.py:144-148`). That one is **not** covered, and on it the property
  does not hold: appending a closing `analysis` step leaves the `open` record exactly as it was, so
  the same PATCH goes on succeeding. That is finding 1 of `findings/anagraphics-db.md`, and the
  test standing three lines away from it is the one that would have caught it.
- The suite has everything needed: `an_open_analysis_step()` at `:701-708` and
  `a_prevalidation_step()` at `:234-253` are both in the file, and the missing test is the two of
  them in sequence with the same step name.
- Severity: `latent`
- Smallest generalising change: open an `analysis` step, append a second `analysis` step with
  `result: "passed"`, then PATCH — and assert what should happen. Whatever the answer turns out to
  be, it becomes a decision instead of a gap.

---

## 3. The suite holds only in the order the file is written in

- `webtools/anagraphics/tests/test_api.py:99-113` — one `scope="module", autouse=True` fixture,
  one database for the whole file, no per-test isolation and no cleanup between tests
- `webtools/anagraphics/tests/test_api.py:394-398` — `test_user_found` asserts
  `response.json() == USER`, an exact equality, where `USER` (`:72-78`) has no `locale`
- `webtools/anagraphics/tests/test_api.py:448-453` — `test_user_locale` writes `locale: "it"` onto
  that same user and leaves it there
- Shape: **6 — world narrowed to fit the code**
- Class: **the orders in which this suite may be run.** Default pytest collection is file order, so
  `test_user_found` happens to run 54 lines before the write that would break it. Every other
  member of the class is reachable with the tools that are already installed and no change to
  anything: `pytest tests/test_api.py::test_user_locale tests/test_api.py::test_user_found` fails,
  `-p randomly` fails about half the time, and running the two files under `pytest-xdist` fails
  whenever the split puts them in different workers in the wrong sequence. The failure reads as a
  defect in `GET /users/{username}`, which is not where it is.
- The suite already knows how to be order-independent and does it in the one place where somebody
  noticed: `test_spend_turns_refuses_more_than_the_credit` (`:757-766`) reads the balance first and
  asserts relative to it, instead of asserting the number that follows from
  `test_spend_turns_reduces_the_credit` having run.
- Severity: `latent`
- Smallest generalising change: either assert on the fields the test is about rather than on whole
  documents that other tests write to, or give the write its own user. The comparison to a whole
  literal document is the good habit here; the shared mutable fixture is what makes it fragile.

---

## Noted, not raised as findings

- `:21-23` — the module writes the anagraphics configuration into Mongo at import time, before
  `from webtools_anagraphics.main import app`, because importing `main` reads it. The dependency is
  stated in a comment at `:15`. If Mongo is not running, the file raises
  `ServerSelectionTimeoutError` at collection time and the whole suite errors with a traceback
  rather than a sentence. A precondition of the suite, not of the class the code serves.
- `:11` and `:672-676` — the suite works on `webtools_test`, dropped at `:113`, and one test points
  `WEBTOOLS_MONGO_DB` at `webtools_test_empty`, which is only read, so Mongo never creates it.
  Nothing of the running system is touched.
- `:7-12` — `TEST_ENV` repeats the four bootstrap values rather than sourcing `bootstrap.env`, and
  `test_settings_from_configuration` (`:664-668`) asserts `("127.0.0.1", 9100)`. That is the right
  choice for a test — the suite should not change meaning when an operator edits an environment
  file — and is noted only because it means the port in `bootstrap.env` is asserted in two places
  that do not know about each other.
- `:605-628` — `test_ip_outside_pool_is_rejected` covers an address outside the pool on reads and
  writes and on an unknown route. It does not cover `request.client is None` (`main.py:33`), the
  other member of that class, which is handled correctly in the code and asserted nowhere.
- `main.py:235-240` — the `PATCH` with neither `set` nor `push`, which returns the project
  unchanged, is covered by no test. The same kind of coverage observation as
  `findings/preanalyst-tests-rest.md`.
- `:103` — the fixture seeds a project consisting of a `project_id` and nothing else, mirroring
  `scripts/seed.py:13-15`, and `test_project_found` (`:143-146`) asserts that exact shape comes
  back. The test is right about the code; the document is the one noted at
  `findings/anagraphics-scripts.md`.
- `test_load_configuration.py:1-8` — the docstring says which part of the script is worth covering
  and why ("the rest of the script is I/O"). It is a stated coverage boundary, which is more than
  most files in the repository offer. It also happens to exclude the two findings recorded at
  `findings/anagraphics-scripts.md` 1 and 2, both of which live in the I/O part.
