// Client HTTP verso webtools_anagraphics: utenti, credenziali, sessioni.
//
// Come in preanalyst, non solleva eccezioni verso il chiamante: ogni chiamata
// restituisce { ok: true, data } oppure { ok: false, reason }, perché chi chiama
// deve sapere *come* è andata male, non solo che è andata male.
//
//   reason "not_found"    → 404, con `code` (USER_NOT_FOUND, CREDENTIAL_NOT_SET, …)
//   reason "conflict"     → 409, token già esistente
//   reason "unavailable"  → servizio irraggiungibile, timeout, 5xx, 403, JSON rotto
//
// Le risposte d'errore di anagraphics sono { "error": "<CODICE>" }: si confronta
// il codice, mai il testo.

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
    // Servizio spento, DNS, rete, timeout del client.
    console.error(`[anagraphics] ${method} ${path}: ${error.name} ${error.message}`);
    return { ok: false, reason: "unavailable" };
  }

  // 204: cancellazione riuscita, nessun corpo da leggere.
  if (response.status === 204) return { ok: true, data: null };

  let payload;
  try {
    payload = await response.json();
  } catch {
    console.error(`[anagraphics] ${method} ${path}: risposta non JSON (HTTP ${response.status})`);
    return { ok: false, reason: "unavailable" };
  }

  if (response.ok) return { ok: true, data: payload };

  if (response.status === 404) return { ok: false, reason: "not_found", code: payload?.error };
  if (response.status === 409) return { ok: false, reason: "conflict", code: payload?.error };

  // 400 INVALID_BODY, 403 IP_NOT_ALLOWED, 503 DATABASE_UNAVAILABLE, 500: per il
  // sso sono tutti "anagraphics non ci sta dando quello che serve", ma nel log
  // deve restare il codice vero, perché sono guasti nostri, non dell'utente.
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

// PUT /users/{username}/locale { locale } → l'utente, con la lingua preferita.
export function setUserLocale(settings, username, locale) {
  return request(settings, `/users/${encode(username)}/locale`, { method: "PUT", body: { locale } });
}

// PUT /sessions/{token}/locale { locale } → la sessione, con `data.locale`.
export function setSessionLocale(settings, token, locale) {
  return request(settings, `/sessions/${encode(token)}/locale`, { method: "PUT", body: { locale } });
}

// POST /sessions → il documento conservato. Il documento lo costruisce il sso.
export function createSession(settings, session) {
  return request(settings, "/sessions", { method: "POST", body: session });
}

// GET /sessions/{token} → la sessione, anche se scaduta: la scadenza la valuta il sso.
export function findSession(settings, token) {
  return request(settings, `/sessions/${encode(token)}`);
}

// DELETE /sessions/{token} → 204, oppure 404 se il token non c'è.
export function deleteSession(settings, token) {
  return request(settings, `/sessions/${encode(token)}`, { method: "DELETE" });
}

// DELETE /sessions?uid={uid} → { uid, deleted }
export function deleteSessionsOfUser(settings, uid) {
  return request(settings, `/sessions?uid=${encode(uid)}`, { method: "DELETE" });
}

// POST /tickets → il biglietto conservato.
export function createTicket(settings, ticket) {
  return request(settings, "/tickets", { method: "POST", body: ticket });
}

// DELETE /tickets/{ticket} → il biglietto, cancellandolo nello stesso momento.
// Chi arriva secondo riceve not_found: è il consumo usa-e-getta.
export function consumeTicket(settings, ticket) {
  return request(settings, `/tickets/${encode(ticket)}`, { method: "DELETE" });
}
