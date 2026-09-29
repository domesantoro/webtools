# metrics-fe — the metrics, to look at

`webtools_metrics` answers questions over HTTP and keeps nothing per occurrence. To see what the
system is doing one had to call it route by route and read JSON. This is the dashboard that reads it.

```sh
./webtools_metrics_fe.sh --start     # then http://127.0.0.1:9700
./webtools_metrics_fe.sh --stop
```

It is in `webtools/configurator/start.sh`, last, and in `stop.sh`, first: nothing depends on it, and
it needs only metrics to be up. It still starts and stops on its own with the commands above, for
when only it is wanted.

**It reads, and it writes nothing.** Not to metrics, not to anagraphics, nowhere. metrics is written
to by whoever measures, and a measurement is not something a page sends. Every address here takes a
reading, and a method that is not a reading is refused wherever it is sent.

**It has no source but metrics.** Every figure on every page comes from `GET /metrics/…` or
`GET /vocabulary`, and nothing is computed from a second place — not from the configuration, not from
anagraphics, not from a constant in a file here. Where metrics does not answer something, the page
says so instead of working it out another way.

## The pages

The period is two days on the address (`?from=&to=`), in UTC, as metrics keys its buckets. Without
it, the period is `period.default_days` days ending today. The bar at the top is the only control
and it scopes everything under it.

| | |
|---|---|
| `/` | the three questions this front end exists to answer, what was consumed, whether it is standing up, and what was folded day by day |
| `/funnel` | who arrived at each stage and where they left, reconciled against the projects that really exist |
| `/cost` | what the AI consumed: by phase, by model, by subsystem, and the distribution over projects |
| `/preanalysis` | the turns a pre-analysis really takes, and how the rounds of questions end |
| `/providers` | calls, failures, retries and latency, model by model |
| `/http` | the HTTP surface of every subsystem: route, status, error code, duration |
| `/economics` | turns granted and spent, what a sale consumed, what was spent on projects a gate refused |
| `/timing` | how long each gate takes, a project from end to end, and the form |
| `/health` | starts, the calls between subsystems, Mongo, logins |
| `/daily` | the buckets themselves, one metric at a time or all of them, with their histograms |
| `/projects?id=` | one project's accumulator: phases, gates, and metric by metric |
| `/vocabulary` | what may be sent — the page to open when a measurement was refused |

`/projects` and `/vocabulary` have no period: an accumulator is everything that project ever did, and
the vocabulary is not a thing that happens on a day. The bar is not shown there, because a control
that changes nothing is worse than no control.

## What it works out

metrics answers the aggregates over the buckets — the distributions, the percentiles, the rates. These
are the figures this subsystem derives on top of them, because they are relations between two answers
and not a fold of one.

**Against the period before.** Every page reads its question twice: over the period on the address, and
over the period of the same length ending the day before it. A figure on its own says how the system
is; the two together say how it is going. The change is beside the figure it belongs to — on the
headings and the headline rows, never on every row of a table of routes. A figure that did not move is
one character (`=`); a figure with nothing to compare against carries nothing at all, and a rise out of
nothing has no per cent. The reading of the period before is its own reading: when it fails it is
reported under its own name and this period's figures are still drawn.

**From one gate to the next.** `/funnel` puts the gates in a chain and says, for each, its share of the
first, its share of **the one above it**, and how many were lost between the two. Those are two
different facts and a funnel that gave only one would be read as the other. The same is done for the way
in, over the stages that are not a gate. The order is the decision count descending — which is the
pipeline's order when the pipeline is real — and no order is declared anywhere in this subsystem.

**What one of them cost.** Every row that carries tokens and a count carries `each`: the kind over the
occurrences counted in that row. Tokens per turn, per call, per phase, per route. It is per kind, so
nothing is weighed against a kind it is not, and it is the figure that does not move with the traffic.

**What produced nothing.** The tokens spent on projects a gate refused, as a share of the period's whole
consumption, kind by kind. `/economics` asks `cost` as well as `economics` for it: the whole consumption
is answered by `cost`, and reconstructing it from a per-demo figure would be a multiplication nobody
measured.

