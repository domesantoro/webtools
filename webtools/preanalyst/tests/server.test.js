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

import { opensPreanalysis, underspecifiedAttempts } from "../src/server.js";

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

/* ----------------------------------------------------------------------------
   Which states may have a pre-analysis step opened for them.

   The rule used to be "there is no open step", which is a different question:
   a project that has been through the pre-analysis has no open step either, and so
   has one that was refused before the conversation began. On that rule a refused
   request got a fresh allowance of turns by having its address retyped, and every
   reload of a finished conversation would have granted another one.

   The list below is a copy of `PipelineState` in anagraphics, because on this side
   there is no list of the states. A copy does not notice a name added over there,
   which is exactly why the rule is written as an allowlist: what is not named opens
   nothing, so a state nobody has thought about here is handled and not guessed.
   ------------------------------------------------------------------------- */

const PIPELINE_STATES = [
  "PREANALYSIS",
  "PREVALIDATION",
  "UNDERSPECIFIED",
  "DRIVER_VALIDATION",
  "CLIENT_VALIDATION",
  "DEVELOPMENT",
  "ALPHA_TEST",
  "DEMO",
  "PAID",
  "REJECTED",
  // A run that did not get to the end, and an analysis nobody can be given. Neither
  // opens a pre-analysis: what is written is written, and a project left there is
  // looked at rather than started again from the questions.
  "FAILED",
  "FAILED_NO_DRIVERS",
];

test("opensPreanalysis: the pre-analysis and a check that did not succeed", () => {
  // The pre-analysis is where the rounds of questions live. `PREVALIDATION` is the
  // state of a check that failed: the project stays, and its client is sent to that
  // page on purpose, so the rounds have to be able to begin there too.
  assert.equal(opensPreanalysis("PREANALYSIS"), true);
  assert.equal(opensPreanalysis("PREVALIDATION"), true);
});

test("opensPreanalysis: nowhere else, one case per state", () => {
  const opens = PIPELINE_STATES.filter(opensPreanalysis);
  assert.deepEqual(opens, ["PREANALYSIS", "PREVALIDATION"]);
});

test("opensPreanalysis: a state we cannot read opens nothing", () => {
  // A project with no pipeline, or with a name nobody here knows: the answer is the
  // same, and it is not "open one and see".
  assert.equal(opensPreanalysis(null), false);
  assert.equal(opensPreanalysis(undefined), false);
  assert.equal(opensPreanalysis("ANALYSIS"), false);
  assert.equal(opensPreanalysis(""), false);
});
