// Avvio del server.
//
// In background: ./webtools_sso.sh --start
// In primo piano, per debug: npm start   (Ctrl+C per fermarlo)

import { createServer } from "./server.js";
import { loadSettings } from "./settings.js";

const settings = loadSettings();
const server = createServer(settings);

server.listen(settings.port, settings.host, () => {
  // Lo script di avvio aspetta questa riga per dire che il server è su.
  console.log(
    `webtools_sso in ascolto su http://${settings.host}:${settings.port} ` +
      `(anagraphics: ${settings.anagraphicsUrl}, sessioni: ${settings.sessionTtlSeconds}s)`
  );
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
