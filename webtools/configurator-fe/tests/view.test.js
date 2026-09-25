// What the page shows, worked out from the documents.
//
// The documents used here are made up on purpose: they are not the system's
// configuration. What is checked is that any document is dealt with — a branch
// nobody has today, a list of objects, an empty object, a field with no
// convention in its name.

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRows,
  buildView,
  describeValue,
  listenAddress,
  readingHint,
  readingTime,
  sharedValues,
} from "../src/view.js";

const NO_SECRETS = { available: true, reason: null, bySubsystem: new Map(), problems: [] };

function rowsByPath(rows) {
  return new Map(rows.map((row) => [row.path, row]));
}

// --- the reading hints -----------------------------------------------------

test("cents are read in euro, seconds and milliseconds as durations", () => {
  assert.equal(readingHint("standard_price_cents", 40000), "400.00 €");
  assert.equal(readingHint("ttl_seconds", 28800), "8 h");
  assert.equal(readingHint("ttl_seconds", 60), "1 min");
  assert.equal(readingHint("cookie_max_age_seconds", 31536000), "365 d");
  assert.equal(readingHint("timeout_ms", 5000), "5 s");
  assert.equal(readingHint("timeout_ms", 300000), "5 min");
});

test("a field with no convention in its name gets no hint, and neither does one too small to have one", () => {
  // Inventing a reading for `port` or `max_turns` would be the defect: the
  // conventions hold for part of the fields, not for all of them.
  assert.equal(readingHint("port", 9500), null);
  assert.equal(readingHint("max_turns", 6), null);
  assert.equal(readingHint("ttl_seconds", 30), null);
  assert.equal(readingHint("timeout_ms", 500), null);
  // Not an integer: `_cents` is an integer field, and 0.5 is not one.
  assert.equal(readingHint("price_cents", 0.5), null);
});

// --- the values ------------------------------------------------------------

test("every JSON type a configuration can hold is described", () => {
  assert.equal(describeValue("a", "text").type, "string");
  assert.equal(describeValue("a", "").type, "empty-string");
  assert.equal(describeValue("a", 3).type, "number");
  assert.equal(describeValue("a", true).text, "true");
  assert.equal(describeValue("a", null).type, "null");
  assert.equal(describeValue("a", []).type, "empty-list");
  assert.equal(describeValue("a", {}).type, "empty-object");
  assert.deepEqual(describeValue("a", ["x", 2, null]).items, ["x", "2", "null"]);
});

test("a secret value is not in what the page is given", () => {
  const described = describeValue("api_key", "sk-ant-0123456789");
  assert.equal(described.text, "sk-ant-0123456789");

  const masked = describeValue("api_key", "sk-ant-0123456789", { secret: true });
  assert.equal(masked.type, "secret");
  assert.equal(masked.secret, true);
  assert.equal(masked.text, "17 characters");
  assert.equal(JSON.stringify(masked).includes("sk-ant"), false);
});

test("a secret that is not a string is masked without inventing a length", () => {
  assert.deepEqual(describeValue("token", 12345, { secret: true }).text, null);
});

// --- the rows --------------------------------------------------------------

test("the document is flattened keeping its order and its depth", () => {
  const rows = buildRows({
    subsystem: "example",
    listen: { host: "127.0.0.1", port: 9500 },
    access: { allowed_ips: ["127.0.0.1", "::1"] },
  });
  // `subsystem` is the section's title, not one of its fields.
  assert.equal(rows.some((row) => row.path === "subsystem"), false);
  assert.deepEqual(
    rows.map((row) => [row.path, row.kind, row.depth]),
    [
      ["listen", "branch", 0],
      ["listen.host", "leaf", 1],
      ["listen.port", "leaf", 1],
      ["access", "branch", 0],
      ["access.allowed_ips", "leaf", 1],
    ]
  );
});

test("a list of objects is opened by position, a list of values stays one value", () => {
  const rows = rowsByPath(
    buildRows({
      subsystem: "example",
      providers: [{ name: "one" }, { name: "two" }],
      locales: ["en", "it"],
    })
  );
  assert.equal(rows.get("providers").kind, "branch");
  assert.equal(rows.get("providers").size, 2);
  assert.equal(rows.get("providers.0").key, "[0]");
  assert.equal(rows.get("providers.0.name").value.text, "one");
  assert.equal(rows.get("locales").kind, "leaf");
  assert.deepEqual(rows.get("locales").value.items, ["en", "it"]);
});

test("an empty branch is a leaf that says it is empty, not a branch with nothing under it", () => {
  const rows = rowsByPath(buildRows({ subsystem: "example", limits: {} }));
  assert.equal(rows.get("limits").kind, "leaf");
  assert.equal(rows.get("limits").value.type, "empty-object");
});

test("only the paths that come from a secrets file are masked", () => {
  const document = {
    subsystem: "example",
    ai: { providers: { anthropic: { api_key: "sk-ant-secret", model: "claude-opus-5" } } },
    // Named like a key and written in configuration/: it is in git, so it is not a
    // secret and it is not masked.
    other: { api_key: "in-git" },
  };
  const rows = rowsByPath(buildRows(document, new Set(["ai.providers.anthropic.api_key"])));
  assert.equal(rows.get("ai.providers.anthropic.api_key").value.type, "secret");
  assert.equal(rows.get("ai.providers.anthropic.model").value.text, "claude-opus-5");
  assert.equal(rows.get("other.api_key").value.text, "in-git");
});

