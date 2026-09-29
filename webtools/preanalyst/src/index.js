// Starting the server.
//
// In the background: ./webtools_preanalyst.sh --start
// In the foreground, for debugging, with the variables of
// webtools/configurator/bootstrap.env in the environment: npm start (Ctrl+C to stop)

import { ConfigurationError } from "./commons/configuration_client.js";
import { createServer } from "./server.js";
import { loadSettings } from "./settings.js";

// The configuration is read once, here: if it is missing or wrong the server does
// not start, and the reason stays in the log.
let settings;
try {
  settings = await loadSettings();
} catch (error) {
  if (!(error instanceof ConfigurationError)) throw error;
  // Not measured: where metrics is, is itself a configuration field, and this is
  // the case where the configuration could not be read. A start that never
  // happened is counted by whoever does have the configuration — the start
  // script, which sees the exit code.
  console.error(`webtools_preanalyst is not starting: ${error.message}`);
  process.exit(1);
}
const server = createServer(settings);

server.listen(settings.port, settings.host, () => {
  // The start script waits for this line before saying the server is up.
  console.log(
    `webtools_preanalyst listening on http://${settings.host}:${settings.port} ` +
      `(anagraphics: ${settings.anagraphicsUrl})`
  );
  // A count that grows by itself is a process that keeps dying and coming back.
  settings.metrics.measure("process.started", { dims: { outcome: "ok" } });
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
