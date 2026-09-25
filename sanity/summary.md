# Summary

Run started 2026-09-25. Rewritten after every unit.

## Progress

42 done / 0 skipped / 30 pending, out of 72.

## Counts by severity

| severity | count |
|---|---|
| **`breaks-now`** | **14** |
| `latent` | 75 |
| `stylistic` | 21 (1 of them resolved during the run) |
| of which flagged `uncertain` in part | 10 (4 of them recorded as `uncertain` only) |

## Counts by shape

| shape | count |
|---|---|
| 1 — partial-class requirement | 8 (+1 as a secondary aspect) |
| 2 — invented value | 13 (+1 as a secondary aspect) |
| 3 — member logic outside its boundary | 5 (+1 as a secondary aspect) |
| 4 — capability inferred from resemblance | 16 (+1 as a secondary aspect) |
| 5 — only the success path | 25 |
| 6 — world narrowed to fit the code | 47 (+2 as a secondary aspect) |

## `breaks-now` findings

Listed in the order they were found. The severity is the protocol's — another legitimate member of
the class is reachable today, with the code and configuration as they stand — so each entry states
its consequence, which ranges from a bypassed gate to a worse log line.

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

3. **`webtools/preanalyst/src/prespec.js:77`** — an answer longer than `form.answer_max_chars` is
   silently cut. The form sets no `maxlength` on any field and accepts a body of 512 KB, so pasting
   a long answer loses everything past 20 000 characters, with no message to the client and nothing
   on the project. The truncated text is the pre-specification: the document the analysis and the
   price are built on. Full write-up in `findings/preanalyst-prespec.md`.

4. **`webtools/preanalyst/src/prevalidator.js:172-176`** — the pre-specification is then cut again
   at `prevalidation.spec_max_chars` (20 000), with no log and no mark on the step, on the argument
   that `form.answer_max_chars` already limits it. That field limits **one open answer** (also
   20 000); the document adds front matter, headings, the open-points list and two characters per
   quoted line. A single long first answer already produces a document over the cut, and the model
   judges a fragment whose missing tail is exactly the evidence of under-specification.

5. **`webtools/preanalyst/scripts/prevalidate.js:34-37`** — the command-line tool discards the
   `usage` that the failure shape carries, in the one place built to measure what a prevalidation
   costs. Reachable with no change; the consequence is bounded — one printed line, with the error
   still visible.

6. **`webtools/preanalyst/src/prespec.js:118`** — `value === UNKNOWN` compares a closed question's
   **code** against every answer, free text included: a client who types `unknown` into an open
   field has it read as "the client does not know". Reachable today; the consequence is mild, and
   the defect is the reasoning — one vocabulary matched against another because they are spelled
   alike.

7. **`webtools/preanalyst/src/driver_link.js:57-63`** — a discount code that could not be read
   becomes the state `discount_expired`, and the client is told "most likely it has expired"
   (`en.json:77`). The layer below distinguishes "not there" from "could not answer"
   (`anagraphics.js:7-9`); the page asserts the first. The window is narrow but needs no change:
   `GET /drivers` must succeed and `GET /discounts/{code}` fail. The discount itself survives —
   the code still travels with the form and is re-read at submission.

8. **`webtools/preanalyst/src/ambassador.js:20-24`** — an ambassador who could not be checked and
   one who is not a driver are the same `null`, and because the hidden field lives inside the box
   (`templates/partials/ambassador_box.njk:19-21`), the uid then never reaches `POST /submit`. The
   project is created with no ambassador and half the fee is owed to nobody. The same page keeps
   the **driver**'s uid in exactly this case, on the stated principle that "if the failure is ours,
   the user must not pay for it" (`page.js:40-43`).

9. **`webtools/preanalyst/src/rejection_pdf.js:25-27`** — the PDF renderer is written for the
   document our own template produces, but `latestSpec` returns the latest stored specification,
   which may be a `.md` the client uploaded to that project: the upload checks ownership, not the
   pipeline state. Reachable today; the consequence is a degraded rendering of the client's own
   document, markdown markers and all.

10. **`webtools/preanalyst/src/index.js:23-29`** — `server.listen` has no `error` handler, so a
    port already taken (an ordinary event on a machine that runs other projects) kills the process
    with a stack trace where the same file, eight lines earlier, prints a sentence. The runner
    notices and shows the log, so the reason reaches the operator inside the trace.

11. **`webtools/sso/src/server.js:118-128`** — a request body over `limits.body_max_bytes` and one
    of zero bytes come back as the same failure, and both are answered `400 INVALID_BODY`, where
    workspaces and preanalyst both answer `413` for the first. The comment above it says the
    connection is closed; nothing closes it.

