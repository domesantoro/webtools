# preanalyst-analyst-ai

Paths: `webtools/preanalyst/src/analyst_ai/webtools_analyst_ai.js`,
`webtools/preanalyst/src/analyst_ai/providers/anthropic.js`
Examined: 2026-09-25

The chat's provider door and its one provider. This unit was checked against the Anthropic API
reference rather than from memory, because most of what it claims is a claim about what a model
supports, and guessing that is the defect being hunted.

**What is right here, and deliberately so** — worth saying, because it sets the bar the findings
below are measured against:

- `operator_channel` is *configuration*, not a guess made from the model's name
  (`providers/anthropic.js:44-47, 77-82`). The reference confirms the underlying fact: a `system`
  role inside `messages` is accepted on Opus 5, Opus 4.8 and the Fable/Mythos families and **not**
  on Sonnet 5. Deriving it from the model string would have been shape 4 exactly.
- The placement the provider uses is the one the API requires: the operator message is appended
  after the final `user` message and is the last entry (`providers/anthropic.js:117-123`,
  fed by `analyst.js:70`).
- `effort` is optional and absent is not a default (`providers/anthropic.js:65-76, 144-146`). The
  reference confirms the stated reason: `effort` errors on Haiku 4.5, and the prevalidator's
  configuration — which points at `claude-haiku-4-5` — correctly carries no `effort` field.
- One client per key-and-timeout rather than one per process (`providers/anthropic.js:97-112`),
  so the two engines' separate keys cannot be crossed.
- `betas: ["server-side-fallback-2026-07-01"]` with `fallbacks: "default"` is the current form of
  that feature, and `EFFORTS` matches the current level set.

---

## 1. Adaptive thinking assumed to be a property of the family, not of the model

- `webtools/preanalyst/src/analyst_ai/providers/anthropic.js:19-22` (the stated premise) and
  `:131-152` (the request, which never sends `thinking`)
- Shape: **1 — what only part of the class offers, treated as given** (and **4**, since the premise
  rests on the model currently configured)
- Class: **the values `analyst.conversation.providers.anthropic.model` and
  `analyst.validation.providers.anthropic.model` may hold.** They are read as a bare
  `configuration.string` (`providers/anthropic.js:84`) with no constraint at all. The code assumes
  a model on which *omitting* the `thinking` parameter yields adaptive thinking — the comment says
  "on this family it is on unless it is asked not to be".
- That is true of the model configured today, `claude-opus-5`, and of Sonnet 5. It is **not** true
  of Opus 4.8 or Opus 4.7, where omitting `thinking` runs the model *without* thinking and adaptive
  has to be asked for explicitly, nor of Haiku 4.5, which has no adaptive mode at all. The premise
  was read off the instance in front of the author.
- What breaks, and on what entitled change: editing `model` in the running configuration — the one
  thing the configuration subsystem exists to allow, and the obvious lever when the chat is too
  expensive — to `claude-opus-4-8` silently turns thinking off. The request still succeeds, the
  schema is still satisfied, `effort` is still accepted; only the quality of the analysis drops,
  with nothing anywhere saying why. A silent quality regression is worse than a 400.
- Severity: `latent`
- Smallest generalising change: make the thinking mode an explicit, configured fact of the model
  beside `operator_channel`, and send it, so that a model change states what it is asking for
  instead of inheriting a default that differs per model.

## 2. Token counters invented when the provider does not report them

- `webtools/preanalyst/src/analyst_ai/providers/anthropic.js:159-164`
- Shape: **2 — an absence filled with an invented value**
- Class: **the shapes a `usage` object may come back in** — present or absent, and each of its four
  fields present or absent. The code assumes that a missing count means a count of zero:
  `response.usage?.input_tokens ?? 0`, and the same for the other three.
