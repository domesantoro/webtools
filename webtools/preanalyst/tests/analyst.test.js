// The client towards the analyst: how an answer becomes one of the contract's
// outcomes. It is the only logic in that file, and the one the go button depends on.
//
//   node --test

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { startAnalysis } from "../src/analyst.js";

const PROJECT = "1f251606-bdba-40c4-bbee-bfedc6e57f70";

const settings = {
  analystUrl: "http://127.0.0.1:9800",
  analystTimeoutMs: 500,
  metrics: { measure: () => {}, timer: () => () => 0 },
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function answering(status, body) {
  globalThis.fetch = async (url, options) => {
    answering.called = { url, method: options.method };
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
}

test("a run that was taken", async () => {
  answering(202, { project_id: PROJECT, started: true });
  const started = await startAnalysis(settings, PROJECT);
  assert.deepEqual(started, { ok: true, data: { project_id: PROJECT, started: true } });
  assert.equal(answering.called.url, `http://127.0.0.1:9800/projects/${PROJECT}/analysis`);
  assert.equal(answering.called.method, "POST");
});

test("a project that cannot be analysed carries the analyst's own code", async () => {
  // Renaming it here would give one fact two names, and the caller branches on it:
  // a run already begun is not shown to the client as a failure.
  answering(409, { error: "ANALYSIS_ALREADY_STARTED" });
  const refused = await startAnalysis(settings, PROJECT);
  assert.deepEqual(refused, { ok: false, reason: "rejected", code: "ANALYSIS_ALREADY_STARTED" });
});

test("a subsystem that is not there is not the same as one that refused", async () => {
  answering(503, { error: "INTERNAL_ERROR" });
  assert.equal((await startAnalysis(settings, PROJECT)).reason, "unavailable");

  globalThis.fetch = async () => {
    throw Object.assign(new Error("no"), { name: "TimeoutError" });
  };
  assert.deepEqual(await startAnalysis(settings, PROJECT), { ok: false, reason: "unavailable" });
});

test("an answer that is not JSON is not an answer", async () => {
  globalThis.fetch = async () => new Response("<html>", { status: 200 });
  assert.deepEqual(await startAnalysis(settings, PROJECT), { ok: false, reason: "unavailable" });
});
