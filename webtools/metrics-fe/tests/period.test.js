// The period: what comes off the address, and what is refused rather than corrected.

import assert from "node:assert/strict";
import { test } from "node:test";

import { addDays, dayOf, daysBetween, parseDay, readPeriod } from "../src/period.js";

const SETTINGS = { defaultDays: 30, presetsDays: [1, 7, 30, 90] };
const TODAY = new Date("2026-09-26T11:22:33.000Z");

function parameters(query) {
  return new URLSearchParams(query);
}

test("a day that does not exist is not rolled into the next month", () => {
  assert.ok(parseDay("2026-02-28"));
  assert.equal(parseDay("2026-02-31"), null);
  assert.equal(parseDay("2026-13-01"), null);
  assert.equal(parseDay("26-01-01"), null);
  assert.equal(parseDay(""), null);
  assert.equal(parseDay(null), null);
});

test("a period is inclusive: one day from a day to itself", () => {
  assert.equal(daysBetween("2026-09-26", "2026-09-26"), 1);
  assert.equal(daysBetween("2026-09-01", "2026-09-30"), 30);
  // Across a month, and across a year.
  assert.equal(daysBetween("2025-12-31", "2026-01-01"), 2);
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(dayOf(TODAY), "2026-09-26");
});

test("nothing on the address is the configured number of days ending today", () => {
  const read = readPeriod(parameters(""), SETTINGS, TODAY);
  assert.ok(read.ok);
  assert.equal(read.period.to, "2026-09-26");
  assert.equal(read.period.from, "2026-08-28");
  assert.equal(read.period.days, 30);
  assert.equal(read.period.endsToday, true);
});

test("two days on the address are the period, whatever its length", () => {
  const read = readPeriod(parameters("from=2026-01-01&to=2026-01-01"), SETTINGS, TODAY);
  assert.ok(read.ok);
  assert.equal(read.period.days, 1);
  assert.equal(read.period.endsToday, false);
});

test("half a period is refused, and so is one that runs backwards", () => {
  for (const query of ["from=2026-09-01", "to=2026-09-01", "from=2026-09-30&to=2026-09-01", "from=x&to=2026-09-01"]) {
    const read = readPeriod(parameters(query), SETTINGS, TODAY);
    assert.equal(read.ok, false, query);
    assert.equal(read.code, "INVALID_PERIOD");
  }
});

test("what was written is carried into the refusal, so the page can say which day it was", () => {
  const read = readPeriod(parameters("from=2026-02-31&to=2026-03-01"), SETTINGS, TODAY);
  assert.equal(read.ok, false);
  assert.equal(read.from, "2026-02-31");
  assert.equal(read.to, "2026-03-01");
});

test("the presets are the configured lengths, and the one being looked at is marked", () => {
  const read = readPeriod(parameters(""), SETTINGS, TODAY);
  assert.deepEqual(
    read.period.presets.map((preset) => preset.days),
    [1, 7, 30, 90]
  );
  assert.deepEqual(
    read.period.presets.filter((preset) => preset.current).map((preset) => preset.days),
    [30]
  );
  // A preset is a period ending today: one day is today alone.
  assert.deepEqual(read.period.presets[0], { days: 1, from: "2026-09-26", to: "2026-09-26", current: false });
});

test("a step back is as long as what is being looked at; there is no step into the future", () => {
  const read = readPeriod(parameters("from=2026-09-20&to=2026-09-26"), SETTINGS, TODAY);
  assert.deepEqual(read.period.previous, { from: "2026-09-13", to: "2026-09-19" });
  assert.equal(read.period.next, null);

  const earlier = readPeriod(parameters("from=2026-09-01&to=2026-09-07"), SETTINGS, TODAY);
  assert.deepEqual(earlier.period.next, { from: "2026-09-08", to: "2026-09-14" });
});

test("a step forward never runs past today", () => {
  const read = readPeriod(parameters("from=2026-09-18&to=2026-09-24"), SETTINGS, TODAY);
  assert.equal(read.period.next.to, "2026-09-26");
  assert.equal(read.period.next.from, "2026-09-20");
});