- Zero is not "unknown". These numbers are the PoC's whole purpose — `CLAUDE.md` says the PoC
  exists "to measure the real AI cost of a webtool" — and they are written into the project's chat
  record at `webtools/preanalyst/src/server.js:749`. A turn whose usage was not reported enters the
  ledger as a turn that cost nothing, indistinguishable from a turn that genuinely did. The
  measurement is then wrong in the one direction nobody checks, because nothing looks anomalous.
- Note the internal contradiction: either these fields are always present, and the four `?? 0` are
  dead code guarding nothing, or they are not, and the substituted zeros are false. The comment
  one line above — "From here on the tokens have been spent, whatever happens next" — states the
  opposite of what the code then records.
- Severity: `latent`, with an `uncertain` component: I have not established which of the four
  fields the API may omit and on which models, and asserting it would be the same defect. What
  would settle it: the documented response shape for `usage` per model, in particular whether the
  two cache counters are omitted rather than returned as 0 on a model or request that does no
  caching.
- Smallest generalising change: record absent as absent — leave the field out of `usage` when the
  provider did not report it — so a turn of unknown cost is visibly unknown downstream.

## 3. Only two stop reasons are treated as failures; every other value is treated as a complete answer

- `webtools/preanalyst/src/analyst_ai/providers/anthropic.js:166`
- Shape: **5 — only the outcome that succeeds is handled**
- Class: **the values `stop_reason` may take** — `end_turn`, `max_tokens`, `stop_sequence`,
  `tool_use`, `pause_turn`, `refusal`, and whatever is added next. The code names two of them as
  failures and, by omission, treats all the rest as a finished answer worth parsing.
- Only `end_turn` actually means a complete answer here. The honest test is positive (is this the
  reason that means "done"?), not negative (is this one of the two I happened to know about?).
- Mitigation, stated so this is not overplayed: a truncated or unfinished body will almost always
  fail the `JSON.parse` at line 181 and end up as `rejected` anyway, and `pause_turn` cannot arise
  today because no server tools are declared. The damage is a misattributed failure reason, not
  corrupt data — unless a future value arrives alongside well-formed JSON.
- Severity: `latent`
- Smallest generalising change: accept `end_turn` and fail everything else with the reason named,
  rather than listing the failures.

## 4. `max_tokens` has a floor and no ceiling, on a call that is not streamed

- `webtools/preanalyst/src/analyst_ai/providers/anthropic.js:88` (`{ min: 1 }`) used at `:131-133`
  (`beta.messages.create`, not `.stream`)
- Shape: **6 — the world narrowed to fit the code**, from the other side: the code is legal only
  for the range of `max_tokens` the author happened to configure.
- Class: **the values `max_tokens` may be configured to.** It is currently `16000`, which is the
  sane non-streaming figure; the validation permits anything from 1 upwards. The models in play
  accept up to 128K output, and the SDK requires streaming at that size or the request hits the
  HTTP timeout instead of returning.
- What breaks, on an entitled change: raising `max_tokens` in the running configuration to give
  the analyst room produces timeouts, not longer answers. Worse for the ledger — a timeout returns
  `{ok:false, reason:"unavailable"}` with no `usage` at all, while the generation may have been
  billed; and `maxRetries: 2` (`:107`) means one client turn can pay for up to three generations
  and record none of them.
- Severity: `latent`
- Smallest generalising change: bound `max_tokens` at read time to what the non-streaming call can
  actually carry, or stream the call so the whole configured range is legal.

---

## Noted, not raised as findings

- `providers/anthropic.js:107` — `maxRetries: 2` is a constant in code where `CLAUDE.md` requires
  configuration, and it also means the configured `timeout_ms` is not the real ceiling: wall clock
  can reach three times it. A different rule, recorded here so it is not lost.
- `webtools_analyst_ai.js:74` — `module.converse(...)` is returned without a guard, so a provider
  that throws escapes the module's stated no-exceptions contract (`:20-27`). The one provider
  that exists does not throw; this is about the door, not the provider behind it. Below the bar,
  but it is the seam where the next provider will break the contract.
