// The configuration client (a copy of commons/configuration): fields are read by
// path, and a missing or wrong field stops the startup.

import assert from "node:assert/strict";
import { test } from "node:test";

import { Configuration, ConfigurationError, readBootstrap } from "../src/commons/configuration_client.js";

const configuration = new Configuration(
  "sso",
  {
    listen: { host: "127.0.0.1", port: 9300 },
    access: { allowed_ips: ["127.0.0.1"] },
    login: { allowed_next: ["http://127.0.0.1:9200/", "javascript:alert(1)"] },
    session: { ttl_seconds: "3600" },
  },
  "http://127.0.0.1:9100"
);

test("reads the fields by path", () => {
  assert.equal(configuration.string("listen.host"), "127.0.0.1");
  assert.equal(configuration.port("listen.port"), 9300);
  assert.deepEqual(configuration.stringList("access.allowed_ips"), ["127.0.0.1"]);
  assert.equal(configuration.httpUrl("login.allowed_next.0"), "http://127.0.0.1:9200");
});

test("a missing field throws ConfigurationError with the path", () => {
  assert.throws(() => configuration.string("ticket.cookie"), (error) => {
    assert.ok(error instanceof ConfigurationError);
    assert.match(error.message, /ticket\.cookie .* missing/);
    return true;
  });
});

test("a field of the wrong type does not pass", () => {
  assert.throws(() => configuration.integer("session.ttl_seconds"), ConfigurationError);
  assert.throws(() => configuration.httpUrlList("login.allowed_next"), /login\.allowed_next\.1/);
});

test("without the startup variables we do not start", () => {
  const saved = process.env.WEBTOOLS_ANAGRAPHICS_URL;
  delete process.env.WEBTOOLS_ANAGRAPHICS_URL;
  try {
    assert.throws(() => readBootstrap(), /WEBTOOLS_ANAGRAPHICS_URL/);
  } finally {
    if (saved !== undefined) process.env.WEBTOOLS_ANAGRAPHICS_URL = saved;
  }
});
