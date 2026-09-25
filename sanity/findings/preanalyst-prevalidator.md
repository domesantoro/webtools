# preanalyst-prevalidator

Paths: `webtools/preanalyst/src/prevalidator.js`, `webtools/preanalyst/scripts/prevalidate.js`
Examined: 2026-09-25

The first gate: it reads the pre-specification, asks the model for a distribution over six
outcomes, normalises it and turns it into one of three decisions. The module is careful where it
matters — it refuses to invent a distribution rather than patch one (`:126`, `:129`), it returns
`usage` on the failure path too (`:189`), it breaks ties towards the most cautious outcome
(`:136-142`), and the criteria live in the policy rather than in the code. Four findings, one of
them reachable today.

---

## 1. The pre-specification is silently cut at 20 000 characters, and the form can already write more

- `webtools/preanalyst/src/prevalidator.js:172-176` — `document: spec.slice(0, specMaxChars)`, and
  the comment above it: "The cut is a safety net, not a check: the open answers are already limited
  at submission time (`form.answer_max_chars`)."
- Shape: **4 — capability inferred from resemblance**, with **6 — the world narrowed to fit the
  code**
- Class: **the pre-specifications the form can produce.** The code treats `spec_max_chars` as a
  bound that is never reached, on the strength of another, independent configured field.
- The two numbers are not the same number. `form.answer_max_chars` is **per open answer**
  (`webtools/preanalyst/src/server.js:313` → `readAnswers(form, settings.answerMaxChars)`);
  `prevalidation.spec_max_chars` bounds **the whole rendered document**. As configured today both
  are `20000` (`webtools/configurator/configuration/preanalyst.json:28` and `:46`), and the
  document is not the answers: on top of them the template adds the YAML front matter, a title, a
  `##` per section, a `###` per field, the "Open points" list
  (`webtools/configurator/documents/prespec.md.njk`) and, for every open answer, two characters per
  line from the `quote` filter (`webtools/preanalyst/src/prespec.js:52-57`). One open answer at the
  limit the form itself allows therefore produces a document **over** the cut, before the other
  four fields have been counted.
- What happens then: the model judges a document whose end has been removed, with no log line, no
  flag on the step and nothing in the stored decision to say it was reading a fragment. The part
  removed is the tail — the last sections and the "Open points" list, i.e. exactly the evidence
  that the request is under-specified. The prevalidation is recorded as an ordinary one, and a
  refusal produced from a truncated document is indistinguishable from a refusal produced from the
  request the client actually wrote.
- Severity: `breaks-now` — no change to code or configuration is needed; a long first answer is
  enough, and 20 000 characters is what the form invites.
- Smallest generalising change: treat "the document does not fit" as a real member of the class
  rather than an impossible one — decide at the boundary what happens to an oversized
  pre-specification (refuse the submission, or record on the step that the judgement was made on a
  truncated document), instead of cutting silently.

## 2. A configured policy name is assumed to have a deployed file (third site)

- `webtools/preanalyst/src/prevalidator.js:108-116` (thrown from `readFile`, line 110), against the
  contract stated at `:34-38`
- Shape: **5 — only the outcome that succeeds is handled**
- Class: **the values `prevalidation.policy` may hold.** A configured string, read from Mongo at
  startup; the code assumes every value it can hold names a `.md` that the policies deployer has
  put in `webtools/preanalyst/policies/`.
- The documented contract is `{ ok: false, reason: "unavailable" | "rejected" | "unknown_provider" }`.
  A renamed policy, a new version configured before the deployer has run, or a deployer that ran
  for some subsystems and not this one, all raise an exception out of `prevalidate` instead. The
  caller's failure branch (`webtools/preanalyst/src/server.js:521-535`, which marks the step
  `failed`, keeps the project and goes on) is bypassed, so the project is left in whatever state
  the exception found it in rather than in the state the module documents.
- This is the same defect already recorded at `webtools/preanalyst/src/analyst.js:48-55` and
  `webtools/preanalyst/src/analysis_validator.js:57`. It is the **third** site, which is the point:
  the assumption is not in one place to be fixed, it is in every place that reads a policy.
- Severity: `latent`
- Smallest generalising change: as before — verify the configured policy files at startup, in
  `settings.js`, where all three names are already in hand, so that an unusable name stops the
  subsystem instead of one request.

## 3. A reason the model did not write becomes an empty string, and downstream that reads as "no reason on this step"

- `webtools/preanalyst/src/prevalidator.js:199` and `:201` — `String(output.off_domain?.reason ?? "")`,
  `String(output.reason ?? "")`
