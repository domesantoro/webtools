// Settings, read at startup from the `configurator-fe` configuration in
// anagraphics (webtools/configurator/configuration/configurator-fe.json). No
// default values: if a field is missing, loadSettings throws ConfigurationError
// and the server does not start.

import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfiguration } from "./commons/configuration_client.js";
import { loadMetrics } from "./commons/metrics/webtools_metrics_client.js";

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
    // The currencies the price of a provider's tokens may be written in. A list,
    // not a guess: which currencies are worth offering is a decision, and a
    // dropdown built from a list in the code would be that decision taken here.
    // A currency already stored is offered as well, whether it is in this list or
    // not: see currencyOptions in src/providers.js.
    currencies: configuration.stringList("pricing.currencies"),
    // The form that writes a price is the only body this server reads. The
    // ceiling is configured because a body's size is a limit, and limits are
    // configured.
    pricingBodyMaxBytes: configuration.integer("pricing.body_max_bytes", { min: 1 }),
    // The metrics client. The configuration has said where metrics is and what to do
    // with a failed send since this subsystem was written, and the deployer has been
    // putting a copy of the client in src/commons/metrics/ all along: what was
    // missing was this line, so a declared subsystem sent nothing. It is the back
    // office where prices are changed, which is the one place that produces the fact
    // every other figure is read against.
    metrics: loadMetrics(configuration),
  };
}
