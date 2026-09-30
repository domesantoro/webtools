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

import { opensPreanalysis, rejectionCase, underspecifiedAttempts } from "../src/server.js";

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

/* ----------------------------------------------------------------------------
   Which refusal a refused project got.

   `REJECTED` is the terminus of every gate, so the state cannot say which one
   refused: the steps can, and the sentence the client reads depends on it.
   ---------------------------------------------------------------------------- */

const refused = (...steps) => ({ pipeline: { state: "REJECTED", steps } });
const prevalidation = (result, outcome) => ({
  step: "prevalidation",
  result,
  data: outcome ? { outcome } : {},
});

test("rejectionCase: the prevalidator's two refusals each have their own sentence", () => {
  assert.equal(rejectionCase(refused(prevalidation("rejected", "run_out_certain"))), "out_of_scope");
  assert.equal(rejectionCase(refused(prevalidation("rejected", "non_sequitur"))), "not_software");
});

test("rejectionCase: with nothing to go on, the request was not recognised", () => {
  assert.equal(rejectionCase({}), "not_recognised");
  assert.equal(rejectionCase(refused()), "not_recognised");
  assert.equal(rejectionCase(refused(prevalidation("rejected", null))), "not_recognised");
});

test("rejectionCase: a refusal at the driver's gate is not any of the three", () => {
  // Everything before it worked: the request was understood, judged worth analysing,
  // analysed and paid for. The prevalidation it passed is still on the project, and
  // reading that step alone would call this request unrecognised — which is the one
  // thing it is not.
  const project = refused(
    prevalidation("passed", "safe"),
    { step: "preanalysis", result: "passed", data: {} },
    { step: "analysis", result: "passed", data: {} },
    { step: "driver_validation", result: "rejected", data: { reason: "Fuori perimetro." } }
  );
  assert.equal(rejectionCase(project), "after_review");
});

test("rejectionCase: an analysis that failed is not a refusal at that gate", () => {
  // `failed` is not `rejected`: nobody decided anything about the request, and such a
  // project is not `REJECTED` in the first place.
  const project = refused(
    prevalidation("rejected", "run_out_certain"),
    { step: "analysis", result: "failed", data: { failed_at: "technical" } }
  );
  assert.equal(rejectionCase(project), "out_of_scope");
});
