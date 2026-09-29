// The geometry of the pictures. Numbers out, no markup: the templates draw the SVG
// from what is worked out here, so what is composed from strings is coordinates and
// never an element.
//
// Every one of these has to draw with nothing, with one value, and with a value a
// thousand times the next one — which is what the data of a system that has just
// started looks like, and what it looks like a year later.

// The plot's frame. The room for the labels is part of it: a chart whose box fits
// the plot and not its axis is a chart with a scrollbar inside it.
const MARGIN = { top: 12, right: 64, bottom: 26, left: 52 };

// How near two end-labels may come before one of them is dropped. Nudging them
// apart would detach them from the lines they name; the legend carries the one that
// goes.
const LABEL_CLEARANCE = 13;

// A scale that ends on a number somebody would write. Ticks at 1, 2 or 5 times a
// power of ten, four or five of them.
export function niceScale(largest, { ticks = 4 } = {}) {
  if (!Number.isFinite(largest) || largest <= 0) return { max: 1, step: 1, values: [0, 1] };
  const rough = largest / ticks;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= rough) ?? 10 * power;
  const max = Math.ceil(largest / step) * step;
  const values = [];
  for (let value = 0; value <= max + step / 2; value += step) values.push(Math.round(value * 1e6) / 1e6);
  return { max, step, values };
}

// One line per metric, over the days of the period.
//
// A day with no bucket is a **gap**: the line stops and starts again, and a day
// that stands alone is a dot. Drawing it as zero would be a measurement nobody
// took.
//
// → everything the template needs and nothing it has to work out.
export function lineChart(series, { width = 880, height = 200, format = String } = {}) {
  const plot = {
    x: MARGIN.left,
    y: MARGIN.top,
    width: Math.max(1, width - MARGIN.left - MARGIN.right),
    height: Math.max(1, height - MARGIN.top - MARGIN.bottom),
  };
  const days = series.days ?? [];
  const largest = series.lines.reduce(
    (most, line) => line.values.reduce((inner, value) => (value === null ? inner : Math.max(inner, value)), most),
    0
  );
  const scale = niceScale(largest);

  const xOf = (index) =>
    days.length <= 1 ? plot.x + plot.width / 2 : plot.x + (index * plot.width) / (days.length - 1);
  const yOf = (value) => plot.y + plot.height - (value / scale.max) * plot.height;

  const lines = series.lines.map((line) => {
    const points = [];
    const segments = [];
    let run = [];
    line.values.forEach((value, index) => {
      if (value === null) {
        // The gap. What was drawn so far is a segment of its own.
        if (run.length > 1) segments.push(run.map((point) => `${point.x},${point.y}`).join(" "));
        run = [];
        return;
      }
      const point = { x: round(xOf(index)), y: round(yOf(value)), day: days[index], value, text: format(value) };
      points.push(point);
      run.push(point);
    });
    if (run.length > 1) segments.push(run.map((point) => `${point.x},${point.y}`).join(" "));

    const last = points[points.length - 1] ?? null;
    return {
      ...line,
      segments,
      points,
      // Only the end of the line is labelled. A number on every point is a chart
      // nobody reads.
      endLabel: last ? { x: last.x + 8, y: last.y, text: format(last.value) } : null,
    };
  });

  // Where two end-labels would sit on top of each other, the lower-ranked one goes
  // and the legend says which colour it was.
  const taken = [];
  for (const line of lines) {
    if (!line.endLabel) continue;
    if (taken.some((y) => Math.abs(y - line.endLabel.y) < LABEL_CLEARANCE)) {
      line.endLabel = null;
      continue;
    }
    taken.push(line.endLabel.y);
  }

  return {
    width,
    height,
    plot,
    lines,
    grid: scale.values.map((value) => ({ y: round(yOf(value)), value, text: format(value) })),
    // Enough day labels to read the axis, never one per day: a year of them is a
    // smear. First and last always, and evenly spaced between.
    xTicks: dayTicks(days, plot.width).map((index) => ({ x: round(xOf(index)), day: days[index] })),
    baseline: round(yOf(0)),
    max: scale.max,
    empty: lines.every((line) => line.points.length === 0),
  };
}

// Which days get a label: as many as fit at about 72px apart, the first and the
// last among them.
function dayTicks(days, width) {
  if (days.length === 0) return [];
  if (days.length === 1) return [0];
  const room = Math.max(2, Math.min(days.length, Math.floor(width / 72)));
  const step = (days.length - 1) / (room - 1);
  const indexes = new Set();
  for (let position = 0; position < room; position += 1) indexes.add(Math.round(position * step));
  return [...indexes].sort((a, b) => a - b);
}

