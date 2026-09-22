// Impostazioni, lette all'avvio dalla configurazione `front-gate` in anagraphics
// (webtools/configurator/configuration/front-gate.json). Niente valori di
// default: se manca un campo, loadSettings lancia ConfigurationError e il server
// non parte.

import { loadConfiguration } from "./commons/configuration_client.js";
import { loadI18n } from "./commons/i18n/webtools_i18n.js";

export async function loadSettings() {
  const configuration = await loadConfiguration("front-gate");
  return {
    host: configuration.string("listen.host"),
    port: configuration.port("listen.port"),
    // Il tasto "Inizia" porta al form della pre-analisi. Solo http(s): il valore
    // finisce in un href, e un `javascript:` lì dentro sarebbe codice eseguito al clic.
    preanalystUrl: configuration.httpUrl("subsystems_infos.preanalyst.url"),
    // Il prezzo del tier standard, in centesimi di euro come ogni importo.
    standardPriceCents: configuration.integer("screen_infos.pricing.standard_price_cents", { min: 0 }),
    // Lingue, cataloghi e cookie della lingua: vedi src/commons/i18n/webtools_i18n.js.
    i18n: loadI18n(configuration),
  };
}
