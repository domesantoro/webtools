// The pages that are one question each: metrics answers the question, and the page
// prints the answer.
//
// They are together in one file because they are the same page eight times over
// with different sections in it, and a file each would be eight copies of the same
// three lines drifting apart. What differs — which question, which parts of the
// answer, and what each part is — is all there is here.
//
// **Nothing is computed from a name.** A section names the key it reads out of the
// answer, and `whole` says whether the rows of that key are the parts of one thing
// (the outcomes of a gate, the phases of a consumption) or separate things counted
// separately (the stages of a funnel). Those two are the only judgements made here,
// and neither of them is about which metrics exist.

import { ring, spans } from "../charts.js";
import {
  breakdown,
  chain,
  delta,
  perOccurrence,
  rate,
  shareOfTokens,
  single,
  spread,
  tokenDeltas,
} from "../figures.js";

// A section of a page: one key of the answer, and what its rows are.
//
//   key       where it is in the answer
//   heading   what it is called on the page
//   whole     whether the rows add up to something
//   note      what has to be said about it, where the figure alone would mislead
//   durations whether the durations of those rows are worth a picture
function section({ key, heading, whole = false, note = null, durations = false }) {
  return { key, heading, whole, note, durations };
}

export const QUESTION_PAGES = {
  funnel: {
    heading: "Funnel",
    intent: "Who arrived, where they left, and how much of it was lost.",
    sections: [],
  },
  cost: {
    heading: "Cost",
    intent: "What the AI consumed, in tokens.",
    sections: [
      section({
        key: "by_phase",
        heading: "By phase",
        whole: true,
      }),
      section({ key: "by_model", heading: "By model", whole: true }),
      section({ key: "by_subsystem", heading: "By subsystem", whole: true }),
    ],
  },
  preanalysis: {
    heading: "Pre-analysis",
    intent: "What a pre-analysis costs in turns, and how the rounds of questions end.",
    sections: [
      section({ key: "closed", heading: "How the pre-analyses closed", whole: true }),
      section({ key: "validation", heading: "Validations", whole: true, durations: true }),
    ],
  },
  providers: {
    heading: "Providers",
    intent: "Calls, failures and latency. A refusal and a provider that never answered are two different things.",
    sections: [
      section({ key: "calls", heading: "Calls by model", whole: true, durations: true }),
      section({
        key: "by_outcome",
        heading: "How the calls ended",
        whole: true,
        note: "In three of the four the model ran, so what it consumed is counted.",
      }),
      section({
        key: "failures",
        heading: "Nothing came back",
        whole: true,
        note: "Why nothing came back. Five reasons, because they call for five different things.",
      }),
      section({ key: "retries", heading: "Retries by phase", whole: true }),
    ],
  },
  http: {
    heading: "HTTP",
    intent: "What is asked of every subsystem, what it answers, and how long it takes.",
    sections: [
      section({ key: "by_route", heading: "By route", whole: true, durations: true }),
      section({ key: "by_status", heading: "By status", whole: true }),
      section({ key: "errors", heading: "Errors by code", whole: true }),
    ],
  },
  economics: {
    heading: "Economics",
    intent: "What is granted, what is spent, and what a sale consumed.",
    sections: [
      section({ key: "turns_granted", heading: "Turns granted", whole: true }),
      section({ key: "turns_spent", heading: "Turns spent, by phase", whole: true }),
    ],
  },
  timing: {
    heading: "Timing",
    intent: "How long each gate takes, and a project from end to end.",
    sections: [
      section({ key: "by_gate", heading: "By gate", whole: true, durations: true }),
      section({ key: "lead_time", heading: "A project from end to end", whole: true, durations: true }),
      section({ key: "form", heading: "The form", whole: true, durations: true }),
    ],
  },
  health: {
    heading: "Health",
    intent: "Whether the parts are standing up.",
    sections: [
      section({ key: "starts", heading: "Starts", whole: true }),
      section({ key: "dependencies", heading: "One subsystem calling another", whole: true, durations: true }),
      section({ key: "mongo", heading: "Mongo", whole: true }),
      section({ key: "logins", heading: "Logins", whole: true }),
    ],
  },
};

