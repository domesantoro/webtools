// HTTP client towards webtools_anagraphics: users, credentials, sessions.
//
// As in the preanalyst, it raises no exceptions towards the caller: every call
// returns { ok: true, data } or { ok: false, reason }, because the caller has to
// know *how* it went wrong, not only that it went wrong.
//
//   reason "not_found"    → 404, with `code` (USER_NOT_FOUND, CREDENTIAL_NOT_SET, …)
//   reason "conflict"     → 409, token already there
//   reason "unavailable"  → service unreachable, timeout, 5xx, 403, broken JSON
//
// Anagraphics' error responses are { "error": "<CODE>" }: the code is compared,
// never the text.

async function request(settings, path, { method = "GET", body } = {}) {
  const url = `${settings.anagraphicsUrl}${path}`;
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(settings.anagraphicsTimeoutMs),
    });
  } catch (error) {
    // Service down, DNS, network, client timeout.
    console.error(`[anagraphics] ${method} ${path}: ${error.name} ${error.message}`);
    return { ok: false, reason: "unavailable" };
  }

  // 204: deletion succeeded, no body to read.
  if (response.status === 204) return { ok: true, data: null };

  let payload;
  try {
    payload = await response.json();
  } catch {
    console.error(`[anagraphics] ${method} ${path}: response is not JSON (HTTP ${response.status})`);
    return { ok: false, reason: "unavailable" };
  }

  if (response.ok) return { ok: true, data: payload };

  if (response.status === 404) return { ok: false, reason: "not_found", code: payload?.error };
  if (response.status === 409) return { ok: false, reason: "conflict", code: payload?.error };

  // 400 INVALID_BODY, 403 IP_NOT_ALLOWED, 503 DATABASE_UNAVAILABLE, 500: to the
  // sso they are all "anagraphics is not giving us what we need", but the real
  // code must stay in the log, because these are our failures, not the user's.
  console.error(`[anagraphics] ${method} ${path}: HTTP ${response.status} ${payload?.error ?? "?"}`);
  return { ok: false, reason: "unavailable", code: payload?.error };
}

const encode = encodeURIComponent;

// GET /users/{username} → { uid, username, screen_name, active, driver_uid }
export function findUser(settings, username) {
  return request(settings, `/users/${encode(username)}`);
}

// GET /users/{username}/credential → { username, credential: { algorithm, params, salt, hash } }
export function findUserCredential(settings, username) {
  return request(settings, `/users/${encode(username)}/credential`);
}

// PUT /users/{username}/locale { locale } → the user, with their preferred language.
export function setUserLocale(settings, username, locale) {
  return request(settings, `/users/${encode(username)}/locale`, { method: "PUT", body: { locale } });
}

// PUT /sessions/{token}/locale { locale } → the session, with `data.locale`.
export function setSessionLocale(settings, token, locale) {
  return request(settings, `/sessions/${encode(token)}/locale`, { method: "PUT", body: { locale } });
}

// POST /sessions → the stored document. The document is built by the sso.
export function createSession(settings, session) {
  return request(settings, "/sessions", { method: "POST", body: session });
}

// GET /sessions/{token} → the session, expired or not: the expiry is judged by the sso.
export function findSession(settings, token) {
  return request(settings, `/sessions/${encode(token)}`);
}

// DELETE /sessions/{token} → 204, or 404 if the token is not there.
export function deleteSession(settings, token) {
  return request(settings, `/sessions/${encode(token)}`, { method: "DELETE" });
}

// DELETE /sessions?uid={uid} → { uid, deleted }
export function deleteSessionsOfUser(settings, uid) {
  return request(settings, `/sessions?uid=${encode(uid)}`, { method: "DELETE" });
}

// POST /tickets → the stored ticket.
export function createTicket(settings, ticket) {
  return request(settings, "/tickets", { method: "POST", body: ticket });
}

// DELETE /tickets/{ticket} → the ticket, deleting it at the same moment.
// Whoever comes second gets not_found: that is the single-use consumption.
export function consumeTicket(settings, ticket) {
  return request(settings, `/tickets/${encode(ticket)}`, { method: "DELETE" });
}
