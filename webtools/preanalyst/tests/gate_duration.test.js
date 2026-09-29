// Which gate a duration belongs to.
//
// The twin of `tests/test_measurements.py` in the analyst: both subsystems append
// steps, both report `gate.duration`, and both got it wrong in the same way until
// 2026-09-29. The rule is written in `src/anagraphics.js` and it is one rule, so it
// is checked on both sides.
//
//   npm test

import assert from "node:assert/strict";
import test from "node:test";

import { gateThatFinished } from "../src/anagraphics.js";

const step = (name, result, decidedAt) => ({ step: name, result, decided_at: decidedAt });
const project = (...steps) => ({ pipeline: { steps } });

test("gateThatFinished: the gate that finished is the one that was open", () => {
  // The step that closes an open one may belong to another gate entirely: the
  // rounds of questions are opened by this subsystem and closed by the analyst's
  // own opening step. Naming the interval after the step that closes it filed the
  // whole conversation under `analysis`, added to the run's own minutes in the same
  // bucket — and left the longest wait in the pipeline with no bucket of its own.
  assert.deepEqual(
    gateThatFinished(
      project(
        step("preanalysis", "open", "2026-09-29T10:00:00Z"),
        step("analysis", "open", "2026-09-29T10:20:00Z")
      )
    ),
    { gate: "preanalysis", durationMs: 20 * 60 * 1000 }
  );
});

test("gateThatFinished: a gate that opened and decided is its own duration", () => {
  assert.deepEqual(
    gateThatFinished(
      project(
        step("analysis", "open", "2026-09-29T10:20:00Z"),
        step("analysis", "passed", "2026-09-29T10:23:00Z")
      )
    ),
    { gate: "analysis", durationMs: 3 * 60 * 1000 }
  );
});

test("gateThatFinished: nothing was open, so nothing finished", () => {
  // Between one gate deciding and the next writing anything there is dead time. It
  // is real, and it is a different question from how long a gate took: counting it
  // as a gate's duration put two things under one name.
  assert.equal(
    gateThatFinished(
      project(
        step("prevalidation", "passed", "2026-09-29T10:00:00Z"),
        step("preanalysis", "open", "2026-09-29T10:00:01Z")
      )
    ),
    null
  );
});

test("gateThatFinished: the first step of a pipeline has nothing before it", () => {
  assert.equal(gateThatFinished(project(step("prevalidation", "passed", "2026-09-29T10:00:00Z"))), null);
});

test("gateThatFinished: a clock that stepped back is a wrong number and is not reported", () => {
  assert.equal(
    gateThatFinished(
      project(
        step("analysis", "open", "2026-09-29T10:20:00Z"),
        step("analysis", "passed", "2026-09-29T10:19:00Z")
      )
    ),
    null
  );
});

test("gateThatFinished: a project with no steps at all", () => {
  assert.equal(gateThatFinished(undefined), null);
  assert.equal(gateThatFinished(project()), null);
});
