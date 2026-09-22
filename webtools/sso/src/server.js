// Server HTTP del sso: le rotte per i programmi, le pagine per le persone.
//
// Per i programmi (JSON, chiamate da server a server):
//   POST /login              { username, password }         → 201 { logged, session }
//   GET  /session            Authorization: Bearer <token>  → 200 { logged, session? }
//   POST /logout             Authorization: Bearer <token>  → 200 { logged: false }
//   POST /tickets/exchange   { ticket, service }            → 200 { logged, session? }
//   POST /session/locale     Authorization: Bearer <token>, { locale } → 200 { logged, session? }
//
// Per le persone (HTML, aperte dal browser):
//   GET  /ui/login?next=…    la pagina con username e password
//   POST /ui/login           il form di sopra
//   GET  /ui/logout?next=…   chiude la sessione e torna indietro
//   GET  /ui/register?next=… la registrazione, che non è ancora attiva
//   POST /locale             cambia la lingua (cookie comune) e torna alla pagina
//
// Gli errori delle rotte JSON seguono il contratto del progetto: stato HTTP
// corretto e codice stabile, { "error": "<CODICE>" }. Le pagine invece parlano
// alle persone, quindi rispondono con HTML anche quando qualcosa va storto.

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
    // Le risposte del sso non si conservano da nessuna parte.
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

// Il cookie del sso dice che *questo browser* è già entrato. Serve perché il
// secondo sottosistema non richieda la password: è la parte "single" del
// single sign-on.
//
// HttpOnly: il JavaScript di una pagina non può leggerlo.
// SameSite=Lax: non viene allegato alle richieste che partono da un altro sito,
// tranne la normale navigazione con un link.
// Niente Secure perché su localhost non c'è HTTPS: fuori di qui va aggiunto.
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

// Legge il corpo della richiesta. Restituisce { ok, raw } e non lancia.
// Un corpo di login sano sta in poche centinaia di byte: oltre `maxBytes`
// (limits.body_max_bytes della configurazione) si chiude.
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

// Il form HTML manda i campi come `a=1&b=2`, non come JSON.
async function readFormBody(request, maxBytes) {
  const body = await readBody(request, maxBytes);
  if (!body.ok) return { ok: false };
  return { ok: true, data: Object.fromEntries(new URLSearchParams(body.raw)) };
}

// Il token sta nell'header `Authorization: Bearer <token>`, non nell'URL: un URL
// finisce nei log dei proxy e nella cronologia, un header no.
function bearerToken(request) {
  const header = request.headers.authorization ?? "";
  const match = /^Bearer (\S+)$/.exec(header.trim());
  return match ? match[1] : null;
}

function reply(response, result) {
  if (result.ok) return sendJson(response, result.status, result.body);
  return sendError(response, result.status, result.code);
}

/* --------------------------------------------------- rotte per i programmi */

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
  // Senza token non c'è una domanda a cui rispondere: è la chiamata a essere
  // fatta male, non la sessione a essere assente.
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

// Il selettore della lingua di un altro sottosistema, per chi è entrato: la
// lingua va nella sessione e nel profilo. Solo le lingue offerte.
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

/* ----------------------------------------------------- pagine per le persone */

