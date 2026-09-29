// The geometry. It has to draw with nothing, with one value, and with a value a
// thousand times the next one.

import assert from "node:assert/strict";
import { test } from "node:test";

import { lineChart, niceScale, ring, spans } from "../src/charts.js";
import { describeDuration } from "../src/figures.js";

test("a scale ends on a number somebody would write", () => {
  assert.deepEqual(niceScale(7).values, [0, 2, 4, 6, 8]);
  assert.equal(niceScale(1234).max, 1500);
  assert.equal(niceScale(99).max, 100);
  // Nothing measured: a scale of one, not a division by zero.
  assert.deepEqual(niceScale(0), { max: 1, step: 1, values: [0, 1] });
  assert.equal(niceScale(null).max, 1);
});

test("a gap breaks the line instead of touching zero", () => {
  const chart = lineChart({
    days: ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"],
    lines: [{ metric: "made.up", slot: 1, values: [3, null, 5, 6] }],
  });
  // Two known points then a gap then two more: one segment of one point (drawn as a
  // dot only) and one segment of two.
  assert.equal(chart.lines[0].points.length, 3);
  assert.equal(chart.lines[0].segments.length, 1);
  assert.equal(chart.empty, false);
});

test("a single day is a dot in the middle, not a line off the edge", () => {
  const chart = lineChart({ days: ["2026-09-01"], lines: [{ metric: "one", slot: 1, values: [4] }] });
  assert.equal(chart.lines[0].points.length, 1);
  assert.equal(chart.lines[0].segments.length, 0);
  assert.equal(chart.lines[0].points[0].x, chart.plot.x + chart.plot.width / 2);
});

test("a line with nothing on it draws nothing and says so", () => {
  const chart = lineChart({ days: ["2026-09-01", "2026-09-02"], lines: [{ metric: "one", slot: 1, values: [null, null] }] });
  assert.equal(chart.empty, true);
  assert.equal(chart.lines[0].endLabel, null);
});

test("no lines at all is still a chart, and it is empty", () => {
  const chart = lineChart({ days: [], lines: [] });
  assert.equal(chart.empty, true);
  assert.deepEqual(chart.xTicks, []);
});

test("the axis is labelled at a readable density, never once per day", () => {
  const days = [...Array(365)].map((_, index) => `day-${index}`);
  const chart = lineChart({ days, lines: [{ metric: "one", slot: 1, values: days.map(() => 1) }] });
  assert.ok(chart.xTicks.length <= 12, `${chart.xTicks.length} ticks`);
  assert.equal(chart.xTicks[0].day, "day-0");
  assert.equal(chart.xTicks[chart.xTicks.length - 1].day, "day-364");
});

test("end labels that would sit on top of each other are dropped, not nudged", () => {
  const days = ["2026-09-01", "2026-09-02"];
  const chart = lineChart({
    days,
    lines: [
      { metric: "a", slot: 1, values: [1, 100] },
      { metric: "b", slot: 2, values: [1, 100] },
      { metric: "c", slot: 3, values: [1, 1] },
    ],
  });
  // Two lines end at the same height: one label survives.
  assert.equal(chart.lines.filter((line) => line.endLabel).length, 2);
});

test("every point carries its own value, so nothing is readable by colour alone", () => {
  const chart = lineChart(
    { days: ["2026-09-01"], lines: [{ metric: "one", slot: 1, values: [1234] }] },
    { format: (value) => `${value} things` }
  );
  assert.equal(chart.lines[0].points[0].text, "1234 things");
});

// --- durations -------------------------------------------------------------

function durationOf(given) {
  return describeDuration(given);
}

test("the rows of a span chart share a scale, and five orders of magnitude all show", () => {
  // A gate that decides in a tenth of a second and one that waits two days are both
  // ordinary. On a linear scale everything but the slowest row would sit on the
  // baseline, which is a picture of one row.
  const chart = spans([
    { label: "days", duration: durationOf({ count: 2, mean_ms: 86_400_000, min_ms: 40_000_000, max_ms: 200_000_000, p50_at_most_ms: 80_000_000, p95_at_most_ms: 150_000_000 }) },
    { label: "seconds", duration: durationOf({ count: 2, mean_ms: 2000, min_ms: 900, max_ms: 5000, p50_at_most_ms: 1800, p95_at_most_ms: 4000 }) },
    { label: "milliseconds", duration: durationOf({ count: 2, mean_ms: 8, min_ms: 3, max_ms: 20, p50_at_most_ms: 7, p95_at_most_ms: 18 }) },
  ]);
  assert.equal(chart.logarithmic, true);
  const width = (label) => {
    const row = chart.rows.find((one) => one.label === label);
    return row.to - row.from;
  };
  // Every row is visible, and none of them is a sliver.
  for (const label of ["days", "seconds", "milliseconds"]) {
    assert.ok(width(label) > 5, `${label} is ${width(label)}% wide`);
  }
  // And they are still in order: the slow row sits to the right of the fast one.
  assert.ok(chart.rows.find((row) => row.label === "days").from > chart.rows.find((row) => row.label === "seconds").to);
});

