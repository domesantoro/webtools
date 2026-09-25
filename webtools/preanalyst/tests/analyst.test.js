// The chat's AI: the settings of its own structure, how the conversation is
// assembled, and how the validator's answer is read.
//
// No call to any provider — it costs and is not repeatable. What is tested is
// what decides: the assembly of what is sent and the reading of what comes back.
//
//   node --test

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadAnalystAiSettings } from "../src/analyst_ai/webtools_analyst_ai.js";
import { conversationOf, operatorNote } from "../src/analyst.js";
import { AXES, decide, dossierOf, readScores } from "../src/analysis_validator.js";
import { Configuration, ConfigurationError } from "../src/commons/configuration_client.js";

const engine = (overrides = {}) => ({
  provider: "anthropic",
  timeout_ms: 120000,
  providers: {
    anthropic: {
      model: "claude-opus-5",
      max_tokens: 16000,
      effort: "medium",
      operator_channel: "system_message",
      api_key: "sk-test",
    },
  },
  ...overrides,
});

const configurationOf = (analyst) =>
  new Configuration("preanalyst", { analyst }, "http://127.0.0.1:9100");

test("loadAnalystAiSettings: each engine reads its own part", () => {
  const configuration = configurationOf({ conversation: engine(), validation: engine() });
  const conversation = loadAnalystAiSettings(configuration, "analyst.conversation");

  assert.equal(conversation.provider, "anthropic");
  assert.equal(conversation.timeoutMs, 120000);
  assert.deepEqual(conversation.configuration, {
    model: "claude-opus-5",
    maxTokens: 16000,
    effort: "medium",
    operatorChannel: "system_message",
    apiKey: "sk-test",
  });
});

test("loadAnalystAiSettings: the two engines are independent of each other", () => {
  // The validation is unusable; the conversation is not asked to care.
  const configuration = configurationOf({
    conversation: engine(),
    validation: { provider: "jev" },
  });

  assert.doesNotThrow(() => loadAnalystAiSettings(configuration, "analyst.conversation"));
  assert.throws(() => loadAnalystAiSettings(configuration, "analyst.validation"), ConfigurationError);
});

test("loadAnalystAiSettings: an effort that is not one of the levels does not start the server", () => {
  const broken = engine();
  broken.providers.anthropic.effort = "enormous";
  const configuration = configurationOf({ conversation: broken, validation: engine() });

  assert.throws(() => loadAnalystAiSettings(configuration, "analyst.conversation"), (error) => {
    assert.ok(error instanceof ConfigurationError);
    assert.match(error.message, /effort, when it is there, must be one of low, medium, high, xhigh, max/);
    return true;
  });
});

test("loadAnalystAiSettings: a model with no effort is configured without one", () => {
  const plain = engine();
  delete plain.providers.anthropic.effort;
  const settings = loadAnalystAiSettings(
    configurationOf({ conversation: plain, validation: engine() }),
    "analyst.conversation",
  );
  assert.equal(settings.configuration.effort, undefined);
  assert.equal(settings.configuration.model, "claude-opus-5");
});

test("loadAnalystAiSettings: an operator channel the provider cannot do does not start the server", () => {
  const broken = engine();
  broken.providers.anthropic.operator_channel = "telepathy";
  const configuration = configurationOf({ conversation: broken, validation: engine() });

  assert.throws(() => loadAnalystAiSettings(configuration, "analyst.conversation"), (error) => {
    assert.ok(error instanceof ConfigurationError);
    assert.match(error.message, /operator_channel must be one of system_message, user_message/);
    return true;
  });
});

test("conversationOf: the pre-specification comes first and the new message last", () => {
  const messages = conversationOf(
    "the form's answers",
    [
      { role: "client", text: "I keep the training sessions" },
      { role: "system", text: "What does a session contain?" },
      { role: "system", text: "" },
    ],
    "a date and who was there",
  );

  assert.equal(messages.length, 4);
  assert.equal(messages[0].role, "user");
  assert.match(messages[0].content, /the form's answers/);
  // The two roles of the stored chat become the API's two.
  assert.deepEqual(
    messages.slice(1).map((message) => message.role),
    ["user", "assistant", "user"],
  );
  assert.equal(messages[3].content, "a date and who was there");
});

test("operatorNote: the turns left, and the language, every turn", () => {
  assert.match(operatorNote(9, "it"), /9 turns left/);
  // One turn is not "1 turns".
  assert.match(operatorNote(1, "it"), /1 turn left/);
  assert.match(operatorNote(9, "it"), /language: it/);
  // Near the end it is told to close rather than start something it cannot finish.
  assert.doesNotMatch(operatorNote(9, "it"), /close rather than run out/);
  assert.match(operatorNote(2, "it"), /close rather than run out/);
});

test("operatorNote: sent back, it is told not to close and what is open", () => {
  const note = operatorNote(2, "en", ["what a session record contains"]);
  assert.match(note, /Do not close now/);
  assert.match(note, /what a session record contains/);
  // The send-back replaces the generic nudge to close: the two say opposite things.
  assert.doesNotMatch(note, /close rather than run out/);
});

test("readScores: four axes, each between 0 and 1", () => {
  const complete = { completeness: 0.9, consistency: 0.8, testability: 0.4, scope: 0.95 };
  const { scores, weakest } = readScores(complete);
  assert.deepEqual(Object.keys(scores).sort(), [...AXES].sort());
  assert.equal(weakest, "testability");

  // A missing axis is not worth zero: the judgement is unusable.
  const { scope, ...incomplete } = complete;
  assert.equal(readScores(incomplete), null);
  assert.equal(readScores({ ...complete, scope: 1.4 }), null);
  assert.equal(readScores({ ...complete, scope: "high" }), null);
  assert.equal(readScores(undefined), null);
});

test("decide: a pass needs the verdict AND every axis above the threshold", () => {
  const good = { completeness: 0.9, consistency: 0.9, testability: 0.9, scope: 0.9 };
  assert.equal(decide("pass", good, 0.75), "pass");

  // The weakest axis decides: three excellent ones do not cover the fourth.
  const weak = { ...good, testability: 0.4 };
  assert.equal(decide("pass", weak, 0.75), "continue");

  // A `continue` is never argued with.
  assert.equal(decide("continue", good, 0.75), "continue");
  // Anything that is not one of the two verdicts goes on, it does not pass.
  assert.equal(decide("PASS", good, 0.75), "continue");
  assert.equal(decide(undefined, good, 0.75), "continue");
});

test("dossierOf: the form's answers and everything said afterwards", () => {
  const dossier = dossierOf("the form's answers", [
    { role: "client", text: "I keep the training sessions" },
    { role: "system", text: "What does a session contain?" },
  ]);

  assert.match(dossier, /the form's answers/);
  assert.match(dossier, /\*\*Client:\*\* I keep the training sessions/);
  assert.match(dossier, /\*\*Analyst:\*\* What does a session contain\?/);
});
