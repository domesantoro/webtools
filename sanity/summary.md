# Summary

Run started 2026-09-25. Rewritten after every unit.

## Progress

9 done / 0 skipped / 63 pending, out of 72.

## Counts by severity

| severity | count |
|---|---|
| **`breaks-now`** | **2** |
| `latent` | 20 |
| `stylistic` | 2 (1 of them resolved during the run) |
| of which flagged `uncertain` in part | 3 |

## Counts by shape

| shape | count |
|---|---|
| 1 — partial-class requirement | 4 |
| 2 — invented value | 3 |
| 3 — member logic outside its boundary | 1 |
| 4 — capability inferred from resemblance | 1 (+1 as a secondary aspect) |
| 5 — only the success path | 5 |
| 6 — world narrowed to fit the code | 11 |

## `breaks-now` findings

1. **`webtools/preanalyst/src/server.js:941-950`** — `GET /analysis/{id}` opens an analysis step
   whatever pipeline state the project is in. A client whose request was refused can edit
   `/?rejected={id}` to `/analysis/{id}`, get a fresh analysis with `max_turns` turns, and move the
   project `REJECTED → ANALYSIS`. Anagraphics does not validate the transition
   (`webtools/anagraphics/webtools_anagraphics/db.py:85-97`), so the prevalidation gate is bypassed
   by editing a URL. Full write-up in `findings/preanalyst-server.md`.

2. **`webtools/preanalyst/src/server.js:588-598`** — a turn credit that could not be read is
   recorded as a credit of zero. "Anagraphics did not answer", "user not found" and "no turns" are
   three different facts collapsed onto one number, and the client is shown a page saying they have
   no turns and offering to sell them more. Reachable today; the harm is bounded only because the
   purchase is still a mock.

## Closest to breaking, among the `latent` findings

`webtools/preanalyst/src/prevalidator_ai/providers/anthropic.js:115-118` — the prevalidation's cost
ledger records only `input_tokens` and `output_tokens`, on the argument that this model's cache
never switches on. `contesto/ottimizzazioni.md` §8 measures the gap at **555 tokens**, on a policy
file that grew ~1300 → 3051 → 3541 in two days. One ordinary policy edit turns caching on and the
ledger silently starts under-reporting every prevalidation.

## `uncertain` items

- `webtools/preanalyst/src/analyst.js:100` — the language reaches the model as a bare locale code
  (`it`, `en`) from `i18n.locales`. Needs: whether the configured model resolves bare language
  subtags, or a declared language name per locale. Not asserted.
- `webtools/preanalyst/src/analyst_ai/providers/anthropic.js:159-164` and
  `webtools/preanalyst/src/prevalidator_ai/providers/anthropic.js:116-117` — `?? 0` on the usage
  counters. Needs: which `usage` fields the API may omit, and on which models.

## Recurring patterns

- **The chat has exactly two roles, in strict pairs.** `analyst.js:68`,
  `analysis_validator.js:99`, `page.js:198`, `templates/analysis.njk:60`. Four sites now depend on it.
- **A configured policy name is assumed to have a deployed file**, so a policy change throws instead
  of failing by contract. `analyst.js:50`, `analysis_validator.js:57`. Cheapest fix is at
  `settings.js:62,89,97`, where all three names are already in hand at startup.
- **Only `max_tokens` and `refusal` are treated as failing stop reasons.** Both provider files.
- **A missing token counter is recorded as zero** rather than as unknown. Both provider files.
- **A value substituted for "we could not find out."** `server.js:588-598` is the `breaks-now`
  case; the provider files are the quiet ones.

## Resolved while this audit was running

- The prevalidator's AI configuration moved from top-level `ai.*` to `prevalidation.*`, and
  `src/ai/` became `src/prevalidator_ai/`. That was finding 1 of `findings/preanalyst-settings.md`,
  now annotated as fixed.

## Units examined so far

| unit | findings |
|---|---|
| preanalyst-analyst | 3 `latent` |
| preanalyst-analyst-ai | 4 `latent` |
| preanalyst-analysis-validator | 3 `latent`, 1 `stylistic` |
| preanalyst-prevalidator-ai | 4 `latent` |
| preanalyst-settings | 1 `latent`, 1 `stylistic` (resolved) |
| preanalyst-server | **2 `breaks-now`**, 1 `latent` |
| preanalyst-page | 2 `latent` |
| preanalyst-template-analysis | 1 `latent` |
| preanalyst-script-analyse | 1 `latent` |
