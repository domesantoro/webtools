// From what metrics answers to what a page prints.
//
// Everything here works on the **shape** metrics answers with, never on the names
// this system happens to measure today. A metric, a dimension value, a model, a
// route, a kind of token: all of them are discovered in the answer. No list of
// them exists in this subsystem, so a metric added to the vocabulary appears on
// these pages the day it is first folded, and nothing has to be remembered here.
//
// Three rules the whole file obeys, because they are the ones a dashboard breaks
// first:
//
//   - **absent is absent.** A summary without `duration` is a summary of something
//     that has no duration, not one whose duration is zero. A row that does not
//     carry a kind of token shows nothing in that column, not a 0.
//   - **kinds of token are never added to one another.** A column per kind, and no
//     total column: a token of one kind and a token of another are not the same
//     thing, and a sum of the two is a rate between them that nobody decided.
//   - **nothing becomes money.** There is no price anywhere in this subsystem, and
//     a figure in a currency would be a claim about one nobody configured.

// What metrics writes in the place of a dimension a bucket does not carry: `none`
// where a dimension is missing (`by_dimension`), `—` where a model is
// (`providers.calls`, `health.dependencies`). It is its contract, stated here at
// the boundary that deals with it, and it is not a guess about what a value may
// be: a page has to be able to say "these were counted, and they could not be
// split" instead of printing a row that reads like a name.
export const NOT_CARRIED = ["none", "—"];

const NUMBER = new Intl.NumberFormat("en-GB");

// A count, grouped. Columns of these are aligned with tabular figures in the
// style, which is what makes a column of numbers readable.
export function count(value) {
  return Number.isFinite(value) ? NUMBER.format(value) : null;
}

// The same number where it is read alone and large — a headline figure — and so
// shortened: at 48px the digits are what is read, not the last three of them.
export function compact(value) {
  if (!Number.isFinite(value)) return null;
  const size = Math.abs(value);
  for (const [unit, suffix] of [[1e9, "G"], [1e6, "M"], [1e3, "k"]]) {
    if (size >= unit) {
      const scaled = value / unit;
      return `${Math.abs(scaled) >= 100 ? Math.round(scaled) : scaled.toFixed(1)}${suffix}`;
    }
  }
  return NUMBER.format(value);
}

// A duration, in the unit it reads in, with the milliseconds kept beside it: the
// unit is for reading and the number is what was measured.
// → { text, ms } | null
export function duration(ms) {
  if (!Number.isFinite(ms)) return null;
  const text = (() => {
    if (ms < 1000) return `${NUMBER.format(Math.round(ms))} ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
    if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)} min`;
    // Days from two days up: a lead time is days in this system, and nobody converts
    // "277.8 h" in their head.
    if (ms < 172_800_000) return `${(ms / 3_600_000).toFixed(1)} h`;
    return `${(ms / 86_400_000).toFixed(1)} d`;
  })();
  return { text, ms, exact: `${NUMBER.format(ms)} ms` };
}

