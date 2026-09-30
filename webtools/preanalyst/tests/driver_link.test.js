// The driver's link: the nine outcomes, and who may supervise.
//
// This file exists because the rule it tests changed. Until 0.12.0 a driver either
// was `enabled: true` or was not; now there is a level, and the three lines that read
// it were the least covered in the subsystem.
//
// Anagraphics is not started: `globalThis.fetch` is replaced, as in
// `analyst.test.js`, so the real client runs and the contract it expects is part of
// what is tested. The driver list arrives already loaded, as the page loads it once
// per request.
//
//   node --test

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  DISCOUNT_APPLIED,
  DISCOUNT_DRIVER_DISABLED,
  DISCOUNT_DRIVER_MISSING,
  DISCOUNT_EXPIRED,
  DRIVER_APPLIED,
  DRIVER_DISABLED,
  DRIVER_UNKNOWN,
  NONE,
  OWN_LINK,
  isResolved,
  maySupervise,
  resolveDriverLink,
  withoutOwnLink,
} from "../src/driver_link.js";

// The drivers as `GET /drivers` hands them over: the driver's uid — not the person's
// — the name, the level and whether the person can log in.
const SUPERVISING = { uid: "d-1", screen_name: "Dome", level: 1, active: true };
const PRJ_ADMIN = { uid: "d-2", screen_name: "Admin", level: 2, active: true };
const TOO_LOW = { uid: "d-3", screen_name: "New", level: 0, active: true };
const DEACTIVATED = { uid: "d-4", screen_name: "Gone", level: 1, active: false };
const DRIVERS = [SUPERVISING, PRJ_ADMIN, TOO_LOW, DEACTIVATED];

