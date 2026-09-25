// Settings, read at startup from the `configurator-fe` configuration in
// anagraphics (webtools/configurator/configuration/configurator-fe.json). No
// default values: if a field is missing, loadSettings throws ConfigurationError
// and the server does not start.

import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfiguration } from "./commons/configuration_client.js";

// The subsystem's own directory: a relative path in the configuration is resolved
// from here, so the same value works on every machine the repository is cloned on.
const ROOT = fileURLToPath(new URL("../", import.meta.url));

export async function loadSettings() {
  const configuration = await loadConfiguration("configurator-fe");
  return {
    host: configuration.string("listen.host"),
    port: configuration.port("listen.port"),
    // An internal tool: it answers only callers from the pool's IPs. It is a check
    // on the connection's IP, not an authorisation: it says where the request
    // comes from, not on whose behalf.
    allowedIps: configuration.stringList("access.allowed_ips"),
    // Every configuration is read from there: the list of the subsystems that
    // exist is in Mongo, not here. The address is the one the configuration came
    // from.
    anagraphicsUrl: configuration.anagraphicsUrl,
    anagraphicsTimeoutMs: configuration.integer("subsystems_infos.anagraphics.timeout_ms", { min: 1 }),
    // Where the secrets' files are (webtools/configurator/secrets/). They are not
    // read for their values: what is read is **which paths** they hold, because
    // those are the paths that load_configuration.sh deep-merges into the
    // configuration, and which the page therefore shows masked. A path that is not
    // absolute is resolved from this subsystem's directory.
    secretsDirectory: path.resolve(ROOT, configuration.string("secrets.directory")),
  };
}
