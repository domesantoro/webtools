// The AI settings: which provider is selected and whose configuration is read.
//
// The call to the provider is not tested — it costs and is not repeatable. What
// is tested is what happens at startup, which is where a configuration mistake
// has to come out: reading the section of the selected provider and only that
// one, and refusing to start over a provider that does not exist.
//
//   node --test

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadAiSettings } from "../src/ai/webtools_ai.js";
import { Configuration, ConfigurationError } from "../src/commons/configuration_client.js";

// A configuration document, as it arrives from anagraphics. Only the `ai` part
// matters here: loadAiSettings reads nothing else.
const configurationOf = (ai) => new Configuration("preanalyst", { ai }, "http://127.0.0.1:9000");

const anthropic = {
  model: "claude-haiku-4-5",
  max_tokens: 512,
  api_key: "sk-test",
};

test("loadAiSettings: the selected provider's configuration is read", () => {
  const settings = loadAiSettings(configurationOf({
    provider: "anthropic",
    timeout_ms: 20000,
    providers: { anthropic },
  }));

  assert.equal(settings.provider, "anthropic");
  assert.equal(settings.timeoutMs, 20000);
  // The fields are the provider's own, with the names the provider gives them.
  assert.deepEqual(settings.configuration, {
    model: "claude-haiku-4-5",
    maxTokens: 512,
    apiKey: "sk-test",
  });
  // Nothing above the provider knows the shape of what is down there: there is
  // no `providers` map in the settings any more.
  assert.equal(settings.providers, undefined);
});

test("loadAiSettings: an unknown provider does not start the server", () => {
  const configuration = configurationOf({
    provider: "jev",
    timeout_ms: 20000,
    providers: { anthropic },
  });

  assert.throws(() => loadAiSettings(configuration), (error) => {
    assert.ok(error instanceof ConfigurationError);
    // The message says which ones exist: whoever mistyped has to be able to fix
    // it from the log alone.
    assert.match(error.message, /ai\.provider must be one of anthropic/);
    assert.match(error.message, /"jev"/);
    return true;
  });
});

test("loadAiSettings: a missing field of the selected provider does not start the server", () => {
  for (const missing of ["model", "max_tokens", "api_key"]) {
    const incomplete = { ...anthropic };
    delete incomplete[missing];
    const configuration = configurationOf({
      provider: "anthropic",
      timeout_ms: 20000,
      providers: { anthropic: incomplete },
    });
    assert.throws(
      () => loadAiSettings(configuration),
      ConfigurationError,
      `a missing ${missing} should stop the server`,
    );
  }
});

test("loadAiSettings: the timeout is required, and it is not the provider's", () => {
  const configuration = configurationOf({ provider: "anthropic", providers: { anthropic } });
  assert.throws(() => loadAiSettings(configuration), ConfigurationError);
});

// The one that motivates all this. Before, the configuration of every provider
// was read whatever was selected, so an environment using one provider still had
// to carry the keys of the others, and could not start without them.
test("loadAiSettings: the configuration of a provider that is not selected is not read", () => {
  const settings = loadAiSettings(configurationOf({
    provider: "anthropic",
    timeout_ms: 20000,
    providers: {
      anthropic,
      // No key, no model: nobody is going to call it, so nobody is going to
      // complain about it.
      jev: { endpoint: "" },
    },
  }));

  assert.equal(settings.provider, "anthropic");
  assert.equal(settings.configuration.apiKey, "sk-test");
});
