# webtools_metrics

An internal subsystem (Python + MongoDB) holding the system's **technical and commercial metrics**:
what things consume, how long they take, how often they fail, how many people arrive at each gate
and where they leave.

**It is not a log.** Nothing is stored per occurrence: a measurement that arrives is folded into the
day's bucket and into the project's accumulator, and what is kept is the number. A turn of chat does
not become a document. Logging is a separate job, and it is not this one.

Why it exists, what is measured and what is deliberately not: `contesto/06. metrics.md`.
Full documentation: `docs/subsystems/metrics/README.md` (at the root of the workspace).

## Start and stop

```sh
webtools/metrics/webtools_metrics.sh --start   # starts it in the background, detached from the terminal
webtools/metrics/webtools_metrics.sh --stop    # stops it
```

- PID: `webtools_metrics.pid`. Log: `webtools_metrics.log` (appended).
- `--stop` stops only the process of the PID file, and only after checking that it is
  `…/webtools/metrics/.venv/bin/python -m webtools_metrics`.
- Debugging in the foreground, from this directory:
  `set -a; source ../configurator/bootstrap.env; set +a; uv run python -m webtools_metrics`.

The first time, from this directory:
```sh
uv sync                                  # environment and dependencies
../configurator/load_configuration.sh    # brings configuration/metrics.json into Mongo
```

One thing it measures about **itself**: `measurement.refused`, whenever the vocabulary turns
something away. It is folded straight into the collection, not sent to its own API — a request to
itself would be a second thing that can fail at exactly the moment something is already failing.
Until that existed, a subsystem quietly sending a name that is refused looked exactly like a
subsystem with nothing to say.

## Collections

| Collection | Key (unique index) | What one document is |
|---|---|---|
| `metrics_daily` | `day` + `subsystem` + `metric` + `dims_key` | one day of one metric with one set of dimensions |
| `metrics_projects` | `project_id` | everything measured about one project |

A bucket, as it is stored:

```json
{ "day": "2026-09-26", "subsystem": "preanalyst", "metric": "preanalysis.turn",
  "dims": { "model": "claude-opus-5", "outcome": "answered" },
  "dims_key": "model=claude-opus-5&outcome=answered",
  "count": 412,
  "tokens": { "input": 754321, "output": 251004, "cache_read": 10934221, "cache_write": 0 },
  "duration_ms": { "sum": 56489204, "min": 8912, "max": 210400,
                   "buckets": { "5000": 3, "15000": 41, "60000": 190, "120000": 150, "300000": 28 } } }
```

The number of documents depends on how many **kinds** of thing are measured, not on the traffic: ten
clients and ten thousand produce the same number.

**Tokens are counted, never converted.** What a token is worth is not this subsystem's to say:
there is no price table here and no figure in a currency. The kinds are whatever the provider
reports — the configuration's `providers.<provider>.token_kinds` declares them — and they are never
added to one another: an output token and a token read from a cache are not the same thing, and a
sum of the two would be a rate between them that nobody decided.

**`dims_key`** is the canonical identity of a set of dimensions: Mongo compares sub-documents
including the order of their keys, so `{a, b}` and `{b, a}` would otherwise be two buckets for the
same thing.

## Endpoints (`http://127.0.0.1:9600`)

Writing, from the subsystems:

- `POST /measurements` → `202 {"folded": true, "day": …, "metric": …}`. One measurement:
  `{subsystem, metric, dims, count?, duration_ms?, tokens?, bytes?, project_id?, occurred_at?}`.
  Nobody waits for the answer.

Reading:

| Route | What it answers |
|---|---|
| `GET /metrics/funnel?from=&to=` | who arrived and where they left, **reconciled** with the projects anagraphics really has |
| `GET /metrics/cost?from=&to=` | tokens by phase, model, kind and subsystem; the distribution over projects, one per kind |
| `GET /metrics/preanalysis?from=&to=` | turns per pre-analysis, how the rounds of questions end, how often the validator sends the preanalyst back |
| `GET /metrics/providers?from=&to=` | calls, failures, retries, latency |
| `GET /metrics/http?from=&to=` | requests, statuses and durations by subsystem and route |
| `GET /metrics/economics?from=&to=` | turns granted and spent, tokens charged to drivers; tokens per accepted demo; tokens of what we refused |
| `GET /metrics/timing?from=&to=` | how long a project sits at each gate, and end to end |
| `GET /metrics/health?from=&to=` | restarts, calls between subsystems, Mongo, logins |
| `GET /metrics/daily?from=&to=[&metric=]` | the buckets themselves: every aggregate is a claim, and a claim must be checkable |
| `GET /metrics/projects/{project_id}` | one project's accumulator |
| `GET /vocabulary` | what may be sent: a closed list is only fair if it can be read |

`from` and `to` are days (`YYYY-MM-DD`), both included, both required: there is no default period,
because a period silently chosen for you is a figure you did not ask for.

## What is refused, and why

The vocabulary is closed (`webtools_metrics/vocabulary.py`), like `PipelineStepName` in anagraphics:

| Code | When |
|---|---|
| `UNKNOWN_SUBSYSTEM`, `UNKNOWN_METRIC` | a name that is not in the list |
| `UNKNOWN_DIMENSION`, `UNKNOWN_DIMENSION_VALUE` | a dimension the metric does not declare, or a value a closed dimension does not allow |
| `MISSING_DIMENSION` | a dimension that is part of the metric's identity: without it the measurement would be counted in a bucket that means something else |
| `UNEXPECTED_VALUE` | a duration on a counter that has none, a project on a metric that has none |
| `UNKNOWN_PROVIDER`, `UNKNOWN_TOKEN_KIND` | tokens for a provider the configuration does not declare, or of a kind that provider does not count |
| `INVALID_RANGE` | a day that is not a day, or a period backwards |
| `BODY_TOO_LARGE`, `IP_NOT_ALLOWED` | over `limits.body_max_bytes`; from outside `access.allowed_ips` |

A typo in a dimension would split a counter in two, and the half nobody looks at would never be
missed. That is why a name is refused rather than stored.

Which kinds a provider counts is **its** list, declared in the configuration and nowhere in the
code: a provider that counts seconds and images is counted under those names, and the day one
reports a kind nobody has heard of the answer is a line of configuration, not a release. Accepting a
kind nobody declared is how a typo becomes a sum that grows in a corner and is never read.

## Two things the answers always say

- **What is missing from them**: `truncated`, whether the rows ran out before the period did.
- **How exact they are**: the percentiles are read off the histogram, so they are given as
  `p95_at_most_ms` — the upper edge of the bucket — and `null` when that bucket has no upper bound.
  `min_ms` and `max_ms` are exact, and are right beside them.

## Retention

`limits.retention_days` on the daily buckets, applied with a Mongo TTL index. **`0` means keep for
ever, and creates no index** — not an index with a very large number, which would be a deletion
merely postponed. Changed in operation, the TTL is altered in place; changing it back to `0` drops
the index and keeps the documents. The per-project accumulators are never expired here: they are one
document per project, and they are what a project's consumption is read from.

## Tests

```sh
uv run pytest -q      # needs a local MongoDB; it uses the database webtools_metrics_test and drops it
```
