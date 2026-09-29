// The shaping. Every name in here is invented on purpose: a metric, a dimension
// value, a kind of token and a provider that this system does not have. What the
// pages do must hold for those exactly as it holds for ours — that is the whole
// point of the file being tested.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  NOT_CARRIED,
  breakdown,
  bytes,
  chain,
  compact,
  count,
  dailySeries,
  delta,
  describeDuration,
  duration,
  failures,
  histogram,
  perOccurrence,
  rate,
  shareOfTokens,
  single,
  spread,
  tokenDeltas,
  tokenKindsOf,
  truncations,
} from "../src/figures.js";

test("a count is grouped; nothing is not a zero", () => {
  assert.equal(count(1234567), "1,234,567");
  assert.equal(count(0), "0");
  assert.equal(count(null), null);
  assert.equal(count(undefined), null);
});

test("a headline number is shortened, and a small one is not", () => {
  assert.equal(compact(999), "999");
  assert.equal(compact(1500), "1.5k");
  assert.equal(compact(150000), "150k");
  assert.equal(compact(2_400_000), "2.4M");
  assert.equal(compact(null), null);
});

test("a duration reads in its own unit and keeps the milliseconds", () => {
  assert.equal(duration(850).text, "850 ms");
  assert.equal(duration(1500).text, "1.5 s");
  assert.equal(duration(137_000).text, "2.3 min");
  assert.equal(duration(7_200_000).text, "2.0 h");
  // A lead time is days, not hours: "277.8 h" is a number nobody converts in their head.
  assert.equal(duration(432_000_000).text, "5.0 d");
  assert.equal(duration(137_000).exact, "137,000 ms");
  assert.equal(duration(null), null);
});

test("bytes read in binary units", () => {
  assert.equal(bytes(512).text, "512 B");
  assert.equal(bytes(2048).text, "2.0 KiB");
  assert.equal(bytes(null), null);
});

test("a percentile that fell in the bucket with no upper bound is said to have none", () => {
  const described = describeDuration({
    count: 10,
    mean_ms: 1200,
    min_ms: 100,
    max_ms: 400_000,
    p50_at_most_ms: 5000,
    p95_at_most_ms: null,
    estimated_from: "histogram buckets",
  });
  assert.equal(described.p95, null);
  assert.equal(described.p95Unbounded, true);
  assert.equal(described.p50Unbounded, false);
  assert.equal(described.p50.text, "5.0 s");
  assert.equal(described.estimatedFrom, "histogram buckets");
});

test("a summary without a duration has none, and not a zero", () => {
  const figure = single({ count: 3 });
  assert.equal(figure.duration, null);
  assert.equal(figure.tokens, null);
  assert.equal(figure.bytes, null);
  assert.equal(figure.countText, "3");
});

test("an answer that is not there at all is a summary of nothing, not a crash", () => {
  for (const given of [null, undefined, 4, "x", []]) {
    const figure = single(given);
    assert.equal(figure.count, 0);
    assert.equal(figure.duration, null);
  }
});

test("the kinds of token are whatever turns up, and they are never added together", () => {
  const kinds = tokenKindsOf([
    { tokens: { reasoning: 5, glyphs: 2 } },
    { tokens: { glyphs: 1, whispers: 9 } },
    { tokens: null },
  ]);
  assert.deepEqual(kinds, ["glyphs", "reasoning", "whispers"]);
  // No sum of them exists anywhere in the answer.
  const table = breakdown({ a: { count: 1, tokens: { reasoning: 5 } } });
  assert.equal(Object.keys(table.rows[0].tokens).length, 1);
  assert.equal(table.rows[0].total, undefined);
});

test("a breakdown of parts of one whole has a total; one of separate things does not", () => {
  const map = {
    "made.up.one": { count: 30 },
    "made.up.two": { count: 10 },
  };
  const whole = breakdown(map, { whole: true });
  assert.equal(whole.total, 40);
  assert.equal(whole.totalText, "40");
  assert.equal(whole.rows[0].percent, 75);

  const separate = breakdown(map, { whole: false });
  assert.equal(separate.total, null);
  // Against the largest row, which is always honest and needs no scale.
  assert.equal(separate.rows[0].percent, 100);
  assert.equal(separate.rows[1].percent, 33.3);
});

test("a breakdown is ranked, largest first, and ties go by name", () => {
  const table = breakdown({ zebra: { count: 5 }, apple: { count: 5 }, big: { count: 9 } });
  assert.deepEqual(
    table.rows.map((row) => row.label),
    ["big", "apple", "zebra"]
  );
});

test("what the limit left out is counted and said, never dropped quietly", () => {
  const map = Object.fromEntries([...Array(10)].map((_, index) => [`route-${index}`, { count: 10 - index }]));
  const table = breakdown(map, { limit: 3, whole: true });
  assert.equal(table.rows.length, 3);
  assert.equal(table.hidden.rows, 7);
  // 4+3+2+1 of the counts that are not shown, plus 7+6+5 — the seven smallest.
  assert.equal(table.hidden.count, "28");
  // The total is still the total of everything, not of what is printed.
  assert.equal(table.total, 55);
});

