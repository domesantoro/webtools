// The buckets themselves, and the picture drawn from them.
//
// Every figure on every other page is a claim, and a claim has to be checkable
// against what it was computed from. This is that page: the rows as metrics stores
// them, one per day × subsystem × metric × dimensions, printed unchanged.
//
// The metric chooser is built from metrics' **vocabulary**, not from the rows: a
// metric that exists and has never been folded has to be choosable, otherwise the
// page can only offer what already happened and never shows that a name is not
// being measured at all.

import { lineChart } from "../charts.js";
import { bytes, count, dailySeries, duration, histogram } from "../figures.js";

export function buildDaily({ readings, settings, period, chosen }) {
  const daily = readings.daily.ok ? readings.daily.answer : null;
  const vocabulary = readings.vocabulary.ok ? readings.vocabulary.answer : null;
  const rows = daily?.rows ?? [];

  const series = daily ? dailySeries(rows, { period, limit: settings.seriesMetrics }) : null;

  return {
    heading: "Daily buckets",
    chosen,
    // Every name there is, with the ones that were folded in this period marked:
    // a name that is offered and has nothing behind it is an answer too.
    metrics: metricOptions(vocabulary, rows, chosen),
    series,
    chart: series ? lineChart(series, { format: (value) => count(value) }) : null,
    rows: rows.map(describeRow).slice(0, settings.topRows),
    shown: Math.min(rows.length, settings.topRows),
    of: rows.length,
    hidden: rows.length > settings.topRows ? rows.length - settings.topRows : null,
    kinds: [...new Set(rows.flatMap((row) => Object.keys(row?.tokens ?? {})))].sort(),
    // The durations of the chosen metric, added up over the period. Only when one
    // metric is chosen: a histogram of two metrics' durations together is a picture
    // of two different things in one shape.
    histogram: chosen ? histogram(mergedBuckets(rows)) : null,
  };
}

function metricOptions(vocabulary, rows, chosen) {
  const folded = new Set(rows.map((row) => row?.metric).filter((name) => typeof name === "string"));
  const names = new Set([...Object.keys(vocabulary?.metrics ?? {}), ...folded]);
  return [...names].sort().map((name) => ({ name, folded: folded.has(name), chosen: name === chosen }));
}

// One bucket, as it is stored. The dimensions are printed as they are: their names
// are open lists — a route, a model, a driver's uid — and a page that only knew some
// of them would quietly drop the rest.
function describeRow(row) {
  const given = row !== null && typeof row === "object" ? row : {};
  const stored = given.duration_ms !== null && typeof given.duration_ms === "object" ? given.duration_ms : null;
  return {
    day: typeof given.day === "string" ? given.day : null,
    subsystem: typeof given.subsystem === "string" ? given.subsystem : null,
    metric: typeof given.metric === "string" ? given.metric : null,
    dims: Object.entries(given.dims ?? {})
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    count: count(given.count),
    tokens: given.tokens !== null && typeof given.tokens === "object" ? given.tokens : null,
    bytes: bytes(given.bytes),
    // What is stored is a sum, a minimum, a maximum and a histogram. No percentile
    // is worked out here: the histogram is on the page, which says more than an
    // estimate read off it would.
    duration: stored
      ? {
          sum: duration(stored.sum),
          min: duration(stored.min),
          max: duration(stored.max),
          mean: mean(stored),
          histogram: histogram(stored.buckets),
        }
      : null,
  };
}

// The mean from what is stored: the sum over the number of durations that went into
// it, which is the histogram's own total. Two numbers that are both there, divided.
function mean(stored) {
  const hits = Object.values(stored.buckets ?? {}).reduce(
    (total, value) => total + (Number.isFinite(value) ? value : 0),
    0
  );
  if (!hits || !Number.isFinite(stored.sum)) return null;
  return duration(Math.round(stored.sum / hits));
}

// The histograms of these rows, added into one. Bucket edges are added under the
// edge they arrived with: the edges are metrics' configuration, and they are not
// named anywhere here.
function mergedBuckets(rows) {
  const merged = {};
  for (const row of rows) {
    const buckets = row?.duration_ms?.buckets;
    if (buckets === null || typeof buckets !== "object") continue;
    for (const [edge, hits] of Object.entries(buckets)) {
      if (!Number.isFinite(hits)) continue;
      merged[edge] = (merged[edge] ?? 0) + hits;
    }
  }
  return Object.keys(merged).length ? merged : null;
}
