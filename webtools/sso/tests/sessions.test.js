import assert from "node:assert/strict";
import { test } from "node:test";

import { buildSession, isExpired, newToken } from "../src/sessions.js";

const USER = {
  uid: "8ff93901-673e-44ba-b05b-56011395dcba",
  username: "dome.santoro@gmail.com",
  screen_name: "Dome",
  driver_uid: "7633be3d-e701-42ca-9fea-6c6d1bb4b7d1",
};

test("il token è lungo e non si ripete", () => {
  const tokens = new Set();
  for (let i = 0; i < 100; i += 1) {
    const token = newToken();
    // 32 byte in base64url: 43 caratteri, nessuno da codificare in un URL.
    assert.equal(token.length, 43);
    assert.match(token, /^[A-Za-z0-9_-]+$/);
    tokens.add(token);
  }
  assert.equal(tokens.size, 100);
});

test("la sessione porta chi è entrato e fino a quando vale", () => {
  const now = new Date("2026-09-21T10:00:00.000Z");
  const session = buildSession(USER, 3600, now);

  assert.equal(session.uid, USER.uid);
  assert.equal(session.username, USER.username);
  assert.equal(session.issued_at, "2026-09-21T10:00:00.000Z");
  assert.equal(session.expires_at, "2026-09-21T11:00:00.000Z");
  // La fotografia dell'utente al login: evita una seconda lettura a ogni
  // `GET /session`, e invecchia (vedi il commento in sessions.js).
  assert.deepEqual(session.data, { screen_name: "Dome", driver_uid: USER.driver_uid });
});

test("un utente senza screen_name o driver non manda in errore la sessione", () => {
  const session = buildSession({ uid: "u", username: "u@example.com" }, 60);
  assert.deepEqual(session.data, { screen_name: null, driver_uid: null });
});

test("la scadenza", () => {
  const now = new Date("2026-09-21T10:00:00.000Z");
  assert.equal(isExpired({ expires_at: "2026-09-21T10:00:01.000Z" }, now), false);
  assert.equal(isExpired({ expires_at: "2026-09-21T09:59:59.000Z" }, now), true);
  // Il momento esatto della scadenza è già fuori.
  assert.equal(isExpired({ expires_at: "2026-09-21T10:00:00.000Z" }, now), true);
  // Senza scadenza leggibile la sessione non vale.
  assert.equal(isExpired({}, now), true);
  assert.equal(isExpired({ expires_at: "domani" }, now), true);
  assert.equal(isExpired(null, now), true);
});
