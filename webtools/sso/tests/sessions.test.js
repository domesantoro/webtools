import assert from "node:assert/strict";
import { test } from "node:test";

import { buildSession, isExpired, newToken } from "../src/sessions.js";

const USER = {
  uid: "8ff93901-673e-44ba-b05b-56011395dcba",
  username: "dome.santoro@gmail.com",
  screen_name: "Dome",
  driver: { driver_uid: "7633be3d-e701-42ca-9fea-6c6d1bb4b7d1", level: 1 },
};

test("the token is long and does not repeat", () => {
  const tokens = new Set();
  for (let i = 0; i < 100; i += 1) {
    const token = newToken();
    // 32 bytes in base64url: 43 characters, none of them to encode in a URL.
    assert.equal(token.length, 43);
    assert.match(token, /^[A-Za-z0-9_-]+$/);
    tokens.add(token);
  }
  assert.equal(tokens.size, 100);
});

test("the session carries who logged in and how long it is good for", () => {
  const now = new Date("2026-09-21T10:00:00.000Z");
  const session = buildSession(USER, 3600, now, "it");

  assert.equal(session.uid, USER.uid);
  assert.equal(session.username, USER.username);
  assert.equal(session.issued_at, "2026-09-21T10:00:00.000Z");
  assert.equal(session.expires_at, "2026-09-21T11:00:00.000Z");
  // The photograph of the user at login time: it avoids a second read on every
  // `GET /session`, and it ages (see the comment in sessions.js).
  assert.deepEqual(session.data, { screen_name: "Dome", driver: USER.driver, locale: "it" });
});

test("the driver role travels whole, level included", () => {
  const admin = { ...USER, driver: { driver_uid: "d", level: 2 } };
  assert.deepEqual(buildSession(admin, 60).data.driver, { driver_uid: "d", level: 2 });
});

test("a user with no screen_name or driver does not break the session", () => {
  const session = buildSession({ uid: "u", username: "u@example.com" }, 60);
  assert.deepEqual(session.data, { screen_name: null, driver: null, locale: null });
});

test("a user who is explicitly not a driver carries null, not a missing field", () => {
  const client = { uid: "u", username: "u@example.com", screen_name: "Client", driver: null };
  assert.deepEqual(buildSession(client, 60).data.driver, null);
});

test("the expiry", () => {
  const now = new Date("2026-09-21T10:00:00.000Z");
  assert.equal(isExpired({ expires_at: "2026-09-21T10:00:01.000Z" }, now), false);
  assert.equal(isExpired({ expires_at: "2026-09-21T09:59:59.000Z" }, now), true);
  // The exact moment of the expiry is already out.
  assert.equal(isExpired({ expires_at: "2026-09-21T10:00:00.000Z" }, now), true);
  // With no readable expiry the session is not good.
  assert.equal(isExpired({}, now), true);
  assert.equal(isExpired({ expires_at: "tomorrow" }, now), true);
  assert.equal(isExpired(null, now), true);
});
