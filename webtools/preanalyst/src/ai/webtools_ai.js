// The preanalyst's AI module: a single door towards the model providers.
//
// The caller asks for a **decision** and gets back an object that respects a
// schema. It does not know which provider is behind it, and sees neither prompts
// nor HTTP: that lives in the providers. Adding a provider is one file in
// providers/ plus one line of configuration (`ai.provider`), and the caller is
// left alone.
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

import { decide as anthropic } from "./providers/anthropic.js";

const PROVIDERS = { anthropic };

export async function decide(settings, { instructions, document, schema }) {
  const provider = PROVIDERS[settings.ai.provider];
  if (!provider) {
    console.error(`[ai] unknown provider: ${settings.ai.provider}`);
    return { ok: false, reason: "unknown_provider" };
  }
  return provider(settings, { instructions, document, schema });
}
