// The preanalyst's AI module: the door towards the model providers, **for the chat
// only**.
//
// It is a separate structure from `src/prevalidator_ai/`, not a second entrance to it. The
// two share no file, no registry, no configuration and no client: the chat may
// run on one provider and the prevalidation on another, with two different keys
// and two different models, and neither is affected by what is done to the
// other. That is the point of having two, and it is worth the resemblance
// between the two doors.
//
// It is used twice, with two independent configurations —
// `preanalyst.conversation` and `preanalyst.validation` — because the
// engine that asks and the validator are two
// engines: one conducts the interview, the other judges whether what came out of
// the pre-analysis is complete. A model that decides on its own that its own work is
// finished is the worst judge of it.
//
// One verb, `converse()`, for both: the validator sends a conversation of one
// message, which is a conversation all the same.
//
// The contract, as everywhere else in the subsystem — no exceptions towards the
// caller:
//
// The contract — what is asked, what comes back, and in whose words — is
// `./contract.js`, this door's own. Nothing about a provider travels through
// here: not its field names, not its roles, not its reasons for stopping.

import { ConfigurationError } from "../commons/configuration_client.js";
import { check, noAnswer } from "./contract.js";
import * as anthropic from "./providers/anthropic.js";

// The providers the chat may use. Its own registry: adding one here does not add
// it to the prevalidator, and removing one there does not remove it from here.
const PROVIDERS = { [anthropic.NAME]: anthropic };

// The settings of one of the chat's engines, read from `base` — the part of the
// configuration that engine owns (`preanalyst.conversation`,
// `preanalyst.validation`).
// Only the selected provider's section is read, and an unknown provider stops
// the server at startup.
export function loadPreanalystAiSettings(configuration, base) {
  const provider = configuration.string(`${base}.provider`);
  const module = PROVIDERS[provider];
  if (!module) {
    const known = Object.keys(PROVIDERS).join(", ");
    throw new ConfigurationError(
      `configuration of ${configuration.subsystem}: ${base}.provider must be one of ${known}, found ${JSON.stringify(provider)}`,
    );
  }
  return {
    provider,
    // Longer than the prevalidation's: there the model classifies, here it
    // thinks and writes, and the client is told to wait.
    timeoutMs: configuration.integer(`${base}.timeout_ms`, { min: 1 }),
    // How many times we are willing to ask. **Ours, not the provider's**: it is
    // a decision about what we spend and about how long a client waits, so it is
    // configured here and the adapter obeys it — instead of being a number
    // inside somebody's SDK that nothing can report afterwards.
    maxAttempts: configuration.integer(`${base}.max_attempts`, { min: 1 }),
    configuration: module.readConfiguration(configuration, base),
  };
}

// `operator` is an instruction about the state of this turn — how many turns are
// left, which language to answer in, that a check sent the engine back. The
// caller says that there is one; **how it reaches the model is the provider's
// business**, because not every model has the same way of being told, and some
// have none. Nothing above this line knows which way is used.
export async function converse(ai, { instructions, messages, schema, operator }) {
  const module = PROVIDERS[ai.provider];
  // A net: loadPreanalystAiSettings has already refused to start without a known
  // provider.
  if (!module) {
    console.error(`[preanalyst_ai] unknown provider: ${ai.provider}`);
    return noAnswer({ provider: ai.provider, failure: "unknown_provider" });
  }
  // The contract is checked **here**, where the adapter hands over: an adapter
  // that drifts is caught at the door and not three files downstream, where a
  // missing field shows up only as a number that quietly stays at zero.
  return check(await module.converse(ai, { instructions, messages, schema, operator }));
}
