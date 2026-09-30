// Which list a project belongs to, and what a stopped one stopped on. Nothing runs and
// nothing is called: these are decisions taken on a project as anagraphics answers with
// it.
//
//   node --test tests/projects.test.js

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  APPROVED_BY_DRIVER_STATES,
  DRIVER_REVIEW_STATES,
  FAILED_STATES,
  MIN_BROKEN_PROJECTS_LEVEL,
  OWNER_RETURNED_STATES,
  OWNER_STOPPED_STATES,
  STATES_OWED_A_DRIVER,
  approvedByDriver,
  forDriver,
  forOwner,
  hasDocuments,
  orphans,
  rowOf,
  whyItStopped,
} from "../src/projects.js";

// A project as a list carries it: the whole document, with only the last step.
function project(state, { steps = [], ...rest } = {}) {
  return {
    project_id: `id-${state}`,
    owner_uid: "an-owner",
    pipeline: { state, steps },
    review: { driver: null, preset: false },
    billing: {},
    ...rest,
  };
}

const step = (name, result, data = {}) => ({ step: name, result, data, decided_at: "2026-09-30T10:00:00Z" });

const stateName = (one) => one.pipeline.state;

/* ------------------------------------------------------- the driver's two lists */

test("only DRIVER_VALIDATION waits for the driver", () => {
  const { waiting } = forDriver([
    project("DRIVER_VALIDATION"),
    project("CLIENT_VALIDATION"),
    project("ANALYSIS"),
  ]);
  assert.deepEqual(
    waiting.map((one) => one.pipeline.state),
    ["DRIVER_VALIDATION"]
  );
});

test("the two ways a run can be left are the driver's list of stopped projects", () => {
  const { failed } = forDriver([project("FAILED"), project("FAILED_NO_DRIVERS"), project("PAID")]);
  assert.deepEqual(
    failed.map((one) => one.pipeline.state),
    ["FAILED", "FAILED_NO_DRIVERS"]
  );
});

test("a project of this driver in DEVELOPMENT is in neither list", () => {
  // Read and not shown: the list that will hold it belongs to a gate that does not exist,
  // and a third list now would be a page built for work nothing can do.
  const lists = forDriver([project("DEVELOPMENT"), project("DEMO"), project("PAID")]);
  assert.deepEqual(lists, { waiting: [], failed: [] });
});

test("no projects at all is two empty lists and not a missing answer", () => {
  assert.deepEqual(forDriver([]), { waiting: [], failed: [] });
  assert.deepEqual(forDriver(undefined), { waiting: [], failed: [] });
});

/* ------------------------------------------------------- the owner's three lists */

test("what is moving, what came back, and what stopped", () => {
  const lists = forOwner([
    project("DEVELOPMENT"),
    project("UNDERSPECIFIED"),
    project("PREANALYSIS"),
    project("DEMO"),
    project("FAILED"),
    project("REJECTED"),
  ]);
  assert.deepEqual(lists.active.map(stateName), ["DEVELOPMENT", "DEMO"]);
  assert.deepEqual(lists.returned.map(stateName), ["UNDERSPECIFIED"]);
  assert.deepEqual(lists.stopped.map(stateName), ["PREANALYSIS", "FAILED", "REJECTED"]);
});

test("a project left in pre-analysis is stopped, not moving", () => {
  // The form was sent and the conversation abandoned: from this page there is nothing to
  // do about it, so it does not sit among the ones something is happening to.
  assert.equal(OWNER_STOPPED_STATES.includes("PREANALYSIS"), true);
  assert.deepEqual(forOwner([project("PREANALYSIS")]).active, []);
});

test("a project that was paid for is finished, not stopped", () => {
  // A success is not a fault, and putting it under the failures would say it was one.
  assert.deepEqual(forOwner([project("PAID")]).active.map(stateName), ["PAID"]);
});

test("a state nobody has a list for is shown as moving, not dropped", () => {
  // A state added to the pipeline tomorrow is a row somebody reads, instead of falling out
  // of all three lists and disappearing from their page.
  const lists = forOwner([project("A_STATE_INVENTED_TOMORROW")]);
  assert.equal(lists.active.length, 1);
  assert.equal(lists.returned.length + lists.stopped.length, 0);
});

test("every project is in exactly one of the three", () => {
  const states = [
    "PREANALYSIS", "PREVALIDATION", "UNDERSPECIFIED", "ANALYSIS", "DRIVER_VALIDATION",
    "CLIENT_VALIDATION", "DEVELOPMENT", "ALPHA_TEST", "DEMO", "PAID", "REJECTED",
    "FAILED", "FAILED_NO_DRIVERS",
  ];
  const lists = forOwner(states.map(project));
  assert.equal(lists.active.length + lists.returned.length + lists.stopped.length, states.length);
  // And the two named lists share no state with each other.
  assert.deepEqual(
    OWNER_RETURNED_STATES.filter((state) => OWNER_STOPPED_STATES.includes(state)),
    []
  );
});

/* ------------------------------------------- when the client may read the list */

