// The sso's HTTP server: the routes for programs, the pages for people.
//
// For programs (JSON, server-to-server calls):
//   POST /login              { username, password }         → 201 { logged, session }
//   GET  /session            Authorization: Bearer <token>  → 200 { logged, session? }
//   POST /logout             Authorization: Bearer <token>  → 200 { logged: false }
//   POST /tickets/exchange   { ticket, service }            → 200 { logged, session? }
//   POST /session/locale     Authorization: Bearer <token>, { locale } → 200 { logged, session? }
//
// For people (HTML, opened by the browser):
//   GET  /ui/login?next=…    the page with username and password
//   POST /ui/login           the form above
//   GET  /ui/logout?next=…   closes the session and goes back
//   GET  /ui/register?next=… registration, which is not active yet
//   POST /locale             changes the language (shared cookie) and returns to the page
//
// The JSON routes' errors follow the project's contract: correct HTTP status and a
// stable code, { "error": "<CODE>" }. The pages, on the other hand, speak to
// people, so they answer with HTML even when something goes wrong.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { exchangeTicket, issueTicket, login, logout, readSession, setLocale } from "./auth.js";
import { renderLoginPage, renderRegisterPage } from "./page.js";
import { safeNext } from "./settings.js";
import { serviceOf, withTicket } from "./tickets.js";

export const MISSING_TOKEN = "MISSING_TOKEN";
export const INVALID_BODY = "INVALID_BODY";
export const INVALID_LOCALE = "INVALID_LOCALE";
export const ROUTE_NOT_FOUND = "ROUTE_NOT_FOUND";
export const METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED";
export const IP_NOT_ALLOWED = "IP_NOT_ALLOWED";
export const INTERNAL_ERROR = "INTERNAL_ERROR";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

/* ------------------------------------------------------------- risposte */

function sendJson(response, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    // The sso's responses are not cached anywhere.
    "cache-control": "no-store",
    ...headers,
  });
  response.end(body);
}

function sendError(response, status, code) {
  sendJson(response, status, { error: code });
}

function sendHtml(response, status, html, headers = {}) {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(html),
    "cache-control": "no-store",
    ...headers,
  });
  response.end(html);
}

function redirect(response, location, headers = {}) {
  response.writeHead(303, { location, "cache-control": "no-store", ...headers });
  response.end();
}

/* -------------------------------------------------------------- cookie */

