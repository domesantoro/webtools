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
// - the thinking and the token ceiling are the configuration's business, not
//   this file's: `effort` says how much the model may reason and `max_tokens`
//   how much room it has to do it in. A classifying model and a thinking one
//   want different numbers, and which one is in use is a configured value;
// - the instructions (the policy) go in the `system` with `cache_control`,
//   because they never change from one call to the next. Whether it does
//   anything depends on the configured model: the cache has a minimum prefix,
//   and under it the marker is accepted and silently ignored
//   (`cache_creation_input_tokens: 0`) — entry 8 of
//   `contesto/ottimizzazioni.md`.
//
// This file is the only one that names `anthropic`: it reads its own fields under
// whatever section it is pointed at, and receives them back in `decide()`.
// Nobody upstream knows which fields a provider needs, which is what lets a
// second provider ask for different ones.
//
// The model and the token limit live in the configuration, the timeout is shared
// by every provider. The key comes from the secrets
// (`configurator/secrets/preanalyst.json`), merged into the configuration: here
// it is a field like any other.

import Anthropic from "@anthropic-ai/sdk";

import { ConfigurationError } from "../../commons/configuration_client.js";

export const NAME = "anthropic";

// How much the model may think before answering, and therefore how much it
// spends — on the models that have the notion at all. Not all of them do, which
// is why the configuration may leave it out: see readConfiguration.
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

// What this provider needs in order to work, read from the configuration
// document with the usual accessors: no default values, and a missing field
// throws ConfigurationError before the server is up. It is read **only if this
// provider is the selected one**, so an environment that uses another one does
// not have to carry an Anthropic key it would never spend.
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
  return {
    model: configuration.string(`${path}.model`),
    // The ceiling of the answer, **thinking included**. On a model that thinks
    // it is not the size of the decision: a ceiling cut to the size of the JSON
    // stops the answer half way, and a cut answer is paid for and thrown away.
    maxTokens: configuration.integer(`${path}.max_tokens`, { min: 1 }),
    effort,
    apiKey: configuration.string(`${path}.api_key`),
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
      output_config: {
        format: { type: "json_schema", schema },
        // Nothing travels when nothing was configured: a field left out and a
        // field set to a value the code chose are not the same thing.
        ...(configuration.effort === undefined ? {} : { effort: configuration.effort }),
      },
    });
  } catch (error) {
    console.error(`[prevalidator_ai/anthropic] ${error.name}: ${error.message}`);
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
    console.error(`[prevalidator_ai/anthropic] answer cut short: stop_reason ${response.stop_reason}`);
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
    console.error("[prevalidator_ai/anthropic] answer is not JSON, despite the schema");
    return { ok: false, reason: "rejected", usage, model: response.model };
  }

  return { ok: true, data: { output, model: response.model, usage } };
}
