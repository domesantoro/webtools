// Il provider Anthropic: una chiamata sola, con l'uscita vincolata a uno schema.
//
// Si usa l'SDK ufficiale `@anthropic-ai/sdk`, non fetch a mano: il contratto
// dell'API cambia, e l'SDK è il posto dove quel cambiamento è già scritto.
//
// Tre scelte, tutte per lo stesso motivo — questa è una classificazione, non una
// conversazione:
//
// - `output_config.format` con uno schema JSON: il modello **non può** rispondere
//   in prosa. Niente da interpretare, niente da riparare
//   (`decision_engine_considerazioni.md` §10, output tipizzati);
// - niente thinking e `max_tokens` basso: non c'è niente da ragionare a lungo;
// - le istruzioni (la policy) vanno nel `system` con `cache_control`, perché non
//   cambiano mai da una chiamata all'altra. **Oggi non serve a niente**: la cache
//   di questo modello parte da 4096 token di prefisso e la policy ne fa circa
//   1300, quindi il marcatore viene accettato e ignorato in silenzio
//   (`cache_creation_input_tokens: 0`). Resta scritto perché non costa e perché
//   una policy più lunga, o un modello diverso, lo fanno funzionare senza
//   toccare niente — voce 8 di `contesto/ottimizzazioni.md`.
//
// Il modello, il limite di token e il timeout stanno in configurazione. La
// chiave arriva dai segreti (`configurator/secrets/preanalyst.json`), fusi nella
// configurazione: qui è un campo come gli altri.

import Anthropic from "@anthropic-ai/sdk";

// Un client per processo: tiene le connessioni aperte, e ricrearlo a ogni
// richiesta vuol dire rifare la stretta di mano TLS ogni volta.
let client = null;

function clientOf(settings) {
  if (client === null) {
    client = new Anthropic({
      apiKey: settings.ai.providers.anthropic.apiKey,
      timeout: settings.ai.timeoutMs,
      // I tentativi li gestisce l'SDK (429 e 5xx). Due bastano: oltre, l'utente
      // sta aspettando davanti a una pagina ferma.
      maxRetries: 2,
    });
  }
  return client;
}

export async function decide(settings, { instructions, document, schema }) {
  const configurazione = settings.ai.providers.anthropic;

  let response;
  try {
    response = await clientOf(settings).messages.create({
      model: configurazione.model,
      max_tokens: configurazione.maxTokens,
      system: [{ type: "text", text: instructions, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: document }],
      output_config: { format: { type: "json_schema", schema } },
    });
  } catch (error) {
    console.error(`[ai/anthropic] ${error.name}: ${error.message}`);
    return { ok: false, reason: "unavailable" };
  }

  // Da qui in poi il fornitore ha risposto, quindi i token sono stati spesi:
  // qualunque cosa vada storta, `usage` torna indietro insieme all'errore.
  const usage = {
    input_tokens: response.usage?.input_tokens ?? 0,
    output_tokens: response.usage?.output_tokens ?? 0,
  };

  // Il modello può fermarsi prima di aver finito (`max_tokens`) o rifiutare di
  // rispondere: in tutti e due i casi non c'è una decisione, e fingere che ci
  // sia è peggio che dire che non c'è.
  if (response.stop_reason === "max_tokens" || response.stop_reason === "refusal") {
    console.error(`[ai/anthropic] risposta interrotta: stop_reason ${response.stop_reason}`);
    return { ok: false, reason: "rejected", usage, model: response.model };
  }

  const testo = response.content
    .filter((blocco) => blocco.type === "text")
    .map((blocco) => blocco.text)
    .join("");

  let output;
  try {
    output = JSON.parse(testo);
  } catch {
    console.error("[ai/anthropic] risposta non JSON, nonostante lo schema");
    return { ok: false, reason: "rejected", usage, model: response.model };
  }

  return { ok: true, data: { output, model: response.model, usage } };
}
