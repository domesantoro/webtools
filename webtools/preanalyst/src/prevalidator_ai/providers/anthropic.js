// An Anthropic adapter for this door.
//
// **An adapter belongs to one door.** A provider used by two doors is two
// adapters, with two configurations, two keys and two clients: a door is a
// question with its own model and its own consumption, and nothing here may be
// shared with another door just because the API behind it happens to be the same
// one.
//
// What crosses the door, in both directions, is this door's contract
// (`../contract.js`). Inside here: this API's field names, its reasons for
// stopping, its errors, its SDK. Outside: ours.
//
// The official SDK `@anthropic-ai/sdk` is used, not fetch by hand: the API
// contract changes, and the SDK is where that change is already written down.
//
// Three choices, all for the same reason — this is a classification, not a
// conversation:
//
// - `output_config.format` with a JSON schema: the model **cannot** answer in
//   prose. Nothing to interpret, nothing to repair
//   (`decision_engine_considerations.md` §10, typed outputs);
// - the thinking and the token ceiling are the configuration's business, not
//   this file's: `effort` says how much the model may reason and `max_tokens`
//   how much room it has to do it in. A classifying model and a thinking one
//   want different numbers, and which one is in use is a configured value;
// - the instructions (the policy) go in the `system` with `cache_control`,
//   because they never change from one call to the next. Whether it does
//   anything depends on the configured model: the cache has a minimum prefix,
//   and under it the marker is accepted and silently ignored
//   (`cache_creation_input_tokens: 0`) — entry 8 of
//   `contesto/optimisations.md`.
//
// It reads its own fields under whatever section it is pointed at, and receives
// them back in `decide()`. Nobody upstream knows which fields a provider needs,
// which is what lets another provider ask for different ones.
//
// The model and the token limit live in the configuration, the timeout is shared
// by every provider. The key comes from the secrets
// (`configurator/secrets/preanalyst.json`), merged into the configuration: here
// it is a field like any other.

import Anthropic from "@anthropic-ai/sdk";

import { ConfigurationError } from "../../commons/configuration_client.js";
import { answered, noAnswer, unusable } from "../contract.js";

export const NAME = "anthropic";

// What this provider counts, in its own words. Declared so that the
// configuration which declares them can be checked against something, and so
// that nothing above this file has to contain the list.
export const SPEND_KINDS = Object.freeze(["input", "output", "cache_write", "cache_read"]);

// How much the model may think before answering, and therefore how many tokens
// it spends — on the models that have the notion at all. Not all of them do, which
// is why the configuration may leave it out: see readConfiguration.
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

// What this provider needs in order to work, read from the configuration
// document with the usual accessors: no default values, and a missing field
// throws ConfigurationError before the server is up. It is read **only if this
// provider is the selected one**, so an environment that uses another one does
// not have to carry an Anthropic key it would never use.
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
    // stops the answer half way, and a cut answer is spent and thrown away.
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
      // The retries are ours, in `decide`: a retry inside the library is tokens
      // and a delay that never reach anybody's numbers.
      maxRetries: 0,
    });
  }
  return client;
}

// This API's failures in the contract's words. `status` is the HTTP code the SDK
// carries on its errors; the name is what it uses when there was no answer to
// have a code.
function failureOf(error) {
  const status = error?.status;
  if (status === 401 || status === 403) return "unauthorised";
  if (status === 429) return "rate_limited";
  if (status === 408 || /timeout/i.test(error?.name ?? "") || /timeout/i.test(error?.message ?? "")) {
    return "timed_out";
  }
  return "unreachable";
}

// Asking again is worth it only when asking again might answer: a wrong key
// stays wrong.
const WORTH_RETRYING = new Set(["timed_out", "rate_limited", "unreachable"]);

function spendOf(response) {
  const usage = response.usage ?? {};
  return {
    kinds: {
      input: usage.input_tokens ?? 0,
      output: usage.output_tokens ?? 0,
      cache_write: usage.cache_creation_input_tokens ?? 0,
      cache_read: usage.cache_read_input_tokens ?? 0,
    },
  };
}

export async function decide(ai, { instructions, document, schema }) {
  const configuration = ai.configuration;

  let attempts = 0;
  let response = null;
  let failure = null;
  while (attempts < ai.maxAttempts) {
    attempts += 1;
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
      failure = null;
      break;
    } catch (error) {
      failure = failureOf(error);
      console.error(`[prevalidator_ai/anthropic] attempt ${attempts}: ${error.name}: ${error.message} → ${failure}`);
      if (!WORTH_RETRYING.has(failure)) break;
    }
  }

  if (response === null) {
    return noAnswer({ provider: NAME, failure, attempts });
  }

  // From here on the provider has answered, so the tokens have been spent:
  // whatever goes wrong, the spend travels back together with the outcome.
  const model = response.model ?? configuration.model;
  const outcome = {
    provider: NAME,
    model,
    spend: spendOf(response),
    attempts,
    fellBack: model !== configuration.model,
  };

  // The model may stop before it has finished (`max_tokens`) or refuse to
  // answer: in both cases there is no decision, and pretending there is one is
  // worse than saying there is none. They are two different facts and they are
  // reported as two.
  if (response.stop_reason === "max_tokens") {
    console.error("[prevalidator_ai/anthropic] answer cut short by max_tokens");
    return unusable({ ...outcome, ended: "cut" });
  }
  if (response.stop_reason === "refusal") {
    console.error("[prevalidator_ai/anthropic] the model refused");
    return unusable({ ...outcome, ended: "refused" });
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
    return unusable({ ...outcome, ended: "unusable" });
  }

  return answered({ ...outcome, output });
}
