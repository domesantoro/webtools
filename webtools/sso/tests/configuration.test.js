// Il client della configurazione (copia di commons/configuration): i campi si
// leggono per percorso, e un campo mancante o sbagliato ferma l'avvio.

import assert from "node:assert/strict";
import { test } from "node:test";

import { Configuration, ConfigurationError, readBootstrap } from "../src/commons/configuration_client.js";

const configuration = new Configuration(
  "sso",
  {
    listen: { host: "127.0.0.1", port: 8300 },
    access: { allowed_ips: ["127.0.0.1"] },
    login: { allowed_next: ["http://127.0.0.1:8200/", "javascript:alert(1)"] },
    session: { ttl_seconds: "3600" },
  },
  "http://127.0.0.1:8100"
);

test("legge i campi per percorso", () => {
  assert.equal(configuration.string("listen.host"), "127.0.0.1");
  assert.equal(configuration.port("listen.port"), 8300);
  assert.deepEqual(configuration.stringList("access.allowed_ips"), ["127.0.0.1"]);
  assert.equal(configuration.httpUrl("login.allowed_next.0"), "http://127.0.0.1:8200");
});

test("un campo mancante lancia ConfigurationError con il percorso", () => {
  assert.throws(() => configuration.string("ticket.cookie"), (error) => {
    assert.ok(error instanceof ConfigurationError);
    assert.match(error.message, /ticket\.cookie .* mancante/);
    return true;
  });
});

test("un campo del tipo sbagliato non passa", () => {
  assert.throws(() => configuration.integer("session.ttl_seconds"), ConfigurationError);
  assert.throws(() => configuration.httpUrlList("login.allowed_next"), /login\.allowed_next\.1/);
});

test("senza le variabili di avvio non si parte", () => {
  const saved = process.env.WEBTOOLS_ANAGRAPHICS_URL;
  delete process.env.WEBTOOLS_ANAGRAPHICS_URL;
  try {
    assert.throws(() => readBootstrap(), /WEBTOOLS_ANAGRAPHICS_URL/);
  } finally {
    if (saved !== undefined) process.env.WEBTOOLS_ANAGRAPHICS_URL = saved;
  }
});
