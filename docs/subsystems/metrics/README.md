# metrics — the system's technical and commercial metrics

`webtools_metrics`, Python + MongoDB, port 9600.

What it is for, and what was deliberately left out: `contesto/06. metrics.md`. How to start and stop
it: `webtools/metrics/README.md`. This page is the reference: what may be sent, what is stored, what
is answered, and what happens when something is wrong.

---

## 1. The one thing to understand first

**It is not a log.** Nothing is kept per occurrence. A measurement that arrives is folded into two
places and then forgotten as an individual fact:

- the **day's bucket** for that subsystem, that metric and that set of dimensions;
- the **project's accumulator**, when the measurement names a project.

So the number of documents grows with the number of *kinds* of thing measured, not with the
traffic. Three hundred turns of chat in a day add nothing to the collection: they add 300 to a
counter, their tokens to four sums, and 300 to the buckets of a histogram.

Two consequences worth stating, because they decide what this subsystem can and cannot be asked:

- **an exact percentile cannot be given.** Durations live in a histogram, so the answer gives the
  upper edge of the bucket the percentile falls in (`p95_at_most_ms`), and `null` when that bucket
  has no upper bound. `min_ms` and `max_ms` are exact and are given beside it;
- **a single occurrence cannot be looked up.** "Which turn took 137 seconds" has no answer here.
  That is a question for a log, and logging is a separate job.

## 2. What is measured, and where its truth lives

Three sources, one per kind of fact.

