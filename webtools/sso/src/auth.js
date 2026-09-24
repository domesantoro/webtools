// The sso's operations: logging in, knowing who has logged in, logging out,
// changing language.
//
// The decision lives here; the data lives in anagraphics. The anagraphics client
// is passed in from outside (`client`) so these functions can be tested without
// anagraphics running.
//
// Every function returns { ok: true, body } or { ok: false, status, code }: the
// translation into HTTP is the server's job, not this part's.

import * as anagraphics from "./anagraphics.js";
import { verifyPassword } from "./credentials.js";
import { buildSession, isExpired } from "./sessions.js";
import { buildTicket, isExpired as ticketIsExpired } from "./tickets.js";

export const INVALID_CREDENTIALS = "INVALID_CREDENTIALS";
export const ANAGRAPHICS_UNAVAILABLE = "ANAGRAPHICS_UNAVAILABLE";
export const TICKET_NOT_FOUND = "TICKET_NOT_FOUND";
export const TICKET_EXPIRED = "TICKET_EXPIRED";
export const TICKET_MISMATCH = "TICKET_MISMATCH";

const unavailable = { ok: false, status: 503, code: ANAGRAPHICS_UNAVAILABLE };
// Unknown user, deactivated user, password never set, wrong password: the user is
// always given the same answer. Knowing *which* of the four is true would tell
// whoever is trying whether an address is registered. The real reason stays in the
// log.
const refused = { ok: false, status: 401, code: INVALID_CREDENTIALS };

// `locale`: the language the login page was being looked at in, if there is one.
// The one saved in the profile wins; if the profile has none, this one is saved.
export async function login(settings, { username, password, locale = null }, client = anagraphics) {
  const userResult = await client.findUser(settings, username);
  if (!userResult.ok) {
    if (userResult.reason === "not_found") {
      console.warn(`[sso] login refused: unknown user (${username})`);
      return refused;
    }
    return unavailable;
  }

  const user = userResult.data;
  if (user.active === false) {
    console.warn(`[sso] login refused: user deactivated (${username})`);
    return refused;
  }

  const credentialResult = await client.findUserCredential(settings, username);
  if (!credentialResult.ok) {
    if (credentialResult.reason === "not_found") {
      // CREDENTIAL_NOT_SET: the user exists but has no password.
      console.warn(`[sso] login refused: ${credentialResult.code} (${username})`);
      return refused;
    }
    return unavailable;
  }

  if (!(await verifyPassword(password, credentialResult.data.credential))) {
    console.warn(`[sso] login refused: wrong password (${username})`);
    return refused;
  }

  const sessionLocale = user.locale ?? locale;
  if (!user.locale && locale) {
    // If it cannot be saved the login goes ahead anyway: the language stays in the
    // cookie and in the session.
    const saved = await client.setUserLocale(settings, username, locale);
    if (!saved.ok) console.error(`[sso] language not saved in ${username}'s profile: ${saved.reason}`);
  }

  const session = buildSession(user, settings.sessionTtlSeconds, new Date(), sessionLocale);
  const created = await client.createSession(settings, session);
  if (!created.ok) {
    // The 409 too: two random 32-byte tokens do not collide, so a conflict here is
    // a defect, not bad luck. It is worth looking at.
    console.error(`[sso] session not created for ${username}: ${created.reason} ${created.code ?? ""}`);
    return unavailable;
  }

  console.log(`[sso] login of ${username} (uid ${user.uid})`);
  return { ok: true, status: 201, body: { logged: true, session: created.data } };
}

export async function readSession(settings, token, client = anagraphics) {
  const result = await client.findSession(settings, token);
  if (!result.ok) {
    // Unknown token: it is not an error, it is the answer to the question.
    if (result.reason === "not_found") return { ok: true, status: 200, body: { logged: false } };
    // Store unreachable: here we cannot say "not logged in", because we do not
    // know. Saying no would log everybody out at every Mongo failure.
    return unavailable;
  }

  const session = result.data;
  if (isExpired(session)) {
    // The deletion is done by anagraphics' TTL index, there is no need to ask for it here.
    return { ok: true, status: 200, body: { logged: false } };
  }

  return { ok: true, status: 200, body: { logged: true, session } };
}

// Issues a ticket for a session that is already open. The login page uses it, right
// after the login and also when the browser is already in: it is the only way to
// hand the session to an address other than this one (see tickets.js).
export async function issueTicket(settings, token, service, client = anagraphics) {
  const ticket = buildTicket(token, service, settings.ticketTtlSeconds);
  const created = await client.createTicket(settings, ticket);
  if (!created.ok) {
    console.error(`[sso] ticket not issued for ${service}: ${created.reason} ${created.code ?? ""}`);
    return unavailable;
  }
  return { ok: true, status: 201, body: { ticket: ticket.ticket } };
}

// The exchange, called by the subsystem server to server: ticket in, session out.
// The ticket is deleted the moment it is read, so a second attempt with the same
// ticket finds nothing.
export async function exchangeTicket(settings, { ticket, service }, client = anagraphics) {
  const consumed = await client.consumeTicket(settings, ticket);
  if (!consumed.ok) {
    if (consumed.reason === "not_found") {
      // Unknown, already used, or removed by the TTL: to the caller it is the same thing.
      console.warn(`[sso] invalid ticket presented by ${service}`);
      return { ok: false, status: 404, code: TICKET_NOT_FOUND };
    }
    return unavailable;
  }

  const record = consumed.data;
  if (ticketIsExpired(record)) {
    console.warn(`[sso] expired ticket presented by ${service}`);
    return { ok: false, status: 400, code: TICKET_EXPIRED };
  }
  if (record.service !== service) {
    // A ticket issued for one subsystem is not good for another. Today the
    // `service` is declared by the caller and nobody really verifies it: this check
    // stops mistakes, not an attack (see the known limits).
    console.warn(`[sso] ticket issued for ${record.service}, presented by ${service}`);
    return { ok: false, status: 403, code: TICKET_MISMATCH };
  }

  // The session may have been closed in the meantime: the ticket is valid, but
  // there is no longer anything it gives access to.
  return readSession(settings, record.token, client);
}

export async function logout(settings, token, client = anagraphics) {
  const result = await client.deleteSession(settings, token);
  if (!result.ok && result.reason !== "not_found") return unavailable;
  // Unknown or already expired token: the result asked for — that session no
  // longer exists — is true anyway. Repeating the logout is not an error.
  return { ok: true, status: 200, body: { logged: false } };
}

// The language chosen by whoever has logged in: it goes into the session and into
// the profile, so the next login finds it again. The pages' language is decided by
// the shared cookie; this is the memory that survives the logout.
export async function setLocale(settings, token, locale, client = anagraphics) {
  const current = await readSession(settings, token, client);
  if (!current.ok || !current.body.logged) return current;

  const updated = await client.setSessionLocale(settings, token, locale);
  if (!updated.ok) {
    if (updated.reason === "not_found") return { ok: true, status: 200, body: { logged: false } };
    return unavailable;
  }
  const saved = await client.setUserLocale(settings, current.body.session.username, locale);
  if (!saved.ok) return unavailable;

  return { ok: true, status: 200, body: { logged: true, session: updated.data } };
}