// → { text, bytes } | null. 1024, because these are bytes of a document.
export function bytes(value) {
  if (!Number.isFinite(value)) return null;
  const units = ["B", "KiB", "MiB", "GiB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const text = unit === 0 ? `${NUMBER.format(value)} B` : `${size.toFixed(1)} ${units[unit]}`;
  return { text, bytes: value, exact: `${NUMBER.format(value)} B` };
}

// --- durations -------------------------------------------------------------

// The duration part of a summary, as metrics answers it:
//   { count, mean_ms, min_ms, max_ms, p50_at_most_ms, p95_at_most_ms, estimated_from }
//
// The percentiles are the **upper edge of the bucket** the percentile falls in, and
// `null` when that bucket has no upper bound. Both facts are carried, because a
// page that printed `p95` as if it were exact would be claiming something metrics
// took care not to say.
export function describeDuration(given) {
  if (given === null || typeof given !== "object") return null;
  const marks = {
    count: count(given.count),
    mean: duration(given.mean_ms),
    min: duration(given.min_ms),
    max: duration(given.max_ms),
    p50: duration(given.p50_at_most_ms),
    p95: duration(given.p95_at_most_ms),
    // Which of the two percentiles fell in the bucket with no upper bound. Then
    // `max` is the only exact thing that can be said about the tail.
    p50Unbounded: given.p50_at_most_ms === null,
    p95Unbounded: given.p95_at_most_ms === null,
    estimatedFrom: typeof given.estimated_from === "string" ? given.estimated_from : null,
  };
  return marks;
}

// --- summaries -------------------------------------------------------------

// One summary as metrics answers it: `{ count, tokens?, bytes?, duration? }`.
// Everything optional stays optional.
export function describeSummary(given) {
  const summary = given !== null && typeof given === "object" ? given : {};
  const tokens = summary.tokens !== null && typeof summary.tokens === "object" ? summary.tokens : null;
  return {
    count: Number.isFinite(summary.count) ? summary.count : 0,
    countText: count(Number.isFinite(summary.count) ? summary.count : 0),
    tokens,
    bytes: bytes(summary.bytes),
    duration: describeDuration(summary.duration),
  };
}

// Every kind of token that turns up across these summaries, sorted. It is what the
// columns of a token table are: the kinds a provider counts are named by it, and
// two providers do not name the same ones.
export function tokenKindsOf(summaries) {
  const kinds = new Set();
  for (const summary of summaries) {
    for (const kind of Object.keys(summary?.tokens ?? {})) kinds.add(kind);
  }
  return [...kinds].sort();
}

// --- the breakdown, which most of the dashboard is ------------------------
//
// A `{ <name>: summary }` map — every question metrics answers is made of these —
// into rows to print and to draw.
//
// `whole` is the caller's word, and only the caller can say it: it means these
// rows are the parts of one thing, so their counts add up to something and the
// bars are shares of that total. Without it the rows are separate things counted
// separately — the stages of a funnel, one metric against another — the bars are
// shares of the **largest** row, and no total is offered: a total would be a sum
// of occurrences of different things.
export function breakdown(map, { limit = null, whole = false } = {}) {
  const entries = map !== null && typeof map === "object" && !Array.isArray(map) ? Object.entries(map) : [];
  const all = entries
    .map(([label, given]) => ({ label, notCarried: NOT_CARRIED.includes(label), ...describeSummary(given) }))
    // By what was counted, largest first: a ranked table is read from the top. Ties
    // by name, so the same data always prints in the same order.
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const total = all.reduce((sum, row) => sum + row.count, 0);
  const largest = all.reduce((most, row) => Math.max(most, row.count), 0);
  const against = whole ? total : largest;

  const shown = limit === null ? all : all.slice(0, limit);
  const left = limit === null ? [] : all.slice(limit);

  for (const row of shown) {
    // The bar. Against the total when the rows are parts of one whole, against the
    // largest row otherwise — which is honest in both cases and never needs a
    // scale nobody can see.
    row.percent = against > 0 ? Math.round((row.count / against) * 1000) / 10 : 0;
    row.share = against > 0 ? row.count / against : 0;
    // What one of them cost: the tokens of a kind over the occurrences counted. Both
    // numbers are in the same row, the denominator is what the row counts, and the
    // ratio is per kind — so nothing is weighed against a kind it is not.
    row.each = perOccurrence(row.tokens, row.count);
  }

  return {
    rows: shown,
    kinds: tokenKindsOf(shown),
    hasTokens: shown.some((row) => row.tokens),
    hasDuration: shown.some((row) => row.duration),
    hasBytes: shown.some((row) => row.bytes),
    hasNotCarried: shown.some((row) => row.notCarried),
    whole,
    total: whole ? total : null,
    totalText: whole ? count(total) : null,
    largest,
    largestText: count(largest),
    empty: all.length === 0,
    // What the limit left out, said rather than dropped: a table that stops is
    // usable, one that stops quietly is not.
    hidden: left.length ? { rows: left.length, count: count(left.reduce((sum, row) => sum + row.count, 0)) } : null,
  };
}

// One summary on its own, for the places where there is nothing to split by.
export function single(given) {
  const figure = describeSummary(given);
  return { ...figure, each: perOccurrence(figure.tokens, figure.count) };
}

// Tokens of each kind over the number of things counted. `null` where there is no
// count to divide by: nothing over nothing is not nothing per thing.
export function perOccurrence(tokens, count) {
  if (!tokens || !Number.isFinite(count) || count <= 0) return null;
  const each = Object.entries(tokens)
    .filter(([, value]) => Number.isFinite(value))
    .map(([kind, value]) => [kind, Math.round(value / count)]);
  return each.length ? Object.fromEntries(each) : null;
}

// --- one thing against another -------------------------------------------

// A chain: how many of what reached one row reached the next. The caller passes the
// rows **in the order they are to be read** and says nothing else — which row follows
// which is not something this file can know, and an order invented here would be a
// funnel nobody measured.
//
// Two facts per row, and both are about two counts that are really there: its share
// of the first row, and its share of the row above it. `dropped` is the difference
// from the row above, in things and not in per cent.
export function chain(rows) {
  const counted = rows.filter((row) => Number.isFinite(row.count));
  const first = counted[0]?.count ?? 0;
  return counted.map((row, index) => {
    const above = index === 0 ? null : counted[index - 1];
    return {
      ...row,
      countText: count(row.count),
      first: index === 0,
      ofFirst: first > 0 ? Math.round((row.count / first) * 1000) / 10 : null,
      ofAbove: above && above.count > 0 ? Math.round((row.count / above.count) * 1000) / 10 : null,
      above: above ? above.label : null,
      dropped: above ? above.count - row.count : null,
      droppedText: above ? count(above.count - row.count) : null,
    };
  });
}

// One figure against the same figure over the period before it. A dashboard that
// cannot say "against what" says how the system is and not how it is going.
//
// → { before, change, percent, direction } | null when there is nothing to compare:
// a period before in which nothing was counted is not a rise from zero, it is no
// comparison at all.
export function delta(now, before) {
  if (!Number.isFinite(now) || !Number.isFinite(before)) return null;
  // Nothing against nothing is not "unchanged", it is no comparison: a figure that was
  // zero and stayed zero has nothing to say, and saying it on every page of a system
  // that has just started is noise on top of an empty table.
  if (now === 0 && before === 0) return null;
  const change = now - before;
  return {
    before,
    beforeText: count(before),
    change,
    changeText: `${change > 0 ? "+" : change < 0 ? "\u2212" : ""}${count(Math.abs(change))}`,
    // No per cent out of nothing: a rise from zero has no rate.
    percent: before > 0 ? Math.round((change / before) * 1000) / 10 : null,
    percentText: before > 0 ? `${change > 0 ? "+" : change < 0 ? "\u2212" : ""}${Math.abs(Math.round((change / before) * 1000) / 10)} %` : null,
    direction: change > 0 ? "up" : change < 0 ? "down" : "flat",
  };
}

// The same, kind by kind, for the places where what is compared is a consumption.
export function tokenDeltas(now, before) {
  const kinds = tokenKindsOf([{ tokens: now }, { tokens: before }]);
  return kinds.map((kind) => ({
    kind,
    text: count(now?.[kind]),
    delta: delta(now?.[kind], before?.[kind]),
  }));
}

// What share of a consumption another consumption is, kind by kind. Never across
// kinds: a share of one kind in another kind is a rate nobody decided.
export function shareOfTokens(part, whole) {
  const kinds = tokenKindsOf([{ tokens: whole }]);
  return kinds
    .map((kind) => {
      const total = whole[kind];
      const taken = part?.[kind];
      if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(taken)) return null;
      return { kind, text: count(taken), of: count(total), percent: Math.round((taken / total) * 1000) / 10 };
    })
    .filter(Boolean);
}