// A section, built. `limit` is the configuration's: a ranked table of an open
// dimension — a route, a model — can have hundreds of rows, and what is left out is
// counted and said.
function build(answer, before, definition, { limit, slices }) {
  const table = breakdown(answer?.[definition.key], { limit, whole: definition.whole });
  const earlier = breakdown(before?.[definition.key], { whole: definition.whole });
  return {
    ...definition,
    table,
    // The same rows over the period before it, added up. Only the total: a change on
    // every row of a table of routes is a table nobody reads.
    delta: delta(
      definition.whole ? table.total : table.rows.reduce((sum, row) => sum + row.count, 0),
      definition.whole ? earlier.total : earlier.rows.reduce((sum, row) => sum + row.count, 0)
    ),
    // The durations of the same rows, on one scale so they can be compared. Only
    // where a duration is what the section is about: a picture of three rows that
    // have none is a picture of nothing.
    spans: definition.durations ? spans(table.rows.map((row) => ({ label: row.label, duration: row.duration }))) : null,
    // The same rows as parts of one whole. `ring` answers null by itself where they
    // are not — a ranked list of routes has no total anybody asked about — so the
    // section does not have to decide it twice.
    ring: ring(table, { slots: slices }),
  };
}

// The stages of the funnel, grouped by what the first part of their name says they
// are. The names come from metrics (`form.opened`, `gate.demo.passed`,
// `project.created`), and the grouping is read off them rather than out of a list
// kept here: a gate added to the vocabulary appears in its own group the first time
// it decides something.
function groupStages(stages, { limit, slices }) {
  const groups = new Map();
  for (const [name, summary] of Object.entries(stages ?? {})) {
    const parts = name.split(".");
    // `gate.<gate>.<outcome>[.<reason>]` — the gate is what the group is. Anything
    // else groups on its first part, which is what it is about.
    const group = parts[0] === "gate" && parts.length > 2 ? `${parts[0]}.${parts[1]}` : parts[0];
    // Inside a group the rest of the name is what tells the rows apart.
    const row = parts.slice(group.split(".").length).join(".") || name;
    if (!groups.has(group)) groups.set(group, {});
    groups.get(group)[row] = summary;
  }
  return [...groups.entries()]
    .map(([name, rows]) => ({
      name,
      // Whether this group is a gate, which is what the name says it is. A gate's
      // rows are the outcomes of one decision — parts of one whole — while the rows
      // of `form` are the same form counted at two moments, which are not.
      gate: name.startsWith("gate."),
      table: breakdown(rows, { limit, whole: name.startsWith("gate.") }),
      // How that one gate decided, as parts of one whole. A group that is not a gate
      // gets none: `form.opened` and `form.submitted` are the same form counted at two
      // moments, and a ring of them would claim a total that does not exist.
      ring: ring(breakdown(rows, { limit, whole: name.startsWith("gate.") }), { slots: slices }),
    }))
    .sort((a, b) => (b.table.total ?? b.table.largest) - (a.table.total ?? a.table.largest) || a.name.localeCompare(b.name));
}

// What of the funnel could not be reconciled. `available` false is an answer, not a
// gap: it says the projects could not be counted and why, and the funnel is still a
// funnel.
function reconciliation(given) {
  const known = new Set(["available", "reason", "projects", "projects_measured", "lost"]);
  const answer = given !== null && typeof given === "object" ? given : {};
  return {
    available: answer.available === true,
    reason: typeof answer.reason === "string" ? answer.reason : null,
    projects: Number.isFinite(answer.projects) ? answer.projects : null,
    measured: Number.isFinite(answer.projects_measured) ? answer.projects_measured : null,
    lost: Number.isFinite(answer.lost) ? answer.lost : null,
    // Anything metrics answers that this page was not written for. Shown as it
    // came: a field added there must not disappear here.
    rest: Object.entries(answer)
      .filter(([key]) => !known.has(key))
      .map(([key, value]) => ({ key, value: JSON.stringify(value) })),
  };
}

