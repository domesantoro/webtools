import assert from "node:assert/strict";
import { test } from "node:test";

import { buildTicket, isExpired, newTicket, serviceOf, withTicket } from "../src/tickets.js";

test("the ticket is long and does not repeat", () => {
  const biglietti = new Set();
  for (let i = 0; i < 100; i += 1) {
    const ticket = newTicket();
    assert.equal(ticket.length, 43);
    assert.match(ticket, /^[A-Za-z0-9_-]+$/);
    biglietti.add(ticket);
  }
  assert.equal(biglietti.size, 100);
});

test("the ticket says who it was given to and for which session", () => {
  const now = new Date("2026-09-21T10:00:00.000Z");
  const ticket = buildTicket("session-token", "http://127.0.0.1:9200", 60, now);

  assert.equal(ticket.token, "session-token");
  assert.equal(ticket.service, "http://127.0.0.1:9200");
  assert.equal(ticket.issued_at, "2026-09-21T10:00:00.000Z");
  // One minute: the time of a redirect, no longer.
  assert.equal(ticket.expires_at, "2026-09-21T10:01:00.000Z");
});

test("the ticket's expiry", () => {
  const now = new Date("2026-09-21T10:00:00.000Z");
  assert.equal(isExpired({ expires_at: "2026-09-21T10:00:01.000Z" }, now), false);
  assert.equal(isExpired({ expires_at: "2026-09-21T09:59:59.000Z" }, now), true);
  assert.equal(isExpired({}, now), true);
  assert.equal(isExpired(null, now), true);
});

test("the service is the subsystem's address, without a path", () => {
  assert.equal(serviceOf("http://127.0.0.1:9200/?discount=abc"), "http://127.0.0.1:9200");
  assert.equal(serviceOf("not an address"), null);
});

test("the ticket is added without losing the parameters already there", () => {
  const next = "http://127.0.0.1:9200/?discount=e8013cf2";
  const url = new URL(withTicket(next, "biglietto"));
  assert.equal(url.searchParams.get("discount"), "e8013cf2");
  assert.equal(url.searchParams.get("ticket"), "biglietto");
});
