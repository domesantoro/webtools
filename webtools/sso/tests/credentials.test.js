// Password verification: the piece that must work identically in Python and in
// Node.
//
// The block below is not made up: it really was produced by
// `webtools_anagraphics/credentials.py` with the password "password-di-prova". If
// one day the two scrypts stopped computing the same thing, this test fails before
// a login does.

import assert from "node:assert/strict";
import { test } from "node:test";

import { verifyPassword } from "../src/credentials.js";

const PASSWORD = "password-di-prova";
const CREDENTIAL = {
  algorithm: "scrypt",
  params: { n: 16384, r: 8, p: 1, dklen: 32 },
  salt: "x9hENw++DZNaSJcQ7+Gqpw==",
  hash: "sCBbG78hlwM7ZyWSi0vmMQwsURojukn7s99GhDhm51M=",
};

test("accepts the right password, computed by Python", async () => {
  assert.equal(await verifyPassword(PASSWORD, CREDENTIAL), true);
});

test("refuses the wrong password", async () => {
  assert.equal(await verifyPassword("password-sbagliata", CREDENTIAL), false);
  assert.equal(await verifyPassword("", CREDENTIAL), false);
  // One extra character is not enough.
  assert.equal(await verifyPassword(`${PASSWORD} `, CREDENTIAL), false);
});

test("a badly made credential block lets nobody in and does not break the login", async () => {
  const malfatti = [
    null,
    undefined,
    {},
    { ...CREDENTIAL, algorithm: "md5" },
    { ...CREDENTIAL, params: undefined },
    { ...CREDENTIAL, params: { n: 0, r: 8, p: 1, dklen: 32 } },
    { ...CREDENTIAL, salt: "" },
    // A hash of a length other than dklen: timingSafeEqual would throw.
    { ...CREDENTIAL, hash: "c2hvcnQ=" },
  ];
  for (const credential of malfatti) {
    assert.equal(await verifyPassword(PASSWORD, credential), false);
  }
});
