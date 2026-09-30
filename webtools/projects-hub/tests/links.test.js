// A driver's links, and the discount code one of them carries. The anagraphics client is
// replaced by what it would have answered, so nothing has to be running.
//
//   node --test tests/links.test.js

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ambassadorLink,
  codeFor,
  discountLink,
  driverLink,
  maySupervise,
  percentages,
  readPercentage,
} from "../src/links.js";

const SETTINGS = {
  preanalystUrl: "http://127.0.0.1:9200",
  discount: { minPercentage: 1, maxPercentage: 5 },
};

const DRIVER_UID = "7633be3d-e701-42ca-9fea-6c6d1bb4b7d1";
const CODE = "e8013cf2-34eb-4bc3-8a34-b08fb24a1bf3";

/* -------------------------------------------------------------- the three links */

test("an ambassador's link carries the driver's uid", () => {
  assert.equal(
    ambassadorLink(SETTINGS, DRIVER_UID),
    `http://127.0.0.1:9200/?ambassador=${DRIVER_UID}`
  );
});

test("a driver's link without a discount carries the driver's uid", () => {
  assert.equal(driverLink(SETTINGS, DRIVER_UID), `http://127.0.0.1:9200/?driver=${DRIVER_UID}`);
});

test("a link with a discount carries the code and NOT the driver", () => {
  // In the preanalyst `discount` wins over `driver` when both arrive, so sending both
  // would put a parameter in the address that nothing reads — and the code already says
  // whose it is.
  const link = discountLink(SETTINGS, CODE);
  assert.equal(link, `http://127.0.0.1:9200/?discount=${CODE}`);
  assert.equal(link.includes("driver="), false);
});

/* ------------------------------------------------------------- which levels, which */

test("an ambassador is any driver, a driver's link needs the level that supervises", () => {
  assert.equal(maySupervise({ driver_uid: DRIVER_UID, level: 0 }), false);
  assert.equal(maySupervise({ driver_uid: DRIVER_UID, level: 1 }), true);
  assert.equal(maySupervise({ driver_uid: DRIVER_UID, level: 2 }), true);
});

test("a level that is not a whole number is not a level", () => {
  // `true >= 1` is true in JavaScript: a `level: true` is a broken session, not a driver
  // at level 1.
  assert.equal(maySupervise({ level: true }), false);
  assert.equal(maySupervise({ level: "1" }), false);
  assert.equal(maySupervise({}), false);
  assert.equal(maySupervise(null), false);
});

/* ------------------------------------------------------------------ the percentages */

test("the percentages offered are the configured range, one by one", () => {
  assert.deepEqual(percentages(SETTINGS), [1, 2, 3, 4, 5]);
  assert.deepEqual(percentages({ discount: { minPercentage: 3, maxPercentage: 3 } }), [3]);
});

test("no percentage chosen is no discount, and not a zero", () => {
  assert.equal(readPercentage(SETTINGS, ""), null);
  assert.equal(readPercentage(SETTINGS, null), null);
  assert.equal(readPercentage(SETTINGS, undefined), null);
});

test("a percentage outside the configured range is refused", () => {
  // Not a smaller discount: a number nobody may choose.
  for (const value of ["0", "6", "50", "100", "-3", "2.5", "three"]) {
    assert.equal(readPercentage(SETTINGS, value), null, value);
  }
});

test("a percentage inside the range comes through as a number", () => {
  assert.equal(readPercentage(SETTINGS, "3"), 3);
  assert.equal(readPercentage(SETTINGS, "1"), 1);
  assert.equal(readPercentage(SETTINGS, "5"), 5);
});

/* ------------------------------------------------------------------- the code */

// The anagraphics client, replaced. It writes down what it was asked, so a write that
// should not have happened is visible.
function fakeAnagraphics({ discounts = [], broken = false } = {}) {
  const created = [];
  return {
    created,
    async listDiscounts() {
      if (broken) return { ok: false, reason: "unavailable" };
      return { ok: true, data: discounts };
    },
    async createDiscount(_settings, driverUid, percentage) {
      if (broken) return { ok: false, reason: "unavailable" };
      created.push({ driverUid, percentage });
      const discount = { discount_code: `made-${percentage}`, percentage };
      discounts.push(discount);
      return { ok: true, data: discount };
    },
  };
}

test("a percentage that already has a code reuses it and writes nothing", () => {
  const client = fakeAnagraphics({ discounts: [{ discount_code: CODE, percentage: 5 }] });
  return codeFor(SETTINGS, DRIVER_UID, 5, client).then((answer) => {
    assert.deepEqual(answer, { ok: true, code: CODE, created: false });
    // A link already handed out goes on working, which is the whole reason not to make a
    // second one.
    assert.deepEqual(client.created, []);
  });
});

test("a percentage with no code yet gets one", async () => {
  const client = fakeAnagraphics({ discounts: [{ discount_code: CODE, percentage: 5 }] });
  const answer = await codeFor(SETTINGS, DRIVER_UID, 3, client);
  assert.deepEqual(answer, { ok: true, code: "made-3", created: true });
  assert.deepEqual(client.created, [{ driverUid: DRIVER_UID, percentage: 3 }]);
});

test("asking twice for the same percentage makes one code", async () => {
  const client = fakeAnagraphics();
  const first = await codeFor(SETTINGS, DRIVER_UID, 2, client);
  const second = await codeFor(SETTINGS, DRIVER_UID, 2, client);
  assert.equal(first.code, second.code);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(client.created.length, 1);
});

test("anagraphics not answering is a reason and not a code", async () => {
  const answer = await codeFor(SETTINGS, DRIVER_UID, 3, fakeAnagraphics({ broken: true }));
  assert.equal(answer.ok, false);
  assert.equal(answer.reason, "unavailable");
});