test("the client may read the functionalities only once the driver has approved", () => {
  // Under review the analysis is written and nobody has checked it: what the client would
  // open is a draft nobody stands behind yet.
  assert.equal(approvedByDriver(project("DRIVER_VALIDATION")), false);
  assert.equal(approvedByDriver(project("CLIENT_VALIDATION")), true);
  for (const state of ["DEVELOPMENT", "ALPHA_TEST", "DEMO", "PAID"]) {
    assert.equal(approvedByDriver(project(state)), true, state);
  }
});

test("nothing before the driver's gate counts as approved", () => {
  for (const state of ["PREANALYSIS", "PREVALIDATION", "UNDERSPECIFIED", "ANALYSIS", "REJECTED", "FAILED", "FAILED_NO_DRIVERS"]) {
    assert.equal(approvedByDriver(project(state)), false, state);
  }
  // And the review itself is deliberately outside the list.
  assert.equal(APPROVED_BY_DRIVER_STATES.includes("DRIVER_VALIDATION"), false);
});

/* ------------------------------------------------------------------ the orphans */

test("an orphan that has also stopped is in the other list", () => {
  const { orphan, orphanFailed } = orphans([
    project("DRIVER_VALIDATION"),
    project("FAILED_NO_DRIVERS"),
    project("DEMO"),
    project("FAILED"),
  ]);
  assert.deepEqual(
    orphan.map((one) => one.pipeline.state),
    ["DRIVER_VALIDATION", "DEMO"]
  );
  assert.deepEqual(
    orphanFailed.map((one) => one.pipeline.state),
    ["FAILED_NO_DRIVERS", "FAILED"]
  );
});

test("the states a driver is owed to leave out the ones a project has not reached yet", () => {
  // A project in pre-analysis with no driver is not broken: it has not got there.
  for (const state of ["PREANALYSIS", "PREVALIDATION", "UNDERSPECIFIED", "ANALYSIS"]) {
    assert.equal(STATES_OWED_A_DRIVER.includes(state), false, state);
  }
  // And a refusal is closed: nobody is owed to it.
  assert.equal(STATES_OWED_A_DRIVER.includes("REJECTED"), false);
  // Everything the two lists partition is in there.
  for (const state of [...DRIVER_REVIEW_STATES, ...FAILED_STATES]) {
    assert.equal(STATES_OWED_A_DRIVER.includes(state), true, state);
  }
});

test("seeing other people's unsupervised projects takes level 2", () => {
  assert.equal(MIN_BROKEN_PROJECTS_LEVEL, 2);
});

/* ------------------------------------------------------- why a project stopped */

test("the last step says why, when it says anything", () => {
  const stopped = project("FAILED", {
    steps: [step("analysis", "failed", { failed_at: "technical", failure: "timed_out" })],
  });
  assert.equal(whyItStopped(stopped), "technical");
});

test("a handover that found nobody is its own reason", () => {
  const stopped = project("FAILED_NO_DRIVERS", {
    steps: [step("analysis", "failed", { failed_at: "handover", outcome: "gave_up", attempts: 3 })],
  });
  assert.equal(whyItStopped(stopped), "handover");
});

test("a step that failed without saying where has no reason, and no invented one", () => {
  assert.equal(whyItStopped(project("FAILED", { steps: [step("analysis", "failed")] })), null);
  assert.equal(whyItStopped(project("FAILED", { steps: [step("analysis", "failed", { failed_at: "" })] })), null);
});

test("a project that has not stopped has no reason", () => {
  assert.equal(whyItStopped(project("DRIVER_VALIDATION", { steps: [step("analysis", "passed")] })), null);
  assert.equal(whyItStopped(project("PREANALYSIS")), null);
  assert.equal(whyItStopped({}), null);
});

/* ------------------------------------------------------ whether the documents exist */

test("the step that closed the analysis says the documents are there", () => {
  const analysed = project("DRIVER_VALIDATION", {
    steps: [step("analysis", "passed", { documents: { analysis: { version: 1 }, proposal: { version: 1 } } })],
  });
  assert.equal(hasDocuments(analysed), true);
});

test("a handover that failed hides the step, and the state answers instead", () => {
  // The analysis was written, stored and paid for: what is missing is a person.
  const waiting = project("FAILED_NO_DRIVERS", {
    steps: [step("analysis", "failed", { failed_at: "handover" })],
  });
  assert.equal(hasDocuments(waiting), true);
});

test("a run that stopped at a door has no documents", () => {
  const stopped = project("FAILED", { steps: [step("analysis", "failed", { failed_at: "technical" })] });
  assert.equal(hasDocuments(stopped), false);
});

test("a project still in pre-analysis has no documents", () => {
  assert.equal(hasDocuments(project("PREANALYSIS")), false);
  assert.equal(hasDocuments(project("ANALYSIS")), false);
});

/* ----------------------------------------------------------------------- the row */

test("a project with no name and no description carries neither, and nothing instead", () => {
  const row = rowOf(project("PREANALYSIS"));
  assert.equal(row.name, null);
  assert.equal(row.description, null);
  assert.equal(row.autonomous_work, false);
  assert.equal(row.stopped_on, null);
});

test("a description and the autonomous-work flag are read where they are", () => {
  const row = rowOf(
    project("DRIVER_VALIDATION", {
      description: "Le presenze agli allenamenti",
      billing: { autonomous_work: true },
    })
  );
  assert.equal(row.description, "Le presenze agli allenamenti");
  assert.equal(row.autonomous_work, true);
});