test("the scale's labels are decades of the data's own range, thinned to a readable few", () => {
  const chart = spans([
    { label: "wide", duration: durationOf({ count: 1, mean_ms: 1000, min_ms: 1, max_ms: 100_000_000, p50_at_most_ms: 500, p95_at_most_ms: 10_000_000 }) },
  ]);
  assert.ok(chart.ticks.length <= 7, `${chart.ticks.length} ticks`);
  assert.equal(chart.ticks[0].at, 0);
  // The end of the scale always carries a label: without it the widest bar means
  // nothing.
  assert.equal(chart.ticks[chart.ticks.length - 1].at, 100);
});

test("a duration below the bottom of the scale is clamped and said to be", () => {
  const chart = spans([
    { label: "one", duration: durationOf({ count: 1, mean_ms: 5000, min_ms: 0, max_ms: 9000, p50_at_most_ms: 5000, p95_at_most_ms: 8000 }) },
  ]);
  const min = chart.rows[0].marks.find((mark) => mark.name === "min");
  assert.equal(min.at, 0);
  assert.equal(min.below, true);
  assert.equal(chart.rows[0].marks.find((mark) => mark.name === "max").below, false);
});

test("durations that are all zero are not a scale: the rows are named instead", () => {
  const chart = spans([
    { label: "instant", duration: durationOf({ count: 1, mean_ms: 0, min_ms: 0, max_ms: 0, p50_at_most_ms: 0, p95_at_most_ms: 0 }) },
  ]);
  assert.equal(chart.empty, true);
  assert.deepEqual(chart.rows, []);
});

test("a percentile with no upper bound has no mark, and the row names it", () => {
  const chart = spans([
    { label: "one", duration: durationOf({ count: 1, mean_ms: 1000, min_ms: 10, max_ms: 400000, p50_at_most_ms: 5000, p95_at_most_ms: null }) },
  ]);
  const row = chart.rows[0];
  assert.deepEqual(row.unbounded, ["p95"]);
  assert.equal(row.marks.some((mark) => mark.name === "p95"), false);
  assert.equal(row.marks.some((mark) => mark.name === "p50"), true);
  // What is exact is said to be exact.
  assert.equal(row.marks.find((mark) => mark.name === "max").exact, true);
  assert.equal(row.marks.find((mark) => mark.name === "p50").exact, false);
});

test("rows without a duration are named, not dropped", () => {
  const chart = spans([
    { label: "measured", duration: durationOf({ count: 1, mean_ms: 5, min_ms: 5, max_ms: 5, p50_at_most_ms: 5, p95_at_most_ms: 5 }) },
    { label: "counted only", duration: null },
  ]);
  assert.deepEqual(chart.without, ["counted only"]);
  assert.equal(chart.rows.length, 1);
});

test("no duration anywhere is an empty chart, not a broken one", () => {
  const chart = spans([{ label: "a", duration: null }]);
  assert.equal(chart.empty, true);
  assert.deepEqual(chart.without, ["a"]);
  assert.deepEqual(chart.rows, []);
});

// --- the ring -------------------------------------------------------------

function tableOf(counts, { whole = true, hidden = null } = {}) {
  return {
    whole,
    empty: counts.length === 0,
    total: counts.reduce((sum, [, count]) => sum + count, 0) + (hidden?.count ?? 0),
    rows: counts.map(([label, count]) => ({ label, count })),
    hidden: hidden ? { rows: hidden.rows, count: String(hidden.count) } : null,
  };
}

