// One project's accumulator: what this webtool cost, turn by turn and gate by gate.
//
// A per-project figure cannot come out of the daily buckets — a daily sum has
// already thrown the projects away — so metrics keeps one document per project, and
// this is it.
//
// **It is not the invoice.** What a project consumed for the price at the demo is on
// its own pipeline steps in anagraphics, written in the same awaited write that
// records the step. This is the same arithmetic done a second time from measurements
// that nobody waited for, and when the two disagree the project's record is the one
// that is right. The page says so where the figures are, not only here.
//
// The document holds a metric's name with its dots turned into underscores, because
// a dot in a Mongo field name is a nuisance to query. The real names come from the
// **vocabulary**, so the mapping back is read from metrics and not guessed: a field
// that matches no name in the vocabulary is shown as it is stored, which is the
// honest thing to do with a name this page does not recognise.

import { bytes, count, duration, histogram } from "../figures.js";

export function buildProject({ readings, projectId }) {
  const reading = readings.project;
  const vocabulary = readings.vocabulary?.ok ? readings.vocabulary.answer : null;
  const names = namesByStoredKey(vocabulary);

  if (!reading || !reading.ok) {
    return {
      heading: "Project",
      projectId,
      // A project id nobody ever measured is not a failure of the reading: it is an
      // answer, and it is a different one from metrics being down.
      unknown: reading?.reason === "not_found",
      project: null,
    };
  }
  const document = reading.answer;

  return {
    heading: "Project",
    projectId,
    unknown: false,
    project: {
      id: document.project_id,
      firstAt: typeof document.first_at === "string" ? document.first_at : null,
      lastAt: typeof document.last_at === "string" ? document.last_at : null,
      // The project's own totals, kind by kind. No total across the kinds.
      tokens: kindRows(document.tokens),
      phases: phaseRows(document.phases),
      gates: countRows(document.gates),
      reasons: countRows(document.gate_reasons),
      metrics: metricRows(document.metrics, names),
      // Anything on the document this page was not written for. Shown rather than
      // dropped: a field added to the accumulator must not vanish here.
      rest: Object.entries(document)
        .filter(([key]) => !KNOWN.has(key))
        .map(([key, value]) => ({ key, value: JSON.stringify(value) })),
    },
  };
}

const KNOWN = new Set([
  "project_id",
  "first_at",
  "last_at",
  "tokens",
  "phases",
  "gates",
  "gate_reasons",
  "metrics",
]);

// `preanalysis_turn` back to `preanalysis.turn`, from the vocabulary's own list of
// names.
function namesByStoredKey(vocabulary) {
  const names = new Map();
  for (const name of Object.keys(vocabulary?.metrics ?? {})) names.set(name.replace(/\./g, "_"), name);
  return names;
}

function kindRows(tokens) {
  if (tokens === null || typeof tokens !== "object") return [];
  return Object.entries(tokens)
    .filter(([, value]) => Number.isFinite(value))
    .map(([kind, value]) => ({ kind, value, text: count(value) }))
    .sort((a, b) => a.kind.localeCompare(b.kind));
}

function countRows(given) {
  if (given === null || typeof given !== "object") return { rows: [], empty: true };
  const rows = Object.entries(given)
    .filter(([, value]) => Number.isFinite(value))
    .map(([label, value]) => ({ label, value, text: count(value) }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  const largest = rows.reduce((most, row) => Math.max(most, row.value), 0);
  for (const row of rows) row.percent = largest > 0 ? Math.round((row.value / largest) * 1000) / 10 : 0;
  return { rows, empty: rows.length === 0 };
}

// What each phase of the pipeline cost this project. The phases are whichever ones
// the project went through: they are not listed here.
function phaseRows(phases) {
  if (phases === null || typeof phases !== "object") return { rows: [], kinds: [], empty: true };
  const rows = Object.entries(phases)
    .map(([phase, given]) => ({
      label: phase,
      count: count(given?.count),
      value: Number.isFinite(given?.count) ? given.count : 0,
      tokens: given?.tokens !== null && typeof given?.tokens === "object" ? given.tokens : null,
    }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  const largest = rows.reduce((most, row) => Math.max(most, row.value), 0);
  for (const row of rows) row.percent = largest > 0 ? Math.round((row.value / largest) * 1000) / 10 : 0;
  return {
    rows,
    kinds: [...new Set(rows.flatMap((row) => Object.keys(row.tokens ?? {})))].sort(),
    empty: rows.length === 0,
  };
}

// Every metric this project was measured on. The durations are stored raw here — a
// sum, a minimum, a maximum and a histogram — so the histogram is what is shown, and
// no percentile is estimated from it: the picture says more than a number read off
// it would.
function metricRows(metrics, names) {
  if (metrics === null || typeof metrics !== "object") return { rows: [], kinds: [], empty: true };
  const rows = Object.entries(metrics)
    .map(([key, given]) => {
      const stored = given?.duration_ms !== null && typeof given?.duration_ms === "object" ? given.duration_ms : null;
      const hits = Object.values(stored?.buckets ?? {}).reduce(
        (total, value) => total + (Number.isFinite(value) ? value : 0),
        0
      );
      return {
        // The real name where the vocabulary has it, the stored field name where it
        // does not.
        label: names.get(key) ?? key,
        stored: names.has(key) ? null : key,
        count: count(given?.count),
        value: Number.isFinite(given?.count) ? given.count : 0,
        tokens: given?.tokens !== null && typeof given?.tokens === "object" ? given.tokens : null,
        bytes: bytes(given?.bytes),
        duration: stored
          ? {
              sum: duration(stored.sum),
              min: duration(stored.min),
              max: duration(stored.max),
              mean: hits && Number.isFinite(stored.sum) ? duration(Math.round(stored.sum / hits)) : null,
              histogram: histogram(stored.buckets),
            }
          : null,
      };
    })
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  return {
    rows,
    kinds: [...new Set(rows.flatMap((row) => Object.keys(row.tokens ?? {})))].sort(),
    empty: rows.length === 0,
  };
}
