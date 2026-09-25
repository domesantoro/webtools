// The prevalidator: the first gate of the flow.
//
// It reads the pre-specification that has just been written and says whether the
// request sits inside the perimeter of the service. It designs nothing, asks no
// questions, writes no text for the client: it returns a decision.
//
// Six outcomes, each with a probability — `non_sequitur`, `run_out_certain`,
// `run_out_likely`, `underspecified`, `safe`, `ultrasafe` — and a reason.
//
// Four outcomes sit on the size axis. The other two do not: `underspecified`
// says the request cannot be placed on that axis, because it has said too little
// — it is not a refusal, it is an invitation to write something more;
// `non_sequitur` says the request does not sit on that axis in principle,
// because there is no software to measure. A logo, an opinion, a consultancy:
// the developer could not build them at any size, so the request is refused like
// one that does not fit.
//
// Alongside the outcomes there is the **internal** `off_domain` flag, which
// answers a different question: is the software we are being asked for a webtool?
// It is raised for a request that could be developed — a showcase site, an online
// shop, an app, a game, a plugin, a script with no interface — but that is not
// the kind of tool we make. It is independent of size: one can be off domain and
// `safe`. It decides nothing on its own and never reaches the client: it will go
// to the driver once the driver area exists.
//
// Not to be confused with `non_sequitur`, which is an outcome and does refuse:
// that one says there is no software at all, this one says the software is not
// ours.
//
// The criteria are not here: they are in the policy, which is configuration
// (`webtools/configurator/policies/`), distributed into `policies/`. Here there is
// only how the answer is read and how it is decided what to do with it.
//
// Contract towards the caller:
//   { ok: true, data: { outcome, distribution, off_domain, reason, policy,
//                       provider, model, usage } }
//   { ok: false, reason: "unavailable" | "rejected" | "unknown_provider",
//                usage?, model? }
//
// Even when things go wrong, if the model answered the tokens have been spent:
// `usage` is there, and the caller records it. A cost that cannot be seen is not
// measured.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { decide } from "./ai/webtools_ai.js";

const POLICIES_DIR = fileURLToPath(new URL("../policies/", import.meta.url));

// The order matters: on a tie the first one wins, that is, the most cautious.
export const OUTCOMES = [
  "non_sequitur",
  "run_out_certain",
  "run_out_likely",
  "underspecified",
  "safe",
  "ultrasafe",
];

// The outcomes that take the request to REJECTED. There are two, and they refuse
// in the same way but for different reasons: `run_out_certain` is too big for us,
// `non_sequitur` is not our kind of work at any size.
export const REJECTING = ["non_sequitur", "run_out_certain"];

// The outcome that sends the user back to the form: the request cannot be judged,
// a few more details are needed.
export const UNDERSPECIFIED = "underspecified";

// The schema the model must respect. `additionalProperties: false` and `required`
// everywhere: what comes back is either this, or nothing.
//
// **No `minimum` and `maximum` on the probabilities**, however natural they would
// be to write: constrained output does not accept numeric constraints, and the
// API answers `400 invalid_request_error` ("For 'number' type, properties maximum,
// minimum are not supported"). `minLength`/`maxLength`, `multipleOf` and recursive
// schemas are not supported either. The SDKs strip them by themselves only when
// the schema is a Zod one passed to `messages.parse()`; here the schema is JSON
// and reaches the API exactly as written.
//
// Nothing is lost: the range is checked by `normalize()`, which discards whatever
// is not a finite, non-negative number and brings the sum back to 1.
const SCHEMA = {
  type: "object",
  properties: {
    distribution: {
      type: "object",
      properties: Object.fromEntries(OUTCOMES.map((name) => [name, { type: "number" }])),
      required: OUTCOMES,
      additionalProperties: false,
    },
    off_domain: {
      type: "object",
      properties: { flag: { type: "boolean" }, reason: { type: "string" } },
      required: ["flag", "reason"],
      additionalProperties: false,
    },
    reason: { type: "string" },
  },
  required: ["distribution", "off_domain", "reason"],
  additionalProperties: false,
};

