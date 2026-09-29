# Checkpoint 2026-09-26

## 1. Everything internal in English, this time to the end

The audit had been recording Italian identifiers as a breach of a rule it was not auditing, and
they were still there because the translation of 2026-09-24 (`4141eb3`) had translated **prose** —
comments, documentation, texts — and left the names of local variables where the first commit had
put them (`git log -S 'const campi'` → `29459ab`, 2026-09-21). Nothing failed if a variable was
called `campi`, so nothing said they had been left behind.

Measured before touching anything: **33 identifiers, 142 occurrences out of 30 758 (0.46%), in 13
files out of 152** — all internal, no route, no API field, no configuration key. Comments were
already clean but for two lines.

What was changed:

- the 33 names (`campi`→`fields`, `documento`→`document`, `passi`→`steps`, `separatore`→`separator`,
  `entrato`→`logged`, `sopra`/`sotto`→`above`/`below`, …);
- test data and fixture strings: `invio-…`→`submission-…`, `token-di-prova-…`→`token-for-test-…`,
  `password-di-prova`→`test-password`. The scrypt block of the sso tests was **regenerated** by
  running `credentials.py`, because the comment says that block really was produced by Python and
  that had to stay true;
- two Italian log lines in `webtools-workspaces/src/server.js`, the section banners of
  `sso/src/server.js` and `sso/public/styles.css`, the comments in `db.py`, `main.py`,
  `analysis_page.test.js`, and `configurator/secrets/.gitignore`;
- the **public URLs** of the front-gate: `che-cos-e`→`what-it-is`, `esempi`→`examples`,
  `come-funziona`→`how-it-works`, `quanto-costa`→`pricing`, `contatti`→`contacts`,
  `lavora-con-noi`→`work-with-us`, plus the anchors `#lavoro-autonomo`→`#autonomous-work` and
  `#nota-1`/`#rif-1`→`#note-1`/`#ref-1`. Every page was rendered and every internal link checked
  against `PAGES`;
- file names: the six documents of `contesto/` (`02. contesto_aggiornato.md`→`02. current_context.md`
  and so on), `struttura/`→`structure/`, `Diagramma senza titolo.drawio`→`Untitled diagram.drawio`,
  with every reference updated in `CLAUDE.md`, `docs/`, the code and `sanity/`.

What stays in Italian, and is not a defect: the catalogues, the policies (they teach a model which
Italian words to use and to avoid), the example pre-specifications, the assertions that quote a
catalogue's text, and the comments that quote a button — «Entra», «Esci», «Inizia».

Left alone because they are not tracked or are closed: `progetti/` (untracked) and
`structure/design/Supermodellone2.drawio.pdf`, which is a coined name and not a word to translate.

207 tests green across the five suites.

## 2. The audit is finished

Resumed at row 44 and run to the end: **73 units of 73**, 73 findings files, `summary.md` complete.
**19 `breaks-now`**, 134 `latent`, 35 `stylistic`.

Row 73 was added by hand at the start of the day for
`webtools/preanalyst/tests/analysis_page.test.js`, written on 2026-09-25 after the inventory had
been computed: the inventory is never recomputed, so a file born later is appended rather than
folded into a row that had already been judged.

Two caveats the summary records itself: `anagraphics/{main,db,errors}.py` were edited (§3) after
units 44–46 had been closed, so those three findings describe the files as they were read; and
`configurator-fe` belongs to no row, so it is recorded inside two other findings rather than added
as one.

## 3. `metrics`: the system's technical and commercial metrics

Seventh subsystem, Python + Mongo, port 9600. Context and reasoning in `contesto/06. metrics.md`,
reference in `docs/subsystems/metrics/README.md`.

**The first design was wrong and was thrown away.** It was an append-only log of events — one
document per turn of chat — which is a log, not metrics. The correction: *what arrives is folded
into a number that was already there*. A turn of chat creates nothing; it adds 1 to a counter, its
tokens to four sums, its cost to another, and 1 to a bucket of a histogram. The number of documents
follows the number of **kinds** of thing measured (~30 a day, ~11 000 a year), never the traffic.

Two collections and no third: `metrics_daily` (day × subsystem × metric × dimensions) and
`metrics_projects` (one accumulator per project — "what a webtool costs" is a distribution **over
projects**, and a daily sum has already thrown the projects away).

Decisions worth keeping:

- **the money at the demo does not come from here.** What a project consumed is written on its
  pipeline steps in anagraphics by an awaited write. Metrics is an observatory and is allowed to
  lose a measurement; an invoice is not. When the two disagree, the project's record is right;
- **micro-cents.** `tokens × price_per_million_cents` is exact integer arithmetic. Rounding each
  measurement to a whole cent would count a thousand cheap calls as zero. The reads round once, at
  the end, and answer in `_cents`;
