# preanalyst-prevalidator-ai

Paths: `webtools/preanalyst/src/prevalidator_ai/webtools_prevalidator_ai.js`,
`webtools/preanalyst/src/prevalidator_ai/providers/anthropic.js`
Examined: 2026-09-25

Note on paths: this unit was inventoried as `webtools/preanalyst/src/ai/`. The directory was
renamed to `src/prevalidator_ai/` during this run, and the module inside was renamed as well, to
`webtools_prevalidator_ai.js`. The inventory row carries the real paths.

The prevalidator's door and its one provider: one call, one classification, no conversation. The
door (`webtools_prevalidator_ai.js`) is clean — an allowlist rather than a module name to load, only
the selected provider's configuration read, an unknown provider refused at startup rather than at
the first client's request. The findings are all in the provider.

---

## 1. One client per process, built from whichever configuration called first

- `webtools/preanalyst/src/prevalidator_ai/providers/anthropic.js:74-89`
- Shape: **6 — the world narrowed to fit the code**
- Class: **the engine configurations that may reach `decide`.** `clientOf(ai)` takes `ai` and, on
  every call after the first, ignores it entirely: the module-level `client` is keyed on nothing.
  The code is correct only because exactly one configuration section (`ai.*`) currently reaches
  this module.
- One engine is not a property of the design, it is a property of today. The sibling door serves
  two engines from one provider file and had to solve this: `analyst_ai/providers/anthropic.js:97`
  keys a `Map` by key and timeout, with the comment "A single shared client would silently give the
  second one the first one's key." The same file, one directory over, has already met this and
  fixed it; this copy has not.
- What breaks, on an entitled change: pointing a second engine at this module — the obvious move
  the day something else in the preanalyst needs a classification — makes the second engine spend
  the first engine's API key and use the first engine's timeout. Silently: the request succeeds,
  and only the billing account is wrong.
- Severity: `latent`
- Smallest generalising change: key the client by what actually distinguishes one client from
  another (the key and the timeout), as the sibling provider already does.

## 2. Cache counters are not recorded, on the argument that this model's cache never switches on

- `webtools/preanalyst/src/prevalidator_ai/providers/anthropic.js:115-118`, against the
  `cache_control` sent at `:99` and the header's reasoning at `:16-21`
- Shape: **6 — the world narrowed to fit the code**
- Class: **the (model, policy) pairs this engine may be configured with.** Both are configured
  values: `ai.providers.anthropic.model` and `prevalidation.policy`. The code records exactly two
  counters, `input_tokens` and `output_tokens`, because on the pair in front of the author the
  other two are always zero.
- The repository proves the premise is fragile, and by how much. `contesto/ottimizzazioni.md` §8
  measures it: the cache minimum is 4096 tokens on `claude-haiku-4-5`, and `scope-v1` is **3541**
  tokens — 555 short. The same table records the policy going ~1300 → 3051 → 3541 in two days.
  Editing the policy is the documented way to change what the system considers acceptable, and it
  has happened twice this week; the model is one string in Mongo, and the same note observes the
  minimum is 512 tokens on newer models.
- What breaks: the first policy edit that crosses 4096 tokens — or a model change to almost
  anything newer — switches caching on. Cached input is then reported in
  `cache_creation_input_tokens` and `cache_read_input_tokens`, which are *not* part of
  `input_tokens`, so the ledger silently starts under-reporting the input volume of every
  prevalidation. Nothing errors, nothing looks odd, and the number the PoC exists to measure — the
  real AI cost of a webtool — becomes quietly wrong. The sibling engine records all four
  (`analyst_ai/providers/anthropic.js:159-164`), so the two halves of the same measurement would no
  longer be comparable either.
- Severity: `latent` — but the nearest to `breaks-now` of anything found so far: it needs one
  ordinary edit to a file that is edited often, and 555 tokens of it.
- Smallest generalising change: record whatever counters the answer carries, rather than the two
  that are non-zero under the current configuration.

## 3. Token counters invented when the provider does not report them

- `webtools/preanalyst/src/prevalidator_ai/providers/anthropic.js:116-117`
- Shape: **2 — an absence filled with an invented value**
- Class: **the shapes a `usage` object may come back in.** Same defect as
  `analyst_ai/providers/anthropic.js:159-164`, recorded separately because it is a second file with
  its own copy. A missing count is written into the ledger as a cost of zero.
- The contradiction is stated even more plainly here: the comment at `:113-114` says "the tokens
  have been spent: whatever goes wrong, `usage` travels back together with the error", and the next
  line substitutes zero for the number that says how many.
- Severity: `latent`, with the same `uncertain` component — which `usage` fields the API may omit
  is not established here, and asserting it would be the same defect.
- Smallest generalising change: leave an unreported counter out, so unknown is visibly unknown.

## 4. Only two stop reasons are treated as failures

- `webtools/preanalyst/src/prevalidator_ai/providers/anthropic.js:123`
- Shape: **5 — only the outcome that succeeds is handled**
- Class: **the values `stop_reason` may take.** Two are named as failures; everything else,
  including values added later, is treated as a finished answer. The positive test — only `end_turn`
  means done — is the one that holds for the whole class.
- Same mitigation as in the sibling: a body that is not complete JSON is caught at `:135` and comes
  back as `rejected` anyway, so what is lost is the reason rather than the data.
- Severity: `latent`
- Smallest generalising change: accept `end_turn` and fail everything else by name.

---

## Noted, not raised as findings

- `providers/anthropic.js:85` — `maxRetries: 2` is a constant in code where `CLAUDE.md` requires
  configuration, and it makes the configured `timeout_ms` not the real ceiling. Same as the
  sibling; a different rule.
- `webtools_prevalidator_ai.js:85` — `module.decide(...)` is returned unguarded, so a throwing
  provider would escape the module's stated no-exceptions contract. Same seam as the sibling door.
- The provider deliberately sends no `fallbacks` and returns `rejected` on a refusal. For a
  classifier that is a handled outcome, not a gap.
