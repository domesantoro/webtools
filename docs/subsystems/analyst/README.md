# Subsystem `webtools_analyst`

> Code: `webtools/analyst/`. Document current as of 2026-09-29, version 0.1.0.

## 0. Quick sheet

| | |
|---|---|
| Role | Turns a finished pre-analysis into the technical analysis, a judgement on taking the work on, and the functional points the client agrees to |
| Technology | Python ≥ 3.12, FastAPI, uvicorn, httpx, Jinja2, one provider SDK behind an adapter |
| Port | **9800** (`listen.port` of the configuration) |
| Configuration | Read at startup from anagraphics (`GET /configuration/analyst`). No defaults: if it is missing, the server does not start (§6) |
| Start / stop | `webtools/analyst/webtools_analyst.sh --start` / `--stop` |
| PID / Log | `webtools_analyst.pid` / `webtools_analyst.log`, in the subsystem's directory |
| Data | None of its own: what it decides goes on the project in anagraphics, the documents go to workspaces |
| Who calls it | **Nobody yet.** The trigger exists (§7); the preanalyst still has a placeholder where it should call it |
| What it calls | anagraphics (the project and its steps), workspaces (the pre-specification in, the two documents out), drivers-pool (who supervises it), comm-center (telling them) |
| Tests | `uv run pytest`: 159 tests, no service running and no model called |

## 1. Role

The client's pre-analysis is over: a pre-specification the form rendered, and the rounds of
questions that followed it. From that this subsystem produces three things, and they go to three
different places because losing one of them does not mean the same as losing another:

- the **technical analysis**, for whoever builds — an AI developer under a driver's supervision. It
  goes to workspaces as the document `analysis/1`;
- the **judgement**, for the driver who decides: a verdict, a score per axis, the weakest axis, the
  declared confidence and the model's own words. It goes on the project's pipeline step, where the
  rest of a project's history is read. **It never writes `REJECTED`**: the analyst proposes, a
  person decides (§3.2);
- the **functional points**, for the client: short sentences in their own language, each with a
  stable identifier. They go on the step as data **and** to workspaces as the document `proposal/1`,
  rendered from that same list so the two cannot disagree.

**Nobody waits in front of it.** A run is several model calls over minutes: the trigger answers at
once and the pipeline advances by what is written in anagraphics.

## 2. The rule this subsystem is built on

**The system talks to a model only through a contract, and is never tied to one provider.** A
**door** is one question asked of a model. Every door owns its contract — what it sends and what
comes back, in our words — and **contracts are not shared between doors**: two doors may run on
different providers, with different keys, different models and different consumption, and each has
to be able to change without the others being disentangled first. Three contracts looking alike is
the price of that independence, and it is paid on purpose.

A **provider is an adapter**: it takes the request in the contract's words, speaks whatever its API
speaks, and answers in the contract's words. It is the only file that may name that provider, import
its SDK, or know its fields, its roles, its error codes and what it calls a unit of consumption.
Above an adapter nothing carries a provider's vocabulary.

## 3. The three doors

They run in this order, and the order is **not** configurable: the analysis first, because judging
without it means arriving at the person who decides with a verdict and nothing to check it against;
the points last, because they are written from the analysis.

All three run on **every** project, whatever the judgement proposed. The driver validates every
analysis, and withholding the list on one of the two outcomes would make the outcomes incomparable
in front of the person deciding.

| Door | Policy | Configuration | Answers |
|---|---|---|---|
| Technical analysis | `analysis-technical-v1` | `analysis.technical` | `{analysis, assumptions}` |
| Judgement of sustainability | `analysis-sustainability-v1` | `analysis.judgement` | `{verdict, asked_for, scores, weakest, confidence, reason}` |
| Functional points | `functional-points-v1` | `analysis.points` | `{language, points: [{id, text}]}` |

Code: `webtools_analyst/analysis_technical.py`, `analysis_sustainability.py`, `functional_points.py`.
Each has its contract and its adapters beside it, in `<door>_ai/`.

### 3.1 What comes back, whatever happens

One envelope for every outcome, so nothing has to be inferred from which fields happen to be there:

```
{ok, provider, model, ended, failure, attempts, fell_back, spend, output}
```

`ended` and `failure` answer two different questions, and collapsing them is how a system stops
knowing what happens to it:

| `ended` | |
|---|---|
| `complete` | there is an answer, and it is ours to use |
| `cut` | the model stopped before finishing — our ceiling, our decision |
| `refused` | the model declined — its policy, not our bug |
| `unusable` | it answered, and the answer does not fit what we asked for |
| `no_answer` | nothing came back at all; `failure` says why |

