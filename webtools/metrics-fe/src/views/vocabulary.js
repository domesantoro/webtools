// What may be sent: every metric that exists, what each one may carry, and which
// subsystems may send anything at all.
//
// A closed list is only fair if it can be read, so metrics answers it
// (`GET /vocabulary`) and this page prints it. It is the page to open when a
// measurement was refused: the name of the dimension that was wrong, or the value a
// closed dimension does not allow, is on it.
//
// Three kinds of dimension, and the difference matters:
//
//   required  part of the metric's identity — without it the measurement is refused
//   optional  it exists only in some cases; absent is absent, and nothing is put in
//             its place
//   open      the values cannot be listed in advance (a model's name, a route, a uid)
//             and only the key is closed

import { count } from "../figures.js";

export function buildVocabulary({ readings }) {
  const vocabulary = readings.vocabulary.ok ? readings.vocabulary.answer : null;
  const metrics = Object.entries(vocabulary?.metrics ?? {})
    .map(([name, given]) => ({
      name,
      required: dimensions(given?.required),
      optional: dimensions(given?.optional),
      // What a measurement of this metric may carry besides its count.
      values: Array.isArray(given?.values) ? [...given.values].sort() : [],
      // Whether a measurement of it may name a project, which is what decides
      // whether it lands in a project's accumulator as well as in the day's bucket.
      project: given?.project === true,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    heading: "Vocabulary",
    subsystems: Array.isArray(vocabulary?.subsystems) ? [...vocabulary.subsystems].sort() : [],
    metrics,
    metricsText: count(metrics.length),
  };
}

// A metric's dimensions. `null` in the place of the values is metrics' word for an
// open dimension: the key is closed and the values are not listable.
function dimensions(given) {
  if (given === null || typeof given !== "object") return [];
  return Object.entries(given)
    .map(([name, values]) => ({
      name,
      open: values === null,
      values: Array.isArray(values) ? values : [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