// --- rates and spreads ----------------------------------------------------

// A rate as metrics answers it: `{ of }` when there is nothing to divide, and
// `{ of, count, per_thousand }` when there is. It is answered that way on purpose —
// a failure rate of half out of two calls and out of two thousand are different
// facts — so the page prints what it is made of beside it.
export function rate(given) {
  const of = Number.isFinite(given?.of) ? given.of : 0;
  if (of === 0) return { known: false, of: 0, ofText: "0" };
  const perThousand = Number.isFinite(given.per_thousand) ? given.per_thousand : null;
  return {
    known: perThousand !== null,
    of,
    ofText: count(of),
    count: count(given.count),
    perThousand,
    // A tenth of a per-thousand is a hundredth of a per-cent: the figure is shown
    // as metrics gives it, with the per-cent beside it for reading.
    percentText: perThousand === null ? null : `${(perThousand / 10).toFixed(1)} %`,
  };
}

// A spread as metrics answers it: `{ mean, min, p50, p95, max }`, exact — it is
// read off the real values, not off a histogram. The count comes under a different
// name in each answer (`projects`, `preanalyses`), so the caller passes what it is.
export function spread(given, { of = null, unit = null } = {}) {
  if (given === null || typeof given !== "object") return null;
  const marks = ["min", "p50", "mean", "p95", "max"].map((name) => ({
    name,
    value: Number.isFinite(given[name]) ? given[name] : null,
    text: Number.isFinite(given[name]) ? count(given[name]) : null,
  }));
  if (marks.every((mark) => mark.value === null)) return null;
  return { marks, of, ofText: count(of), unit };
}

// --- the buckets themselves ----------------------------------------------