// The parts of an answer that are not a `{ name: summary }` map, and therefore have
// a shape of their own. Each is built by the page it belongs to, and each says what
// it could not say.
const EXTRAS = {
  cost(answer, before) {
    const total = single(answer?.total);
    return {
      total,
      delta: delta(total.count, single(before?.total).count),
      // What was consumed, kind by kind, against the period before.
      consumed: tokenDeltas(total.tokens, single(before?.total).tokens),
      perProject: perProject(answer?.per_project),
      // What one thing that consumes cost, kind by kind. The denominator is the
      // buckets that carry tokens, which is what `total` counts.
      each: total.each,
    };
  },
  preanalysis(answer, before) {
    const turns = single(answer?.turns);
    const earlier = single(before?.turns);
    const perPreanalysis = answer?.turns_per_preanalysis ?? {};
    const earlierPerPreanalysis = before?.turns_per_preanalysis ?? {};
    return {
      turns,
      delta: delta(turns.count, earlier.count),
      // What one turn costs, kind by kind: the cost question at the grain the
      // pre-analysis is actually charged in.
      each: turns.each,
      // And whether a pre-analysis is taking more turns than it was.
      medianDelta: delta(perPreanalysis.p50, earlierPerPreanalysis.p50),
      preanalysesDelta: delta(perPreanalysis.preanalyses, earlierPerPreanalysis.preanalyses),
      // How many turns one pre-analysis takes: one of the three questions. Exact, not
      // estimated — there is one accumulator per project, so the quantiles are read
      // off the real values.
      perPreanalysis: spread(perPreanalysis, { of: perPreanalysis.preanalyses ?? 0, unit: "turns" }),
      preanalyses: Number.isFinite(perPreanalysis.preanalyses) ? perPreanalysis.preanalyses : 0,
      // The turns' own durations, which is where the 137-second turn of the
      // checkpoints would show up. One row, on its own scale: there is nothing to
      // compare it with, and the marks are what is being read.
      duration: spans([{ label: "preanalysis.turn", duration: turns.duration }]),
    };
  },
  providers(answer, before) {
    return {
      failureRate: rate(answer?.failure_rate),
      // A failure rate is only readable against the one before it: three in a
      // thousand and thirty in a thousand are the same sentence otherwise.
      failureRateBefore: rate(before?.failure_rate),
      failureRateDelta: delta(rate(answer?.failure_rate).perThousand, rate(before?.failure_rate).perThousand),
    };
  },
  http(answer, before) {
    const refused = Number.isFinite(answer?.refused_ips) ? answer.refused_ips : 0;
    return {
      refusedIps: refused,
      refusedIpsDelta: delta(refused, Number.isFinite(before?.refused_ips) ? before.refused_ips : null),
    };
  },
  economics(answer, before, { limit, also }) {
    const now = perAcceptedDemo(answer?.cost_per_accepted_demo);
    const earlier = perAcceptedDemo(before?.cost_per_accepted_demo);
    return {
      charged: single(answer?.tokens_charged_to_drivers),
      perAcceptedDemo: now,
      acceptedDelta: delta(now.accepted, earlier.accepted),
      // What a sale consumed, against what it consumed before: the figure the worst
      // case is built on, and the only way to see it moving.
      perDemoDeltas: tokenDeltas(now.tokens, earlier.tokens),
      refusals: refusals(answer?.cost_of_refusals, { limit }),
      // The share of the whole consumption that produced nothing. Kind by kind: a
      // share of one kind in another is a rate nobody decided.
      // The whole consumption of the period is answered by `cost`, not here, so the
      // page asks that question too rather than reconstructing the figure.
      wasted: shareOfTokens(answer?.cost_of_refusals?.tokens, single(also.cost?.total).tokens),
    };
  },
  health(answer, before) {
    return {
      dependencyFailureRate: rate(answer?.dependency_failure_rate),
      dependencyFailureRateDelta: delta(
        rate(answer?.dependency_failure_rate).perThousand,
        rate(before?.dependency_failure_rate).perThousand
      ),
    };
  },
  funnel(answer, before, { limit, slices }) {
    const groups = groupStages(answer?.stages, { limit, slices });
    return {
      groups,
      reconciliation: reconciliation(answer?.reconciliation),
      // How many of what reached one gate reached the next: the funnel's own
      // question, which the heights of the bars do not answer.
      gates: chain(
        groups
          .filter((group) => group.gate)
          .map((group) => ({ label: group.name, count: group.table.total ?? group.table.largest }))
      ),
      // And the way in, before the first gate: the stages that are not a gate, each
      // against the widest of them.
      entry: chain(
        groups
          .filter((group) => !group.gate)
          .flatMap((group) => group.table.rows.map((row) => ({ label: `${group.name}.${row.label}`, count: row.count })))
          .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      ),
      delta: delta(measuredOf(answer?.reconciliation), measuredOf(before?.reconciliation)),
    };
  },
};

