# preanalyst-tests-rest

Paths: `webtools/preanalyst/tests/prevalidator.test.js`, `webtools/preanalyst/tests/server.test.js`
Examined: 2026-09-25

The two remaining test files. `prevalidator.test.js` is the best test in the repository on this
audit's own subject: it builds its cases from `OUTCOMES` rather than from a list of its own, it
asserts the tie rule, and it tests explicitly that a **missing** outcome is not worth zero
(`:58-63`) — the rule under audit, written as an assertion. Two findings, both about what the
fixtures cannot see.

---

## 1. "The functions that decide are the ones that can be wrong" is a claim about the instance

- `webtools/preanalyst/tests/prevalidator.test.js:1-5` — "The call to the provider is not tested
  here — it costs and is not repeatable: what is tested are the functions that decide, **which are
  the ones that can be wrong**."
- Shape: **6 — the world narrowed to fit the code**
- Class: **the parts of the prevalidator that can be wrong.** The sentence divides them in two:
  `normalize`, `rejects` and `verdict`, which are pure and tested exhaustively, and everything else,
  which is presumed safe because it is a call. Everything else is `prevalidate()` — and both
  `breaks-now` findings of `findings/preanalyst-prevalidator.md` are inside it: the document cut at
  `specMaxChars` with no mark on the step, and the reason coerced to `""` that a later reader takes
  for "no reason on this step". Neither needs a provider: the first is a `slice`, the second a `??`.
- The reason they are untestable is structural, not inherent: `prevalidate` imports `decide`
  statically (`webtools/preanalyst/src/prevalidator.js:47`) and has no way to be handed another one,
  so the only way to reach the code around the call is to make the call. The suite then records
  that boundary as a statement about where defects live.
- Severity: `stylistic` — nothing is asserted wrongly; the claim in the header is what makes it a
  finding rather than a gap in coverage.
- Smallest generalising change: let `prevalidate` take the decider (or the policy text) as an
  argument, so that the reading of the answer can be tested without a provider — and then the
  sentence becomes true.

## 2. The fixture always sets the step name, and the function never reads it

- `webtools/preanalyst/tests/server.test.js:15-17` — every fixture step is
  `{ step: "prevalidation", result }` — against `webtools/preanalyst/src/server.js:391-394`, where
  `underspecifiedAttempts` filters on `entry.result === "underspecified"` and does not look at
  `entry.step` at all
- Shape: **6 — the world narrowed to fit the code**
- Class: **the steps a project's pipeline may contain.** The pipeline is an open register — "a step
  can repeat, and the list is the register of the decisions taken on the project"
  (`webtools/anagraphics/webtools_anagraphics/main.py:166-169`) — and the flow has more steps to
  come: analysis, validation, demo. The function counts, as rounds of rewriting, every step of any
  kind whose `result` happens to be the string `underspecified`; the test cannot notice, because
  every step it builds is a prevalidation.
- The consequence is the one the test file's own header names (`:3-6`): "If it were counted wrong,
  either somebody with rounds left would be refused, or we would never stop asking." A later stage
  that records `underspecified` — the analysis validator's vocabulary is a natural candidate —
  silently spends the client's rewriting rounds.
- Severity: `latent` — it takes a new kind of step using that word, which is a change somebody is
  entitled to make and would have no reason to connect to this counter.
- Smallest generalising change: filter on the step as well as the result, in the function, and let
  one fixture carry a step of another kind so the test would see it.

---

## Noted, not raised as findings

- `webtools/preanalyst/tests/prevalidator.test.js:15-18` — the `dist()` helper fills the outcomes a
  case does not name with zero, which is precisely the substitution `normalize` refuses to make. The
  suite knows: the one case about a missing outcome bypasses the helper and writes the partial
  object by hand (`:60-63`). A convenience that could have hidden the rule, and does not.
- `webtools/preanalyst/tests/prevalidator.test.js:68-72` — the all-zeros case is kept with a note
  that it is "the case that really happened". A real observation recorded as a member of the class
  rather than as an anecdote.
- **A different rule, recorded so it is not lost**: `CLAUDE.md` requires everything internal to be in
  English. `prevalidator.test.js` uses Italian identifiers — `sopra`, `sotto` (`:76-80`),
  `probabile`, `fuori`, `incerto` (`:86-95`), `valori` (`:101`) — and an Italian test value,
  `"alto"` (`:65`). Not a class-vs-instance defect.
- `webtools/preanalyst/tests/analysis_page.test.js` sits in the same directory and is in **no**
  inventory row. It is untracked in git and was not present when this run's inventory was computed,
  so it is new work arriving while the audit runs. Per the protocol the inventory is not recomputed,
  and the file is therefore **not audited**; it is recorded here so that the gap is visible rather
  than silent.