test("a row that carries no value for the dimension is marked, and is still counted", () => {
  for (const label of NOT_CARRIED) {
    const table = breakdown({ [label]: { count: 4 }, real: { count: 1 } }, { whole: true });
    assert.equal(table.hasNotCarried, true);
    assert.equal(table.total, 5);
    assert.equal(table.rows.find((row) => row.label === label).notCarried, true);
    assert.equal(table.rows.find((row) => row.label === "real").notCarried, false);
  }
});

test("an empty breakdown is empty, and every bar is zero rather than infinite", () => {
  const empty = breakdown({});
  assert.equal(empty.empty, true);
  assert.deepEqual(empty.rows, []);
  const zeros = breakdown({ a: { count: 0 }, b: { count: 0 } }, { whole: true });
  assert.equal(zeros.rows[0].percent, 0);
});

test("a rate says what it is made of, and says when there is nothing to divide", () => {
  const known = rate({ of: 2000, count: 40, per_thousand: 20 });
  assert.equal(known.known, true);
  assert.equal(known.percentText, "2.0 %");
  assert.equal(known.ofText, "2,000");

  const nothing = rate({ of: 0 });
  assert.equal(nothing.known, false);
  assert.equal(nothing.ofText, "0");
});

test("a spread keeps its marks in reading order and says what it is of", () => {
  const figure = spread({ mean: 4, min: 1, p50: 3, p95: 9, max: 12 }, { of: 7, unit: "turns" });
  assert.deepEqual(
    figure.marks.map((mark) => mark.name),
    ["min", "p50", "mean", "p95", "max"]
  );
  assert.equal(figure.ofText, "7");
  assert.equal(spread(null), null);
  assert.equal(spread({}), null);
});

test("a histogram takes its edges from the document, and the last bucket has no upper bound", () => {
  // Edges nobody configured here: they are metrics' own, and they arrive in the data.
  const chart = histogram({ 750: 3, 9000: 1, 90: 6, inf: 2 });
  assert.deepEqual(
    chart.rows.map((row) => row.label),
    ["0 ms – 90 ms", "90 ms – 750 ms", "750 ms – 9.0 s", "over 9.0 s"]
  );
  assert.equal(chart.rows[3].upper, null);
  assert.equal(chart.total, 12);
  assert.equal(chart.rows[0].percent, 100);
  assert.equal(histogram(null), null);
  assert.equal(histogram({}), null);
});

test("a histogram with no unbounded bucket simply has none", () => {
  const chart = histogram({ 100: 1 });
  assert.equal(chart.rows.length, 1);
  assert.equal(chart.rows[0].upper, 100);
});