// What a webtool consumes: the distribution over projects, one per kind of token.
// There is no distribution of the kinds together, and there is no total of them:
// a single number would have to weigh one kind against another, and that weight is
// a price.
function perProject(given) {
  const answer = given !== null && typeof given === "object" ? given : {};
  const projects = Number.isFinite(answer.projects) ? answer.projects : 0;
  const byKind = answer.by_kind !== null && typeof answer.by_kind === "object" ? answer.by_kind : {};
  return {
    projects,
    kinds: Object.entries(byKind)
      .map(([kind, values]) => ({
        kind,
        total: values?.total,
        spread: spread(values, { of: projects, unit: `${kind} tokens` }),
      }))
      .sort((a, b) => a.kind.localeCompare(b.kind)),
  };
}

// Every token of the period over the demos accepted in it. `null` tokens is not
// zero: nothing divided by nothing is not a consumption of nothing, and the page
// says which of the two it is looking at.
function perAcceptedDemo(given) {
  const answer = given !== null && typeof given === "object" ? given : {};
  const accepted = Number.isFinite(answer.accepted_demos) ? answer.accepted_demos : 0;
  return {
    accepted,
    tokens: answer.tokens !== null && typeof answer.tokens === "object" ? answer.tokens : null,
  };
}

// What was spent on projects a gate refused, by the reason it gave. The rows are
// not summaries — they are projects and tokens — so they are built here and not by
// `breakdown`.
function refusals(given, { limit }) {
  const answer = given !== null && typeof given === "object" ? given : {};
  const byReason = answer.by_reason !== null && typeof answer.by_reason === "object" ? answer.by_reason : {};
  const rows = Object.entries(byReason)
    .map(([reason, entry]) => ({
      label: reason,
      projects: Number.isFinite(entry?.projects) ? entry.projects : 0,
      tokens: entry?.tokens !== null && typeof entry?.tokens === "object" ? entry.tokens : null,
    }))
    .sort((a, b) => b.projects - a.projects || a.label.localeCompare(b.label));
  const shown = rows.slice(0, limit);
  const largest = shown.reduce((most, row) => Math.max(most, row.projects), 0);
  for (const row of shown) row.percent = largest > 0 ? Math.round((row.projects / largest) * 1000) / 10 : 0;
  return {
    projects: Number.isFinite(answer.projects) ? answer.projects : 0,
    tokens: answer.tokens !== null && typeof answer.tokens === "object" ? answer.tokens : null,
    rows: shown,
    kinds: [...new Set(shown.flatMap((row) => Object.keys(row.tokens ?? {})))].sort(),
    hidden: rows.length > shown.length ? rows.length - shown.length : null,
  };
}

// The view of one of these pages, from the answer metrics gave.
// How many projects were measured, which is the funnel's own count of itself.
function measuredOf(reconciliation) {
  const measured = reconciliation?.projects_measured;
  return Number.isFinite(measured) ? measured : null;
}

// `also` carries the answers a page needs that are not its own question: the
// economics page asks what share of the consumption produced nothing, and the whole
// consumption of the period is answered by `cost`, not by `economics`.
export function buildQuestion(name, answer, before, { limit, slices, also = {} }) {
  const definition = QUESTION_PAGES[name];
  const extra = EXTRAS[name] ? EXTRAS[name](answer, before, { limit, slices, also }) : {};
  return {
    question: name,
    heading: definition.heading,
    intent: definition.intent,
    sections: definition.sections.map((given) => build(answer, before, given, { limit, slices })),
    ...extra,
  };
}