// The policy, read from disk once: it does not change while the server runs, and
// after a deploy the server restarts anyway.
const policies = new Map();

async function readPolicy(name) {
  if (!policies.has(name)) {
    const text = await readFile(`${POLICIES_DIR}${name}.md`, "utf8");
    // The copy carries an HTML comment at the top, put there by the deployer
    // ("do not edit here"): that is ours, and does not belong in the prompt.
    policies.set(name, text.replace(/^\s*<!--[\s\S]*?-->\s*/, ""));
  }
  return policies.get(name);
}

// The distribution, cleaned up. The model declares six numbers and they almost
// never sum to exactly 1: they are normalised, rather than trusted or rejected.
//   → { distribution, outcome } or null if there is nothing to normalise.
export function normalize(raw) {
  const values = OUTCOMES.map((name) => {
    const value = raw?.[name];
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  });
  if (values.some((value) => value === null)) return null;

  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return null;

  const distribution = {};
  OUTCOMES.forEach((name, index) => {
    distribution[name] = values[index] / total;
  });

  // The outcome is the most probable one. On a tie the first of the list wins,
  // that is, the most cautious: between two equally probable readings we keep the
  // one that stops.
  let outcome = OUTCOMES[0];
  for (const name of OUTCOMES) {
    if (distribution[name] > distribution[outcome]) outcome = name;
  }
  return { distribution, outcome };
}

// A request is refused only if the most probable outcome is one of the two that
// refuse **and** it is above the threshold. Two conditions and not one: a
// `run_out_certain` at 35%, highest of the six though it is, is a certainty of
// nothing. The threshold is the same for both: whoever refuses does so on the
// same terms.
export function rejects(distribution, outcome, threshold) {
  return REJECTING.includes(outcome) && distribution[outcome] > threshold;
}

// What is done with a successful prevalidation: "rejected", "underspecified" or
// "passed".
//
// `attempts` is how many times this same request has already come back for want
// of detail. Past the limit no more is asked: going on sending somebody back who
// has already rewritten many times is not an invitation, it is a wall.
export function verdict(distribution, outcome, { threshold, attempts, maxAttempts }) {
  if (rejects(distribution, outcome, threshold)) return "rejected";
  if (outcome !== UNDERSPECIFIED) return "passed";
  return attempts >= maxAttempts ? "rejected" : "underspecified";
}

export async function prevalidate(settings, spec) {
  const { policy, specMaxChars } = settings.prevalidation;
  const instructions = await readPolicy(policy);

  const answer = await decide(settings.ai, {
    instructions,
    // The cut is a safety net, not a check: the open answers are already limited
    // at submission time (`form.answer_max_chars`).
    document: spec.slice(0, specMaxChars),
    schema: SCHEMA,
  });
  if (!answer.ok) return answer;

  const { output, model, usage } = answer.data;
  const normalized = normalize(output?.distribution);
  if (normalized === null) {
    // This happens if the model sends numbers that are not numbers, or puts them
    // all at zero: an empty distribution yields no outcome. The policy forbids it
    // explicitly — if nothing else fits, the mass goes on `non_sequitur` — but the
    // guard stays, because the model is not obliged to obey. The tokens, however,
    // have been spent, and they are reported back.
    console.error("[prevalidator] unusable distribution");
    return { ok: false, reason: "rejected", usage, model };
  }

  return {
    ok: true,
    data: {
      outcome: normalized.outcome,
      distribution: normalized.distribution,
      off_domain: {
        flag: Boolean(output.off_domain?.flag),
        reason: String(output.off_domain?.reason ?? ""),
      },
      reason: String(output.reason ?? ""),
      policy,
      provider: settings.ai.provider,
      model,
      usage,
    },
  };
}