test("a day with no bucket is a gap in the line, not a zero", () => {
  const period = { from: "2026-09-01", to: "2026-09-05" };
  const series = dailySeries(
    [
      { day: "2026-09-01", metric: "made.up", count: 5 },
      { day: "2026-09-04", metric: "made.up", count: 2 },
    ],
    { period, limit: 3 }
  );
  assert.deepEqual(series.days, ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"]);
  assert.deepEqual(series.lines[0].values, [5, null, null, 2, null]);
  assert.equal(series.daysWithoutBuckets, 3);
});

test("the metrics past the limit are named, never folded into an other", () => {
  const rows = [
    { day: "2026-09-01", metric: "a", count: 100 },
    { day: "2026-09-01", metric: "b", count: 50 },
    { day: "2026-09-01", metric: "c", count: 10 },
    { day: "2026-09-01", metric: "d", count: 1 },
  ];
  const series = dailySeries(rows, { period: { from: "2026-09-01", to: "2026-09-01" }, limit: 2 });
  assert.deepEqual(
    series.lines.map((line) => line.metric),
    ["a", "b"]
  );
  assert.deepEqual(
    series.notDrawn.map((other) => other.metric),
    ["c", "d"]
  );
  assert.equal(series.metrics, 4);
  // The slot follows the line, and it is what the style paints by.
  assert.deepEqual(
    series.lines.map((line) => line.slot),
    [1, 2]
  );
});

test("several buckets of the same metric on the same day are one point", () => {
  const series = dailySeries(
    [
      { day: "2026-09-01", metric: "made.up", dims: { one: "x" }, count: 3 },
      { day: "2026-09-01", metric: "made.up", dims: { one: "y" }, count: 4 },
    ],
    { period: { from: "2026-09-01", to: "2026-09-01" }, limit: 3 }
  );
  assert.deepEqual(series.lines[0].values, [7]);
});

test("rows that are not rows are skipped rather than drawn as something", () => {
  const series = dailySeries([null, {}, { day: "2026-09-01" }, { metric: "x" }, 7], {
    period: { from: "2026-09-01", to: "2026-09-01" },
    limit: 3,
  });
  assert.deepEqual(series.lines, []);
  assert.equal(series.metrics, 0);
});

test("what ran out and what did not come back are two different lists", () => {
  const readings = {
    one: { ok: true, answer: { truncated: true } },
    two: { ok: true, answer: { truncated: false } },
    three: { ok: false, reason: "unreachable", detail: "…", code: null },
    four: { ok: false, reason: "refused", detail: "…", code: "INVALID_RANGE" },
  };
  assert.deepEqual(truncations(readings), ["one"]);
  assert.deepEqual(
    failures(readings).map((failure) => `${failure.name}:${failure.reason}`),
    ["three:unreachable", "four:refused"]
  );
  assert.equal(failures(readings)[1].code, "INVALID_RANGE");
});

// --- the aggregations -----------------------------------------------------

test("a row says what one of the things it counts consumed", () => {
  const table = breakdown({ phase: { count: 4, tokens: { glyphs: 1000, whispers: 3 } } });
  assert.deepEqual(table.rows[0].each, { glyphs: 250, whispers: 1 });
});

test("nothing over nothing is not nothing per thing", () => {
  assert.equal(perOccurrence({ glyphs: 100 }, 0), null);
  assert.equal(perOccurrence({ glyphs: 100 }, null), null);
  assert.equal(perOccurrence(null, 10), null);
  // A kind that is not a number is left out rather than turned into one.
  assert.deepEqual(perOccurrence({ glyphs: 100, broken: "x" }, 10), { glyphs: 10 });
});

test("a chain says a row's share of the first and of the one above it", () => {
  const rows = chain([
    { label: "opened", count: 1000 },
    { label: "submitted", count: 400 },
    { label: "created", count: 300 },
  ]);
  assert.equal(rows[0].first, true);
  assert.equal(rows[0].ofAbove, null);
  assert.equal(rows[0].ofFirst, 100);

  assert.equal(rows[1].ofFirst, 40);
  assert.equal(rows[1].ofAbove, 40);
  assert.equal(rows[1].dropped, 600);

  // The third is 30 % of the first and 75 % of the one above it: two different facts,
  // and a funnel that gave only one of them would be read as the other.
  assert.equal(rows[2].ofFirst, 30);
  assert.equal(rows[2].ofAbove, 75);
  assert.equal(rows[2].above, "submitted");
  assert.equal(rows[2].dropped, 100);
});

test("a chain of one row, of none, and one that starts at zero", () => {
  assert.deepEqual(chain([]), []);
  const one = chain([{ label: "only", count: 5 }]);
  assert.equal(one[0].ofFirst, 100);
  assert.equal(one[0].ofAbove, null);
  // Nothing reached the first row: there is no share of it, and no rate is invented.
  const zero = chain([{ label: "a", count: 0 }, { label: "b", count: 0 }]);
  assert.equal(zero[0].ofFirst, null);
  assert.equal(zero[1].ofAbove, null);
  // A row without a count is not a link in the chain.
  assert.equal(chain([{ label: "a" }, { label: "b", count: 2 }]).length, 1);
});

test("a change carries the sign, and no rate out of nothing", () => {
  const up = delta(120, 100);
  assert.equal(up.change, 20);
  assert.equal(up.changeText, "+20");
  assert.equal(up.percentText, "+20 %");
  assert.equal(up.direction, "up");

  const down = delta(80, 100);
  assert.equal(down.direction, "down");
  assert.equal(down.percentText, "−20 %");

  assert.equal(delta(100, 100).direction, "flat");
  // A rise from nothing has no rate: the number is there, the per cent is not.
  const fromNothing = delta(5, 0);
  assert.equal(fromNothing.changeText, "+5");
  assert.equal(fromNothing.percentText, null);
  // And no comparison at all where the period before was not read.
  assert.equal(delta(5, null), null);
  assert.equal(delta(null, 5), null);
  // Nor where there is nothing on either side: a figure that was zero and stayed zero
  // has nothing to say, and "unchanged" on every heading of a system that has just
  // started is noise on top of an empty table.
  assert.equal(delta(0, 0), null);
});

test("kinds are compared kind by kind, and a kind only one side has is still shown", () => {
  const deltas = tokenDeltas({ glyphs: 120, whispers: 5 }, { glyphs: 100 });
  const of = (kind) => deltas.find((entry) => entry.kind === kind);
  assert.equal(of("glyphs").delta.changeText, "+20");
  // `whispers` is new: it is in the list, and it has no comparison.
  assert.equal(of("whispers").text, "5");
  assert.equal(of("whispers").delta, null);
});

test("a share of a consumption is per kind, never across kinds", () => {
  const shares = shareOfTokens({ glyphs: 1000, whispers: 1 }, { glyphs: 4000, whispers: 4 });
  assert.deepEqual(
    shares.map((one) => [one.kind, one.percent]),
    [["glyphs", 25], ["whispers", 25]]
  );
  // A kind the whole does not have is not a share of anything.
  assert.deepEqual(shareOfTokens({ ghost: 10 }, { glyphs: 100 }), []);
  // And nothing is divided by zero.
  assert.deepEqual(shareOfTokens({ glyphs: 10 }, { glyphs: 0 }), []);
  assert.deepEqual(shareOfTokens(null, { glyphs: 100 }), []);
});
