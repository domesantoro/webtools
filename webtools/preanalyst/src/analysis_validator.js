// The validator: the second judgement on the analysis.
//
// The analyst declares itself finished; this engine decides whether that is
// true. It is a separate engine on purpose — its own policy, its own provider,
// its own model, its own configuration — because the thing being checked is a
// model's claim about its own work, and there is nobody less impartial.
//
// It does not run at every turn. It runs when the analyst proposes `ready`: one
// call per analysis, not one per message. What it costs is nothing against what
// a false `pass` costs, which is discovered at the demo.
//
// The criteria are in the policy — `analysis-validation-v1`, configuration in
// `webtools/configurator/policies/`. Here there is only how the answer is read
// and how the verdict is formed.
//
// Contract towards the caller:
//   { ok: true, data: { verdict, scores, weakest, missing, reason, policy,
//                       provider, model, usage } }
//   { ok: false, reason: "unavailable" | "rejected" | "unknown_provider", usage?, model? }

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { converse } from "./analyst_ai/webtools_analyst_ai.js";

const POLICIES_DIR = fileURLToPath(new URL("../policies/", import.meta.url));

// The four axes, in the order the documentation names them
// (`contesto/decision_engine_considerazioni.md`, The Analysis Validation).
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
// does not make up for a missing subject on the fourth: an analysis that is
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
// builds for the analyst. Who said what is the `role` of each message, which
// belongs to the call and not to the text.
//
// It used to be one document, with `**Client:**` and `**Analyst:**` written in
// front of each turn. Those are ordinary characters: the client could type them
// inside their own message and put words in the analyst's mouth, because there was
// nothing else saying who had spoken. Now the client's text can say whatever it
// likes — it stays inside a message whose role is `user`.
export function materialOf(spec, chat) {
  const messages = [{ role: "user", content: `# Pre-specification\n\n${spec}` }];
  for (const entry of chat ?? []) {
    const text = String(entry?.text ?? "");
    if (text === "") continue;
    messages.push({ role: entry.role === "client" ? "user" : "assistant", content: text });
  }
  return messages;
}

export async function validate(settings, { spec, chat }) {
  const { policy, passThreshold } = settings.analyst.validation;
  const instructions = await readPolicy(policy);

  const answer = await converse(settings.analyst.validation.ai, {
    instructions,
    messages: materialOf(spec, chat),
    schema: SCHEMA,
  });
  if (!answer.ok) return answer;

  const { output, model, usage } = answer.data;
  const read = readScores(output?.scores);
  if (read === null) {
    console.error("[analysis_validator] unusable scores");
    return { ok: false, reason: "rejected", usage, model };
  }

  return {
    ok: true,
    data: {
      verdict: decide(output.verdict, read.scores, passThreshold),
      scores: read.scores,
      weakest: read.weakest,
      missing: Array.isArray(output.missing) ? output.missing.map((item) => String(item)) : [],
      reason: String(output.reason ?? ""),
      policy,
      provider: settings.analyst.validation.ai.provider,
      model,
      usage,
    },
  };
}
