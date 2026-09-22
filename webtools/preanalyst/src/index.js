// Avvio del server.
//
// In background: ./webtools_preanalyst.sh --start
// In primo piano, per debug, con le variabili di webtools/configurator/bootstrap.env
// nell'ambiente: npm start   (Ctrl+C per fermarlo)

import { ConfigurationError } from "./commons/configuration_client.js";
import { createServer } from "./server.js";
import { loadSettings } from "./settings.js";

// La configurazione si legge una volta, qui: se manca o è sbagliata il server
// non parte, e il motivo resta nel log.
let settings;
try {
  settings = await loadSettings();
} catch (error) {
  if (!(error instanceof ConfigurationError)) throw error;
  console.error(`webtools_preanalyst non parte: ${error.message}`);
  process.exit(1);
}
const server = createServer(settings);

server.listen(settings.port, settings.host, () => {
  // Lo script di avvio aspetta questa riga per dire che il server è su.
  console.log(
    `webtools_preanalyst in ascolto su http://${settings.host}:${settings.port} ` +
      `(anagraphics: ${settings.anagraphicsUrl})`
  );
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