test("a secret declared on a branch masks the branch, without opening it", () => {
  const rows = rowsByPath(buildRows({ subsystem: "example", credential: { user: "u", pass: "p" } }, new Set(["credential"])));
  assert.equal(rows.get("credential").kind, "leaf");
  assert.equal(rows.get("credential").value.type, "secret");
  assert.equal(rows.has("credential.pass"), false);
});

// --- where a subsystem listens ---------------------------------------------

test("a subsystem that does not listen has no address, and none is invented", () => {
  assert.equal(listenAddress({ listen: { host: "127.0.0.1", port: 9500 } }), "127.0.0.1:9500");
  // Anagraphics is like this: its address is in the bootstrap, not in the document.
  assert.equal(listenAddress({ access: { allowed_ips: [] } }), null);
  assert.equal(listenAddress({ listen: { host: "127.0.0.1" } }), null);
  assert.equal(listenAddress({ listen: { host: "", port: 9500 } }), null);
});

// --- the shared values -----------------------------------------------------

test("a leaf several subsystems hold with the same value is shared; one they hold differently is not", () => {
  const shared = sharedValues([
    { subsystem: "one", listen: { host: "127.0.0.1", port: 9000 }, i18n: { fallback_locale: "en" } },
    { subsystem: "two", listen: { host: "127.0.0.1", port: 9100 }, i18n: { fallback_locale: "en" } },
    { subsystem: "three", listen: { host: "127.0.0.1", port: 9200 } },
  ]);
  const paths = shared.map((entry) => entry.path);
  assert.deepEqual(paths, ["i18n.fallback_locale", "listen.host"]);
  // The ports differ: not a shared value.
  assert.equal(paths.includes("listen.port"), false);
  assert.deepEqual(shared.find((entry) => entry.path === "listen.host").subsystems, ["one", "two", "three"]);
  assert.deepEqual(shared.find((entry) => entry.path === "i18n.fallback_locale").subsystems, ["one", "two"]);
});

test("a leaf only one subsystem holds is not shared", () => {
  assert.deepEqual(sharedValues([{ subsystem: "one", only: { here: 1 } }, { subsystem: "two" }]), []);
});

test("a secret path is never compared and never shown among the shared values", () => {
  const documents = [
    { subsystem: "one", ai: { api_key: "same-key" } },
    { subsystem: "two", ai: { api_key: "same-key" } },
  ];
  assert.equal(sharedValues(documents).length, 1);
  const secrets = new Map([["one", new Set(["ai.api_key"])]]);
  assert.deepEqual(sharedValues(documents, secrets), []);
});

// --- the whole view --------------------------------------------------------

test("the bootstrap shown is what this process received, and only the WEBTOOLS_ variables", () => {
  const view = buildView({
    configurations: [],
    secrets: NO_SECRETS,
    environment: { WEBTOOLS_MONGO_DB: "webtools", PATH: "/usr/bin", WEBTOOLS_ANAGRAPHICS_URL: "http://127.0.0.1:9100" },
    readAt: new Date(2026, 8, 25, 18, 42, 11),
  });
  assert.deepEqual(view.bootstrap, [
    { name: "WEBTOOLS_ANAGRAPHICS_URL", value: "http://127.0.0.1:9100" },
    { name: "WEBTOOLS_MONGO_DB", value: "webtools" },
  ]);
  assert.equal(view.readAt, "2026-09-25 18:42:11");
});

test("a secret declared on disk and not in Mongo is pointed out", () => {
  const view = buildView({
    configurations: [{ subsystem: "one", ai: { model: "claude-opus-5" } }],
    secrets: {
      available: true,
      reason: null,
      problems: [],
      bySubsystem: new Map([["one", new Set(["ai.api_key"])], ["gone", new Set(["x"])]]),
    },
    environment: {},
    readAt: new Date(),
  });
  assert.deepEqual(view.subsystems[0].secretsNotInMongo, ["ai.api_key"]);
  // A secrets file for a subsystem that has no configuration at all.
  assert.deepEqual(view.secrets.orphans, ["gone"]);
});

test("with no secrets folder nothing is masked, and the view says why", () => {
  const view = buildView({
    configurations: [{ subsystem: "one", ai: { api_key: "in-mongo" } }],
    secrets: { available: false, reason: "/nowhere: ENOENT", bySubsystem: new Map(), problems: [] },
    environment: {},
    readAt: new Date(),
  });
  assert.equal(view.secrets.available, false);
  assert.equal(view.secrets.reason, "/nowhere: ENOENT");
  assert.equal(view.subsystems[0].secrets, 0);
});

test("a failed reading leaves no half page", () => {
  const view = buildView({
    configurations: [],
    secrets: NO_SECRETS,
    environment: {},
    readAt: new Date(),
    failure: "GET http://127.0.0.1:9100/configuration: TypeError fetch failed",
  });
  assert.match(view.failure, /fetch failed/);
  assert.deepEqual(view.subsystems, []);
  assert.deepEqual(view.shared, []);
});

test("the reading time is the moment of the reading, printed in full", () => {
  assert.equal(readingTime(new Date(2026, 0, 2, 3, 4, 5)), "2026-01-02 03:04:05");
});
