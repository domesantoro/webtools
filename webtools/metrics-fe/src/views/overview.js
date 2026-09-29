// The first page: the three questions this front end exists to answer, and whether
// the system is standing up.
//
// Those three are the figures nobody has yet — the real AI cost of a webtool,
// how often demos are accepted, and how many turns a pre-analysis really takes. The
// three figures at the top are those three questions and nothing else, each with
// what it is out of beside it: a median over four projects and a median over four
// hundred are different facts, and a figure without its denominator is not usable.
//
// **A question that cannot be answered yet says so.** Nothing is filled in with a
// zero: no accepted demo is not a consumption of nothing, and no project measured is
// not a webtool that consumes nothing.

import { lineChart, ring } from "../charts.js";
import {
  breakdown,
  compact,
  count,
  dailySeries,
  delta,
  rate,
  shareOfTokens,
  single,
  spread,
  tokenDeltas,
} from "../figures.js";

// One of the three. `figure` is the number it leads with — or null, which is the
// answer "not yet". `outOf` is the sentence saying what the figures are out of, and
// each question writes its own: only the question knows what its denominator is, and
// "out of 88" under a figure of 88 says nothing.
function question({ heading, asks, figure, unit = null, outOf, link, absent, rows = null, change = null }) {
  return { heading, asks, figure, unit, outOf, link, absent, rows, change };
}

export function buildOverview({ readings, settings, period }) {
  const answer = (name) => answerOf(readings[name]);
  const earlier = (name) => answerOf(readings[`${name} (period before)`]);

  const cost = answer("cost");
  const economics = answer("economics");
  const daily = answer("daily");
  const series = daily ? dailySeries(daily.rows, { period, limit: settings.seriesMetrics }) : null;

  const consumedNow = single(cost?.total).tokens;
  const failureNow = rate(answer("providers")?.failure_rate);
  const failureBefore = rate(earlier("providers")?.failure_rate);
  const dependencyNow = rate(answer("health")?.dependency_failure_rate);
  const dependencyBefore = rate(earlier("health")?.dependency_failure_rate);

  // Two wholes worth seeing at a glance: how a pre-analysis ends up, and where a call
  // to a model ends up. Both are the parts of one thing — a pre-analysis closes once,
  // a call
  // ends once — which is what a ring may be drawn of and the only thing it may be drawn
  // of. Nothing else on this page is one: the kinds of token are not parts of anything,
  // and a project passes several gates rather than one.
  const wholeOf = (given) => ring(breakdown(given, { whole: true }), { slots: settings.ringSlices });

  return {
    heading: "Overview",
    hero: hero(answer("funnel"), earlier("funnel")),
    closed: wholeOf(answer("preanalysis")?.closed),
    callOutcomes: wholeOf(answer("providers")?.by_outcome),
    questions: [
      consumption(cost, earlier("cost")),
      demos(economics, earlier("economics")),
      turns(answer("preanalysis"), earlier("preanalysis")),
    ],
    // One row per kind of token: what was consumed, how it moved, what one occurrence
    // cost, and how much of it produced nothing. The joining is done here — a template
    // that looks a row up inside a loop is a template that quietly finds nothing.
    consumed: consumption_rows(consumedNow, single(earlier("cost")?.total).tokens, single(cost?.total).each, economics),
    failureRate: failureNow,
    failureRateDelta: delta(failureNow.perThousand, failureBefore.perThousand),
    dependencyFailureRate: dependencyNow,
    dependencyFailureRateDelta: delta(dependencyNow.perThousand, dependencyBefore.perThousand),
    refusals: refusalSummary(economics?.cost_of_refusals),
    series,
    chart: series ? lineChart(series, { format: (value) => count(value) }) : null,
  };
}

function answerOf(reading) {
  return reading?.ok ? reading.answer : null;
}

// What was consumed, kind by kind, with everything that is said about a kind on its own
// row: the change against the period before, what one occurrence cost, and the share of
// it that produced nothing. Never anything across kinds.
function consumption_rows(now, before, each, economics) {
  const wasted = new Map(shareOfTokens(economics?.cost_of_refusals?.tokens, now).map((one) => [one.kind, one]));
  return tokenDeltas(now, before).map((entry) => ({
    ...entry,
    each: each?.[entry.kind] ?? null,
    eachText: each?.[entry.kind] === undefined ? null : count(each[entry.kind]),
    waste: wasted.get(entry.kind) ?? null,
  }));
}

// The number everything else is out of: the projects that really exist in the
// period. It comes from anagraphics through metrics, where it is true by
// construction — and when it could not be counted the page leads with what was
// measured and says that the two are not the same thing.
function hero(funnel, before) {
  const given = funnel?.reconciliation ?? {};
  const was = before?.reconciliation ?? {};
  const authoritative = given.available === true && Number.isFinite(given.projects);
  const measured = Number.isFinite(given.projects_measured) ? given.projects_measured : null;
  const leading = authoritative ? given.projects : measured;
  return {
    figure: leading === null ? null : compact(leading),
    // Only where the headline figure is short for it: "331 · 331" says nothing twice.
    exact: leading === null || compact(leading) === count(leading) ? null : count(leading),
    label: authoritative ? "projects in the period" : "projects measured in the period",
    // Where the number comes from, because the two sources are not equally true.
    source: authoritative ? "counted in anagraphics" : "folded measurements only",
    lost: Number.isFinite(given.lost) ? given.lost : null,
    lostText: Number.isFinite(given.lost) ? count(given.lost) : null,
    reason: given.available === true ? null : typeof given.reason === "string" ? given.reason : null,
    measuredText: measured === null ? null : count(measured),
    // Against the period of the same length before it.
    change: delta(
      authoritative ? given.projects : measured,
      was.available === true && Number.isFinite(was.projects) ? was.projects : Number.isFinite(was.projects_measured) ? was.projects_measured : null
    ),
  };
}