In the first four **the model ran**, so what it consumed is real and is reported. `failure` is one
of `unreachable`, `timed_out`, `rate_limited`, `unauthorised`, `rejected`, `unknown_provider`.

`spend["kinds"]` maps a name to a number of units, and **the names are the adapter's**: one provider
counts input and output, another a cache it writes and a cache it reads, another reasoning apart. No
list of those names exists anywhere above an adapter. They are counted and never converted: what a
unit is worth is not this subsystem's to say.

The door checks the contract on whatever the adapter hands over, so an adapter that drifts is caught
at the boundary instead of three files downstream.

### 3.2 The judgement is a proposal

The analyst never writes `REJECTED`. A gate of that kind is already in place earlier and cheaper —
the prevalidation refuses on scope before the client has spent a conversation — and `REJECTED` is
terminal with no appeal. What goes on the step is what a person needs in order to disagree: the
verdict, the score per axis, which axis was weakest, the confidence, and the model's own words.

`analysis.judgement.take_on_threshold` is a **floor and not a mean**: every axis has to be above it
for the proposal to be `take_on`. The weakest decides.

### 3.3 The identifiers of the points are ours

The list is numbered as it arrives, `p1`, `p2`, `p3`. A model asked for identifiers gives two points
the same one sooner or later, and two points with one identifier is a demo nobody can accept by
halves. Blank entries are dropped before numbering, so the identifiers have no holes: `p2` missing
from a list of five would read as a point somebody removed.

## 4. The documents

The shape of a document is configuration: the models live in `webtools/configurator/documents/` and
this subsystem holds **generated copies** in `documents/`, put there by the documents deployer.

| Document | Model | Language |
|---|---|---|
| `analysis/1` | `analysis.md.j2` | English: its reader is whoever builds |
| `proposal/1` | `proposal.md.j2` | The client's, read off the pre-specification's front matter |

**Whoever produces a document renders it**, which is why the models here are Jinja2 and the
pre-specification's, next door in the preanalyst, is nunjucks: the engine follows the subsystem's
language, not the other way round.

Two things the renderer holds and the models do not (`webtools_analyst/documents.py`):

- **a model's words never reach the front matter.** They are markdown in the body, where an
  unexpected line is a line of text rather than YAML somebody else parses;
- **a point cannot break out of its row.** The proposal is a table, and a bar or a newline inside a
  sentence would read as two points. The `cell` filter keeps one point on one row.

The rendered file **begins** with the front matter's first dash. A document whose first line is
anything else has no front matter as far as workspaces is concerned, and it would be given a fresh
one with ours pushed down into the body.

The proposal's fixed words — its title and the line under it — are **not** written in its model:
they come from the language catalogues, like every other text a person reads
(`analyst.proposal.*` in `webtools/commons/i18n/locales/`). The Python side of the catalogues is
`webtools_i18n.py`, a module of its own beside the JavaScript one: a page asks which language a
request is in and how to escape a value into HTML, a document asks neither.

## 5. What is measured

Everything goes to metrics under the names the vocabulary closes
(`webtools/metrics/webtools_metrics/vocabulary.py`). The phases are `analysis_technical`,
`analysis_sustainability` and `analysis_points`, one per door, so what each call consumed can be
read apart from the others.

| Metric | What it says |
|---|---|
| `ai.call` | one interaction with a model: how it ended, how long we waited, **and the tokens** |
| `ai.failed` | nothing came back, and why |
| `ai.retry` | an attempt that was not the first. It carries the count and **not** the tokens: those are on `ai.call`, once |
| `analysis.written` | how long the analysis came out, and how many assumptions it declared |
| `analysis.judged` | the verdict, the weakest axis, the scores and the confidence |
| `points.written` | how many points, and in which language |
| `gate.decided`, `gate.duration` | every step this gate writes, counted where it is written, so nobody has to remember |
| `driver.handover` | assigned, nobody enabled, given up on, or the pool unavailable — and how many times it was asked |
| `dependency.call` | every call to another subsystem: target, operation, outcome, duration |
| `http.request`, `http.error`, `http.refused_ip` | one per request, counted in the middleware so no route has to remember |
| `process.started` | the subsystem came up |

**Only `ai.call` carries the tokens.** Whoever reads the consumption adds up everything that carries
tokens and cannot tell one report of a call from two, so the same tokens under a second name would
double the cost of the whole system. What a run *was* is counted by its own metric; what it *cost*
is on `ai.call`. The decision is written in `webtools_analyst/measured_ai.py`, which is where it
would be undone.

