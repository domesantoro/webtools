// Counting the rounds: how many times a request has already come back.
//
// It is the only number a refusal that does not come from the model depends on,
// and it is not stored anywhere: it is read from the project's register of steps.
// If it were counted wrong, either somebody with rounds left would be refused, or
// we would never stop asking.
//
//   node --test

import assert from "node:assert/strict";
import { test } from "node:test";

import { underspecifiedAttempts } from "../src/server.js";

const project = (results) => ({
  pipeline: { steps: results.map((result) => ({ step: "prevalidation", result })) },
});

test("underspecifiedAttempts: no steps, no rounds", () => {
  assert.equal(underspecifiedAttempts({}), 0);
  assert.equal(underspecifiedAttempts({ pipeline: { state: "PREANALYSIS" } }), 0);
  assert.equal(underspecifiedAttempts(project([])), 0);
});

test("underspecifiedAttempts: only the rounds sent back are counted", () => {
  assert.equal(underspecifiedAttempts(project(["underspecified"])), 1);
  assert.equal(underspecifiedAttempts(project(["underspecified", "underspecified"])), 2);
  // A failed check is not a round: the user rewrote nothing.
  assert.equal(underspecifiedAttempts(project(["failed", "underspecified", "failed"])), 1);
  assert.equal(underspecifiedAttempts(project(["passed"])), 0);
});
