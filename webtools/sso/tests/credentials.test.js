// Verifica della password: il pezzo che deve funzionare identico in Python e in Node.
//
// Il blocco qui sotto non è inventato: è stato prodotto davvero da
// `webtools_anagraphics/credentials.py` con la password "password-di-prova".
// Se un giorno i due scrypt smettessero di calcolare la stessa cosa, questo
// test fallisce prima che a fallire sia un login.

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

test("accetta la password giusta, calcolata da Python", async () => {
  assert.equal(await verifyPassword(PASSWORD, CREDENTIAL), true);
});

test("rifiuta la password sbagliata", async () => {
  assert.equal(await verifyPassword("password-sbagliata", CREDENTIAL), false);
  assert.equal(await verifyPassword("", CREDENTIAL), false);
  // Un carattere in più non basta.
  assert.equal(await verifyPassword(`${PASSWORD} `, CREDENTIAL), false);
});

test("un blocco credenziali malfatto non fa entrare e non rompe il login", async () => {
  const malfatti = [
    null,
    undefined,
    {},
    { ...CREDENTIAL, algorithm: "md5" },
    { ...CREDENTIAL, params: undefined },
    { ...CREDENTIAL, params: { n: 0, r: 8, p: 1, dklen: 32 } },
    { ...CREDENTIAL, salt: "" },
    // Hash di lunghezza diversa da dklen: timingSafeEqual lancerebbe.
    { ...CREDENTIAL, hash: "c2hvcnQ=" },
  ];
  for (const credential of malfatti) {
    assert.equal(await verifyPassword(PASSWORD, credential), false);
  }
});