test("a ring is the parts of one whole, and the parts close the circle", () => {
  const chart = ring(tableOf([["passed", 60], ["rejected", 30], ["open", 10]]), { slots: 5 });
  assert.equal(chart.slices.length, 3);
  assert.deepEqual(
    chart.slices.map((slice) => slice.percent),
    [60, 30, 10]
  );
  // The shares close the circle.
  assert.ok(Math.abs(chart.slices.reduce((sum, slice) => sum + slice.share, 0) - 1) < 1e-9);
  // The first slice starts at twelve o'clock.
  assert.match(chart.slices[0].path, /^M 120 20 /);
  assert.equal(chart.total, 100);
  assert.equal(chart.folded, null);
});

test("a ring is not drawn where the rows are not parts of one whole", () => {
  assert.equal(ring(tableOf([["a", 5], ["b", 3], ["c", 1]], { whole: false }), { slots: 5 }), null);
  assert.equal(ring(null, { slots: 5 }), null);
  assert.equal(ring(tableOf([]), { slots: 5 }), null);
  // A whole of nothing has no parts.
  assert.equal(ring(tableOf([["a", 0], ["b", 0], ["c", 0]]), { slots: 5 }), null);
});

test("two parts of a whole are a number and its complement, and get no ring", () => {
  assert.equal(ring(tableOf([["passed", 90], ["rejected", 10]]), { slots: 5 }), null);
  assert.equal(ring(tableOf([["only", 10]]), { slots: 5 }), null);
});

test("what is past the slices folds into one slice, and the fold says it is one", () => {
  // Four slices in all, so three rows and the fold: the number is the slices, and the
  // fold is one of them.
  const chart = ring(tableOf([["a", 50], ["b", 20], ["c", 15], ["d", 10], ["e", 3], ["f", 2]]), { slots: 4 });
  assert.equal(chart.slices.length, 4);
  const last = chart.slices[3];
  assert.equal(last.rest, true);
  assert.equal(last.label, "3 more");
  assert.equal(last.count, 15);
  // It still closes the circle: a ring of part of a whole is not a ring.
  assert.equal(chart.slices.reduce((sum, slice) => sum + slice.count, 0), chart.total);
  assert.equal(chart.folded, 15);
});

test("rows the table left out of its own limit are in the fold, not lost from the circle", () => {
  // Three printed rows out of a whole of 120, with 20 in rows the table did not print.
  const chart = ring(tableOf([["a", 50], ["b", 30], ["c", 20]], { hidden: { rows: 4, count: 20 } }), { slots: 5 });
  assert.equal(chart.total, 120);
  assert.equal(chart.slices.reduce((sum, slice) => sum + slice.count, 0), 120);
  assert.equal(chart.slices[chart.slices.length - 1].rest, true);
});

test("a slice too thin for its own number does not carry one", () => {
  const chart = ring(tableOf([["big", 970], ["small", 20], ["tiny", 10]]), { slots: 5 });
  assert.equal(chart.slices.find((slice) => slice.label === "big").shows, true);
  // 2 % and 1 % have no room on the arc: the number is in the legend and the table.
  assert.equal(chart.slices.find((slice) => slice.label === "small").shows, false);
  assert.equal(chart.slices.find((slice) => slice.label === "tiny").shows, false);
});

test("a slice that is the whole circle is drawn as a ring, not as an arc to itself", () => {
  const chart = ring(tableOf([["everything", 100], ["none", 0], ["also none", 0]]), { slots: 5 });
  assert.equal(chart.slices[0].full, true);
  // The empty ones are there, at nought per cent: they are parts of the whole and
  // they were measured.
  assert.equal(chart.slices[1].percent, 0);
  assert.equal(chart.slices[1].full, false);
});

test("a slice limit that was not given is no fold, not a fold of everything", () => {
  const chart = ring(tableOf([["a", 50], ["b", 30], ["c", 20]]), { slots: undefined });
  assert.equal(chart.slices.length, 3);
  assert.equal(chart.folded, null);
  assert.equal(chart.slices.reduce((sum, slice) => sum + slice.count, 0), 100);
});

test("a ring never asks for more hues than the style has", () => {
  const many = [...Array(12)].map((_, index) => [`part-${index}`, 12 - index]);
  // Asked for ten slices, and there are six hues: six, the last of them the fold.
  const chart = ring(tableOf(many), { slots: 10 });
  assert.equal(chart.slices.length, 6);
  assert.equal(chart.slices[5].rest, true);
  assert.equal(chart.slices.reduce((sum, slice) => sum + slice.count, 0), chart.total);
  assert.ok(chart.slices.every((slice) => slice.slot <= 6));
});