- **a model with no price is not priced.** Tokens counted, cost untouched, `unpriced_count` raised,
  and every answer says how much of its cost figure is missing;
- **the vocabulary is closed** — 28 names, their dimensions, and the values of the dimensions that
  can be listed. A name, a dimension or a value that is not in it is a `400` naming what was wrong.
  A typo would split a counter in two and nobody would miss the half they never read;
- **percentiles are estimates** read off the histogram, so they are called `p95_at_most_ms` and are
  `null` when the bucket has no upper bound; `min` and `max` are exact and sit beside them;
- **the funnel reconciles itself.** `GET /projects/count` was added to anagraphics (declared
  **before** `/projects/{project_id}`, or "count" would be read as an id) and the funnel answers
  with the measured figure, the real one, and what it lost — or with the reason it could not ask
  (`unreachable`, `no_route`, `refused`, `unusable`: four different things to do about it).

The vocabulary already covers what nobody has asked for yet and could not be added later:
`dependency.call` (whose fault a slow page is), `ai.retry` (the 137 s turn against a 120 s timeout),
`process.started` with its outcome, `analysis.validation` (every `sent_back` is a paid call),
`prespec.truncated` (the `breaks-now` the audit found, turned into a number), `gate.duration` and
`project.lead_time` (the driver's hours are counted on every project of the funnel), `gate.decided`
with its `reason` — from which comes the cost of what we refuse — `price.quoted` against
`payment.decided`, `fee.split`, `discount.applied`, `turns.granted`/`spent`, `tokens.charged`.

30 tests for metrics, 75 for anagraphics (4 new ones on the count). Loaded into Mongo and tried
against a live anagraphics: the fold, the refusal of an invented name, the reconciliation and the
per-project accumulator all answered as they should; the test data was removed afterwards.
`start.sh` now starts metrics straight after anagraphics.

**The price table is empty on purpose.** The published prices are in dollars and converting them
would mean inventing an exchange rate. Until somebody fills it, everything is counted and nothing
is priced — and the answers say so. Per million tokens: Opus 5 $5 in / $25 out, Haiku 4.5 $1 / $5,
cache write ×1.25 and cache read ×0.1 of input.

The retention was left **configurable and at infinity**: the seed says 90 days, what runs in Mongo
is `0`, which creates no TTL index at all rather than one merely postponing a deletion.

## 4. Still to do

- the shared client in `webtools/commons/metrics/` — it sends without waiting and counts its own
  failed sends; writing them to the subsystem's log is configurable and **off** by default, because
  a broken metrics must not fill the disks;
- the call sites: nothing measures anything yet;
- the price table, once the currency question is settled.

## 5. `metrics-fe`: the dashboard over metrics

A Node subsystem on **9700**, read-only: it reads metrics and writes nothing, anywhere. Twelve pages —
the three questions of the PoC, one page per question metrics answers (`funnel`, `cost`, `analysis`,
`providers`, `http`, `economics`, `timing`, `health`), the daily buckets, one project's accumulator,
and the vocabulary. Configuration in `configurator/configuration/metrics-fe.json`, in `start.sh` last
and in `stop.sh` first; own shell and own stylesheet, like configurator-fe and for the same reason.

**Nothing in it names a metric.** No list of metrics, dimensions, phases, gates, models, providers or
kinds of token exists in the subsystem: they all come out of the answers. A metric added to the
vocabulary appears the day it is first folded, a kind of token becomes a column the first time a
provider reports it, a gate gets a group of its own on `/funnel` the first time it decides something
(the grouping is read off the name metrics builds), and a field added to an answer is printed as it
came rather than dropped. The only judgement the pages make is whether a set of rows are **parts of one
whole** — a total and a share can be given — or separate things counted separately, where the bars are
shares of the largest row and no total is offered.

What it derives on top of what metrics answers, because these are relations between two answers and
not a fold of one:

- **against the period before**: every page reads its question twice, over the period on the address
  and over the one of the same length ending the day before. A figure that did not move is one
  character; one with nothing to compare against carries nothing; a rise out of nothing has no per
  cent. The reading of the period before is its own reading — when it fails it is named and this
  period's figures are still drawn;
- **from one gate to the next**: each gate's share of the first, its share of **the one above it**, and
  how many were lost between the two. Two different facts, and a funnel giving one would be read as
  the other. The order is the decision count descending, which is the pipeline's order when the
  pipeline is real: no order is declared anywhere;
- **`each`**: the kind over the occurrences counted in the same row — tokens per turn, per call, per
  phase. The figure that does not move with the traffic;
- **what produced nothing**: the tokens spent on refused projects as a share of the period's whole
  consumption, kind by kind. `/economics` asks `cost` too for it, rather than reconstructing the
  figure by multiplication.

Three decisions worth keeping:

- **durations are on a logarithmic scale**, in decades of what was measured, and the page says so. A
  gate deciding in a second and one waiting two days are both ordinary; on a linear scale every row but
  the slowest sat on the baseline. Found by rendering real data, not by reasoning about it;
- **rings only where the rows are the parts of one whole**, from three slices up: never over a ranked
  list of routes, never over kinds of token — their sum is a rate nobody decided — and never with two
  slices, which is a number and its complement. At most `limits.ring_slices`, capped at the six hues
  validated in both modes (lightness band, chroma floor, separation under protanopia and deuteranopia,
  separation under ordinary vision, contrast);
- **no page explains itself in prose.** The prose in the templates went from 558 words to 313, and what
  is left is only what stops a number being misread. The why is in the README and in the comments. A
  sentence a reader has already understood is noise on top of the number it explains.

88 tests, against a stub whose every name is invented. Three states beside the ordinary one: a system
that has just started (every key of every answer present and empty), a metrics that is down, slow,
refusing or answering something that is not what the route promises, and a period before that cannot be
read. Two defects the tests caught: the empty system — the state a new environment is in — crashed the
overview, and the funnel drew its stages twice.

`integerList` was added to `commons/configuration/configuration_client.js`: a list of integers had no
reader. Additive, redeployed, and every sibling suite still passes.

## 6. The call sites: from 3 metrics sent to 24 of 27

§4 said "nothing measures anything yet", and that was still true after metrics-fe was finished: with
everything running, metrics held **2 buckets and 1 metric** (`process.started`). A dashboard nobody
sends anything to shows nothing, and it would have gone on showing nothing — no amount of traffic fills
a counter nobody increments.

Where the measurements went, and the principle: **one place per family**, never scattered.

| | |
|---|---|
| `dependency.call` | inside `readJson` of the preanalyst's `anagraphics.js` and in its `workspaces.js` client: one line covers **every** call between subsystems there is, and one added tomorrow needs nothing. Four outcomes — `ok`, `failed`, `timed_out` (we gave up waiting, which is not the same as nothing being there) and `not_found`, which is an answer |
| `gate.decided`, `gate.duration` | inside `addPipelineStep`: **every** gate of the pipeline decides through there, the ones that do not exist yet included. The duration is between the previous step deciding and this one, both from anagraphics' own clock — ours would be a second clock, and two clocks make a duration that is not one |
| `project.created` | inside `createProject`, **201 only**: a 200 is a submission that had already arrived, and counting it again would be a project that does not exist. It is the number the funnel is reconciled against |
| `ai.call`, `ai.failed`, `ai.retry` | a new `preanalyst/src/measured_ai.js`: the doors' envelope translated into the vocabulary **once**, and the three engines call it with their own phase (`prevalidation`, `analysis_opening`, `analysis_turn`, `analysis_validation`) |
| `http.request`, `http.error` | on the response's `finish`, so no branch of the routing counts itself; the error's code is stamped on the response by whoever sends it. Added to front-gate and workspaces, which measured nothing at all, and the error code to all four |

front-gate and workspaces did not even load the metrics client, though the deployer had been copying it
to them and their configuration already had the fields.

**The trap, and it is the thing to remember**: `analysis.turn` does **not** carry the tokens — `ai.call`
does. `reads.cost` sums *everything that carries tokens*, so the same tokens under two names double the
consumption of the whole system. The per-turn cost is read on `/cost` under the `analysis_turn` phase.
Written in the code where it would be undone.

Verified by a checker that reads the vocabulary from the running metrics and compares **every**
`measure()` in the source — name, required dimensions present, no unknown dimension, values declared,
`project_id` only where it is allowed: **37 points, 0 problems**. Its first two versions gave 13 and 4
false alarms, because they could not read shorthand properties and did not tell keys from values. It
lives in the scratchpad and is not in the repository yet.

After `start.sh --restart` and a handful of page opens: `form.opened` 2, `http.error` 1,
`http.request` 6 from three subsystems. `/http` on 9700 reads real data.

## 7. Still to do, replacing §4

- **a metrics client for anagraphics**, in Python. It is the only subsystem not in JavaScript, and the
  one collection every figure in the system is stored in is the one part of it nothing says anything
  about (`mongo.operation`);
- **`project.lead_time`**: `paid` does not exist in the flow, and the lead time of an open project is a
  photograph of a duration still growing, with no moment at which to take it;
- **`tokens.charged`**: the autonomous work's flow does not exist. It belongs with that work;
- the three above are written out in full in `contesto/todos.md`;
- **the measurement checker in the repository**, skipping itself when metrics does not answer. It is
  what stops a wrong measurement staying silently at zero — as 21 of these did until today;
- the price table, once the currency question is settled (unchanged from §4).
