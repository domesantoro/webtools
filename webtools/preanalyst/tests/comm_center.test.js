// The client towards the comm-center: what a communication carries, and how an answer
// becomes one of the contract's outcomes.
//
//   node --test
//
// It is called on one path only — turns drawn from somebody's credit that never reached
// the project and could not be given back — and what matters about that path is that the
// person and the number both leave with it.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { turnsLost } from "../src/comm_center.js";

const PROJECT = "1f251606-bdba-40c4-bbee-bfedc6e57f70";
const CLIENT = {
  uid: "c6d0f3a2-1f0e-4b7c-9d33-0b9a7c2e5511",
  screen_name: "Anna",
  username: "anna@example.org",
  // The user document carries more than a communication needs. What is not part of the
  // contract does not travel.
  billing: { turns_credit: 4 },
};

const measurements = () => {
  const taken = [];
  return { taken, measure: (metric, fields) => taken.push({ metric, ...fields }), timer: () => () => 0 };
};

const settings = () => ({
  commCenterUrl: "http://127.0.0.1:9002",
  commCenterTimeoutMs: 500,
  metrics: measurements(),
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function answering(status, body) {
  globalThis.fetch = async (url, options) => {
    answering.called = { url, method: options.method, body: JSON.parse(options.body) };
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
}

test("what leaves is the person, the project and how many turns", async () => {
  answering(202, { taken: true });
  const told = await turnsLost(settings(), PROJECT, CLIENT, 3);

  assert.deepEqual(told, { ok: true });
  assert.equal(answering.called.url, "http://127.0.0.1:9002/communications/turns-lost");
  assert.deepEqual(answering.called.body, {
    project_id: PROJECT,
    client: { uid: CLIENT.uid, screen_name: CLIENT.screen_name, username: CLIENT.username },
    turns: 3,
  });
});

test("a communication the other side would not take is not a service that is down", async () => {
  // Two different things to do about it: one is a body of ours that is wrong, and asking
  // again with the same one buys the same answer.
  answering(400, { error: "INVALID_BODY" });
  assert.deepEqual(await turnsLost(settings(), PROJECT, CLIENT, 3), {
    ok: false,
    reason: "rejected",
    code: "INVALID_BODY",
  });
});

test("a comm-center that is not there", async () => {
  answering(503, { error: "INTERNAL_ERROR" });
  assert.equal((await turnsLost(settings(), PROJECT, CLIENT, 3)).reason, "unavailable");

  globalThis.fetch = async () => {
    throw Object.assign(new Error("no"), { name: "TimeoutError" });
  };
  assert.deepEqual(await turnsLost(settings(), PROJECT, CLIENT, 3), {
    ok: false,
    reason: "unavailable",
  });
});

test("every call is measured once, under the form's own name", async () => {
  const up = settings();
  answering(202, { taken: true });
  await turnsLost(up, PROJECT, CLIENT, 3);

  assert.deepEqual(up.metrics.taken, [
    {
      metric: "dependency.call",
      dims: { target: "comm-center", operation: "turns_lost", outcome: "ok" },
      duration_ms: 0,
    },
  ]);
});

test("a timeout is told apart from a refusal in what is counted", async () => {
  const up = settings();
  globalThis.fetch = async () => {
    throw Object.assign(new Error("no"), { name: "TimeoutError" });
  };
  await turnsLost(up, PROJECT, CLIENT, 3);
  assert.equal(up.metrics.taken[0].dims.outcome, "timed_out");
});
