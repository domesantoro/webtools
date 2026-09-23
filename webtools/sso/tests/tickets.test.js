import assert from "node:assert/strict";
import { test } from "node:test";

import { buildTicket, isExpired, newTicket, serviceOf, withTicket } from "../src/tickets.js";

test("il biglietto è lungo e non si ripete", () => {
  const biglietti = new Set();
  for (let i = 0; i < 100; i += 1) {
    const ticket = newTicket();
    assert.equal(ticket.length, 43);
    assert.match(ticket, /^[A-Za-z0-9_-]+$/);
    biglietti.add(ticket);
  }
  assert.equal(biglietti.size, 100);
});

test("il biglietto dice a chi è stato dato e per quale sessione", () => {
  const now = new Date("2026-09-21T10:00:00.000Z");
  const ticket = buildTicket("token-della-sessione", "http://127.0.0.1:9200", 60, now);

  assert.equal(ticket.token, "token-della-sessione");
  assert.equal(ticket.service, "http://127.0.0.1:9200");
  assert.equal(ticket.issued_at, "2026-09-21T10:00:00.000Z");
  // Un minuto: il tempo di un redirect, non di più.
  assert.equal(ticket.expires_at, "2026-09-21T10:01:00.000Z");
});

test("la scadenza del biglietto", () => {
  const now = new Date("2026-09-21T10:00:00.000Z");
  assert.equal(isExpired({ expires_at: "2026-09-21T10:00:01.000Z" }, now), false);
  assert.equal(isExpired({ expires_at: "2026-09-21T09:59:59.000Z" }, now), true);
  assert.equal(isExpired({}, now), true);
  assert.equal(isExpired(null, now), true);
});

test("il service è l'indirizzo del sottosistema, senza percorso", () => {
  assert.equal(serviceOf("http://127.0.0.1:9200/?discount=abc"), "http://127.0.0.1:9200");
  assert.equal(serviceOf("non è un indirizzo"), null);
});

test("il biglietto si aggiunge senza perdere i parametri che c'erano già", () => {
  const next = "http://127.0.0.1:9200/?discount=e8013cf2";
  const url = new URL(withTicket(next, "biglietto"));
  assert.equal(url.searchParams.get("discount"), "e8013cf2");
  assert.equal(url.searchParams.get("ticket"), "biglietto");
});
