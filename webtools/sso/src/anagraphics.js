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
//
// **Every call through here is measured**, once, as a `dependency.call`, exactly as
// in the preanalyst, the analyst and the drivers' pool. It is the one place the sso
// talks to anagraphics, so a measurement here covers every call there is and one
// added later needs nothing but its own name. `operation` is that name: a stable word
// each helper gives, never the path — a path carries tokens and usernames, and a
// bucket per identifier would make the number of documents grow with the traffic
// instead of with the number of kinds of thing measured.
//
// Four outcomes, because they are four different things to do about it: `ok`,
// `failed`, `timed_out` (it may well still be working) and `not_found`, which is an
// answer and not a fault — an unknown token is most of this subsystem's traffic and
// counting it as a failure would drown the ones that are.

async function request(settings, path, { method = "GET", body, operation } = {}) {
  const url = `${settings.anagraphicsUrl}${path}`;
  const elapsed = settings.metrics.timer();
  const report = (outcome) =>
    settings.metrics.measure("dependency.call", {
      dims: { target: "anagraphics", operation, outcome },
      duration_ms: elapsed(),
    });
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
    // We gave up waiting, or there was nothing at the other end: two facts, and in a
    // log they look alike.
    report(error.name === "TimeoutError" ? "timed_out" : "failed");
    return { ok: false, reason: "unavailable" };
  }

  // 204: deletion succeeded, no body to read.
  if (response.status === 204) {
    report("ok");
    return { ok: true, data: null };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    console.error(`[anagraphics] ${method} ${path}: response is not JSON (HTTP ${response.status})`);
    report("failed");
    return { ok: false, reason: "unavailable" };
  }

  if (response.ok) {
    report("ok");
    return { ok: true, data: payload };
  }

  if (response.status === 404) {
    // It answered, and what it said is that the thing is not there. Not a failure.
    report("not_found");
    return { ok: false, reason: "not_found", code: payload?.error };
  }
  report("failed");
  if (response.status === 409) return { ok: false, reason: "conflict", code: payload?.error };

  // 400 INVALID_BODY, 403 IP_NOT_ALLOWED, 503 DATABASE_UNAVAILABLE, 500: to the
  // sso they are all "anagraphics is not giving us what we need", but the real
  // code must stay in the log, because these are our failures, not the user's.
  console.error(`[anagraphics] ${method} ${path}: HTTP ${response.status} ${payload?.error ?? "?"}`);
  return { ok: false, reason: "unavailable", code: payload?.error };
}

const encode = encodeURIComponent;

// GET /users/{username} → { uid, username, screen_name, active, driver }
// `driver` is null, or the driver role: { driver_uid, level }.
export function findUser(settings, username) {
  return request(settings, `/users/${encode(username)}`, { operation: "find_user" });
}

// GET /users/{username}/credential → { username, credential: { algorithm, params, salt, hash } }
export function findUserCredential(settings, username) {
  return request(settings, `/users/${encode(username)}/credential`, {
    operation: "find_user_credential",
  });
}

// PUT /users/{username}/locale { locale } → the user, with their preferred language.
export function setUserLocale(settings, username, locale) {
  return request(settings, `/users/${encode(username)}/locale`, {
    method: "PUT",
    body: { locale },
    operation: "set_user_locale",
  });
}

// PUT /sessions/{token}/locale { locale } → the session, with `data.locale`.
export function setSessionLocale(settings, token, locale) {
  return request(settings, `/sessions/${encode(token)}/locale`, {
    method: "PUT",
    body: { locale },
    operation: "set_session_locale",
  });
}

// POST /sessions → the stored document. The document is built by the sso.
export function createSession(settings, session) {
  return request(settings, "/sessions", {
    method: "POST",
    body: session,
    operation: "create_session",
  });
}

// GET /sessions/{token} → the session, expired or not: the expiry is judged by the sso.
export function findSession(settings, token) {
  return request(settings, `/sessions/${encode(token)}`, { operation: "find_session" });
}

// DELETE /sessions/{token} → 204, or 404 if the token is not there.
export function deleteSession(settings, token) {
  return request(settings, `/sessions/${encode(token)}`, {
    method: "DELETE",
    operation: "delete_session",
  });
}

// DELETE /sessions?uid={uid} → { uid, deleted }
export function deleteSessionsOfUser(settings, uid) {
  return request(settings, `/sessions?uid=${encode(uid)}`, {
    method: "DELETE",
    operation: "delete_sessions_of_user",
  });
}

// POST /tickets → the stored ticket.
export function createTicket(settings, ticket) {
  return request(settings, "/tickets", {
    method: "POST",
    body: ticket,
    operation: "create_ticket",
  });
}

// DELETE /tickets/{ticket} → the ticket, deleting it at the same moment.
// Whoever comes second gets not_found: that is the single-use consumption.
export function consumeTicket(settings, ticket) {
  return request(settings, `/tickets/${encode(ticket)}`, {
    method: "DELETE",
    operation: "consume_ticket",
  });
}
