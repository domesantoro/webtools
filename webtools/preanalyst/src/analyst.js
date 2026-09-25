// The analyst: the engine that conducts the conversation of the analysis.
//
// It is the chat's counterpart to the prevalidator, and it is a different animal.
// The prevalidator classifies one document and answers with numbers; this one
// carries a conversation that grows, writes a sentence a person reads, and has a
// limited number of turns to get somewhere with it.
//
// It is **not** the judge of its own work. It proposes `ready` when it believes
// the questions are over; whether that is true is decided by
// `src/analysis_validator.js`, which is a separate engine with its own policy and
// its own model. A model that grades itself finished is the worst judge of it.
//
// The criteria are not here: they are in the policy, which is configuration
// (`webtools/configurator/policies/analysis-v1.md`), distributed into `policies/`.
// Here there is only how the conversation is assembled and how the answer is read.
//
// Contract towards the caller:
//   { ok: true, data: { message, missing, ready, reason, policy, provider, model, usage } }
//   { ok: false, reason: "unavailable" | "rejected" | "unknown_provider", usage?, model? }
//
// As everywhere else: if the model answered, the tokens were spent, and `usage`
// comes back with the error too.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { converse } from "./analyst_ai/webtools_analyst_ai.js";

const POLICIES_DIR = fileURLToPath(new URL("../policies/", import.meta.url));

// `message` is prose for the client; everything else is for us. No `minLength`
// and no `maxLength`: constrained output does not accept them, exactly as in the
// prevalidator's schema. The length is cut afterwards, by the caller.
const SCHEMA = {
  type: "object",
  properties: {
    message: { type: "string" },
    missing: { type: "array", items: { type: "string" } },
    ready: { type: "boolean" },
    reason: { type: "string" },
  },
  required: ["message", "missing", "ready", "reason"],
  additionalProperties: false,
};

const policies = new Map();

async function readPolicy(name) {
  if (!policies.has(name)) {
    const text = await readFile(`${POLICIES_DIR}${name}.md`, "utf8");
    // The deployer's "do not edit here" banner is ours, not the model's.
    policies.set(name, text.replace(/^\s*<!--[\s\S]*?-->\s*/, ""));
  }
  return policies.get(name);
}

// The conversation as the API wants it. The stored chat has two roles — the
// client and us — and they become `user` and `assistant`.
//
// The **pre-specification is the first message**, always, and it never changes:
// that makes it part of the stable prefix, so from the second turn on the policy
// and the form's answers are read from the cache instead of being paid for again.
//
// `message` is what the client has just written, and it is **optional**: on the
// opening the analyst reads the pre-specification and asks the first question
// without anybody having written anything. A turn with no client message is a
// conversation all the same; an empty message is not turned into one.
export function conversationOf(spec, chat, message = null) {
  const messages = [{ role: "user", content: `# Pre-specification\n\n${spec}` }];
  for (const entry of chat ?? []) {
    const text = String(entry?.text ?? "");
    if (text === "") continue;
    messages.push({ role: entry.role === "client" ? "user" : "assistant", content: text });
  }
  const written = message === null || message === undefined ? "" : String(message);
  if (written !== "") messages.push({ role: "user", content: written });
  return messages;
}

// What the model is told about the state of the conversation, as an operator
// instruction. It changes at every turn, which is exactly why it is not in the
// policy: the policy is the part that never changes. How it reaches the model —
// a system role among the messages, a marked user message, something else on a
// provider written tomorrow — is not decided here. See src/analyst_ai/.
//
// It carries the language too. The client writes in their own, and the reply is
// read by them: the language is not a matter of the model guessing right.
//
// `stillMissing` is the validator's answer when it has refused a `ready`: the
// analyst believed it was done, a separate judgement said it was not, and these
// are the points it is sent back for. It arrives the same way as everything else
// about the state of the turn — at the end of the messages, out of the cached
// prefix.
export function operatorNote(turnsLeft, language, { stillMissing = [], opening = false } = {}) {
  const turns = turnsLeft === 1 ? "1 turn" : `${turnsLeft} turns`;
  const sentBack =
    stillMissing.length > 0
      ? `You proposed to close, and a separate check judged the analysis not complete yet. Still open: ${stillMissing.join("; ")}. Do not close now: ask about whichever of these matters most.`
      : "";
  return [
    // The opening: nobody has written yet, and the client is looking at an empty
    // page. Said out loud, because a model that has only the pre-specification in
    // front of it could take the conversation to be already under way.
    opening
      ? "Nobody has written yet: the client has just arrived on the page and is reading you. This message is your first question, and there is no answer to reply to."
      : "",
    `The conversation has ${turns} left, this one included.`,
    turnsLeft <= 3 && sentBack === "" && !opening
      ? "Ask only what would change the tool the most, and close rather than run out mid-question."
      : "",
    sentBack,
    `Write your message in this language: ${language}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

// `message` is absent on the opening, when the analyst asks the first question
// before the client has written anything.
export async function ask(
  settings,
  { spec, chat, message = null, turnsLeft, language, stillMissing = [], opening = false },
) {
  const { policy, messageMaxChars } = settings.analyst.conversation;
  const instructions = await readPolicy(policy);

  const answer = await converse(settings.analyst.conversation.ai, {
    instructions,
    messages: conversationOf(spec, chat, message),
    schema: SCHEMA,
    operator: operatorNote(turnsLeft, language, { stillMissing, opening }),
  });
  if (!answer.ok) return answer;

  const { output, model, usage } = answer.data;
  const text = String(output?.message ?? "").trim();
  if (text === "") {
    // The schema requires the field, so this is an empty string that satisfied
    // it: a turn with nothing to show the client is not a turn.
    console.error("[analyst] empty message");
    return { ok: false, reason: "rejected", usage, model };
  }

  return {
    ok: true,
    data: {
      message: text.slice(0, messageMaxChars),
      missing: Array.isArray(output.missing) ? output.missing.map((item) => String(item)) : [],
      ready: Boolean(output.ready),
      reason: String(output.reason ?? ""),
      policy,
      provider: settings.analyst.conversation.ai.provider,
      model,
      usage,
    },
  };
}