12. **`webtools/sso/src/anagraphics.js:56`** — `encodeURIComponent` is used to make a path segment
    out of a username, a token and a ticket, and it leaves `.` alone: a username of `..` is a dot
    segment, which the URL parser removes, so the request goes to `/` instead of `/users/..`. The
    consequence today is one log line that names the wrong event ("unknown user"); the defect is
    that the only thing between an outside string and an internal address is an escaper whose job
    is a different one.

13. **`webtools/sso/src/index.js:23-29`** — `server.listen` with no `error` handler, exactly as at
    `webtools/preanalyst/src/index.js:23-29`: a port already taken kills the process with a stack
    trace where the same file, six lines earlier, prints a sentence. The same defect in a second
    subsystem, and neither file is a place where it could be fixed once.

14. **`webtools/front-gate/src/index.js:23-26`** — the third copy of the missing `listen` error
    handler, after the preanalyst's and the sso's. On the one subsystem that faces the open
    internet, a port already taken ends the process with a stack trace.

## Closest to breaking, among the `latent` findings

`webtools/preanalyst/src/prevalidator_ai/providers/anthropic.js:115-118` — the prevalidation's cost
ledger records only `input_tokens` and `output_tokens`, on the argument that this model's cache
never switches on. `contesto/ottimizzazioni.md` §8 measures the gap at **555 tokens**, on a policy
file that grew ~1300 → 3051 → 3541 in two days. One ordinary policy edit turns caching on and the
ledger silently starts under-reporting every prevalidation.

## `uncertain` items

- `webtools/preanalyst/src/analyst.js:100`, and the same assumption at
  `webtools/preanalyst/src/prespec.js:123-131` with
  `webtools/configurator/documents/prespec.md.njk:13-14` — the language reaches the model as a bare
  locale code (`it`, `en`) from `i18n.locales`. Needs: whether the configured model resolves bare
  language subtags, or a declared language name per locale. Not asserted.
- `webtools/preanalyst/src/analyst_ai/providers/anthropic.js:159-164` and
  `webtools/preanalyst/src/prevalidator_ai/providers/anthropic.js:116-117` — `?? 0` on the usage
  counters. Needs: which `usage` fields the API may omit, and on which models.
- `webtools/preanalyst/scripts/prevalidate.js:50` — the manual cost report prints two counters.
  Needs: the same answer as above — which counters a given model may report.
- `webtools/sso/src/server.js:365` — the URL is built from the `Host` header, outside the handler's
  `try` and before the IP check; an empty or malformed authority makes `new URL` throw, and an
  unhandled rejection ends the process. Needs: whether Node's HTTP parser can deliver such a `Host`
  at all. The defect stands either way; the severity depends on the answer.
- `webtools/preanalyst/webtools_preanalyst.sh:28-30` — `--stop` identifies the server by matching
  the whole command line from `ps -p <pid> -o command=`. Needs: whether that output can come back
  truncated on macOS or Linux when captured rather than displayed. If it can, `--stop` reports the
  server as not running, removes the PID file and leaves it holding the port.
- `webtools/preanalyst/src/rejection_pdf.js:34-49,68-80` — the PDF is written entirely with
  pdfkit's standard Helvetica, while the client may write any UTF-8. Needs: what pdfkit's standard
  fonts do with a character outside their encoding — drop, substitute or throw. Each is a different
  defect; none is asserted.
- `webtools/sso/tests/i18n.test.js:50-51` — the test asserts `Intl.NumberFormat`'s exact output
  (`"€400.50"`), having already had to patch the Italian line with a `\s` replacement for the same
  reason. Needs: which Node builds (and ICU data) this project is run on. Not asserted.
- `webtools/front-gate/src/server.js:92`, the same line as `webtools/sso/src/server.js:365` — the
  URL is built from the `Host` header outside the handler's `try`, so a `Host` that `new URL`
  refuses ends the process. Needs: whether Node's HTTP parser can deliver such a header.

## Recurring patterns

- **The chat has exactly two roles, in strict pairs.** `analyst.js:68`,
  `analysis_validator.js:99`, `page.js:198`, `templates/analysis.njk:60`,
  `public/styles.css:340`, `public/analysis.js:39-43,75`. **Six sites**, and `tests/analyst.test.js:110` asserts it as the
  specification, so fixing the code will read as breaking the tests.
- **A deployed artefact is assumed present, so a configuration change throws instead of failing by
  contract.** The policy files at `analyst.js:50`, `analysis_validator.js:57`,
  `prevalidator.js:110`; the generated document template at `prespec.js:124`. **Four sites**, all
  fixable at startup, where the names are already in hand (`settings.js:62,89,97`).
- **A limit is enforced by silently rewriting the input.** `prespec.js:77` cuts the client's answer,
  `prevalidator.js:175` cuts the document again. In both places "it is too long" is a real outcome
  of a real submission and is never answered, only absorbed.
