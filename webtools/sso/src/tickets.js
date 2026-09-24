// The ticket: how a session is handed from one address to another.
//
// The problem it solves. A cookie belongs to one address: the sso, which sits on
// `127.0.0.1:9300`, cannot set a cookie on behalf of the preanalyst, which sits on
// another. And the session token cannot travel in the address, because the address
// ends up in the browser's history, in proxy logs and in links people pass around:
// a receipt good for eight hours is not left lying about.
//
// The solution is a second receipt, made to be left lying about:
//
//   1. the sso creates a ticket pointing at the session, and it lives one minute;
//   2. it sends the browser to the preanalyst with the ticket in the address;
//   3. the preanalyst exchanges it **from behind**, server to server, and receives
//      the session;
//   4. the ticket is deleted at the very moment it is read.
//
// So even somebody reading the ticket in a log finds something expired and already
// consumed. The real token never travelled through the address.

import { randomBytes } from "node:crypto";

const TICKET_BYTES = 32;

export function newTicket() {
  return randomBytes(TICKET_BYTES).toString("base64url");
}

export function buildTicket(token, service, ttlSeconds, now = new Date()) {
  return {
    ticket: newTicket(),
    token,
    // Who it was given to. It keeps a subsystem from exchanging a ticket issued
    // for another one.
    service,
    issued_at: new Date(now.getTime()).toISOString(),
    expires_at: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
  };
}

export function isExpired(ticket, now = new Date()) {
  const expiresAt = Date.parse(ticket?.expires_at ?? "");
  if (Number.isNaN(expiresAt)) return true;
  return expiresAt <= now.getTime();
}

// The subsystem receiving the ticket: `http://127.0.0.1:9200` from
// `http://127.0.0.1:9200/something?x=1`. It is the part compared with the
// `service` written inside the ticket.
export function serviceOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

// Adds the ticket to the return address, without losing the parameters that were
// already there (the preanalyst's `?discount=`, for instance).
export function withTicket(next, ticket) {
  const url = new URL(next);
  url.searchParams.set("ticket", ticket);
  return url.toString();
}