Nothing else is derived. There is no failure rate per model — metrics splits the failures by reason, not
by model, and getting it any other way would mean naming metrics in this subsystem. There is no
comparison against the estimates of `contesto/04.`: those are not configuration yet, and inventing them
here would be a claim about a figure nobody declared.

## What it will not do

**It never turns a token into money, and it never adds two kinds of token together.** There is no
price in this subsystem and no currency anywhere on these pages. What a token is worth is agreed
elsewhere and changes; a figure in a currency coming out of here would be a claim about a price
nobody configured. Kinds are columns, never a sum: a token of one kind and a token of another are not
the same thing, and a total of the two is a rate between them that nobody decided.

**It never fills a gap in.** A summary without a duration has none, not a zero. A row that does not
carry a kind of token shows a dash in that column. A day with no bucket is a break in the line, not a
point on the baseline: nothing was folded on it, which is not the same as a measured zero — metrics
may simply not have been running. A question with no answer yet says so, and no figure is put in its
place.

**It never claims a percentile is exact.** metrics reads `p50` and `p95` off a histogram and answers
the upper edge of the bucket the percentile falls in; the pages print them as `p50 ≤` and say what
they were read from. A percentile that fell in the bucket with no upper bound has no number at all,
and `max` — which is exact — is beside it.

**It never refreshes itself, and nothing opens by itself.** The bar says when it was read, and
reading again is a click. A picture that changed while it was being read would be a reading of a
moment nobody asked about.

**It never explains itself on the page.** Why a figure is built the way it is belongs here and in the
comments, not stacked on top of the number. A sentence stays on a page only where leaving it out would
let a number be misread — that a percentile is a bucket's edge, that kinds are not added, that a column
is not part of a sum. Everything else is a column heading or nothing at all.

## Nothing here names a metric

No list of metrics, dimensions, dimension values, phases, gates, models, providers or kinds of token
exists anywhere in this subsystem. They are all read out of what metrics answers:

- a **metric** added to the vocabulary appears on `/daily` and in the pictures the day it is first
  folded, and on `/vocabulary` before that;
- a **kind of token** becomes a column the first time a provider reports it;
- a **gate** added to the vocabulary gets a group of its own on `/funnel` the first time it decides
  something. The grouping is read off the name metrics builds (`gate.<gate>.<outcome>`), not out of a
  list kept here;
- a **field added to an answer** that these pages were not written for is printed as it came
  (`/funnel`'s reconciliation, a project's accumulator) rather than dropped.

The only judgement the pages make about an answer is whether a set of rows are **parts of one whole**
— the outcomes of one gate, the phases of one consumption, of which a total and a share can be given
— or separate things counted separately, where the bars are shares of the largest row and no total is
offered: a total of occurrences of different things is a number nobody can use.

## What every page says about its own reading

- a reading that **could not be used** is named with the word for what happened to it: `unreachable`
  (nothing came back), `refused` (it answered with a status that is not a success, and a stable code),
  `not_json`, `malformed` (it is JSON and it is not what the route promises). Four words, because they
  are four different things to do about it. The page is still drawn from the readings that did come
  back, and nothing is put in the place of the ones that did not;
- a reading that answered **"there is no such thing"** is not a failure. A project id nobody ever
  measured is an answer about that project, and the page that asked is the one that says it;
- a reading that **ran out** is said so: metrics answers at most `limits.max_rows` buckets and says
  when it reached that. Every figure computed from a truncated reading is a figure of part of the
  period, and the page says which readings those were.

## Reading the pictures

Bars, histograms and spans carry **one measure and one colour**: length is the value, and hue is
never a second copy of it.

**Durations are on a logarithmic scale**, in decades of what was actually measured, and the rule says
so where it is drawn. A gate that decides in a second and a gate that waits two days are both
ordinary here; on a linear scale every row but the slowest would sit on the baseline. `min`, `mean`
and `max` are dots; the two percentiles are dotted boundaries, because that is what they are.

