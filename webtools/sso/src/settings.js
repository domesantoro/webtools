// Settings, read at startup from the `sso` configuration in anagraphics
// (webtools/configurator/configuration/sso.json). No default values: if a field is
// missing, loadSettings throws ConfigurationError and the server does not start.

import { loadConfiguration } from "./commons/configuration_client.js";
import { loadI18n } from "./commons/i18n/webtools_i18n.js";

export async function loadSettings() {
  const configuration = await loadConfiguration("sso");
  return {
    host: configuration.string("listen.host"),
    port: configuration.port("listen.port"),
    // An internal subsystem: it answers only callers from the pool's IPs. It is a
    // check on the connection's IP, not an authorisation: it says where the
    // request comes from, not on whose behalf.
    allowedIps: configuration.stringList("access.allowed_ips"),
    // Users, credentials, sessions and tickets all live there: the sso has no
    // database. The address is the one the configuration came from.
    anagraphicsUrl: configuration.anagraphicsUrl,
    anagraphicsTimeoutMs: configuration.integer("subsystems_infos.anagraphics.timeout_ms", { min: 1 }),
    // How long a session lasts, from the login. It does not extend itself on every
    // read: somebody who logged in eight hours ago logs in again, even if they have
    // been working all day.
    sessionTtlSeconds: configuration.integer("session.ttl_seconds", { min: 1 }),
    // The sso's cookie: it tells this server that the browser has already logged
    // in, so the second subsystem does not ask for the password again. The name
    // must differ from the subsystems': cookies ignore the port, so on 127.0.0.1
    // they all sit in the same pile and two cookies with the same name would
    // overwrite each other.
    cookieName: configuration.string("session.cookie_name"),
    // The ticket lives as long as a redirect, no longer.
    ticketTtlSeconds: configuration.integer("ticket.ttl_seconds", { min: 1 }),
    // Where the browser may be sent back to after the login. Without this list,
    // anybody could build a link `…/ui/login?next=http://fake-site` and use our
    // login page as a springboard.
    allowedNext: configuration.httpUrlList("login.allowed_next"),
    // The largest body accepted by login, ticket exchange and forms.
    bodyMaxBytes: configuration.integer("limits.body_max_bytes", { min: 1 }),
    // Languages, catalogues and the language cookie: see src/commons/i18n/webtools_i18n.js.
    i18n: loadI18n(configuration),
  };
}

// The address to return to after the login is decided by whoever sent us here, so
// it is not trusted: it must start with one of the allowed addresses. If it does
// not, we go back to the first of the list, and the fact ends up in the log.
export function safeNext(settings, next) {
  const fallback = settings.allowedNext[0] ?? "/";
  if (!next) return fallback;
  const allowed = settings.allowedNext.some(
    (base) => next === base || next.startsWith(`${base}/`)
  );
  if (allowed) return next;
  console.warn(`[sso] next outside the allowed addresses, ignored: ${next}`);
  return fallback;
}