// A histogram as it is stored: `{ "<edge in ms>": hits, "inf": hits }`. The edges
// are configured in metrics (`limits.duration_buckets_ms`), so they are read off
// the document and never listed here. `inf` is last and it is the one with no
// upper bound, which is why it is labelled differently.
export function histogram(buckets) {
  if (buckets === null || typeof buckets !== "object") return null;
  const edges = Object.keys(buckets).filter((edge) => edge !== "inf");
  edges.sort((a, b) => Number(a) - Number(b));

  const rows = [];
  let previous = 0;
  for (const edge of edges) {
    const upper = Number(edge);
    rows.push({
      label: `${duration(previous).text} – ${duration(upper).text}`,
      upper,
      hits: Number.isFinite(buckets[edge]) ? buckets[edge] : 0,
    });
    previous = upper;
  }
  if ("inf" in buckets) {
    rows.push({
      label: `over ${duration(previous).text}`,
      upper: null,
      hits: Number.isFinite(buckets.inf) ? buckets.inf : 0,
    });
  }
  if (!rows.length) return null;

  const largest = rows.reduce((most, row) => Math.max(most, row.hits), 0);
  const total = rows.reduce((sum, row) => sum + row.hits, 0);
  for (const row of rows) {
    row.hitsText = count(row.hits);
    row.percent = largest > 0 ? Math.round((row.hits / largest) * 1000) / 10 : 0;
    row.shareText = total > 0 ? `${((row.hits / total) * 100).toFixed(1)} %` : null;
  }
  return { rows, total, totalText: count(total), largest };
}

// --- the buckets over time ------------------------------------------------

// The daily rows into one line per metric. The days are the period's own, so a day
// with no bucket is a **gap** and not a zero: nothing was folded on it, which is
// not the same as a measured zero — metrics may simply not have been running.
//
// Only the busiest `limit` metrics get a line. The rest are named, one by one:
// folding them into an "other" would add up occurrences of different things.
export function dailySeries(rows, { period, limit }) {
  const days = [];
  for (let day = period.from; day <= period.to; day = nextDay(day)) days.push(day);

  const totals = new Map();
  const perDay = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const metric = typeof row?.metric === "string" ? row.metric : null;
    const day = typeof row?.day === "string" ? row.day : null;
    if (!metric || !day) continue;
    const amount = Number.isFinite(row.count) ? row.count : 0;
    totals.set(metric, (totals.get(metric) ?? 0) + amount);
    const key = `${metric}\u0000${day}`;
    perDay.set(key, (perDay.get(key) ?? 0) + amount);
  }

  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const drawn = ranked.slice(0, limit);
  const named = ranked.slice(limit);

  const lines = drawn.map(([metric, total], index) => ({
    metric,
    total,
    totalText: count(total),
    // The slot is the metric's, fixed by its rank in this reading and carried into
    // the style as a number. A metric keeps its colour for as long as the picture
    // is the same picture.
    slot: index + 1,
    values: days.map((day) => (perDay.has(`${metric}\u0000${day}`) ? perDay.get(`${metric}\u0000${day}`) : null)),
  }));

  return {
    days,
    lines,
    notDrawn: named.map(([metric, total]) => ({ metric, total, totalText: count(total) })),
    // How many metrics were measured at all in the period, which is what says
    // whether a short list is short because little happens or because it was cut.
    metrics: ranked.length,
    // A day that carries no bucket for any metric at all: the whole reading was
    // quiet, or nothing was running. Said, not drawn as zero.
    daysWithoutBuckets: days.filter((day) => !ranked.some(([metric]) => perDay.has(`${metric}\u0000${day}`))).length,
  };
}

function nextDay(day) {
  const moment = new Date(`${day}T00:00:00.000Z`);
  moment.setUTCDate(moment.getUTCDate() + 1);
  return moment.toISOString().slice(0, 10);
}

// --- what a reading could not say ----------------------------------------

// The readings that ran out of rows before the period ran out. Every page says so
// where it happens, because a figure computed from half the buckets is not the
// figure it claims to be.
export function truncations(readings) {
  return Object.entries(readings)
    .filter(([, result]) => result.ok && result.answer.truncated)
    .map(([name]) => name);
}

// The readings the page could not use, each with the word for what happened to it.
// Four outcomes are four things to do about them, and one word for all of them would
// be the dashboard not knowing what happens to it.
//
// A reading that came back with a **definite answer** is not here even when that
// answer is "there is no such thing": `isAnswer` marks it, and the page that asked
// is the one that says it. A project id nobody ever measured is an answer about that
// project, not a metrics that failed.
export function failures(readings) {
  return Object.entries(readings)
    .filter(([, result]) => !result.ok && !result.isAnswer)
    .map(([name, result]) => ({ name, reason: result.reason, detail: result.detail, code: result.code ?? null }));
}