// The sso's cookie says that *this browser* has already logged in. It is what
// keeps the second subsystem from asking for the password: it is the "single" part
// of single sign-on.
//
// HttpOnly: a page's JavaScript cannot read it.
// SameSite=Lax: it is not attached to requests starting from another site, except
// ordinary navigation through a link.
// No Secure because there is no HTTPS on localhost: outside here it must be added.
function setCookie(name, value, maxAgeSeconds) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, maxAgeSeconds)}`;
}

function clearCookie(name) {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function readCookie(request, name) {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const piece of header.split(";")) {
    const separatore = piece.indexOf("=");
    if (separatore === -1) continue;
    if (piece.slice(0, separatore).trim() === name) {
      return decodeURIComponent(piece.slice(separatore + 1).trim());
    }
  }
  return null;
}

/* ------------------------------------------------------------- richiesta */

// Reads the request body. It returns { ok, raw } and does not throw. A sane login
// body fits in a few hundred bytes: past `maxBytes` (limits.body_max_bytes of the
// configuration) the connection is closed.
async function readBody(request, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) return { ok: false };
    chunks.push(chunk);
  }
  if (size === 0) return { ok: false };
  return { ok: true, raw: Buffer.concat(chunks).toString("utf8") };
}

async function readJsonBody(request, maxBytes) {
  const body = await readBody(request, maxBytes);
  if (!body.ok) return { ok: false };
  try {
    const data = JSON.parse(body.raw);
    if (data === null || typeof data !== "object" || Array.isArray(data)) return { ok: false };
    return { ok: true, data };
  } catch {
    return { ok: false };
  }
}

// The HTML form sends the fields as `a=1&b=2`, not as JSON.
async function readFormBody(request, maxBytes) {
  const body = await readBody(request, maxBytes);
  if (!body.ok) return { ok: false };
  return { ok: true, data: Object.fromEntries(new URLSearchParams(body.raw)) };
}

// The token is in the `Authorization: Bearer <token>` header, not in the URL: a
// URL ends up in proxy logs and in the history, a header does not.
function bearerToken(request) {
  const header = request.headers.authorization ?? "";
  const match = /^Bearer (\S+)$/.exec(header.trim());
  return match ? match[1] : null;
}

function reply(response, result) {
  if (result.ok) return sendJson(response, result.status, result.body);
  return sendError(response, result.status, result.code);
}

/* ------------------------------------------------- routes for programs */

async function handleLogin(request, response, settings, client) {
  const body = await readJsonBody(request, settings.bodyMaxBytes);
  if (!body.ok) return sendError(response, 400, INVALID_BODY);

  const { username, password } = body.data;
  if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
    return sendError(response, 400, INVALID_BODY);
  }

  return reply(response, await login(settings, { username, password }, client));
}

async function handleSession(request, response, settings, client) {
  const token = bearerToken(request);
  // With no token there is no question to answer: it is the call that is badly
  // made, not the session that is missing.
  if (!token) return sendError(response, 400, MISSING_TOKEN);
  return reply(response, await readSession(settings, token, client));
}

async function handleLogout(request, response, settings, client) {
  const token = bearerToken(request);
  if (!token) return sendError(response, 400, MISSING_TOKEN);
  return reply(response, await logout(settings, token, client));
}

async function handleExchange(request, response, settings, client) {
  const body = await readJsonBody(request, settings.bodyMaxBytes);
  if (!body.ok) return sendError(response, 400, INVALID_BODY);

  const { ticket, service } = body.data;
  if (typeof ticket !== "string" || typeof service !== "string" || !ticket || !service) {
    return sendError(response, 400, INVALID_BODY);
  }

  return reply(response, await exchangeTicket(settings, { ticket, service }, client));
}

// Another subsystem's language switcher, for whoever has logged in: the language
// goes into the session and into the profile. Only the languages offered.
async function handleSessionLocale(request, response, settings, client) {
  const token = bearerToken(request);
  if (!token) return sendError(response, 400, MISSING_TOKEN);
  const body = await readJsonBody(request, settings.bodyMaxBytes);
  if (!body.ok) return sendError(response, 400, INVALID_BODY);
  const { locale } = body.data;
  if (typeof locale !== "string" || !settings.i18n.locales.includes(locale)) {
    return sendError(response, 400, INVALID_LOCALE);
  }
  return reply(response, await setLocale(settings, token, locale, client));
}

/* --------------------------------------------------- pages for people */

// An open session plus a return address: it issues the ticket and sends the
// browser back. It is the point at which the session passes from this address to
// the subsystem's.
async function returnWithTicket(response, settings, client, ui, token, next, cookieHeader) {
  const service = serviceOf(next);
  const issued = await issueTicket(settings, token, service, client);
  if (!issued.ok) {
    const html = renderLoginPage(ui, { next, error: "unavailable" });
    return sendHtml(response, 503, html, cookieHeader ? { "set-cookie": cookieHeader } : {});
  }
  const location = withTicket(next, issued.body.ticket);
  return redirect(response, location, cookieHeader ? { "set-cookie": cookieHeader } : {});
}

async function showLoginPage(request, response, settings, client, url) {
  const next = safeNext(settings, url.searchParams.get("next"));
  const ui = settings.i18n.pageContext(request, url, { returnTo: `/ui/login?next=${encodeURIComponent(next)}` });

  // Already logged in from another subsystem: the password is not asked for again,
  // the ticket is issued and we go back. This is the "single" part of the sign-on.
  const token = readCookie(request, settings.cookieName);
  if (token) {
    const state = await readSession(settings, token, client);
    if (state.ok && state.body.logged) {
      return returnWithTicket(response, settings, client, ui, token, next, null);
    }
  }

  return sendHtml(response, 200, renderLoginPage(ui, { next }));
}

async function handleLoginForm(request, response, settings, client, url) {
  const body = await readFormBody(request, settings.bodyMaxBytes);
  const campi = body.ok ? body.data : {};
  const next = safeNext(settings, campi.next ?? url.searchParams.get("next"));
  const username = typeof campi.username === "string" ? campi.username : "";
  const password = typeof campi.password === "string" ? campi.password : "";
  // Changing language reopens the page with a GET: the `next` goes into the
  // address, because here it arrived in the form's body. Always the one already
  // checked.
  const ui = settings.i18n.pageContext(request, url, {
    returnTo: `/ui/login?next=${encodeURIComponent(next)}`,
  });

  if (!username || !password) {
    return sendHtml(response, 400, renderLoginPage(ui, { next, username, error: "invalid_credentials" }));
  }

  // The login page's language: if the profile has none, it becomes theirs.
  const locale = settings.i18n.localeOf(request);
  const entrato = await login(settings, { username, password, locale }, client);
  if (!entrato.ok) {
    const error = entrato.status === 401 ? "invalid_credentials" : "unavailable";
    // The username stays written, the password does not: it is typed again.
    return sendHtml(response, entrato.status, renderLoginPage(ui, { next, username, error }));
  }

  // Two cookies: the sso session and the session's language, which may be the
  // profile's and therefore different from the one we arrived with.
  const session = entrato.body.session;
  const cookies = [setCookie(settings.cookieName, session.token, settings.sessionTtlSeconds)];
  if (session.data?.locale) cookies.push(settings.i18n.cookie(session.data.locale));
  return returnWithTicket(response, settings, client, ui, session.token, next, cookies);
}

async function handleLogoutPage(request, response, settings, client, url) {
  const next = safeNext(settings, url.searchParams.get("next"));
  const token = readCookie(request, settings.cookieName);

  if (token) {
    // It closes the shared session: from here on no subsystem recognises that
    // token any more. "Esci" must really log you out.
    const uscito = await logout(settings, token, client);
    if (!uscito.ok) {
      // Store down: we remove the cookie anyway, but the session stays alive until
      // it expires. It is to be looked at, not hidden.
      console.error("[sso] logout with no store: the session stays open until it expires");
    }
  }

  return redirect(response, next, { "set-cookie": clearCookie(settings.cookieName) });
}

function showRegisterPage(request, response, settings, client, url) {
  const next = safeNext(settings, url.searchParams.get("next"));
  const ui = settings.i18n.pageContext(request, url, { returnTo: `/ui/register?next=${encodeURIComponent(next)}` });
  return sendHtml(response, 200, renderRegisterPage(ui, { next }));
}

// The language switcher, in the header of every page. It writes the shared cookie
// and returns to the page it started from: the other subsystems read the same
// cookie, so they change language too on the next page.
async function handleLocale(request, response, settings, client) {
  const change = await settings.i18n.readChange(request);
  if (!change.ok) return sendError(response, change.status, change.code);
  // Whoever has logged in finds it again at the next login. If the store does not
  // answer the language changes anyway: the cookie is enough for the pages.
  const token = readCookie(request, settings.cookieName);
  if (token) {
    const saved = await setLocale(settings, token, change.locale, client);
    if (!saved.ok) console.error("[sso] language not saved in the session and in the profile");
  }
  return redirect(response, change.location, { "set-cookie": change.cookie });
}

/* --------------------------------------------------------------- statici */

async function serveStatic(pathname, response) {
  // Only files inside public/: path.normalize strips the "..".
  const relative = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  const file = path.join(PUBLIC_DIR, relative);
  // An attempt to escape public/ with "..": to the caller it is as if the file did
  // not exist.
  if (!file.startsWith(PUBLIC_DIR)) return sendError(response, 404, ROUTE_NOT_FOUND);

  let info;
  try {
    info = await stat(file);
  } catch {
    return sendError(response, 404, ROUTE_NOT_FOUND);
  }
  if (!info.isFile()) return sendError(response, 404, ROUTE_NOT_FOUND);

  response.writeHead(200, {
    "content-type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
    "content-length": info.size,
  });
  createReadStream(file).pipe(response);
}

/* ---------------------------------------------------------------- routes */

const ROUTES = {
  "/login": { POST: handleLogin },
  "/session": { GET: handleSession },
  "/logout": { POST: handleLogout },
  "/tickets/exchange": { POST: handleExchange },
  "/session/locale": { POST: handleSessionLocale },
  "/ui/login": { GET: showLoginPage, POST: handleLoginForm },
  "/ui/logout": { GET: handleLogoutPage },
  "/ui/register": { GET: showRegisterPage },
  "/locale": { POST: handleLocale },
};

// `client` is passed only in the tests, so as not to depend on anagraphics running.
export function createServer(settings, client) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);

    // The IP pool comes before everything: somebody not in the pool does not even
    // learn which routes exist. Only the connection's IP counts.
    // Listening on IPv6 the same address arrives as "::ffff:127.0.0.1": it is the
    // same IP written another way, not another caller.
    const remote = (request.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
    if (!settings.allowedIps.includes(remote)) {
      console.warn(`[sso] request from an IP outside the pool: ${remote}`);
      return sendError(response, 403, IP_NOT_ALLOWED);
    }

    try {
      const route = ROUTES[url.pathname];
      if (route) {
        const handler = route[request.method];
        if (!handler) return sendError(response, 405, METHOD_NOT_ALLOWED);
        return await handler(request, response, settings, client, url);
      }

      // Not a route: it may be one of the pages' static files.
      if (request.method !== "GET") return sendError(response, 405, METHOD_NOT_ALLOWED);
      return await serveStatic(url.pathname, response);
    } catch (error) {
      console.error(`[sso] error on ${request.method} ${url.pathname}: ${error.stack ?? error}`);
      if (!response.headersSent) sendError(response, 500, INTERNAL_ERROR);
    }
  });
}
