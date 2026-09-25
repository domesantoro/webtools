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

import { loadPrevalidatorAiSettings } from "../src/prevalidator_ai/webtools_prevalidator_ai.js";
import { Configuration, ConfigurationError } from "../src/commons/configuration_client.js";

// Which part of the document this engine owns. It is the caller's word, not the
// module's assumption, so the tests say it too.
const BASE = "prevalidation";

// A configuration document, as it arrives from anagraphics. Only that part
// matters here: loadPrevalidatorAiSettings reads nothing else.
const configurationOf = (engine) =>
  new Configuration("preanalyst", { [BASE]: engine }, "http://127.0.0.1:9000");

const anthropic = {
  model: "claude-haiku-4-5",
  max_tokens: 512,
  api_key: "sk-test",
};

test("loadPrevalidatorAiSettings: the selected provider's configuration is read", () => {
  const settings = loadPrevalidatorAiSettings(
    configurationOf({ provider: "anthropic", timeout_ms: 20000, providers: { anthropic } }),
    BASE,
  );

  assert.equal(settings.provider, "anthropic");
  assert.equal(settings.timeoutMs, 20000);
  // The fields are the provider's own, with the names the provider gives them.
  // `effort` is not there, because this model has no such notion: the field is
  // absent, not filled in with something.
  assert.deepEqual(settings.configuration, {
    model: "claude-haiku-4-5",
    maxTokens: 512,
    effort: undefined,
    apiKey: "sk-test",
  });
  // Nothing above the provider knows the shape of what is down there: there is
  // no `providers` map in the settings any more.
  assert.equal(settings.providers, undefined);
});

test("loadPrevalidatorAiSettings: an unknown provider does not start the server", () => {
  const configuration = configurationOf({
    provider: "jev",
    timeout_ms: 20000,
    providers: { anthropic },
  });

  assert.throws(() => loadPrevalidatorAiSettings(configuration, BASE), (error) => {
    assert.ok(error instanceof ConfigurationError);
    // The message says which ones exist: whoever mistyped has to be able to fix
    // it from the log alone.
    assert.match(error.message, new RegExp(`${BASE}\\.provider must be one of anthropic`));
    assert.match(error.message, /"jev"/);
    return true;
  });
});

test("loadPrevalidatorAiSettings: a missing field of the selected provider does not start the server", () => {
  for (const missing of ["model", "max_tokens", "api_key"]) {
    const incomplete = { ...anthropic };
    delete incomplete[missing];
    const configuration = configurationOf({
      provider: "anthropic",
      timeout_ms: 20000,
      providers: { anthropic: incomplete },
    });
    assert.throws(
      () => loadPrevalidatorAiSettings(configuration, BASE),
      ConfigurationError,
      `a missing ${missing} should stop the server`,
    );
  }
});

test("loadPrevalidatorAiSettings: an effort left out is left out, one written wrong stops the server", () => {
  const withEffort = (effort) =>
    configurationOf({
      provider: "anthropic",
      timeout_ms: 20000,
      providers: { anthropic: { ...anthropic, effort } },
    });

  // A model that has the notion: the level travels as configured.
  assert.equal(loadPrevalidatorAiSettings(withEffort("low"), BASE).configuration.effort, "low");

  // A typo is a typo whether or not the field was compulsory.
  assert.throws(() => loadPrevalidatorAiSettings(withEffort("enormous"), BASE), (error) => {
    assert.ok(error instanceof ConfigurationError);
    assert.match(error.message, /effort, when it is there, must be one of low, medium, high, xhigh, max/);
    return true;
  });
});

test("loadPrevalidatorAiSettings: the timeout is required, and it is not the provider's", () => {
  const configuration = configurationOf({ provider: "anthropic", providers: { anthropic } });
  assert.throws(() => loadPrevalidatorAiSettings(configuration, BASE), ConfigurationError);
});

// The one that motivates all this. Before, the configuration of every provider
// was read whatever was selected, so an environment using one provider still had
// to carry the keys of the others, and could not start without them.
test("loadPrevalidatorAiSettings: the configuration of a provider that is not selected is not read", () => {
  const settings = loadPrevalidatorAiSettings(
    configurationOf({
      provider: "anthropic",
      timeout_ms: 20000,
      providers: {
        anthropic,
        // No key, no model: nobody is going to call it, so nobody is going to
        // complain about it.
        jev: { endpoint: "" },
      },
    }),
    BASE,
  );

  assert.equal(settings.provider, "anthropic");
  assert.equal(settings.configuration.apiKey, "sk-test");
});
