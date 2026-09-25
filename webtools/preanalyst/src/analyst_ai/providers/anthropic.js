// The analyst's Anthropic provider.
//
// **It is not the prevalidator's provider.** `src/prevalidator_ai/providers/anthropic.js` is
// another file, with another configuration, another key and another client, and
// neither knows the other exists: the chat can run on one provider and the
// prevalidation on a different one. The two look alike because they talk to the
// same SDK, not because they are the same thing — and they are free to drift
// apart without anybody having to disentangle them first.
//
// What this one does that the other does not: it sends a **conversation**, not a
// single document, and it carries an optional operator instruction.
//
// The choices:
//
// - `output_config.format` with a JSON schema: the answer is typed even though
//   part of it is prose for the client. The message and what the model believes
//   is still missing come back in the same object, and nothing has to be parsed
//   out of free text;
// - **adaptive thinking**, left at the model's discretion: on this family it is
//   on unless it is asked not to be, and `output_config.effort` is the dial. A
//   conversation is not a long agentic task, so the configuration starts at
//   `medium` rather than at the default;
// - the policy in the `system` with `cache_control`: here the cache **works**,
//   unlike in the prevalidation. The conversation is re-sent whole at every turn
//   and the prefix does not change, so from the second turn on the policy and
//   the pre-specification are read from the cache;
// - `refusal` fallbacks: a declined request is re-run on another model inside the
//   same call, instead of leaving the client in front of a chat that stopped.
//
// **The operator instruction is realised here, and only here.** The caller says
// *that* there is an instruction about the state of the turn; how it reaches the
// model is this provider's business, because it is not the same everywhere — and
// not even the same across this provider's own models. `operator_channel` says
// which way to use:
//
//   system_message  a `system` role inside the conversation. Opus 5 and the
//                   families that accept it: the instruction changes at every
//                   turn, and this way it sits after the cached prefix instead of
//                   invalidating it.
//   user_message    an ordinary user message, marked as coming from the operator.
//                   Everything else — Sonnet 5, Haiku, and whatever a provider
//                   written tomorrow can do. The cache is invalidated less
//                   cleverly, and it works.
//
// A model that does not take a `system` role among the messages answers 400, not
// something slightly worse: the channel is a fact about the model, so it is
// configuration and not a guess made from the model's name.

import Anthropic from "@anthropic-ai/sdk";

import { ConfigurationError } from "../../commons/configuration_client.js";

export const NAME = "anthropic";

// How much the model may think, and therefore how much it spends — on the models
// that have the notion at all. Not all of them do, which is why the configuration
// may leave it out: see readConfiguration.
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

// How an operator instruction reaches this model. See the header.
const CHANNELS = ["system_message", "user_message"];

export function readConfiguration(configuration, base) {
  const path = `${base}.providers.${NAME}`;
  // **Optional, and absent is not a default.** `effort` does not exist on every
  // model — Haiku 4.5 answers an error if it is sent — so the field that says how
  // much to think cannot be required of a configuration that may be pointing at
  // a model that has no such notion. Left out, nothing is sent and the model does
  // what it does; written, it must be one of the levels, because a typo there is
  // a typo either way.
  const effort = configuration.get(`${path}.effort`);
  if (effort !== undefined && !EFFORTS.includes(effort)) {
    throw new ConfigurationError(
      `configuration of ${configuration.subsystem}: ${path}.effort, when it is there, must be one of ${EFFORTS.join(", ")}, found ${JSON.stringify(effort)}`,
    );
  }
  const channel = configuration.string(`${path}.operator_channel`);
  if (!CHANNELS.includes(channel)) {
    throw new ConfigurationError(
      `configuration of ${configuration.subsystem}: ${path}.operator_channel must be one of ${CHANNELS.join(", ")}, found ${JSON.stringify(channel)}`,
    );
  }
  return {
    model: configuration.string(`${path}.model`),
    operatorChannel: channel,
    // The ceiling of the answer, thinking included: it is not what gets spent,
    // it is what may be spent before the answer is cut short.
    maxTokens: configuration.integer(`${path}.max_tokens`, { min: 1 }),
    effort,
    apiKey: configuration.string(`${path}.api_key`),
  };
}

// One client per key and timeout, not one per process: the conversation and the
// validation are two separate configurations and may carry two different keys.
// A single shared client would silently give the second one the first one's key.
const clients = new Map();

function clientOf(ai) {
  const key = `${ai.configuration.apiKey}\u0000${ai.timeoutMs}`;
  if (!clients.has(key)) {
    clients.set(
      key,
      new Anthropic({
        apiKey: ai.configuration.apiKey,
        timeout: ai.timeoutMs,
        maxRetries: 2,
      }),
    );
  }
  return clients.get(key);
}

// The operator instruction, put where this model can read it. Either way it goes
// **after** the conversation, so what precedes it stays byte for byte what the
// previous turn cached.
function withOperator(messages, operator, channel) {
  if (!operator) return messages;
  if (channel === "system_message") return [...messages, { role: "system", content: operator }];
  // Said out loud, because in this channel it arrives as if the client had
  // written it, and it must not be mistaken for something they said.
  return [...messages, { role: "user", content: `[Operator instruction, not from the client]\n${operator}` }];
}

export async function converse(ai, { instructions, messages, schema, operator }) {
  const configuration = ai.configuration;
  const conversation = withOperator(messages, operator, configuration.operatorChannel);

  let response;
  try {
    response = await clientOf(ai).beta.messages.create({
      model: configuration.model,
      max_tokens: configuration.maxTokens,
      system: [{ type: "text", text: instructions, cache_control: { type: "ephemeral" } }],
      messages: conversation,
      // Caches the last cacheable block as well, which at every turn is the
      // conversation up to here: the turn writes a cache covering the whole
      // history and reads the one the previous turn wrote. The operator
      // instruction sits after it, which is why it is a message and not the
      // system — it changes every turn and would otherwise invalidate all of it.
      cache_control: { type: "ephemeral" },
      output_config: {
        format: { type: "json_schema", schema },
        // Nothing travels when nothing was configured: a field left out and a
        // field set to a value the code chose are not the same thing.
        ...(configuration.effort === undefined ? {} : { effort: configuration.effort }),
      },
      // A refusal is re-run on another model inside the same call. Without it a
      // declined message simply stops, and what stops is a client's chat.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
  } catch (error) {
    console.error(`[analyst_ai/anthropic] ${error.name}: ${error.message}`);
    return { ok: false, reason: "unavailable" };
  }

  // From here on the tokens have been spent, whatever happens next.
  const usage = {
    input_tokens: response.usage?.input_tokens ?? 0,
    output_tokens: response.usage?.output_tokens ?? 0,
    cache_creation_input_tokens: response.usage?.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: response.usage?.cache_read_input_tokens ?? 0,
  };

  if (response.stop_reason === "max_tokens" || response.stop_reason === "refusal") {
    const details = response.stop_details?.category ? ` (${response.stop_details.category})` : "";
    console.error(`[analyst_ai/anthropic] answer cut short: ${response.stop_reason}${details}`);
    return { ok: false, reason: "rejected", usage, model: response.model };
  }

  // Thinking blocks come back too, with their text empty: only the text blocks
  // carry the answer.
  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  let output;
  try {
    output = JSON.parse(text);
  } catch {
    console.error("[analyst_ai/anthropic] answer is not JSON, despite the schema");
    return { ok: false, reason: "rejected", usage, model: response.model };
  }

  return { ok: true, data: { output, model: response.model, usage } };
}
