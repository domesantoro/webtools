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
// (`contesto/decision_engine_considerazioni.md` §11): you give the state and the
// admissible outputs, you get back a typed answer. Here the admissible outputs
// are a JSON schema, which the provider imposes on the model.
//
// Same contract as the anagraphics and workspaces clients — no exceptions towards
// the caller:
//
//   { ok: true, data: { output, model, usage } }
//   { ok: false, reason: "unavailable" }   the provider does not answer
//   { ok: false, reason: "rejected", usage, model }
//                                          it answered, but not with anything usable
//   { ok: false, reason: "unknown_provider" }
//
// `usage` is the tokens consumed: it is the measure of the real cost, which the
// PoC has to collect. It is not converted into money here.
//
// It is there **even when the answer is not usable**, because those tokens were
// paid for all the same: a truncated or off-schema answer costs as much as a good
// one, and a cost that is not recorded is not measured. It is missing only when
// the provider did not answer at all, which is the one case where nothing was
// spent.

import { ConfigurationError } from "../commons/configuration_client.js";
import * as anthropic from "./providers/anthropic.js";

// The providers that exist. It is an allowlist, not a directory listing: the
// configuration chooses among these, it does not name a module to load.
const PROVIDERS = { [anthropic.NAME]: anthropic };

// The `ai` settings, read at startup from the configuration document.
//   → { provider, timeoutMs, configuration }
//
// **Only the selected provider's section is read**, and therefore only that one
// must be complete: an environment that uses one provider does not have to carry
// the keys of the others. The provider reads it itself, so this function does not
// know which fields exist down there.
//
// An unknown `ai.provider` throws here, like any other wrong field: the server
// does not start. It used to start and fail on the first client's prevalidation,
// which is a configuration mistake discovered by whoever is least able to fix it.
export function loadAiSettings(configuration) {
  const provider = configuration.string("ai.provider");
  const module = PROVIDERS[provider];
  if (!module) {
    const known = Object.keys(PROVIDERS).join(", ");
    throw new ConfigurationError(
      `configuration of ${configuration.subsystem}: ai.provider must be one of ${known}, found ${JSON.stringify(provider)}`,
    );
  }
  return {
    provider,
    // The cut-off of the call, the same for every provider: it is how long the
    // user is left standing in front of a page, not a property of the model.
    timeoutMs: configuration.integer("ai.timeout_ms", { min: 1 }),
    configuration: module.readConfiguration(configuration),
  };
}

export async function decide(ai, { instructions, document, schema }) {
  const module = PROVIDERS[ai.provider];
  // `loadAiSettings` has already refused to start with an unknown provider, so
  // this is a net and not a check. It stays: the settings could be built by
  // other hands one day, and answering `unknown_provider` costs one line.
  if (!module) {
    console.error(`[ai] unknown provider: ${ai.provider}`);
    return { ok: false, reason: "unknown_provider" };
  }
  return module.decide(ai, { instructions, document, schema });
}