| | Where it comes from | Why |
|---|---|---|
| The commercial funnel: projects, gates, outcomes | **read from anagraphics** (`GET /projects/count`, the projects' own steps) | they are already written down, and they are true by construction |
| Everything that leaves no trace: form abandoned, durations, provider failures, HTTP surface | **pushed measurements** | nothing else records them |
| Which kinds of token a provider counts | **configuration** | it is declared, not discovered |

**The money at the demo does not come from here — and it comes from nowhere here.** What a project
consumed is on its own pipeline steps in anagraphics, written in the same awaited write that records
the step. Metrics keeps a per-project total as well, in tokens, and the two can be compared — but
when they disagree, the project's record is the one that is right. A measurement may be lost; an
invoice may not. **Nothing in this subsystem converts a token into money**: what a token is worth is
not its to say, and a figure in a currency would be a claim about a price nobody configured here.

## 3. Writing: `POST /measurements`

```
POST /measurements
{ "subsystem": "preanalyst",
  "metric": "preanalysis.turn",
  "dims": { "model": "claude-opus-5", "outcome": "answered" },
  "count": 1,
  "duration_ms": 137204,
  "tokens": { "input": 1841, "output": 612, "cache_read": 26548, "cache_write": 0 },
  "project_id": "1f251606-bdba-40c4-bbee-bfedc6e57f70",
  "occurred_at": "2026-09-26T14:03:09.980Z" }

→ 202 { "folded": true, "day": "2026-09-26", "metric": "preanalysis.turn" }
```

`202`, not `201`: nothing was created — a number that was already there is larger now.

| Field | |
|---|---|
| `subsystem` | who is sending. A closed list (§4) |
| `metric` | what happened. A closed list (§4) |
| `dims` | the dimensions the metric declares. Closed keys; closed values where they can be listed |
| `count` | how many occurrences this stands for. `1` when not said — that is what sending a measurement means, not a default value in the sense the configuration rules forbid |
| `duration_ms`, `tokens`, `bytes` | only the ones the metric declares; anything else is refused. `tokens` must name a provider the configuration declares (§8) and kinds that provider counts |
| `project_id` | only on a metric that may name one |
| `occurred_at` | when it really happened. Without it, the receiving server's clock decides the day: a caller's clock is not ours |

**Nobody waits for the answer.** The caller sends and goes on. That is what makes it acceptable for
a measurement to be lost, and it is why the funnel reconciles itself against anagraphics (§5).

## 4. The vocabulary

Closed, like `PipelineStepName` in anagraphics: an invented name must not be able to get into the
data, because a counter nobody reads is never missed. Readable at `GET /vocabulary`, which is the
copy that is always right — this page is written by hand and can fall behind it.

`subsystem` ∈ `anagraphics`, `analyst`, `comm-center`, `configurator-fe`, `drivers-pool`,
`front-gate`, `metrics`, `preanalyst`, `sso`, `workspaces`.

`phase` ∈ `prevalidation`, `preanalysis_opening`, `preanalysis_turn`, `preanalysis_validation`,
`analysis_technical`, `analysis_sustainability`, `analysis_points`, `development`, `alpha_test`,
`demo`. `gate` ∈ the nine step names of the pipeline.

A dimension is **required** when it is part of the metric's identity: without it the measurement
would land in a bucket that means something else, so it is refused rather than folded. A dimension
is **optional** when it exists only in some cases — the reason of a refusal, the model of a call
that never reached a provider. Absent is absent: the bucket simply has no such dimension. A
dimension with no listed values is **open**: the key is closed, the values cannot be listed in
advance.

**Every subsystem**

| metric | required | optional | values |
|---|---|---|---|
| `http.request` | `route`, `method`, `status` | | `duration_ms` |
| `http.error` | `code` | | |
| `http.refused_ip` | | | |
| `dependency.call` | `target`, `operation`, `outcome` ∈ ok/failed/timed_out/not_found | | `duration_ms` |
| `mongo.operation` | `collection`, `operation`, `outcome` ∈ ok/failed | | `duration_ms` |
| `process.started` | `outcome` ∈ ok/configuration_missing/failed | | |

`dependency.call` covers every call one subsystem makes to another, including the one to the **sso**
that every page makes in order to know who is looking at it. `mongo.operation` comes from
anagraphics, where it is counted by the database wrapper in `db.py` and not by any of the functions:
a query written tomorrow is counted the day it is written.

`process.started` can only ever say `ok` from the subsystem itself: one that could not read its
configuration has no metrics client to say so with, because the client is built out of that same
configuration. The other two values are there for whoever else comes to send them.

**The AI**

| metric | required | optional | values |
|---|---|---|---|
| `ai.call` | `phase`, `model`, `provider`, `outcome` ∈ complete/cut/refused/unusable, `fell_back` ∈ yes/no | | `duration_ms`, `tokens` |
| `ai.unusable` | `phase`, `provider`, `model`, `reason` | | |
| `ai.failed` | `phase`, `provider`, `reason` ∈ unreachable/timed_out/rate_limited/unauthorised/unknown_provider/rejected | `model` | `duration_ms` |
| `ai.retry` | `phase`, `provider` | | |
| `preanalysis.validation` | `outcome` ∈ accepted/sent_back/failed | | `duration_ms` |

`ai.call` carries **the tokens**, and it is the only metric that carries the tokens of a model call:
whoever adds up the consumption adds up everything that carries them, so the same tokens under a
second name would be counted twice.

`fell_back` says whether the model that answered is the model that was asked for. A declined request
may be re-run on another model inside the same call, and `model` alone cannot tell that apart from a
configuration whose primary model was changed.

`ai.unusable` is **not** `ai.call`'s `unusable`, and the difference is worth the second name.
`ai.call` carries how the **provider** ended and is sent the moment the call comes back, before
anybody has read the answer, because that is when what it cost is known. `ai.unusable` carries how
the **door** ended: the answer came back whole, inside the schema, and what was in it was not a
judgement, or not an analysis, or not a message. `reason` is the door's own word for it and is open.

**What the analyst produced**

| metric | required | optional | values |
|---|---|---|---|
| `analysis.judged` | `verdict` ∈ take_on/refuse, `asked_for` ∈ take_on/refuse, `weakest` | | `scores`, `confidence` |
| `analysis.written` | | | `bytes`, `amounts` |
| `points.written` | `language` | | `amounts` |
| `document.written` | `kind` | | `bytes` |
| `spec.written` | `origin` ∈ system/third_party | | `bytes` |

**The drivers and the communications**

| metric | required | optional | values |
|---|---|---|---|
| `driver.chosen` | `rule` ∈ random | | `amounts` (`enabled`, `registered`) |
| `driver.handover` | `outcome` ∈ assigned/nobody_enabled/gave_up/unavailable | | `amounts` (`attempts`) |
| `driver_link.resolved` | `state` | | |
| `communication.sent` | `kind`, `channel` ∈ log | | |

`driver_link.resolved` is what somebody's link did when a client arrived on one: the nine states of
the driver's link and the four of the ambassador's. It is the only record of them — a project is
written with `driver_uid: null` whether the link was absent or expired, so `project.created` says
`has_discount: no` for both and the difference cannot be recovered from anything afterwards.

**The funnel and its timing**

| metric | required | optional | values |
|---|---|---|---|
| `form.opened` | | | |
| `form.submitted` | `outcome` ∈ sent/login_required/refused | `reason` | `duration_ms` |
| `project.created` | `autonomous_work`, `has_discount`, `has_ambassador` ∈ yes/no | | |
| `gate.decided` | `gate`, `outcome` ∈ open/passed/rejected/underspecified/failed | `reason` | |
| `gate.duration` | `gate` | | `duration_ms` |
| `project.lead_time` | `outcome` ∈ paid/rejected/open | | `duration_ms` |
| `preanalysis.turn` | `provider`, `outcome` ∈ answered/failed | `model` | `duration_ms`, `tokens` |
| `preanalysis.closed` | `outcome` ∈ ready/turns_exhausted/abandoned | | |
| `underspecified.returned` | `attempt` | | |

**`gate.duration` is how long a gate was open**, from its own opening step to the step that closed
it — which, under the pipeline's convention, may belong to another gate: the rounds of questions are
opened by the preanalyst and closed by the analyst's opening step. The duration is named after the
gate that **was open**, not the one being written. Nothing is reported when nothing was open: the
interval between one gate deciding and the next writing anything is dead time, which is real and is
a different question.

`form.submitted`'s `reason` says which refusal it was — a required answer left empty, an answer past
the limit, a body too large, a submission that cannot be read, the sso not answering. Only a refusal
has one.

**Turns and tokens**

| metric | required | optional | values |
|---|---|---|---|
| `turns.granted` | `source` ∈ purchase/fake_purchase/included | | |
| `turns.spent` | `phase` | | |
| `tokens.charged` | `driver_uid`, `provider`, `model` | | `tokens` |

**The rest of the system**

| metric | required | optional | values |
|---|---|---|---|
| `login.attempt` | `outcome` ∈ ok/invalid/unavailable | `reason` ∈ unknown_user/deactivated/credential_not_set/wrong_password | `duration_ms` |
| `session.opened` | | | |
| `session.closed` | `reason` ∈ logout/expired/revoked | | |
| `configuration.changed` | `subsystem`, `section` | | |
| `measurement.refused` | `code` | `sender` | |

`login.attempt`'s `reason` is **never told to whoever is trying**: the four refusals answer one word
on purpose, so that nobody can find out from outside whether an address is registered. A count of a
day names nobody, and the four are four different problems.

`configuration.changed` is the moment after which every other figure means something else. It
carries the section and not the value: what a price became is in the configuration, which is the
thing that is true, and a copy here would be a second answer that can disagree with the first.

`measurement.refused` is the one failure the closed list exists in order to create, and it is
counted by metrics about itself — folded straight into its own collection, not sent to its own API.
It carries the **code** and not the refused name: an invented name in an open dimension would make a
bucket per typo, which is what the closed list is for. `sender` is absent when what was refused was
the sender's own name.

## 5. Reading

`from` and `to` are days (`YYYY-MM-DD`), both included, both **required**: a period chosen for you
is a figure you did not ask for. Every answer carries `from`, `to`, `days` and `truncated`.

| Route | What it answers |
|---|---|
| `GET /metrics/funnel` | how many at each stage and where they left, with the reconciliation (§6) |
| `GET /metrics/cost` | tokens by phase, model, kind and subsystem, and the **distribution over projects**, one per kind — exact, because there is one accumulator per project |
| `GET /metrics/preanalysis` | turns per pre-analysis, how the rounds of questions end, how often the validator sends the preanalyst back |
| `GET /metrics/providers` | calls by model and outcome, failures by reason, retries, and a failure rate that says what it is made of |
| `GET /metrics/http` | requests by subsystem and route, by status, the errors, the refused IPs |
| `GET /metrics/economics` | turns granted and spent, tokens charged to drivers; **cost per accepted demo**; **cost of what we refused**, by reason — both in tokens |
| `GET /metrics/timing` | how long a project sits at each gate, the lead time, how long a form takes |
| `GET /metrics/health` | starts and restarts, calls between subsystems, Mongo, logins |
| `GET /metrics/daily` | the buckets themselves, optionally one metric |
| `GET /metrics/projects/{id}` | one project's accumulator |
| `GET /vocabulary` | what may be sent |

Two figures are computed and named carefully:

- **`cost_per_accepted_demo`** is every token of the period over the demos accepted in it, kind by
  kind — not a per-project figure, and `null` rather than `0` when no demo was accepted, because
  nothing divided by nothing is not a consumption of nothing;
- **`cost_of_refusals`** is read from the project accumulators, by the gate decisions each of them
  carries: a daily bucket has no project in it, so the question could not be asked of one.

## 6. The reconciliation

A measurement may be lost, so a `project.created` that never arrived looks exactly like a client who
left. For projects the truth exists elsewhere, and the funnel asks for it:

```json
"reconciliation": { "available": true, "projects": 35, "projects_measured": 32, "lost": 3 }
```

When anagraphics cannot answer, the funnel says so and stays a funnel:

```json
"reconciliation": { "available": false, "reason": "unreachable", "projects_measured": 32 }
```

`reason` tells apart `unreachable` (nothing answered), `no_route` (an anagraphics without
`GET /projects/count`), `refused` (an error status) and `unusable` (an answer that is not a count).
They call for different things to be done, so they are not one word.

## 7. What is stored

| Collection | Unique key | One document is |
|---|---|---|
| `metrics_daily` | `day` + `subsystem` + `metric` + `dims_key` | one day of one metric with one set of dimensions |
| `metrics_projects` | `project_id` | everything measured about one project |

A bucket carries `count`, `tokens` (whatever kinds the provider counts), `bytes` and `duration_ms`
(`sum`, `min`, `max`, `buckets`). A project's accumulator
carries the same numbers per metric (`metrics.<name>`), per phase (`phases.<phase>`), its own
totals, and how its gates decided (`gates.<outcome>`, `gate_reasons.<reason>`).

`dims_key` is the canonical identity of a set of dimensions (`model=…&outcome=…`, keys sorted):
Mongo compares sub-documents including the order of their keys, so without it `{a, b}` and `{b, a}`
would be two buckets for the same thing. Inside a project's document a metric's name is written with
its dots turned into underscores (`preanalysis_turn`), because a dot in a Mongo field name is legal but
a nuisance to query; the mapping is checked at import against the closed vocabulary.

## 8. The providers, and why nothing is priced

`providers.<provider>.token_kinds` — a list of names, and nothing else. It says which kinds of token
that provider reports, so that a measurement can be checked against something: tokens for a provider
nobody declared are `UNKNOWN_PROVIDER`, and a kind that provider does not count is
`UNKNOWN_TOKEN_KIND`. Both are answered by a line of configuration. Accepting a kind nobody declared
is how a typo becomes a sum that grows in a corner and is never read.

The kinds are **not** a list in the code, at any level. One provider counts input and output,
another a cache it writes and a cache it reads, another reasoning apart or an image; the day one
reports something nobody has heard of, it is counted under the name it arrives with.

**There is no price table, and there are no figures in a currency.** What a token is worth is not
this subsystem's to say: a price belongs to a provider **and** a model, it changes, and it is agreed
elsewhere. What is kept here is the count, by kind, which is what a price would have been worked out
from anyway — and keeping it means a question about money can be answered later, deliberately, from
numbers that were never rounded into an answer nobody checked.

For the same reason **kinds are never added to one another**. An output token and a token read from
a cache are not the same thing: on 2026-09-19, 26.5 M tokens read from cache against 282 tokens of
fresh input were worth about a seventh of what the same count of fresh input would have been. A
single number over the four would be a rate between them, which is a price by another name. Every
figure that could be one — the distribution over projects, the tokens per accepted demo, the tokens
of what we refused — is given kind by kind.

## 9. Retention

`limits.retention_days` on the daily buckets, applied with a Mongo TTL index on `day_at`.

- `0` — keep for ever, and **no index is created**: not one with a very large number, which would
  be a deletion merely postponed.
- `N` — Mongo deletes a bucket N days after its day. Changed in operation, the TTL is altered in
  place (`collMod`), not dropped and rebuilt; set back to `0`, the index goes and the documents
  stay.

The per-project accumulators are never expired: one document per project, and they are what a
project's consumption is read from.

The seed says 90 days, which is what a new environment is born with. What runs is what is in Mongo.

## 10. Errors

| Code | Status | When |
|---|---|---|
| `UNKNOWN_SUBSYSTEM`, `UNKNOWN_METRIC` | 400 | a name that is not in the closed list |
| `UNKNOWN_DIMENSION`, `UNKNOWN_DIMENSION_VALUE` | 400 | a key the metric does not declare, a value a closed dimension does not allow |
| `MISSING_DIMENSION` | 400 | a dimension that is part of the metric's identity |
| `UNEXPECTED_VALUE` | 400 | a value the metric does not carry (a duration on a counter, a project on a metric that has none) |
| `UNKNOWN_PROVIDER`, `UNKNOWN_TOKEN_KIND` | 400 | tokens for a provider the configuration does not declare, or of a kind that provider does not count (§8) |
| `INVALID_RANGE` | 400 | a day that is not a day, or a period backwards |
| `INVALID_BODY` | 400 | the body does not have the shape of a measurement |
| `BODY_TOO_LARGE` | 413 | over `limits.body_max_bytes` |
| `IP_NOT_ALLOWED` | 403 | from outside `access.allowed_ips` |
| `PROJECT_NOT_FOUND` | 404 | no accumulator for that project |
| `DATABASE_UNAVAILABLE` | 503 | Mongo did not answer |

Each refusal names what was wrong (`metric`, `dimension`, `value`, `day`): whoever sent the
measurement has to be able to fix it without reading our log.

## 11. Configuration (`webtools/configurator/configuration/metrics.json`)

| Field | What it decides |
|---|---|
| `listen.host`, `listen.port` | where it listens (9600) |
| `access.allowed_ips` | who may write and read. An internal service, not on the internet |
| `mongo.server_selection_timeout_ms` | how long Mongo may take before the answer is `DATABASE_UNAVAILABLE` |
| `limits.retention_days` | §9. `0` = for ever |
| `limits.body_max_bytes` | a measurement is a handful of numbers; anything larger is a mistake |
| `limits.max_rows` | the most buckets a read may walk. When it is reached the answer says `truncated: true` rather than quietly telling half the truth |
| `limits.duration_buckets_ms` | the edges of the histogram, ordered and without repetitions |
| `subsystems_infos.anagraphics.timeout_ms` | how long the reconciliation may wait. The **address** is not here: it is in `bootstrap.env`, because it is what has to be known before a configuration can be read |
| `providers.<provider>.token_kinds` | §8. An empty declaration is legitimate and means no tokens may be sent yet |

No default values anywhere: a missing field and the server does not start.

## 12. What is left to do

- **The shared client** in `webtools/commons/metrics/`, which sends a measurement without waiting
  for it and counts its own failed sends. A failed send is **not** written to the subsystem's log by
  default (`metrics.log_failures`, seeded `false`): if metrics breaks while every subsystem logs
  every failure, the logs fill the disk, which is a worse failure than the one being reported.
- **The subsystems' call sites**: nothing measures anything yet.
- `gate.duration`, `project.lead_time` and the later gates are in the vocabulary and nobody sends
  them, because the phases they belong to do not exist yet. That is the point of their being there.