// What a webtool consumes: the median project, one figure per kind of token. Not one
// number — a single number would have to weigh one kind against another, and that
// weight is a price.
function consumption(cost, before) {
  const given = cost?.per_project ?? {};
  const was = before?.per_project ?? {};
  const projects = Number.isFinite(given.projects) ? given.projects : 0;
  const byKind = given.by_kind !== null && typeof given.by_kind === "object" ? given.by_kind : {};
  const earlierByKind = was.by_kind !== null && typeof was.by_kind === "object" ? was.by_kind : {};
  const rows = Object.entries(byKind)
    .map(([kind, values]) => ({
      name: kind,
      value: count(values?.p50),
      // The tail beside the median: a median without it is half the fact.
      aside: `p95 ${count(values?.p95)}`,
      // Whether the median project is costing more than it was.
      delta: delta(values?.p50, earlierByKind[kind]?.p50),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return question({
    heading: "What a webtool consumes",
    asks: "the median project, and its tail, one figure per kind of token",
    figure: null,
    outOf: `over ${count(projects)} project${projects === 1 ? "" : "s"} with an accumulator`,
    link: "/cost",
    absent: projects === 0 ? "No project has consumed anything yet." : rows.length === 0 ? "No project carries tokens." : null,
    rows,
  });
}

// How often a demo is accepted. The number of accepted demos is metrics' own — it
// knows which gate a demo is — and the tokens beside it are every token of the
// period over those demos, which is the figure the worst case is built on.
function demos(economics, before) {
  const given = economics?.cost_per_accepted_demo ?? {};
  const was = before?.cost_per_accepted_demo ?? {};
  const accepted = Number.isFinite(given.accepted_demos) ? given.accepted_demos : 0;
  const tokens = given.tokens !== null && typeof given.tokens === "object" ? given.tokens : null;
  return question({
    heading: "Demos accepted",
    asks: "and what a sale consumed: every token of the period over the demos accepted in it",
    figure: compact(accepted),
    unit: accepted === 1 ? "demo" : "demos",
    // The tokens beside it are every token of the period divided by these demos, so
    // that is what they are over. The number of demos itself is not out of anything
    // metrics answers here.
    outOf: tokens ? `tokens of the period over ${count(accepted)} accepted demo${accepted === 1 ? "" : "s"}` : null,
    change: delta(accepted, Number.isFinite(was.accepted_demos) ? was.accepted_demos : null),
    link: "/economics",
    absent: accepted === 0 ? "No demo was accepted in this period, so there is nothing to divide by." : null,
    rows: tokens
      ? tokenDeltas(tokens, was.tokens).map((entry) => ({ name: entry.kind, value: entry.text, aside: null, delta: entry.delta }))
      : null,
  });
}

// How many turns a pre-analysis takes. Exact: one accumulator per project, so the
// quantiles are read off the real values and not off a histogram.
function turns(preanalysis, before) {
  const given = preanalysis?.turns_per_preanalysis ?? {};
  const was = before?.turns_per_preanalysis ?? {};
  const preanalyses = Number.isFinite(given.preanalyses) ? given.preanalyses : 0;
  const values = spread(given, { of: preanalyses, unit: "turns" });
  // No pre-analysis has taken a turn: there is no spread, so there is no median. Not
  // a zero — a median of nothing is not nothing turns.
  const median = values ? values.marks.find((mark) => mark.name === "p50") ?? null : null;
  return question({
    heading: "Turns a pre-analysis takes",
    asks: "the median, out of the pre-analyses that had at least one turn",
    figure: median && median.value !== null ? compact(median.value) : null,
    unit: "turns (p50)",
    outOf: `out of ${count(preanalyses)} pre-analys${preanalyses === 1 ? "is" : "es"} that took at least one turn`,
    change: delta(given.p50, was.p50),
    link: "/preanalysis",
    absent: preanalyses === 0 ? "No pre-analysis has taken a turn yet." : null,
    // The rest of the spread beside the median: the same numbers the pre-analysis page
    // gives, so the card is not a different answer from the page it links to.
    rows: values
      ? values.marks
          .filter((mark) => mark.name !== "p50")
          .map((mark) => ({ name: mark.name, value: mark.text, aside: null, delta: null }))
      : null,
  });
}

// The part of the consumption that produced nothing. Read from the project
// accumulators: a daily bucket has no project in it.
function refusalSummary(given) {
  const answer = given !== null && typeof given === "object" ? given : {};
  const tokens = answer.tokens !== null && typeof answer.tokens === "object" ? answer.tokens : null;
  return {
    projects: Number.isFinite(answer.projects) ? answer.projects : 0,
    projectsText: count(Number.isFinite(answer.projects) ? answer.projects : 0),
    kinds: tokens
      ? Object.entries(tokens)
          .map(([kind, value]) => ({ kind, text: count(value) }))
          .sort((a, b) => a.kind.localeCompare(b.kind))
      : [],
  };
}