- **A policy states as fact something a configured value can falsify.** `scope-v1.md:78-80` repeats
  the `reject_threshold` inside the prose; `:123-127` tells the model that `underspecified` closes
  nothing, which `max_underspecified_attempts` can make untrue; `:180,240-241` promises that
  `off_domain.reason` never reaches the client, which `rejection_reason_in_pdf` can make untrue; and
  `analysis-v1.md` and `analysis-validation-v1.md` are written to match each other with nothing
  recording that they must. The policies are configuration, and they are written against the
  configuration as it stands today.
- **A property of a question lives in its reader, not in the question.** `prespec.js:37`
  (`FRONT_MATTER_FIELDS`) and `prespec.js:40` (`UNKNOWN`) both decide, in another module and by
  spelling, something `questions.js` is the natural place to declare — in the file whose header says
  it is meant to be rewritten often.
- **Only `max_tokens` and `refusal` are treated as failing stop reasons.** Both provider files.
- **A missing token counter is recorded as zero, or not reported at all** rather than as unknown.
  Both provider files, and `scripts/prevalidate.js:50`.
- **A value substituted for "we could not find out."** `server.js:588-598` is the `breaks-now`
  case; the provider files, `prevalidator.js:199,201` and `anagraphics.js:63` are the quiet ones —
  and `prevalidator.js:201` is read downstream (`server.js:918`) as "this step has no reason",
  which reaches back to an earlier round's reason.
- **Two different facts arriving as one answer.** `anagraphics.js:46-48` puts "the project is not
  there" and "the route is not there" on one `not_found`, and the callers that act on it
  (`ambassador.js:38`, `project_driver.js:32,38`) drop an ambassador or a discount as a fact.
  `workspaces.js:65` does the same with `SPEC_NOT_FOUND` and `ROUTE_NOT_FOUND`, and does not even
  read the code.

- **The same file in five copies, with no original.** `webtools/sso/webtools_sso.sh` is
  `webtools/preanalyst/webtools_preanalyst.sh` with the name changed, and the same holds for
  front-gate, anagraphics and workspaces; `src/index.js` is close behind (findings 1 and 2 of
  `findings/sso-settings-index-page.md` repeat `findings/preanalyst-index.md` line for line). The
  repository has a deployer for a stylesheet and none for the script that decides how a process is
  stopped.

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
| configurator-configuration-preanalyst | 2 `latent` |
| configurator-secrets-preanalyst | nothing to report |
| configurator-policies-analysis | 3 `latent` |
| commons-i18n-locales | 2 `latent` |
| preanalyst-tests-ai-analyst | 1 `latent`, 1 `stylistic` |
| preanalyst-styles | 1 `latent`, 1 `stylistic` |
| preanalyst-prevalidator | **2 `breaks-now`**, 3 `latent` |
| preanalyst-anagraphics-client | 2 `latent`, 1 `stylistic` |
| preanalyst-questions | 2 `latent` |
| preanalyst-prespec | **2 `breaks-now`**, 2 `latent`, 1 `stylistic` |
| preanalyst-driver-link | **1 `breaks-now`**, 1 `latent` |
| preanalyst-ambassador-project-driver | **1 `breaks-now`**, 1 `latent`, 1 `stylistic` |
| preanalyst-workspaces-client | 2 `latent`, 1 `stylistic` |
| preanalyst-rejection-pdf | **1 `breaks-now`**, 2 `latent`, 1 `uncertain` |
| preanalyst-index | **1 `breaks-now`**, 1 `stylistic` |
| preanalyst-public-js | 2 `latent`, 2 `stylistic` |
| preanalyst-templates | 1 `latent`, 1 `stylistic` |
| configurator-policy-scope | 3 `latent` |
| preanalyst-tests-rest | 1 `latent`, 1 `stylistic` |
| preanalyst-runner | 1 `latent`, 1 `stylistic`, 1 `uncertain` |
| sso-server | **1 `breaks-now`**, 2 `latent` |
| sso-auth | 2 `latent` |
| sso-sessions-tickets | 3 `latent`, 1 `stylistic` |
| sso-credentials | 2 `latent`, 1 `stylistic` |
| sso-anagraphics-client | **1 `breaks-now`**, 1 `latent` |
| sso-settings-index-page | **1 `breaks-now`**, 2 `latent`, 2 `stylistic` |
| sso-templates | nothing to report |
| sso-tests | 4 `latent`, 1 `uncertain` |
| sso-runner | 1 `latent` |
| front-gate-server | 2 `latent`, 1 `stylistic`, 1 `uncertain` |
| front-gate-settings-index-page | **1 `breaks-now`**, 1 `latent`, 1 `stylistic` |
| front-gate-templates | 2 `latent`, 1 `stylistic` |
| front-gate-public | 1 `latent` |
