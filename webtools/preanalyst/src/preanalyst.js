// The preanalyst's engine: the one that conducts the rounds of questions which
// complete the pre-analysis.
//
// It is the chat's counterpart to the prevalidator, and it is a different animal.
// The prevalidator classifies one document and answers with numbers; this one
// carries a conversation that grows, writes a sentence a person reads, and has a
// limited number of turns to get somewhere with it.
//
// It is **not** the judge of its own work. It proposes `ready` when it believes
// the questions are over; whether that is true is decided by
// `src/preanalysis_validator.js`, which is a separate engine with its own
// policy and its own model. A model that grades itself finished is the worst
// judge of it.
//
// The criteria are not here: they are in the policy, which is configuration
// (`webtools/configurator/policies/preanalysis-v1.md`), distributed into
// `policies/`. Here there is only how the conversation is assembled and how the
// answer is read.
//
// Towards the caller it passes the door's own envelope through
// (`src/preanalyst_ai/contract.js`) with `output` replaced by what this file makes
// of it: the caller reads `ok`, `ended`, `failure`, `attempts`, `spend`,
// `provider`, `model` exactly as they came from the door, and `output` in this
// file's words. Nothing of a provider's is repackaged on the way.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PREANALYSIS_OPENING, PREANALYSIS_TURN, reportInteraction, reportUnusable } from "./measured_ai.js";

import { conversation, unusable } from "./preanalyst_ai/contract.js";
import { converse } from "./preanalyst_ai/webtools_preanalyst_ai.js";

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

// The conversation in **our** roles. The stored chat has two — the client and us
// — and they stay what they are: how a provider names them is decided inside its
// adapter, and nothing here knows or cares.
//
// The **pre-specification is the first message**, always, and it never changes:
// that makes it part of the stable prefix, so from the second turn on the policy
// and the form's answers are read from the cache instead of being sent again.
//
// `message` is what the client has just written, and it is **optional**: on the
// opening it reads the pre-specification and asks the first question
// without anybody having written anything. A turn with no client message is a
// conversation all the same; an empty message is not turned into one.
export function conversationOf(spec, chat, message = null) {
  const entries = [{ role: "client", text: `# Pre-specification\n\n${spec}` }];
  for (const entry of chat ?? []) {
    const text = String(entry?.text ?? "");
    if (text === "") continue;
    // The chat stores `client` and `system`; towards a model the second one is
    // us having spoken, which is the `preanalyst` role of the contract.
    entries.push({ role: entry.role === "client" ? "client" : "preanalyst", text });
  }
  const written = message === null || message === undefined ? "" : String(message);
  if (written !== "") entries.push({ role: "client", text: written });
  return conversation(entries);
}

// What the model is told about the state of the conversation, as an operator
// instruction. It changes at every turn, which is exactly why it is not in the
// policy: the policy is the part that never changes. How it reaches the model —
// a system role among the messages, a marked user message, something else on a
// provider written tomorrow — is not decided here. See src/preanalyst_ai/.
//
// It carries the language too. The client writes in their own, and the reply is
// read by them: the language is not a matter of the model guessing right.
//
// `stillMissing` is the validator's answer when it has refused a `ready`: this
// engine believed it was done, a separate judgement said it was not, and these
// are the points it is sent back for. It arrives the same way as everything else
// about the state of the turn — at the end of the messages, out of the cached
// prefix.
export function operatorNote(turnsLeft, language, { stillMissing = [], opening = false } = {}) {
  const turns = turnsLeft === 1 ? "1 turn" : `${turnsLeft} turns`;
  const sentBack =
    stillMissing.length > 0
      ? `You proposed to close, and a separate check judged the pre-analysis not complete yet. Still open: ${stillMissing.join("; ")}. Do not close now: ask about whichever of these matters most.`
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

// `message` is absent on the opening, when this engine asks the first question
// before the client has written anything.
export async function ask(
  settings,
  { spec, chat, message = null, turnsLeft, language, stillMissing = [], opening = false, projectId = null },
) {
  const { policy } = settings.preanalyst.conversation;
  const instructions = await readPolicy(policy);

  // Which phase this is: the first question of the interview and an ordinary turn cost
  // different amounts and take different times, and one bucket for both would hide it.
  const phase = opening ? PREANALYSIS_OPENING : PREANALYSIS_TURN;
  const elapsed = settings.metrics.timer();
  const answer = await converse(settings.preanalyst.conversation.ai, {
    instructions,
    messages: conversationOf(spec, chat, message),
    schema: SCHEMA,
    operator: operatorNote(turnsLeft, language, { stillMissing, opening }),
  });
  // Reported here, before anything is decided about the answer: whatever the caller does
  // with it, the model ran and what it consumed is real. The checks below may turn a
  // complete answer into an unusable one for the caller; they do not change what it cost.
  reportInteraction(settings, { phase, projectId, answer, durationMs: elapsed() });
  if (!answer.ok) return answer;

  const { output } = answer;
  const text = String(output?.message ?? "").trim();
  if (text === "") {
    // The schema requires the field, so this is an empty string that satisfied
    // it: a turn with nothing to show the client is not a turn. It answered, so
    // the tokens were spent: it is `unusable` and not a failure, and the spend
    // comes back with it.
    console.error("[preanalyst] empty message");
    // It answered inside the schema and there is nothing to show the client.
    // `ai.call` has already gone out saying the provider completed, which it did:
    // this is the door's own verdict, and nothing else records it.
    reportUnusable(settings, { phase, projectId, answer, reason: "empty_message" });
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
      // The reply goes to the page as the model wrote it. It used to be cut here at
      // a ceiling of characters, which showed the client a question ending
      // mid-sentence with nothing saying it had been cut. The ceiling that is real is
      // the one the call already has: a model stopped by our `max_tokens` comes back
      // `cut`, which is one of the contract's five endings and is handled as such.
      // A second ceiling applied afterwards, by rewriting, added no protection.
      message: text,
      missing: Array.isArray(output.missing) ? output.missing.map((item) => String(item)) : [],
      ready: Boolean(output.ready),
      reason: String(output.reason ?? ""),
    },
  };
}
