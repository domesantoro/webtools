// The Anthropic provider: one single call, with the output bound to a schema.
//
// The official SDK `@anthropic-ai/sdk` is used, not fetch by hand: the API
// contract changes, and the SDK is where that change is already written down.
//
// Three choices, all for the same reason — this is a classification, not a
// conversation:
//
// - `output_config.format` with a JSON schema: the model **cannot** answer in
//   prose. Nothing to interpret, nothing to repair
//   (`decision_engine_considerazioni.md` §10, typed outputs);
// - no thinking and a low `max_tokens`: there is nothing to reason about at
//   length;
// - the instructions (the policy) go in the `system` with `cache_control`,
//   because they never change from one call to the next. **Today it does
//   nothing**: this model's cache starts at 4096 tokens of prefix and the policy
//   is shorter, so the marker is accepted and silently ignored
//   (`cache_creation_input_tokens: 0`). It stays written because it costs
//   nothing, and because a longer policy, or a different model, makes it work
//   without touching anything — entry 8 of `contesto/ottimizzazioni.md`.
//
// This file is the only one that names `anthropic`: it reads its own section of
// the configuration in `readConfiguration()` and receives it back in `decide()`.
// Nobody upstream knows which fields a provider needs, which is what lets a
// second provider ask for different ones.
//
// The model and the token limit live in the configuration, the timeout is shared
// by every provider. The key comes from the secrets
// (`configurator/secrets/preanalyst.json`), merged into the configuration: here
// it is a field like any other.

import Anthropic from "@anthropic-ai/sdk";

export const NAME = "anthropic";

// What this provider needs in order to work, read from the configuration
// document with the usual accessors: no default values, and a missing field
// throws ConfigurationError before the server is up. It is read **only if this
// provider is the selected one**, so an environment that uses another one does
// not have to carry an Anthropic key it would never spend.
export function readConfiguration(configuration) {
  return {
    model: configuration.string("ai.providers.anthropic.model"),
    maxTokens: configuration.integer("ai.providers.anthropic.max_tokens", { min: 1 }),
    apiKey: configuration.string("ai.providers.anthropic.api_key"),
  };
}

// One client per process: it keeps the connections open, and recreating it on
// every request would mean redoing the TLS handshake every time.
let client = null;

function clientOf(ai) {
  if (client === null) {
    client = new Anthropic({
      apiKey: ai.configuration.apiKey,
      timeout: ai.timeoutMs,
      // Retries are the SDK's business (429 and 5xx). Two are enough: beyond
      // that, the user is waiting in front of a page that is not moving.
      maxRetries: 2,
    });
  }
  return client;
}

export async function decide(ai, { instructions, document, schema }) {
  const configuration = ai.configuration;

  let response;
  try {
    response = await clientOf(ai).messages.create({
      model: configuration.model,
      max_tokens: configuration.maxTokens,
      system: [{ type: "text", text: instructions, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: document }],
      output_config: { format: { type: "json_schema", schema } },
    });
  } catch (error) {
    console.error(`[ai/anthropic] ${error.name}: ${error.message}`);
    return { ok: false, reason: "unavailable" };
  }

  // From here on the provider has answered, so the tokens have been spent:
  // whatever goes wrong, `usage` travels back together with the error.
  const usage = {
    input_tokens: response.usage?.input_tokens ?? 0,
    output_tokens: response.usage?.output_tokens ?? 0,
  };

  // The model may stop before it has finished (`max_tokens`) or refuse to
  // answer: in both cases there is no decision, and pretending there is one is
  // worse than saying there is none.
  if (response.stop_reason === "max_tokens" || response.stop_reason === "refusal") {
    console.error(`[ai/anthropic] answer cut short: stop_reason ${response.stop_reason}`);
    return { ok: false, reason: "rejected", usage, model: response.model };
  }

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  let output;
  try {
    output = JSON.parse(text);
  } catch {
    console.error("[ai/anthropic] answer is not JSON, despite the schema");
    return { ok: false, reason: "rejected", usage, model: response.model };
  }

  return { ok: true, data: { output, model: response.model, usage } };
}
