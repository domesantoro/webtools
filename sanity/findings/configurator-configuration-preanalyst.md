# configurator-configuration-preanalyst

Path: `webtools/configurator/configuration/preanalyst.json`
Examined: 2026-09-25 (after the `ai.*` → `prevalidation.*` move made during this run)

The seed and the expected shape of the preanalyst's configuration. Several things in it are the
rule applied correctly and deliberately:

- `prevalidation.providers.anthropic` carries **no** `effort`, because the model it names
  (`claude-haiku-4-5`) rejects that field; the two analyst engines carry one. Absent is absent, and
  it is absent for a reason that is a fact about the model.
- `subsystems_infos.front_gate` carries a `url` and **no** `timeout_ms`, because that address is
  only ever put in an `href` and never called. A field that would mean nothing is not there.
- `subsystems_infos.anagraphics` carries no `url`, because the configuration came from anagraphics
  and the address is the one it came from.
- No key anywhere: they are in `secrets/`, which is the rule.

---

## 1. `prevalidation.max_tokens` is sized for the model beside it, and the two are validated apart

- `webtools/configurator/configuration/preanalyst.json:38-39` (`"model": "claude-haiku-4-5"`,
  `"max_tokens": 512`), read at
  `webtools/preanalyst/src/prevalidator_ai/providers/anthropic.js:64-68`
- Shape: **6 — the world narrowed to fit the code** (the pair is legal only under a restriction
  nobody stated)
- Class: **the models `prevalidation.providers.anthropic.model` may name.** 512 is enough for the
  JSON of a six-outcome distribution and a reason, and it is enough *only* on a model that does not
  think before answering. The provider's own comment says so at `:65-67`: "The ceiling of the
  answer, **thinking included**. On a model that thinks it is not the size of the decision: a
  ceiling cut to the size of the JSON stops the answer half way, and a cut answer is paid for and
  thrown away." The author knows the two fields are coupled; the configuration does not.
- What breaks, on an entitled change: pointing this model at anything in the current Opus or
  Sonnet families — the obvious move if the prevalidation is judged too crude — leaves `max_tokens`
  at 512 while the model now reasons before answering. Every call stops at the ceiling,
  `stop_reason` is `max_tokens`, every prevalidation returns `rejected`, and every client request
  fails the gate while the tokens are paid for. The server starts, nothing in the configuration
  looks wrong, and the failure is at the first client.
- Severity: `latent`
- Smallest generalising change: read `max_tokens` as a fact about the chosen model rather than a
  free integer — a floor tied to what that model needs, refused at startup like any other bad
  configuration.

## 2. `prevalidation.spec_max_chars` is the size of one answer, applied to the document made of all of them

- `webtools/configurator/configuration/preanalyst.json:45` (`"spec_max_chars": 20000`) against
  `:28` (`"answer_max_chars": 20000`), applied at
  `webtools/preanalyst/src/prevalidator.js:175` (`spec.slice(0, specMaxChars)`)
- Shape: **6 — the world narrowed to fit the code**
- Class: **the pre-specifications the prevalidator may be asked to judge.** The two limits are the
  same number, and that is the tell: the ceiling was sized for a single open answer and then
  applied to the document assembled from all of them. The form has four textareas
  (`webtools/preanalyst/src/questions.js`), each allowed 20000 characters, plus the question
  headings the template adds, inside a form body capped at 512 KB
  (`form.body_max_bytes`). Two long answers already exceed the ceiling.
- What breaks: `spec.slice()` is silent. A client who writes a genuinely detailed brief has the
  tail of it cut off before the model ever sees it, and is then judged — passed, sent back, or
  **refused** — on a partial reading of their own request. Nothing logs it, the stored
  pre-specification is complete, and the verdict looks as well-formed as any other. The settings
  file calls this field "a safety net: the open answers are already limited at submission time"
  (`webtools/preanalyst/src/settings.js:65-66`), which is true of each answer and not of their sum.
- Severity: `latent` — reachable by an ordinary long form rather than only by an absurd one, and
  silent when reached.
- Smallest generalising change: make the ceiling a fact about the document rather than about one
  field, and — whatever the number — log or refuse when it actually cuts, so that a truncated
  judgement is never mistaken for a judgement.

---

## Noted, not raised as findings

- `:44` — `"max_underspecified_attempts": 100` makes refusal-by-exhaustion effectively
  unreachable, which in turn makes the `not_recognised` branch of
  `webtools/preanalyst/src/server.js:1075` dead in practice. A value chosen to keep a gate open
  during development is a legitimate thing for a seed file to hold; it is recorded because it means
  that path is not exercised by anything.
- All addresses are `127.0.0.1`. That is what a seed for a new environment is, not a defect.
