// What an interaction with a model cost, reported once, in the vocabulary's words.
//
// The doors answer one envelope for every outcome (`src/preanalyst_ai/contract.js` and
// `src/prevalidator_ai/contract.js`): `{ ok, provider, model, ended, failure, attempts,
// spend, output }`. metrics' vocabulary asks for the same facts under its own names.
// This file is the **only** place the two are put side by side, so the mapping exists
// once and a door that gains an outcome is dealt with here and nowhere else.
//
// Nothing about a provider passes through: `ended` and `failure` are already our words —
// the adapter translated whatever its SDK said before the envelope was built — and
// `spend.kinds` carries the kinds under the names the adapter reports them by. They are
// counted and never converted.
//
// **Where the tokens are carried, and why only here.** An interaction is reported as one
// `ai.call`, and that is the measurement that carries the tokens. It is tempting to put
// them on `preanalysis.turn` as well, since a turn is an interaction — and it would
// double the cost of the whole system: `/metrics/cost` sums **everything that carries
// tokens**, so the same tokens under two names are counted twice. A turn is counted by
// `preanalysis.turn` and paid for by `ai.call`, and the per-turn cost is read on the
// cost page under the `preanalysis_turn` phase.

// The phases of the pipeline, as the vocabulary closes them. They are here rather than
// at the call sites so that a door and the phase it belongs to cannot drift apart.
export const PREVALIDATION = "prevalidation";
export const PREANALYSIS_OPENING = "preanalysis_opening";
export const PREANALYSIS_TURN = "preanalysis_turn";
export const PREANALYSIS_VALIDATION = "preanalysis_validation";

// One envelope, reported. `durationMs` is how long we waited, which is the number that
// started all this: an opening of 15 s and an ordinary turn of 137 s exist nowhere else.
export function reportModelCall(settings, { phase, projectId = null, answer, durationMs }) {
  const project = projectId ? { project_id: projectId } : {};

  // Nothing came back at all. `spend` is null and stays null: a zero would be a claim we
  // cannot make. Why nothing came back is a different question from how an answer ended,
  // and it is a different metric.
  if (answer.ended === "no_answer") {
    settings.metrics.measure("ai.failed", {
      dims: {
        phase,
        provider: answer.provider,
        reason: answer.failure,
        // The model is known only sometimes: a call refused before a model was chosen has
        // none. Absent is absent — the dimension is optional and nothing is put in its
        // place.
        ...(answer.model ? { model: answer.model } : {}),
      },
      duration_ms: durationMs,
      ...project,
    });
    return;
  }

  // The model ran. In three of the four outcomes there is nothing to use, and what it
  // consumed is real all the same.
  if (typeof answer.provider !== "string" || typeof answer.model !== "string") {
    // `ai.call` is identified by its provider and its model: without them the bucket
    // would mean something else, and metrics refuses it by name. It is our defect, so it
    // is said out loud rather than sent and lost.
    console.warn(`[measured_ai] ${phase} ended ${answer.ended} with no provider or model: not counted`);
    return;
  }
  settings.metrics.measure("ai.call", {
    dims: {
      phase,
      model: answer.model,
      provider: answer.provider,
      outcome: answer.ended,
      // Whether what answered is what was asked for. `model` alone cannot say it: a
      // configuration whose primary model was changed and a primary model that is being
      // fallen back from every time produce the same bucket, and they are not the same
      // thing to know.
      fell_back: answer.fell_back ? "yes" : "no",
    },
    // The kinds are the adapter's. Nothing here lists them, and nothing adds them up.
    ...(answer.spend?.kinds ? { tokens: answer.spend.kinds } : {}),
    duration_ms: durationMs,
    ...project,
  });
}

// How many times we asked again. It is ours, not the provider's: the ceiling is
// configured here and the adapter obeys it, so the number of attempts is a fact about a
// decision we made. One attempt is not a retry.
export function reportRetries(settings, { phase, projectId = null, answer }) {
  const again = Number(answer.attempts ?? 1) - 1;
  if (again <= 0) return;
  settings.metrics.measure("ai.retry", {
    dims: { phase, provider: answer.provider },
    count: again,
    ...(projectId ? { project_id: projectId } : {}),
  });
}

// The door could not use an answer the provider completed.
//
// It is a second measurement and not a dimension of the first, because the two are known
// at different moments. `ai.call` goes out as soon as the call comes back — that is when
// what it cost is known, and it is reported before anything has been decided about the
// answer, on purpose. By the time the door has read the answer and found it empty, that
// bucket has already been written.
//
// No tokens and no duration: the call that produced this answer reported both, and the
// same tokens under a second name would be counted twice.
export function reportUnusable(settings, { phase, projectId = null, answer, reason }) {
  if (typeof answer.provider !== "string" || typeof answer.model !== "string") return;
  settings.metrics.measure("ai.unusable", {
    dims: { phase, provider: answer.provider, model: answer.model, reason },
    ...(projectId ? { project_id: projectId } : {}),
  });
}

// Both, which is what every caller wants: one interaction, everything it is worth
// saying about it.
export function reportInteraction(settings, options) {
  reportModelCall(settings, options);
  reportRetries(settings, options);
}
