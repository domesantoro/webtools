# preanalyst-analysis-validator

Path: `webtools/preanalyst/src/analysis_validator.js`
Examined: 2026-09-25

The second judgement on the analysis: it scores four axes and turns them into a verdict. A careful
file. `readScores` (`:67-76`) refuses a partial judgement rather than working with three axes out
of four, and `decide` (`:86-90`) resolves every unknown verdict towards `continue`, which is the
direction that costs a question instead of a sale — both are the rule applied correctly, on
purpose.

---

## 1. The axes and verdicts are fixed in code while the policy that defines them is configuration

- `webtools/preanalyst/src/analysis_validator.js:30` (`AXES`), `:32` (`VERDICTS`), `:36-51` (the
  schema built from them), `:69-73` and `:87` (the reading that enforces them)
- Shape: **6 — the world narrowed to fit the code**
- Class: **the policies `analyst.validation.policy` may name.** It is a configured string
  (`webtools/configurator/configuration/preanalyst.json`, currently `analysis-validation-v1`), and
  the policy file is configuration too — `CLAUDE.md` is explicit that an artefact saying "what the
  system considers acceptable" lives in `webtools/configurator/policies/` and that "the JSON
  configuration says *which* one is used; the file says *what* it asks for". This file assumes
  every policy the field can name scores exactly `completeness`, `consistency`, `testability`,
  `scope`, and returns exactly `pass` or `continue`.
- The file's own header says "the criteria are in the policy … here there is only how the answer is
  read". They are in both: `analysis-validation-v1.md:17-29` names the four axes and the code names
  them again, and the two must agree byte for byte.
- What breaks, on an entitled change: writing `analysis-validation-v2` with a fifth axis, a renamed
  axis, or a third verdict, and pointing the configuration at it — the documented way to change
  what the system considers acceptable. The model answers per the new policy, the old schema
  rejects it or `readScores` returns `null`, and the client sees `ANALYST_UNAVAILABLE`
  (`webtools/preanalyst/src/server.js:724`) — an outage, not a configuration error naming the
  mismatch. Worse, a renamed axis that still parses would be scored against the wrong policy's
  threshold in silence.
- Severity: `latent`
- Smallest generalising change: let the policy declare its own axes and verdicts, and read the
  schema, the score check and the threshold comparison from that declaration instead of from
  constants beside the reader.

## 2. Every chat role that is not `client` is labelled to the judge as "Analyst"

- `webtools/preanalyst/src/analysis_validator.js:99`
- Shape: **6 — the world narrowed to fit the code**
- Class: **the roles a stored chat entry may carry.** Same class as the finding at
  `webtools/preanalyst/src/analyst.js:68`, and the same assumption in a second place: two members,
  one of which is `client`. Today the writer pushes `client` and `system`
  (`webtools/preanalyst/src/server.js:743-751`), so the labelling is correct.
- Here the consequence is sharper than in the analyst. This text is the *material of a judgement*:
  a third role added later — a driver's note, an imported remark, a system notice — would be
  presented to the validator as something the analyst said, and the analyst would be graded on
  words it did not write. The verdict would be wrong and would look perfectly well-formed.
- Severity: `latent`
- Smallest generalising change: label each known role explicitly and refuse to build the dossier
  from an entry whose role the validator has no label for.

## 3. A policy name that has no file throws instead of failing the documented way

- `webtools/preanalyst/src/analysis_validator.js:55-61` (thrown from `readFile`, `:57`), against
  the contract at `:16-19`
- Shape: **5 — only the outcome that succeeds is handled**
- Class: **the values `analyst.validation.policy` may hold.** Identical in kind to the finding at
  `webtools/preanalyst/src/analyst.js:48-55`; recorded separately because it is a second file with
  its own copy of the code and its own configured field, and fixing one will not fix the other.
- Here the caller's failure branch (`webtools/preanalyst/src/server.js:719-725`) is the one that
  deliberately keeps the conversation open rather than closing on an unchecked claim. Bypassing it
  with an exception loses that protection as well as the error code.
- Severity: `latent`
- Smallest generalising change: as for the analyst — verify the configured policy files exist when
  the settings are read at startup.

## 4. `operator_channel` is required of an engine that never sends an operator instruction

- Required at `webtools/preanalyst/src/analyst_ai/providers/anthropic.js:77-82`; this engine never
  supplies one (`webtools/preanalyst/src/analysis_validator.js:108-112` passes no `operator`)
- Shape: **1 — what only part of the class needs, treated as required**
- Class: **the engines that use the `analyst_ai` door.** Two members today,
  `analyst.conversation` and `analyst.validation`. Only the first has an operator instruction; the
  configuration demands the field of both, so `analyst.validation.providers.anthropic.operator_channel`
  states a fact about a channel that is never used.
- Nothing breaks. The cost is that the configuration contains a claim nobody can verify by running
  the system: set it wrong for the validation engine and everything keeps working, which is
  precisely the condition under which a configuration value stops being trustworthy.
- Severity: `stylistic`
- Smallest generalising change: make `operator_channel` required only of an engine that sends
  operator instructions, so the field's presence means it is in use.

---

## Noted, not raised as findings

- `webtools/preanalyst/src/analysis_validator.js:89` — `scores[axis] > threshold` is strict, so a
  score exactly equal to `pass_threshold` fails. A boundary choice, consistently applied; not a
  class defect.
- `:128` — the same `Array.isArray(output.missing) ? … : []` coercion as in the analyst. Below the
  bar for the same reason.
