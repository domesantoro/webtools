// Il modulo IA del preanalyst: una porta sola verso i fornitori di modelli.
//
// Chi chiama chiede una **decisione** e riceve un oggetto che rispetta uno
// schema. Non sa quale fornitore c'è dietro, non vede prompt né HTTP: quello
// sta nei provider. Aggiungere un fornitore è un file in providers/ più una
// riga nella configurazione (`ai.provider`), e chi chiama non si tocca.
//
// La forma è quella dell'API concettuale del decision engine
// (`contesto/decision_engine_considerazioni.md` §11): si dà lo stato e gli
// output ammessi, si riceve una risposta tipizzata. Qui gli output ammessi sono
// uno schema JSON, che il fornitore impone al modello.
//
// Stesso contratto dei client di anagraphics e workspaces — niente eccezioni
// verso chi chiama:
//
//   { ok: true, data: { output, model, usage } }
//   { ok: false, reason: "unavailable" }   il fornitore non risponde
//   { ok: false, reason: "rejected", usage, model }
//                                          ha risposto, ma non una cosa usabile
//   { ok: false, reason: "unknown_provider" }
//
// `usage` sono i token consumati: è la misura del costo reale, che il PoC deve
// raccogliere. Non si converte in denaro qui.
//
// C'è **anche quando la risposta non è usabile**, perché quei token sono stati
// pagati comunque: una risposta troncata o fuori schema costa come una buona, e
// un costo che non si registra non si misura. Manca solo quando il fornitore non
// ha risposto affatto, che è l'unico caso in cui non si è speso niente.

import { decide as anthropic } from "./providers/anthropic.js";

const PROVIDERS = { anthropic };

export async function decide(settings, { instructions, document, schema }) {
  const provider = PROVIDERS[settings.ai.provider];
  if (!provider) {
    console.error(`[ai] fornitore sconosciuto: ${settings.ai.provider}`);
    return { ok: false, reason: "unknown_provider" };
  }
  return provider(settings, { instructions, document, schema });
}