**A ring is drawn where the rows really are the parts of one whole** — the outcomes of one gate, the
statuses of one subsystem's requests, the sources of the turns granted, how a pre-analysis closed, where a
call to a model ended up. Never over a ranked list of routes or models, where there are hundreds and the
total is not a thing anybody asked about, and never over kinds of token, which are not parts of anything:
their sum is a rate nobody decided. Two limits: at most `limits.ring_slices` slices, the fold included,
and never more than the number of validated hues — what is past it folds into one slice, which is
legitimate here because these parts are the same unit and of the same whole, so their sum is a part too.
And at least three slices: two parts of a whole are a number and its complement, which the table beside it
already says. The middle carries the total, the legend names every slice, a slice with room carries its own
percentage, and the counts are in the table next to it.

**The chart over time** draws a line per metric, for the busiest `limits.series_metrics` of them; the
rest are **named**, never folded into an "other" that would add up occurrences of different things.
The colours are eight fixed hues in a fixed order, of which the dashboard uses the first six,
validated in both light and dark against the surface they are drawn on — lightness band, chroma floor,
separation under protanopia and deuteranopia, separation under ordinary vision, contrast. The order is
what makes them safe, so it is never re-ordered and a seventh line is never a generated hue.

Nothing is readable by colour alone: every chart has a legend, every line's end carries its own
number, every mark carries its value as a tooltip, and the numbers the chart is drawn from are under
it in a table.

## Configuration

`webtools/configurator/configuration/metrics-fe.json`, served by anagraphics at
`GET /configuration/metrics-fe`. No default values: a missing field and the server does not start.

| | |
|---|---|
| `listen.host`, `listen.port` | where it listens |
| `access.allowed_ips` | the pool it answers. A check on the connection's IP, not an authorisation |
| `subsystems_infos.metrics.url`, `.timeout_ms` | where metrics is, and how long a page may wait for it. A page asks several questions at once, and a period of a year is a read of hundreds of buckets: it is the timeout of a page being drawn, not of a measurement being sent |
| `period.default_days` | how long a period is when the address does not say |
| `period.presets_days` | the lengths the bar offers in one click |
| `limits.top_rows` | how many rows a ranked table shows. Routes, models and dimension values are open lists; what is left out is counted and said |
| `limits.series_metrics` | how many metrics get a line of their own |
| `limits.ring_slices` | how many slices a ring may have, the fold included. Capped at the number of hues that have been validated to be told apart |

The period before is not configured: it is the period on the address, one length earlier, so the two
being compared are always the same length.

## Why not the shared shell

`commons/base.njk` asks for the language and the translation of a page of the product. This is
internal instrumentation: its labels are metric names, dimension values and system terms, and they
stay in English like everything else that is internal. So it has its own `templates/layout.njk` and
its own `public/styles.css`, and it receives nothing from the style, template or i18n deployers — the
same choice as configurator-fe, for the same reason. It does receive the configuration client, which
every Node subsystem needs to read its own configuration.

## Why it does not measure itself

It is not in metrics' `SUBSYSTEMS`, so a measurement from here would be refused by name — correctly:
the vocabulary is closed and adding a subsystem to it is a decision about metrics, not about this
page. It therefore does not take the metrics client from the deployer, and it counts nothing about
itself. If that changes, the vocabulary changes first.

## Tests

```sh
npm test
```

A stub takes the place of metrics, so the tests need nothing running. **Everything it answers is
invented** — metric names, dimension values, kinds of token, providers, phases, a gate this system
does not have — because what the pages do has to hold for those exactly as it holds for ours. Three states are tested beside the ordinary one: a system that has just started, where every key of
every answer is there and empty; a metrics that is down, slow, refusing, or answering something that is
not what the route promises; and a period before that cannot be read, which must not take this period's
figures down with it. The arithmetic of the chain, the changes, the ratios and the shares is tested on
its own, with the numbers written out.