## 6. Configuration

Read **at startup** from anagraphics, `GET /configuration/analyst`. The source is
`webtools/configurator/configuration/analyst.json`, and the API keys are deep-merged from
`webtools/configurator/secrets/analyst.json`, which is outside git. No defaults: if a field is
missing the subsystem does not start.

Only `WEBTOOLS_ANAGRAPHICS_URL` and `WEBTOOLS_CONFIGURATION_TIMEOUT_MS` come from the environment
(`webtools/configurator/bootstrap.env`). Where anagraphics is cannot be configuration: it is the one
thing that has to be known before the configuration can be read.

| Field | Today | |
|---|---|---|
| `listen.host` / `listen.port` | `127.0.0.1` / `9800` | |
| `access.allowed_ips` | `["127.0.0.1", "::1"]` | An exact comparison on the connection's IP |
| `limits.body_max_bytes` | `8192` | What arrives here is a trigger naming a project, not a document |
| `subsystems_infos.anagraphics.timeout_ms` | `5000` | The address comes from the bootstrap |
| `subsystems_infos.workspaces.*` | `9400`, `5000` | The pre-specification in, the two documents out |
| `subsystems_infos.drivers_pool.*` | `9001`, `5000` | Who supervises the project |
| `subsystems_infos.comm_center.*` | `9002`, `5000` | Telling that driver the analysis is waiting |
| `subsystems_infos.metrics.*` | `9600`, `2000` | |
| `metrics.log_failures`, `metrics.pending_max` | `false`, `1000` | |
| `handover.max_attempts` | `3` | How many times the pool is asked again when the driver it named no longer exists |
| `i18n.locales`, `i18n.fallback_locale` | `["en","it"]`, `en` | The catalogues for the proposal's fixed words |
| `analysis.<door>.provider` | `anthropic` | Which adapter answers |
| `analysis.<door>.timeout_ms` | `600000` | Ten minutes: these are long answers |
| `analysis.<door>.max_attempts` | `3` | |
| `analysis.<door>.policy` | see §3 | **Which** policy, not what it says |
| `analysis.<door>.providers.<name>.*` | model, `max_tokens`, `effort`, `api_key` | Read by that adapter only |
| `analysis.judgement.take_on_threshold` | `0.5` | A floor on every axis (§3.2) |

## 7. The run

### 7.1 The trigger

`POST /projects/{project_id}/analysis` → `202 {"project_id": …, "started": true}`.

`202` means taken, not done: several model calls over minutes are not a request anybody waits on.
What is already true when it answers is that the project carries an open `analysis` step and sits in
`ANALYSIS`; the rest happens behind the answer and is read off the project.

| Outcome | Status | Body |
|---|---|---|
| Taken | `202` | `{"project_id": …, "started": true}` |
| No such project | `404` | `PROJECT_NOT_FOUND` |
| The analysis has already been run | `409` | `ANALYSIS_ALREADY_STARTED` |
| The project is not there yet (`PREVALIDATION`, `UNDERSPECIFIED`) | `409` | `PROJECT_NOT_READY` |
| The project was refused | `409` | `PROJECT_REJECTED` |
| Anagraphics not answering | `503` | `ANAGRAPHICS_UNAVAILABLE` |

Three codes and not one, because they are three different facts: a caller that reads one word cannot
tell a project that is not ready yet from one that has already been through here.

**The refusal is decided on the state, never on whether an open step is there.** A project that has
been through a phase has no open step for it — that is what finishing means — so the absence of one
cannot be the test. It is the mistake the audit found one step earlier, where a finished
conversation is reopened and hands out its turns again.

### 7.2 The step: how it opens, and what closes it

The trigger writes the `analysis` step as `open` and moves the project to `ANALYSIS`, in one write,
because anagraphics appends the step and sets the state together. At the end the run appends the step
again, decided, and **that is what closes the open one**: it is the convention the pipeline already
runs on — the rounds of questions are opened by the prevalidation and closed by whatever step comes
after them (`webtools/preanalyst/src/server.js`, where the `preanalysis` step is opened).

### 7.3 In order

1. the pre-specification from workspaces, and the rounds of questions off the project's **last**
   `preanalysis` step — a project sent back for want of detail and come again has more than one;
2. the technical analysis, then the judgement, then the points (§3);
3. the two documents to workspaces, **before** the step is written: a step saying the analysis is
   ready, with no analysis anywhere, would be worse than a run that failed;
4. the step, decided, with the verdict, the scores, the weakest axis, the confidence, the model's
   words, the assumptions, the points as data, which documents were written, and what each of the
   three calls consumed. The state goes to `DRIVER_VALIDATION`;