// Sessione aperta più indirizzo di ritorno: emette il biglietto e rimanda
// indietro il browser. È il punto in cui la sessione passa da questo indirizzo
// a quello del sottosistema.
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

  // Già entrato da un altro sottosistema: non si richiede la password, si emette
  // il biglietto e si torna indietro. Questa è la parte "single" del sign-on.
  const token = readCookie(request, settings.cookieName);
  if (token) {
    const stato = await readSession(settings, token, client);
    if (stato.ok && stato.body.logged) {
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
  // Il cambio di lingua riapre la pagina con un GET: il `next` va nell'indirizzo,
  // perché qui arrivava nel corpo del form. Sempre quello già verificato.
  const ui = settings.i18n.pageContext(request, url, {
    returnTo: `/ui/login?next=${encodeURIComponent(next)}`,
  });

  if (!username || !password) {
    return sendHtml(response, 400, renderLoginPage(ui, { next, username, error: "invalid_credentials" }));
  }

  // La lingua della pagina di login: se il profilo non ne ha una, diventa la sua.
  const locale = settings.i18n.localeOf(request);
  const entrato = await login(settings, { username, password, locale }, client);
  if (!entrato.ok) {
    const error = entrato.status === 401 ? "invalid_credentials" : "unavailable";
    // Lo username resta scritto, la password no: si ridigita.
    return sendHtml(response, entrato.status, renderLoginPage(ui, { next, username, error }));
  }

  // Due cookie: la sessione del sso e la lingua della sessione, che può essere
  // quella del profilo e quindi diversa da quella con cui si è arrivati.
  const session = entrato.body.session;
  const cookies = [setCookie(settings.cookieName, session.token, settings.sessionTtlSeconds)];
  if (session.data?.locale) cookies.push(settings.i18n.cookie(session.data.locale));
  return returnWithTicket(response, settings, client, ui, session.token, next, cookies);
}

async function handleLogoutPage(request, response, settings, client, url) {
  const next = safeNext(settings, url.searchParams.get("next"));
  const token = readCookie(request, settings.cookieName);

  if (token) {
    // Chiude la sessione condivisa: da qui in avanti nessun sottosistema
    // riconosce più quel token. "Esci" deve far uscire davvero.
    const uscito = await logout(settings, token, client);
    if (!uscito.ok) {
      // Archivio giù: il cookie lo togliamo lo stesso, ma la sessione resta viva
      // fino alla scadenza. Va guardato, non nascosto.
      console.error("[sso] logout senza archivio: la sessione resta aperta fino alla scadenza");
    }
  }

  return redirect(response, next, { "set-cookie": clearCookie(settings.cookieName) });
}

function showRegisterPage(request, response, settings, client, url) {
  const next = safeNext(settings, url.searchParams.get("next"));
  const ui = settings.i18n.pageContext(request, url, { returnTo: `/ui/register?next=${encodeURIComponent(next)}` });
  return sendHtml(response, 200, renderRegisterPage(ui, { next }));
}

// Il selettore della lingua, in testata su ogni pagina. Scrive il cookie comune
// e torna alla pagina da cui è partito: gli altri sottosistemi leggono lo stesso
// cookie, quindi cambiano lingua anche loro alla prossima pagina.
async function handleLocale(request, response, settings, client) {
  const change = await settings.i18n.readChange(request);
  if (!change.ok) return sendError(response, change.status, change.code);
  // Chi è entrato se la ritrova al prossimo login. Se l'archivio non risponde
  // la lingua cambia lo stesso: il cookie basta per le pagine.
  const token = readCookie(request, settings.cookieName);
  if (token) {
    const salvata = await setLocale(settings, token, change.locale, client);
    if (!salvata.ok) console.error("[sso] lingua non salvata nella sessione e nel profilo");
  }
  return redirect(response, change.location, { "set-cookie": change.cookie });
}

/* --------------------------------------------------------------- statici */

async function serveStatic(pathname, response) {
  // Solo file dentro public/: path.normalize toglie i "..".
  const relative = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  const file = path.join(PUBLIC_DIR, relative);
  // Tentativo di uscire da public/ con dei "..": per chi chiama è come se il
  // file non esistesse.
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

/* ----------------------------------------------------------------- rotte */

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

// `client` si passa solo nei test, per non dipendere da anagraphics acceso.
export function createServer(settings, client) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);

    // Il pool di IP sta prima di tutto: chi non è nel pool non impara nemmeno
    // quali rotte esistono. Conta solo l'IP della connessione.
    // In ascolto su IPv6 lo stesso indirizzo arriva come "::ffff:127.0.0.1":
    // è lo stesso IP scritto in un altro modo, non un altro chiamante.
    const remote = (request.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
    if (!settings.allowedIps.includes(remote)) {
      console.warn(`[sso] richiesta da IP fuori dal pool: ${remote}`);
      return sendError(response, 403, IP_NOT_ALLOWED);
    }

    try {
      const route = ROUTES[url.pathname];
      if (route) {
        const handler = route[request.method];
        if (!handler) return sendError(response, 405, METHOD_NOT_ALLOWED);
        return await handler(request, response, settings, client, url);
      }

      // Non è una rotta: può essere uno dei file statici delle pagine.
      if (request.method !== "GET") return sendError(response, 405, METHOD_NOT_ALLOWED);
      return await serveStatic(url.pathname, response);
    } catch (error) {
      console.error(`[sso] errore su ${request.method} ${url.pathname}: ${error.stack ?? error}`);
      if (!response.headersSent) sendError(response, 500, INTERNAL_ERROR);
    }
  });
}
