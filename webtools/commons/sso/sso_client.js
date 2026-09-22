// Codice condiviso: come un sottosistema parla con webtools_sso.
//
// NON MODIFICARE LA COPIA DENTRO UN SOTTOSISTEMA.
// L'originale è `webtools/commons/sso/sso_client.js`; le copie le distribuisce
// `webtools/configurator/sso_deployer/deploy.sh`, come per commons.css.
//
// Qui non si decide niente sull'autenticazione: si sa **come chiedere**. Chi
// verifica le password, chi tiene le sessioni e chi giudica le scadenze è il sso.
//
// Il giro completo, per chi legge questo file per la prima volta:
//
//   1. l'utente non è loggato → si manda il browser a `loginUrl(next)`;
//   2. il sso mostra la sua pagina di login, l'unica del sistema;
//   3. finito, rimanda il browser al sottosistema con `?ticket=…` nell'indirizzo;
//   4. il sottosistema chiama `claimTicket()` **da server a server** e riceve la
//      sessione, poi si mette il proprio cookie e toglie il biglietto dall'indirizzo;
//   5. da lì in poi ogni richiesta porta il cookie, e `currentSession()` dice chi è.
//
// Serve il biglietto perché un cookie appartiene a un indirizzo solo: il sso non
// può metterne uno per conto nostro. E il token della sessione non passa mai
// dall'indirizzo, perché dura ore e l'indirizzo finisce nella cronologia e nei log:
// ci passa il biglietto, che vale una volta sola e per un minuto.
//
// Il sottosistema deve avere queste impostazioni:
//
//   ssoUrl        indirizzo del sso, es. "http://127.0.0.1:8300"
//   ssoTimeoutMs  quanto si aspetta una risposta
//   cookieName    nome del **proprio** cookie: deve essere diverso da quello del
//                 sso e da quello degli altri sottosistemi, perché i cookie
//                 ignorano la porta e su 127.0.0.1 finiscono tutti nello stesso
//                 mucchio (due cookie con lo stesso nome si sovrascrivono)
//   publicUrl     il proprio indirizzo pubblico, es. "http://127.0.0.1:8200":
//                 è quello che si dichiara al sso quando si scambia il biglietto

/* ------------------------------------------------------------- richieste */

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
    console.error(`[sso-client] ${method} ${path}: risposta non JSON (HTTP ${response.status})`);
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
    const separatore = piece.indexOf("=");
    if (separatore === -1) continue;
    if (piece.slice(0, separatore).trim() === name) {
      return decodeURIComponent(piece.slice(separatore + 1).trim());
    }
  }
  return null;
}

// HttpOnly: il JavaScript della pagina non può leggerlo.
// SameSite=Lax: non viene allegato alle richieste che partono da un altro sito,
// tranne la normale navigazione con un link.
// Niente Secure perché su localhost non c'è HTTPS: fuori di qui va aggiunto.
export function sessionCookie(settings, token, maxAgeSeconds) {
  return `${settings.cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(
    0,
    maxAgeSeconds
  )}`;
}

export function clearSessionCookie(settings) {
  return `${settings.cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/* ------------------------------------------------------------- indirizzi */

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

/* -------------------------------------------------------------- sessione */

// Chi sta chiedendo questa pagina.
//
//   { ok: true, logged: false }            nessun cookie, o sessione non più valida
//   { ok: true, logged: true, session }    sessione valida
//   { ok: false, reason: "unavailable" }   il sso non risponde: **non lo sappiamo**
//
// L'ultimo caso non va confuso con "non è loggato": trattarlo come un logout
// butterebbe fuori tutti a ogni guasto del sso.
export async function currentSession(settings, httpRequest) {
  const token = readCookie(httpRequest, settings.cookieName);
  if (!token) return { ok: true, logged: false };

  const result = await request(settings, "/session", { token });
  if (!result.ok) return result;
  return { ok: true, logged: Boolean(result.data.logged), session: result.data.session ?? null };
}

// Scambia il biglietto che il sso ha messo nell'indirizzo. Da server a server:
// il browser non vede mai questa chiamata.
export async function claimTicket(settings, ticket) {
  const result = await request(settings, "/tickets/exchange", {
    method: "POST",
    body: { ticket, service: settings.publicUrl },
  });
  if (!result.ok) return result;
  return { ok: true, logged: Boolean(result.data.logged), session: result.data.session ?? null };
}

// La lingua scelta con il selettore delle pagine, per chi è entrato: il sso la
// mette nella sessione e nel profilo, così il login successivo la ritrova.
// Senza cookie di sessione non c'è niente da salvare: la lingua resta nel
// cookie comune, che scrive chi chiama.
//
//   { ok: true, logged }                   fatto, oppure sessione non più valida
//   { ok: false, reason: "unavailable" }   il sso non risponde
export async function saveSessionLocale(settings, httpRequest, locale) {
  const token = readCookie(httpRequest, settings.cookieName);
  if (!token) return { ok: true, logged: false };

  const result = await request(settings, "/session/locale", { method: "POST", body: { locale }, token });
  if (!result.ok) return result;
  return { ok: true, logged: Boolean(result.data.logged) };
}

/* -------------------------------------------------- il ritorno dal login */

export function ticketFrom(url) {
  return url.searchParams.get("ticket");
}

// Lo stesso indirizzo senza il biglietto: ci si rimanda il browser subito dopo
// lo scambio, così il biglietto non resta nella barra degli indirizzi né nella
// cronologia, e un aggiornamento della pagina non prova a riusarlo.
export function urlWithoutTicket(settings, url) {
  const pulito = new URL(url);
  pulito.searchParams.delete("ticket");
  return `${settings.publicUrl}${pulito.pathname}${pulito.search}`;
}