5. the driver, asked of the pool and written on the project; then the comm-center is told.

### 7.4 When it does not get to the end

Every way a run can stop appends the step as `failed` and puts the project in **`FAILED`**. That is
not a refusal — nobody decided anything about the request — and it is not somewhere a project passes
through: it is where one is left when the work that was supposed to move it stopped, and it is
looked at rather than waited on.

`failed_at` says where it stopped — `no_specification`, `technical`, `judgement`, `points`,
`documents`, `broken` — and the step carries what each call that had already answered consumed. In
three of the four ways an answer ends badly the model ran, and those tokens are real.

**A project nobody can be given to ends in `FAILED_NO_DRIVERS`**, which is a different fact and has
its own name: the analysis is written and paid for, and what is missing is a person. It is a second
step, because the first one says the analysis passed and this one says the handover did not; the
project does not stay in `DRIVER_VALIDATION`, where it would look as though somebody were reading
it.

One failure is written down and repairs nothing, because nothing here could: **the step could not be
written** after the documents were stored. The project is left in `ANALYSIS` and the log says so in
capitals.

### 7.5 What still does not exist

- **The call from the preanalyst**, at the end of the rounds of questions, where there is an explicit
  placeholder today.
- **The driver's gate**: a subsystem of its own, after this one. Until it exists, projects sit in
  `DRIVER_VALIDATION` with nothing able to move them on. That is not a hole in the analyst; it is
  what "the gate comes after" means.
- **A notification channel**: there is none in this repository. The comm-center writes the notice in
  its log.

## 8. Known limits

- **A project with an analysis and no driver.** If the pool has nobody enabled, or names drivers who
  no longer exist until `handover.max_attempts` runs out, the work is done and paid for and there is
  nobody to look at it. The state says so — `FAILED_NO_DRIVERS` — the run counts it
  (`driver.handover`) and says it in the log, and nothing else notices, because nothing reads the
  register of the steps back. What answers that is the `sanity-checker` (`contesto/todos.md`).
- **Two triggers in the same instant.** The state is read and then written, and between those two
  moments a second trigger can pass. The window is milliseconds against a run of minutes, and what
  it would cost is a second analysis, paid twice.
- **Nobody reads `template:`.** Every document declares which model it was written against, and no
  reader uses it to decide how to treat what it is reading. What happens when a model changes and a
  document written against the old one is opened has no answer.
- **Authentication between services**: there is only the IP pool, as everywhere else.

## 9. Files

```text
webtools/analyst/
├── pyproject.toml              # fastapi, uvicorn, httpx, jinja2, the provider SDK
├── webtools_analyst.sh         # --start / --stop, PID with a verified command line
├── scripts/analyse.py          # the three doors by hand, on real material: real calls, real cost
├── documents/                  # GENERATED COPIES from the documents deployer
│   ├── analysis.md.j2
│   └── proposal.md.j2
├── policies/                   # GENERATED COPIES: what each door asks, and by what criteria
├── webtools_analyst/
│   ├── main.py                 # the app: the IP pool, the body's size, one measurement per request
│   ├── settings.py             # the configuration → the settings, or it does not start
│   ├── errors.py               # the error contract: a status and a stable code
│   ├── run.py                  # one run: the trigger, the order, what is written when it fails
│   ├── documents.py            # renders analysis/1 and proposal/1
│   ├── measured_ai.py          # one interaction → the vocabulary's words, in one place
│   ├── analysis_technical.py   ┐
│   ├── analysis_sustainability.py  ├ the three doors
│   ├── functional_points.py    ┘
│   ├── <door>_ai/              # one per door: contract.py and providers/<name>.py
│   ├── anagraphics.py          ┐
│   ├── workspaces.py           ├ the clients: the data or a reason, never an exception
│   ├── drivers_pool.py         │
│   ├── comm_center.py          ┘
│   └── commons/                # GENERATED COPIES: configuration, metrics, i18n + catalogues
└── tests/
```

## 10. Changelog

| Date | Version | Change |
|---|---|---|
| 2026-09-29 | 0.1.0 | The documents (`analysis/1`, `proposal/1`) rendered with Jinja2 from the configurator's models; the Python side of the language catalogues; the clients towards anagraphics, workspaces, drivers-pool and comm-center; **the run and its trigger** (§7), with `gate.decided`, `gate.duration` and the new `driver.handover`. First documentation of the subsystem. |
| 2026-09-28 | — | The subsystem, its configuration, its error contract and the three doors, run by hand with `scripts/analyse.py` on real material. |
