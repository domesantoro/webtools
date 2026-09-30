// Settings, read at startup from the `projects-hub` configuration in anagraphics
// (webtools/configurator/configuration/projects-hub.json). No default values: if a
// field is missing, loadSettings throws ConfigurationError and the server does not
// start.

import { ConfigurationError, loadConfiguration } from "./commons/configuration_client.js";
import { loadI18n } from "./commons/i18n/webtools_i18n.js";
import { loadMetrics } from "./commons/metrics/webtools_metrics_client.js";

export async function loadSettings() {
  const configuration = await loadConfiguration("projects-hub");
  const minPercentage = configuration.integer("links.discount.min_percentage", { min: 1, max: 100 });
  const maxPercentage = configuration.integer("links.discount.max_percentage", { min: 1, max: 100 });
  if (minPercentage > maxPercentage) {
    // A range that is not one offers no percentage at all, and the page would show a
    // select with nothing in it. Refusing to start is the same answer the client gives
    // to a field that is missing: a configuration nobody can act on stops us here,
    // where the reason is written, instead of downstream where it is a puzzle.
    throw new ConfigurationError(
      `links.discount: min_percentage (${minPercentage}) is above max_percentage (${maxPercentage})`
    );
  }
  return {
    host: configuration.string("listen.host"),
    port: configuration.port("listen.port"),
    // Where the measurements go. Nothing waits for it: see
    // src/commons/metrics/webtools_metrics_client.js.
    metrics: loadMetrics(configuration),
    // The projects, the drivers and their discount codes. The requests start from this
    // server and not from the browser: anagraphics only answers callers from known IPs.
    // The address is the one the configuration came from.
    anagraphicsUrl: configuration.anagraphicsUrl,
    anagraphicsTimeoutMs: configuration.integer("subsystems_infos.anagraphics.timeout_ms", { min: 1 }),
    // Our address as seen from outside: the browser comes back to it after the login,
    // and it is what we declare to the sso when exchanging the ticket.
    publicUrl: configuration.httpUrl("public_url"),
    // The sso: login, session state, logout. See src/commons/sso_client.js.
    ssoUrl: configuration.httpUrl("subsystems_infos.sso.url"),
    ssoTimeoutMs: configuration.integer("subsystems_infos.sso.timeout_ms", { min: 1 }),
    // Where the two documents of an analysis are stored. We read them and hand them to
    // the person: workspaces sits behind its own pool of IPs and knows nothing about
    // who is asking.
    workspacesUrl: configuration.httpUrl("subsystems_infos.workspaces.url"),
    workspacesTimeoutMs: configuration.integer("subsystems_infos.workspaces.timeout_ms", { min: 1 }),
    // Where a driver's links point: the pre-analysis form. Only the address is needed —
    // nothing is asked of that subsystem, the link is a string. `httpUrl` because the
    // value ends up in an href.
    preanalystUrl: configuration.httpUrl("subsystems_infos.preanalyst.url"),
    // Where what has to be said to a person is handed over. The client is told here
    // when a driver closes their request: the decision is the driver's and they are at
    // the screen, the person who has to hear about it is not.
    commCenterUrl: configuration.httpUrl("subsystems_infos.comm_center.url"),
    commCenterTimeoutMs: configuration.integer("subsystems_infos.comm_center.timeout_ms", { min: 1 }),
    // **Our** session cookie. The name must differ from the sso's and from the other
    // subsystems': cookies ignore the port, so on 127.0.0.1 they all end up in the same
    // pile and two cookies with the same name overwrite each other.
    cookieName: configuration.string("session.cookie_name"),
    // How much of the price a driver may give away with a link. It is a commercial
    // parameter somebody sets, and it is configuration for that reason — unlike which
    // level may see other people's stopped projects, which is an authorisation rule and
    // lives in the code that applies it (src/projects.js).
    discount: { minPercentage, maxPercentage },
    // The largest body accepted by the forms: making a link, changing language, and
    // deciding about an analysis — which is the one that carries prose, and the reason
    // this number is not a few hundred bytes.
    bodyMaxBytes: configuration.integer("limits.body_max_bytes", { min: 1 }),
    // How long the motivation of a refusal may be. It is a limit on a sentence somebody
    // has to read, so it is counted in characters and not in bytes: the same sentence in
    // two languages would otherwise be two different lengths. The body limit above is
    // the other one, and it is about what a request weighs.
    rejectionReasonMaxChars: configuration.integer("limits.rejection_reason_max_chars", { min: 1 }),
    // Languages, catalogues and the language cookie: see src/commons/i18n/webtools_i18n.js.
    i18n: loadI18n(configuration),
  };
}