// The durations of several rows on one scale, so the rows can be compared.
//
// **The scale is logarithmic, and it has to be.** A gate that decides in a second
// and a gate that waits two days are both ordinary, and on a linear scale
// everything but the slowest row collapses onto the baseline — a picture of one row
// and a line of dots. Five orders of magnitude are what durations in this system
// really span, so the scale is the one that can show five: decades, labelled with
// the duration each is, and named as logarithmic wherever it is drawn. A log scale
// passed off as a linear one would be the worst thing on the page.
//
// A mark each for what was measured exactly — `min`, `mean`, `max` — and a mark for
// each percentile, which is the **upper edge of the bucket** it falls in and is
// drawn as such. A percentile that fell in the bucket with no upper bound has no
// position on any scale, so it has no mark and the row says so.
//
// rows: [{ label, duration }] with duration as figures.describeDuration answered.
export function spans(rows) {
  const present = rows.filter((row) => row.duration);
  const marksOf = (duration) => [
    { name: "min", value: duration.min, exact: true },
    { name: "p50", value: duration.p50, exact: false, unbounded: duration.p50Unbounded },
    { name: "mean", value: duration.mean, exact: true },
    { name: "p95", value: duration.p95, exact: false, unbounded: duration.p95Unbounded },
    { name: "max", value: duration.max, exact: true },
  ];

  // The decades the data actually occupies. Nothing is assumed about how fast or how
  // slow this system is: the scale is read off what was measured.
  const measured = present
    .flatMap((row) => marksOf(row.duration).map((mark) => mark.value?.ms))
    .filter((ms) => Number.isFinite(ms) && ms > 0);
  if (!present.length || !measured.length) {
    return {
      rows: [],
      logarithmic: true,
      ticks: [],
      empty: true,
      // Rows that were measured and carry no duration, and rows whose every duration
      // is zero: both are named rather than drawn as something.
      without: rows.filter((row) => !row.duration).map((row) => row.label),
    };
  }
  const low = 10 ** Math.floor(Math.log10(Math.min(...measured)));
  const high = Math.max(10 ** Math.ceil(Math.log10(Math.max(...measured))), low * 10);
  const span = Math.log10(high) - Math.log10(low);
  const at = (ms) =>
    !Number.isFinite(ms) ? null : ms <= low ? 0 : Math.min(100, Math.round(((Math.log10(ms) - Math.log10(low)) / span) * 1000) / 10);

  const placed = present.map((row) => {
    const marks = marksOf(row.duration)
      .filter((mark) => mark.value && Number.isFinite(mark.value.ms))
      .map((mark) => ({ ...mark, at: at(mark.value.ms), below: mark.value.ms < low }));
    const positions = marks.map((mark) => mark.at);
    const from = positions.length ? Math.min(...positions) : 0;
    const to = positions.length ? Math.max(...positions) : 0;
    return {
      ...row,
      from,
      to,
      width: Math.round((to - from) * 10) / 10,
      marks,
      // The percentiles that have no upper bound to report, named so the row can say
      // it instead of looking as if they were not measured.
      unbounded: [row.duration.p50Unbounded ? "p50" : null, row.duration.p95Unbounded ? "p95" : null].filter(Boolean),
    };
  });

  return {
    rows: placed,
    logarithmic: true,
    ticks: decades(low, high, span, at),
    empty: false,
    without: rows.filter((row) => !row.duration).map((row) => row.label),
  };
}

// One label per decade, thinned to about six: thirteen labels on one rule is a
// smear, and the ones that go are the ones between.
function decades(low, high, span, at) {
  const count = Math.round(span);
  const step = Math.max(1, Math.ceil(count / 5));
  const ticks = [];
  for (let power = 0; power <= count; power += step) {
    const value = low * 10 ** power;
    ticks.push({ at: at(value), value });
  }
  // The end of the scale always carries a label: without it the widest bar means
  // nothing.
  if (ticks[ticks.length - 1].value < high) ticks.push({ at: 100, value: high });
  return ticks;
}

function round(value) {
  return Math.round(value * 10) / 10;
}

// --- part of a whole ------------------------------------------------------

// A ring: the parts of one whole, at a glance.
//
// It is drawn **only where the rows really are parts of one whole** — the outcomes of
// one gate, the statuses of one route's requests, the sources of the turns granted.
// Never over a ranked list of routes or models, where there are hundreds of them and
// the total is not a thing anybody asked about, and never over kinds of token, which
// are not parts of anything: their sum is a rate nobody decided.
//
// Two limits, and they are not the same kind of limit:
//
//   - **at most `slots` slices**, because there are that many hues that have been
//     validated to be told apart, and a further one would be a colour nobody can
//     distinguish from the others. What is past it folds into one slice — legitimate
//     here and nowhere else, because these parts are the same unit and of the same
//     whole, so their sum is a part too;
//   - **at least three slices.** Two parts of a whole are a number and its
//     complement: the bar table beside it already says that, and a two-slice ring is
//     a picture that adds a shape to a fact that had none.
const FEWEST_SLICES = 3;

