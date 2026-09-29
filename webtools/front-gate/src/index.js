// Starting the server.
//
// In the background: ./webtools_front_gate.sh --start
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
  console.error(`webtools_front_gate is not starting: ${error.message}`);
  process.exit(1);
}
const server = createServer(settings);

server.listen(settings.port, settings.host, () => {
  // The start script waits for this line before saying the server is up.
  console.log(`webtools_front_gate listening on http://${settings.host}:${settings.port}`);
  // A start that worked. The ones that did not are the lines above, where there is no
  // configuration yet and so nowhere to send a measurement: a subsystem that cannot
  // read its configuration cannot report that it could not.
  settings.metrics.measure("process.started", { dims: { outcome: "ok" } });
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