const SETTINGS = {
  anagraphicsUrl: "http://127.0.0.1:9100",
  anagraphicsTimeoutMs: 500,
  metrics: { measure: () => {}, timer: () => () => 0 },
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// `GET /discounts/{code}` answers this. It is the only read the resolution makes.
function discountAnswers(status, body) {
  globalThis.fetch = async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
}

/* ------------------------------------------------------------- maySupervise */

test("from level 1 upwards a driver may supervise", () => {
  assert.equal(maySupervise(SUPERVISING), true);
  assert.equal(maySupervise(PRJ_ADMIN), true);
});

test("level 0 may not supervise", () => {
  assert.equal(maySupervise(TOO_LOW), false);
});

test("a deactivated person may not supervise, whatever their level", () => {
  assert.equal(maySupervise(DEACTIVATED), false);
});

test("a level that is not a whole number is not a level", () => {
  // `true >= 1` is true in JavaScript: a broken document must not pass for level 1.
  assert.equal(maySupervise({ uid: "x", level: true, active: true }), false);
  assert.equal(maySupervise({ uid: "x", level: "1", active: true }), false);
  assert.equal(maySupervise({ uid: "x", level: 1.5, active: true }), false);
  assert.equal(maySupervise({ uid: "x", active: true }), false);
  assert.equal(maySupervise(undefined), false);
});

test("a driver whose `active` is missing may not supervise", () => {
  // Absent is absent: it is not a yes.
  assert.equal(maySupervise({ uid: "x", level: 1 }), false);
});

/* ------------------------------------------------- the link with no parameter */

test("no parameter: no box", async () => {
  const link = await resolveDriverLink(SETTINGS, {}, DRIVERS);
  assert.deepEqual(link, { state: NONE });
  assert.equal(isResolved(link), false);
});

/* ------------------------------------------------------- the link by uid only */

test("the link's driver may supervise: applied", async () => {
  const link = await resolveDriverLink(SETTINGS, { driverUid: "d-1" }, DRIVERS);
  assert.equal(link.state, DRIVER_APPLIED);
  assert.equal(link.driver, SUPERVISING);
  assert.equal(isResolved(link), true);
});

test("a level above the threshold applies too", async () => {
  const link = await resolveDriverLink(SETTINGS, { driverUid: "d-2" }, DRIVERS);
  assert.equal(link.state, DRIVER_APPLIED);
});

test("the link's driver is at level 0: disabled, and the name is kept to show", async () => {
  const link = await resolveDriverLink(SETTINGS, { driverUid: "d-3" }, DRIVERS);
  assert.equal(link.state, DRIVER_DISABLED);
  assert.equal(link.driver.screen_name, "New");
  assert.equal(isResolved(link), false);
});

test("the link's driver cannot log in: disabled as well", async () => {
  const link = await resolveDriverLink(SETTINGS, { driverUid: "d-4" }, DRIVERS);
  assert.equal(link.state, DRIVER_DISABLED);
});

test("a uid that is in no driver: unknown", async () => {
  const link = await resolveDriverLink(SETTINGS, { driverUid: "nobody" }, DRIVERS);
  assert.equal(link.state, DRIVER_UNKNOWN);
  assert.equal(link.driverUid, "nobody");
});

/* ------------------------------------------------------- the link by discount */

test("a valid discount of a driver who may supervise: applied, with the percentage", async () => {
  discountAnswers(200, {
    discount_code: "c-1",
    driver: { uid: "d-1", screen_name: "Dome" },
    percentage: 5,
  });
  const link = await resolveDriverLink(SETTINGS, { discountCode: "c-1" }, DRIVERS);
  assert.equal(link.state, DISCOUNT_APPLIED);
  assert.equal(link.percentage, 5);
  assert.equal(link.code, "c-1");
  assert.equal(isResolved(link), true);
});

test("a discount of a driver at level 0: the discount falls with the driver", async () => {
  discountAnswers(200, {
    discount_code: "c-3",
    driver: { uid: "d-3", screen_name: "New" },
    percentage: 10,
  });
  const link = await resolveDriverLink(SETTINGS, { discountCode: "c-3" }, DRIVERS);
  assert.equal(link.state, DISCOUNT_DRIVER_DISABLED);
  assert.equal(link.code, "c-3");
});

test("a discount whose driver is in no list: missing, and the name comes from the copy", async () => {
  discountAnswers(200, {
    discount_code: "c-x",
    driver: { uid: "gone", screen_name: "Ghost" },
    percentage: 5,
  });
  const link = await resolveDriverLink(SETTINGS, { discountCode: "c-x" }, DRIVERS);
  assert.equal(link.state, DISCOUNT_DRIVER_MISSING);
  // The only handle the user is left with for recognising whom to contact.
  assert.equal(link.driverName, "Ghost");
});

test("a discount that does not exist: expired", async () => {
  discountAnswers(404, { error: "DISCOUNT_NOT_FOUND" });
  const link = await resolveDriverLink(SETTINGS, { discountCode: "c-?" }, DRIVERS);
  assert.equal(link.state, DISCOUNT_EXPIRED);
});

test("anagraphics down: expired as well, and the difference stays in the log", async () => {
  // For the user the discount simply does not apply; telling them a technical
  // failure would ask them to do something about a thing that is ours.
  globalThis.fetch = async () => {
    throw new Error("connection refused");
  };
  const link = await resolveDriverLink(SETTINGS, { discountCode: "c-?" }, DRIVERS);
  assert.equal(link.state, DISCOUNT_EXPIRED);
});

test("discount and driver together: the discount wins", async () => {
  discountAnswers(200, {
    discount_code: "c-1",
    driver: { uid: "d-1", screen_name: "Dome" },
    percentage: 5,
  });
  const link = await resolveDriverLink(
    SETTINGS,
    { discountCode: "c-1", driverUid: "d-2" },
    DRIVERS
  );
  assert.equal(link.state, DISCOUNT_APPLIED);
  assert.equal(link.driver.uid, "d-1");
});

/* ------------------------------------------------------------------ own link */

test("a driver does not send a client to themselves", () => {
  const applied = { state: DRIVER_APPLIED, driver: SUPERVISING };
  assert.deepEqual(withoutOwnLink(applied, "d-1"), { state: OWN_LINK, code: null });
});

test("another driver's link stays valid: it is work they brought in", () => {
  const applied = { state: DRIVER_APPLIED, driver: SUPERVISING };
  assert.equal(withoutOwnLink(applied, "d-2"), applied);
});

test("one's own discount does not apply either, and the code is kept", () => {
  const applied = { state: DISCOUNT_APPLIED, code: "c-1", driver: SUPERVISING, percentage: 5 };
  assert.deepEqual(withoutOwnLink(applied, "d-1"), { state: OWN_LINK, code: "c-1" });
});

test("a uid that was not recognised is compared all the same", () => {
  // `driver_unknown` carries `driverUid` and no driver: whoever used their own
  // expired link must not be told a stranger's link failed.
  const unknown = { state: DRIVER_UNKNOWN, driverUid: "d-1" };
  assert.deepEqual(withoutOwnLink(unknown, "d-1"), { state: OWN_LINK, code: null });
});

test("whoever is not a driver has no own link", () => {
  const applied = { state: DRIVER_APPLIED, driver: SUPERVISING };
  assert.equal(withoutOwnLink(applied, null), applied);
});