// How many hues `public/styles.css` defines for a slot, and therefore the most slices
// a ring can have and still be read. It is not a preference and it is not configured:
// it is the number of steps of the palette that have been checked to be told apart in
// both modes, and a slice past them would be a colour indistinguishable from another.
// A configuration that asks for more gets this.
const HUES = 6;

const RING = { size: 240, radius: 100, inner: 62 };
// Under this share a slice has no room for its own percentage, and the number goes to
// the legend and the table instead of being clipped by the arc it belongs to.
const LABEL_LEAST_SHARE = 0.07;

// table: a figures.breakdown with `whole` true.
// → null where a ring would not be honest or would say nothing.
export function ring(table, { slots }) {
  if (!table || !table.whole || table.empty || !table.total) return null;

  // Every row of the whole, not only the ones the table printed: a ring of part of a
  // whole is not a ring.
  const parts = [...table.rows].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  // What the table left out of its own limit is part of the whole too, and it goes into
  // the fold rather than being dropped: otherwise the slices would not close the circle.
  const printed = parts.reduce((sum, row) => sum + row.count, 0);
  const hiddenCount = table.hidden ? Math.max(0, table.total - printed) : 0;
  const hiddenRows = hiddenCount > 0 && table.hidden ? table.hidden.rows : 0;

  // How many slices there may be **in all**, the fold included. A number that was not
  // given is not a fold of everything: it is no fold. What there are hues for is the
  // ceiling either way.
  const ceiling = Math.min(Number.isInteger(slots) && slots > 0 ? slots : parts.length, HUES);
  // When something has to be folded, one of the slices is the fold.
  const folding = parts.length > ceiling || hiddenCount > 0;
  const shown = parts.slice(0, folding ? Math.max(1, ceiling - 1) : ceiling);
  const rest = parts.slice(shown.length);
  const folded = rest.reduce((sum, row) => sum + row.count, 0) + hiddenCount;

  const slices = shown.map((row) => ({ label: row.label, count: row.count, notCarried: row.notCarried }));
  if (folded > 0) {
    slices.push({
      label: `${rest.length + hiddenRows} more`,
      count: folded,
      // Said to be a fold, so nobody reads it as a value of its own.
      rest: true,
    });
  }
  if (slices.length < FEWEST_SLICES) return null;

  const total = table.total;
  const centre = RING.size / 2;
  let from = 0;
  const drawn = slices.map((slice, index) => {
    const share = slice.count / total;
    const to = from + share;
    const arc = {
      ...slice,
      slot: index + 1,
      share,
      percent: Math.round(share * 1000) / 10,
      // The whole ring in one slice cannot be drawn as one arc: a circle whose start
      // and end are the same point draws nothing. It is two halves.
      full: share >= 0.9999,
      path: arcPath(centre, from, to),
      label_at: pointOn(centre, (RING.radius + RING.inner) / 2, from + share / 2),
      shows: share >= LABEL_LEAST_SHARE,
    };
    from = to;
    return arc;
  });

  return {
    size: RING.size,
    centre,
    radius: RING.radius,
    inner: RING.inner,
    slices: drawn,
    total,
    // Whether anything was folded, so the page can say so instead of the reader
    // wondering what the last slice is.
    folded: folded > 0 ? folded : null,
  };
}

// The path of one slice, from a share of the circle to another. Twelve o'clock is
// zero and it goes round clockwise, which is how a ring is read.
function arcPath(centre, from, to) {
  const outer = { start: pointOn(centre, RING.radius, from), end: pointOn(centre, RING.radius, to) };
  const inner = { start: pointOn(centre, RING.inner, from), end: pointOn(centre, RING.inner, to) };
  const large = to - from > 0.5 ? 1 : 0;
  return [
    `M ${outer.start.x} ${outer.start.y}`,
    `A ${RING.radius} ${RING.radius} 0 ${large} 1 ${outer.end.x} ${outer.end.y}`,
    `L ${inner.end.x} ${inner.end.y}`,
    `A ${RING.inner} ${RING.inner} 0 ${large} 0 ${inner.start.x} ${inner.start.y}`,
    "Z",
  ].join(" ");
}

function pointOn(centre, radius, share) {
  const angle = share * 2 * Math.PI - Math.PI / 2;
  return {
    x: Math.round((centre + radius * Math.cos(angle)) * 10) / 10,
    y: Math.round((centre + radius * Math.sin(angle)) * 10) / 10,
  };
}
