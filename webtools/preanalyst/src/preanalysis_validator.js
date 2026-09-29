// The validator: the second judgement on the pre-analysis.
//
// The engine that asks declares itself finished; this one decides whether that is
// true. It is a separate engine on purpose — its own policy, its own provider,
// its own model, its own configuration — because the thing being checked is a
// model's claim about its own work, and there is nobody less impartial.
//
// It does not run at every turn. It runs when the other engine proposes `ready`:
// one call per pre-analysis, not one per message. One call is nothing against a false
// `pass`, which is discovered at the demo.
//
// The criteria are in the policy — `preanalysis-validation-v1`, configuration in
// `webtools/configurator/policies/`. Here there is only how the answer is read
// and how the verdict is formed.
//
// Towards the caller it passes the door's envelope through
// (`src/preanalyst_ai/contract.js`) with `output` replaced by the verdict this file
// forms: `ok`, `ended`, `failure`, `attempts`, `spend`, `provider` and `model`
// arrive exactly as the door gave them.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PREANALYSIS_VALIDATION, reportInteraction, reportUnusable } from "./measured_ai.js";

import { conversation, unusable } from "./preanalyst_ai/contract.js";
import { converse } from "./preanalyst_ai/webtools_preanalyst_ai.js";

const POLICIES_DIR = fileURLToPath(new URL("../policies/", import.meta.url));

// The four axes, in the order the documentation names them
// (`contesto/decision_engine_considerations.md`, The Analysis Validation).
export const AXES = ["completeness", "consistency", "testability", "scope"];

export const VERDICTS = ["pass", "continue"];

// No `minimum`/`maximum` on the numbers: constrained output rejects them with a
// 400, as the prevalidator's schema records. The range is checked below.
const SCHEMA = {
  type: "object",
  properties: {
    scores: {
      type: "object",
      properties: Object.fromEntries(AXES.map((axis) => [axis, { type: "number" }])),
      required: AXES,
      additionalProperties: false,
    },
    verdict: { type: "string", enum: VERDICTS },
    missing: { type: "array", items: { type: "string" } },
    reason: { type: "string" },
  },
  required: ["scores", "verdict", "missing", "reason"],
  additionalProperties: false,
};

const policies = new Map();

async function readPolicy(name) {
  if (!policies.has(name)) {
    const text = await readFile(`${POLICIES_DIR}${name}.md`, "utf8");
    policies.set(name, text.replace(/^\s*<!--[\s\S]*?-->\s*/, ""));
  }
  return policies.get(name);
}

// The four numbers, cleaned up. Anything that is not a number between 0 and 1 is
// not a score, and one missing axis makes the whole judgement unusable: a verdict
// resting on three axes out of four is not the verdict this policy describes.
//   → { scores, weakest } or null.
export function readScores(raw) {
  const scores = {};
  for (const axis of AXES) {
    const value = raw?.[axis];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) return null;
    scores[axis] = value;
  }
  const weakest = AXES.reduce((lowest, axis) => (scores[axis] < scores[lowest] ? axis : lowest), AXES[0]);
  return { scores, weakest };
}

// The verdict, on two conditions and not one — as in the prevalidation, and for
// the same reason: a `pass` the model asked for but cannot support with its own
// numbers is not a pass.
//
// The **weakest axis** decides, not the average. Being excellent on three axes
// does not make up for a missing subject on the fourth: a pre-analysis that is
// complete, consistent and in scope but untestable is still one nobody can check
// at the end.
export function decide(verdict, scores, threshold) {
  if (!VERDICTS.includes(verdict)) return "continue";
  if (verdict === "continue") return "continue";
  return AXES.every((axis) => scores[axis] > threshold) ? "pass" : "continue";
}

// The material the judgement is made on: the form's answers and everything that
// was said afterwards.
//
// **It is a conversation, and it is sent as one** — the same shape `conversationOf`
// builds for the other engine. Who said what is the `role` of each message, which
// belongs to the call and not to the text.
//
// It used to be one document, with `**Client:**` and `**Analyst:**` written in
// front of each turn. Those are ordinary characters: the client could type them
// inside their own message and put words in ours, because there was
// nothing else saying who had spoken. Now the client's text can say whatever it
// likes — it stays inside a message whose role says it is the client's, and the
// role is a field of the call, not something written in the text.
export function materialOf(spec, chat) {
  const entries = [{ role: "client", text: `# Pre-specification\n\n${spec}` }];
  for (const entry of chat ?? []) {
    const text = String(entry?.text ?? "");
    if (text === "") continue;
    entries.push({ role: entry.role === "client" ? "client" : "preanalyst", text });
  }
  return conversation(entries);
}

export async function validate(settings, { spec, chat, projectId = null }) {
  const { policy, passThreshold } = settings.preanalyst.validation;
  const instructions = await readPolicy(policy);

  const elapsed = settings.metrics.timer();
  const answer = await converse(settings.preanalyst.validation.ai, {
    instructions,
    messages: materialOf(spec, chat),
    schema: SCHEMA,
  });
  // The validator is a second engine, on its own configuration and possibly its own
  // provider: what it costs is counted under its own phase and never folded into the
  // conversation's.
  reportInteraction(settings, { phase: PREANALYSIS_VALIDATION, projectId, answer, durationMs: elapsed() });
  if (!answer.ok) return answer;

  const { output } = answer;
  const read = readScores(output?.scores);
  if (read === null) {
    console.error("[preanalysis_validator] unusable scores");
    // It answered inside the schema and what came back is not a judgement. `ai.call`
    // has already gone out saying the provider completed, which it did: this is the
    // door's own verdict, and nothing else records it.
    reportUnusable(settings, {
      phase: PREANALYSIS_VALIDATION,
      projectId,
      answer,
      reason: "unreadable_scores",
    });
    return unusable({
      provider: answer.provider,
      model: answer.model,
      ended: "unusable",
      spend: answer.spend,
      attempts: answer.attempts,
      fellBack: answer.fell_back,
    });
  }

  return {
    ...answer,
    policy,
    output: {
      verdict: decide(output.verdict, read.scores, passThreshold),
      scores: read.scores,
      weakest: read.weakest,
      missing: Array.isArray(output.missing) ? output.missing.map((item) => String(item)) : [],
      reason: String(output.reason ?? ""),
    },
  };
}
