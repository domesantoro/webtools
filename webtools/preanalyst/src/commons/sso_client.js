// Shared code: how a subsystem talks to webtools_sso.
//
// DO NOT EDIT THE COPY INSIDE A SUBSYSTEM.
// The original is `webtools/commons/sso/sso_client.js`; the copies are distributed
// by `webtools/configurator/sso_deployer/deploy.sh`, as for commons.css.
//
// Nothing about authentication is decided here: this file knows **how to ask**.
// Verifying passwords, holding sessions and judging expiries is the sso's job.
//
// The full round trip, for whoever reads this file for the first time:
//
//   1. the user is not logged in → the browser is sent to `loginUrl(next)`;
//   2. the sso shows its login page, the only one in the system;
//   3. once done, it sends the browser back to the subsystem with `?ticket=…` in
//      the address;
//   4. the subsystem calls `claimTicket()` **server to server** and receives the
//      session, then sets its own cookie and strips the ticket from the address;
//   5. from then on every request carries the cookie, and `currentSession()` says
//      who it is.
//
// The ticket is needed because a cookie belongs to one address only: the sso
// cannot set one on our behalf. And the session token never travels through the
// address, because it lasts hours and the address ends up in history and in logs:
// the ticket travels there instead, and it is good once and for one minute.
//
// The subsystem must have these settings:
//
//   ssoUrl        the sso address, e.g. "http://127.0.0.1:9300"
//   ssoTimeoutMs  how long to wait for an answer
//   cookieName    the name of its **own** cookie: it must differ from the sso's
//                 and from the other subsystems', because cookies ignore the port
//                 and on 127.0.0.1 they all end up in the same pile (two cookies
//                 with the same name overwrite each other)
//   publicUrl     its own public address, e.g. "http://127.0.0.1:9200": it is what
//                 is declared to the sso when the ticket is exchanged

/* -------------------------------------------------------------- requests */

async function request(settings, path, { method = "GET", body, token } = {}) {
  const url = `${settings.ssoUrl}${path}`;
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(settings.ssoTimeoutMs),
    });
  } catch (error) {
    console.error(`[sso-client] ${method} ${path}: ${error.name} ${error.message}`);
    return { ok: false, reason: "unavailable" };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    console.error(`[sso-client] ${method} ${path}: response is not JSON (HTTP ${response.status})`);
    return { ok: false, reason: "unavailable" };
  }

  if (response.ok) return { ok: true, data: payload };
  console.error(`[sso-client] ${method} ${path}: HTTP ${response.status} ${payload?.error ?? "?"}`);
  return { ok: false, reason: "unavailable", code: payload?.error };
}

/* --------------------------------------------------------------- cookie */

export function readCookie(request, name) {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const piece of header.split(";")) {
    const separator = piece.indexOf("=");
    if (separator === -1) continue;
    if (piece.slice(0, separator).trim() === name) {
      return decodeURIComponent(piece.slice(separator + 1).trim());
    }
  }
  return null;
}

// HttpOnly: the page's JavaScript cannot read it.
// SameSite=Lax: it is not attached to requests starting from another site, except
// ordinary navigation through a link.
// No Secure because there is no HTTPS on localhost: outside here it must be added.
export function sessionCookie(settings, token, maxAgeSeconds) {
  return `${settings.cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(
    0,
    maxAgeSeconds
  )}`;
}

export function clearSessionCookie(settings) {
  return `${settings.cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/* ------------------------------------------------------------- addresses */

function withNext(settings, path, next) {
  return `${settings.ssoUrl}${path}?next=${encodeURIComponent(next)}`;
}

export function loginUrl(settings, next) {
  return withNext(settings, "/ui/login", next);
}

export function logoutUrl(settings, next) {
  return withNext(settings, "/ui/logout", next);
}

export function registerUrl(settings, next) {
  return withNext(settings, "/ui/register", next);
}

/* --------------------------------------------------------------- session */

// Who is asking for this page.
//
//   { ok: true, logged: false }            no cookie, or the session is no longer valid
//   { ok: true, logged: true, session }    valid session
//   { ok: false, reason: "unavailable" }   the sso does not answer: **we do not know**
//
// The last case is not to be confused with "not logged in": treating it as a
// logout would throw everybody out at every sso failure.
export async function currentSession(settings, httpRequest) {
  const token = readCookie(httpRequest, settings.cookieName);
  if (!token) return { ok: true, logged: false };

  const result = await request(settings, "/session", { token });
  if (!result.ok) return result;
  return { ok: true, logged: Boolean(result.data.logged), session: result.data.session ?? null };
}

// Exchanges the ticket the sso put in the address. Server to server: the browser
// never sees this call.
export async function claimTicket(settings, ticket) {
  const result = await request(settings, "/tickets/exchange", {
    method: "POST",
    body: { ticket, service: settings.publicUrl },
  });
  if (!result.ok) return result;
  return { ok: true, logged: Boolean(result.data.logged), session: result.data.session ?? null };
}

// The language chosen with the pages' switcher, for whoever has logged in: the
// sso puts it in the session and in the profile, so the next login finds it again.
// Without a session cookie there is nothing to save: the language stays in the
// shared cookie, which the caller writes.
//
//   { ok: true, logged }                   done, or the session is no longer valid
//   { ok: false, reason: "unavailable" }   the sso does not answer
export async function saveSessionLocale(settings, httpRequest, locale) {
  const token = readCookie(httpRequest, settings.cookieName);
  if (!token) return { ok: true, logged: false };

  const result = await request(settings, "/session/locale", { method: "POST", body: { locale }, token });
  if (!result.ok) return result;
  return { ok: true, logged: Boolean(result.data.logged) };
}

/* ------------------------------------------------ coming back from login */

export function ticketFrom(url) {
  return url.searchParams.get("ticket");
}

// The same address without the ticket: the browser is sent there right after the
// exchange, so the ticket stays neither in the address bar nor in the history, and
// reloading the page does not try to use it again.
export function urlWithoutTicket(settings, url) {
  const clean = new URL(url);
  clean.searchParams.delete("ticket");
  return `${settings.publicUrl}${clean.pathname}${clean.search}`;
}