- Shape: **2 — invented value**
- Class: **the answers the model may return.** `reason` and `off_domain.reason` are `required` in
  `SCHEMA` (`:100`, `:95`), so the coercion exists precisely for the case where the contract was not
  honoured — that is, for an absence. The absence is replaced by `""`.
- Where it lands: the step is stored with `data: outcome.data`
  (`webtools/preanalyst/src/server.js:552-557`), and the rejection PDF looks the reason up with
  `steps.reverse().find((entry) => entry.step === "prevalidation" && entry.data?.reason)`
  (`webtools/preanalyst/src/server.js:918`). An empty string is falsy, so the search does not stop
  at the step that decided: it **walks back to an earlier prevalidation step**, from a previous
  round, on a previous version of the document, and prints that reason as the reason for this
  refusal. An invented empty value has become a wrong attributed statement, which is worse than a
  missing one.
- Severity: `latent` — reaching it needs the provider to omit a field the schema requires.
- Smallest generalising change: keep the absence as an absence (leave the field out, or carry
  `null`), and let the reader decide what to do with "the model gave no reason" — which is a fact,
  and a different one from "the reason is empty".

## 4. The command-line tool drops the cost of the attempts that fail

- `webtools/preanalyst/scripts/prevalidate.js:34-37`
- Shape: **5 — only the outcome that succeeds is handled**
- Class: **the two shapes `prevalidate` returns.** The module's own contract
  (`webtools/preanalyst/src/prevalidator.js:34-42`) says the failure shape carries `usage` and
  `model` whenever the model answered, and states why: "Even when things go wrong, if the model
  answered the tokens have been spent… A cost that cannot be seen is not measured." The script
  prints `outcome.reason` and exits, discarding both.
- This matters here more than it would elsewhere: the script's stated purpose is to see what a
  policy costs and how it judges (`:8-12`), and the server's own failure branch does record the
  spent tokens (`webtools/preanalyst/src/server.js:526-537`). The tool built to measure the cost is
  the one place that loses it.
- The failing shape is reachable with no change at all — an unusable distribution returns
  `{ ok: false, reason: "rejected", usage, model }` (`webtools/preanalyst/src/prevalidator.js:189`).
- Severity: `breaks-now` by reachability; the consequence is bounded — a manual tool prints one
  line less, and the operator sees the error.
- Smallest generalising change: print `usage` when the failure carries it, as the server does.

## 5. The manual cost report counts two token fields out of however many there are

- `webtools/preanalyst/scripts/prevalidate.js:50` — `${usage.input_tokens} in, ${usage.output_tokens} out`
- Shape: **6 — the world narrowed to fit the code**
- Class: **the counters a `usage` may carry.** The same assumption already recorded against
  `webtools/preanalyst/src/prevalidator_ai/providers/anthropic.js:115-118`, where the ledger keeps
  only those two fields on the argument that this model's cache never switches on. Here it is the
  human-facing half: whoever runs the script to measure what a policy costs reads a number that
  silently stops being the whole number the day caching starts.
- Severity: `latent`, and `uncertain` in the same way as the provider finding — which fields a
  given model may report is not something this audit asserts.
- Smallest generalising change: print whatever `usage` contains, rather than the two fields it is
  expected to contain.

---

## Noted, not raised as findings

- `webtools/preanalyst/src/prevalidator.js:52-68`, `:83-102` — the six outcome names, the two that
  refuse and the schema are all in this file, while the criteria that produce them are in the
  policy, which is configuration and versioned by name (`scope-v1`). The two halves are coupled by
  string and nothing checks that they agree: a policy version that renamed or added an outcome
  would be rejected by `additionalProperties: false` at every call, as a provider failure. This is
  a coupling declared openly in the header comment rather than a hidden assumption, and the failure
  is loud, so it is recorded rather than raised.
- `webtools/preanalyst/src/prevalidator.js:121-144` — `normalize` refuses the whole distribution if
  any one of the six numbers is unusable, instead of treating the missing ones as zero. That is the
  opposite of what this audit hunts, and worth keeping.
- `webtools/preanalyst/src/prevalidator.js:161-165` — `verdict` returns `"passed"` for every
  outcome that is neither rejecting nor `underspecified`. Correct for the class as this file
  defines it, since `OUTCOMES`, `REJECTING` and `UNDERSPECIFIED` are declared together a few lines
  above; noted only because "everything else passes" is the shape that goes wrong when the list
  stops being local.
- `webtools/preanalyst/scripts/prevalidate.js:28` — a missing or unreadable file leaves an
  unhandled rejection, while a missing argument gets a usage line and exit code 2 (`:21-25`). Two
  members of the same class — "the tool was called wrongly" — handled two different ways. Below the
  bar for a script, recorded so it is not lost.
