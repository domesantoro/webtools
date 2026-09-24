// Settings, read at startup from the `front-gate` configuration in anagraphics
// (webtools/configurator/configuration/front-gate.json). No default values: if a
// field is missing, loadSettings throws ConfigurationError and the server does not
// start.

import { loadConfiguration } from "./commons/configuration_client.js";
import { loadI18n } from "./commons/i18n/webtools_i18n.js";

export async function loadSettings() {
  const configuration = await loadConfiguration("front-gate");
  return {
    host: configuration.string("listen.host"),
    port: configuration.port("listen.port"),
    // The "Inizia" button leads to the pre-analysis form. Only http(s): the value
    // ends up in an href, and a `javascript:` in there would be code run on click.
    preanalystUrl: configuration.httpUrl("subsystems_infos.preanalyst.url"),
    // The standard tier's price, in euro cents like every amount.
    standardPriceCents: configuration.integer("screen_infos.pricing.standard_price_cents", { min: 0 }),
    // Languages, catalogues and the language cookie: see src/commons/i18n/webtools_i18n.js.
    i18n: loadI18n(configuration),
  };
}
