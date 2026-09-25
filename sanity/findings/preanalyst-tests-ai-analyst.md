# preanalyst-tests-ai-analyst

Paths: `webtools/preanalyst/tests/prevalidator_ai.test.js` (renamed from `ai.test.js` during this
run), `webtools/preanalyst/tests/analyst.test.js`
Examined: 2026-09-25

These tests are unusually class-aware in places, and exactly instance-shaped in others. Both are
worth stating, because the rule's own warning is about tests: code written for the instance "passes
the tests, because the tests are drawn from that same instance".

**Where they test the class properly** — this is most of the configuration surface, and it is good
work:

- `prevalidator_ai.test.js:18` puts the configuration section in a `BASE` constant with the note
  "It is the caller's word, not the module's assumption, so the tests say it too". When that
  section was renamed during this run, the test needed one line changed rather than a sweep.
- `prevalidator_ai.test.js:114-131` tests that an **unselected** provider's broken configuration is
  not read — the general case, not the configured one.
- `prevalidator_ai.test.js:87-104` and `analyst.test.js:61-82` test `effort` both ways: absent stays
  absent, wrong stops the server.
- `analyst.test.js:84-94` tests that an operator channel the provider cannot do stops the server,
  which is the whole reason that field is configuration rather than a guess.
- `analyst.test.js:136-148` tests `readScores` against four wrong members of the class — missing
  axis, out of range, wrong type, nothing at all — and `:150-163` tests `decide` against verdicts
  that are not verdicts. These are tests of the class, and the code they cover is the code this
  audit found nothing wrong with. That is not a coincidence.

---

## 1. The two-role assumption is not merely untested — it is asserted as the specification

- `webtools/preanalyst/tests/analyst.test.js:96-116` (`conversationOf`), in particular the comment
  at `:110` — "The two roles of the stored chat become the API's two" — and the assertion at
  `:111-114`; and `:165-173` (`dossierOf`), asserting `**Client:**` and `**Analyst:**`
- Shape: **6 — the world narrowed to fit the code**, applied to the tests themselves
- Class: **the roles a stored chat entry may carry.** The findings against
  `webtools/preanalyst/src/analyst.js:68` and
  `webtools/preanalyst/src/analysis_validator.js:99` are that everything which is not `client`
  silently becomes the assistant. These tests fix that behaviour in place: the fixture contains
  exactly `client` and `system`, and the assertion is that there are exactly two output roles in
  exactly that order.
- Why this matters more than an ordinary coverage gap: a test that is silent about a case leaves it
  open, but a test that asserts the collapse makes the defect load-bearing. Anyone who later fixes
  `conversationOf` to handle a third role properly will see this test go red and will reasonably
  conclude they broke something. The instance has been written down as the specification.
- Severity: `latent`
- Smallest generalising change: add a case with a role neither module knows, and assert what should
  happen to it — which forces the question to be answered once, in the code, rather than assumed in
  four places.

## 2. The response side of both providers is untested, and that is where the findings are

- `webtools/preanalyst/tests/prevalidator_ai.test.js:3-6` and
  `webtools/preanalyst/tests/analyst.test.js:4-5`, which both draw the boundary at "no call to any
  provider — it costs and is not repeatable"
- Shape: **5 — only the outcome that succeeds is handled**, in the test suite's coverage
- Class: **the answers a provider may return.** Not making a real call is right and the reason
  given is sound. But the boundary was drawn at the *call*, when what needs testing is the
  *reading of the answer* — and that needs no call at all, only a response object. Everything from
  `stop_reason` onwards is therefore unexercised: the stop reasons that are neither `max_tokens`
  nor `refusal` (`prevalidator_ai/providers/anthropic.js:123`,
  `analyst_ai/providers/anthropic.js:166`), the body that is not JSON, and the `usage` object with
  a counter missing, where `?? 0` writes a zero into the cost ledger.
- Every finding recorded against those two provider files lives in the untested half. The
  configuration half, which is thoroughly tested, produced no findings. The suite's shape and the
  code's defects line up precisely, which is the rule's prediction.
- Severity: `stylistic` — this is a statement about coverage, not a defect in the tests
- Smallest generalising change: test `decide`/`converse` against fabricated response objects, one
  per outcome the answer can have, without any provider call.

---

## Noted, not raised as findings

- `analyst.test.js:118-126` asserts "One turn is not '1 turns'", covering the singular/plural case
  in the operator note. The same care is the thing missing from
  `preanalyst.analysis.exhausted.lead` in the catalogues (finding 1 of
  `findings/commons-i18n-locales.md`) — and that one is read by a client, while this one is read by
  a model.
- `analyst.test.js:119-125` fixes the "nearly out of turns" threshold behaviour at 2 vs 9, which
  encodes the literal `3` from `webtools/preanalyst/src/analyst.js:96`. If that constant becomes
  configuration, as `CLAUDE.md` asks, this test changes with it.
