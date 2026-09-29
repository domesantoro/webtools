// The preanalyst's AI module: a single door towards the model providers.
//
// The caller asks for a **decision** and gets back an object that respects a
// schema. It does not know which provider is behind it, and sees neither prompts
// nor HTTP: that lives in the providers.
//
// Nothing outside `providers/` names a provider, the registry below excepted.
// A provider declares for itself what it needs from the configuration
// (`readConfiguration`), and receives back exactly that and nothing else
// (`decide`): the shape of a provider's configuration is the provider's own
// business, which is what lets the second one ask for different fields from the
// first. Adding one is a file in `providers/`, a line in the registry, and the
// value of `ai.provider` in the configuration.
//
// The shape is that of the decision engine's conceptual API
// (`contesto/decision_engine_considerations.md` §11): you give the state and the
// admissible outputs, you get back a typed answer. Here the admissible outputs
// are a JSON schema, which the provider imposes on the model.
//
// The contract — what is asked, what comes back, and in whose words — is
// `./contract.js`, this door's own. Nothing about a provider travels through
// here: not its field names, not its roles, not its reasons for stopping.
//
// `spend` is the tokens consumed, by kind. It is there **even when the answer is
// not usable**, because the model ran all the same: a truncated or off-schema
// answer spends as much as a good one, and a consumption that is not recorded is
// not measured. It is missing only when the provider did not answer at all, which
// is the one case where nothing was spent.

import { ConfigurationError } from "../commons/configuration_client.js";
import { check, noAnswer } from "./contract.js";
import * as anthropic from "./providers/anthropic.js";

// The providers that exist. It is an allowlist, not a directory listing: the
// configuration chooses among these, it does not name a module to load.
const PROVIDERS = { [anthropic.NAME]: anthropic };

// The settings of this engine, read at startup from `base` — the part of the
// configuration document this engine owns. Which part that is, is the caller's
// to say and not this module's to assume.
//   → { provider, timeoutMs, configuration }
//
// **Only the selected provider's section is read**, and therefore only that one
// must be complete: an environment that uses one provider does not have to carry
// the keys of the others. The provider reads it itself, so this function does not
// know which fields exist down there.
//
// An unknown provider throws here, like any other wrong field: the server does
// not start. It used to start and fail on the first client's prevalidation,
// which is a configuration mistake discovered by whoever is least able to fix it.
export function loadPrevalidatorAiSettings(configuration, base) {
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
    // The cut-off of the call, the same for every provider: it is how long the
    // user is left standing in front of a page, not a property of the model.
    timeoutMs: configuration.integer(`${base}.timeout_ms`, { min: 1 }),
    // How many times we are willing to ask. Ours, not the provider's: it is a
    // decision about what we spend, so it is configured here and the adapter
    // obeys it, instead of being a number inside somebody's SDK.
    maxAttempts: configuration.integer(`${base}.max_attempts`, { min: 1 }),
    configuration: module.readConfiguration(configuration, base),
  };
}

export async function decide(ai, { instructions, document, schema }) {
  const module = PROVIDERS[ai.provider];
  // `loadPrevalidatorAiSettings` has already refused to start with an unknown provider, so
  // this is a net and not a check. It stays: the settings could be built by
  // other hands one day, and answering `unknown_provider` costs one line.
  if (!module) {
    console.error(`[prevalidator_ai] unknown provider: ${ai.provider}`);
    return noAnswer({ provider: ai.provider, failure: "unknown_provider" });
  }
  // Checked here, where the adapter hands over: a drift is caught at the door.
  return check(await module.decide(ai, { instructions, document, schema }));
}
