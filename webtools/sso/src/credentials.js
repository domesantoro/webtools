// Verifying a password against the `credential` block stored in anagraphics.
//
// The format is written by anagraphics (`webtools_anagraphics/credentials.py`);
// here it is only read:
//
//   { algorithm: "scrypt", params: { n, r, p, dklen }, salt: <base64>, hash: <base64> }
//
// The parameters are taken from the document, not from constants here: the day
// they are raised, old passwords stay verifiable with their own.

import { scrypt, timingSafeEqual } from "node:crypto";

const SCRYPT = "scrypt";
// 128 * n * r with n=16384 and r=8 makes 16 MB: Node's default is not enough.
const MAXMEM = 64 * 1024 * 1024;

function scryptAsync(password, salt, keylen, options) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

// true only if the password matches. Anything that does not add up — unknown
// algorithm, missing parameters, broken base64 — is false, never an exception: a
// badly made document must let nobody in, and must not break the login either.
export async function verifyPassword(password, credential) {
  if (!credential || credential.algorithm !== SCRYPT) {
    console.error(`[credentials] algorithm not handled: ${credential?.algorithm ?? "missing"}`);
    return false;
  }

  const { n, r, p, dklen } = credential.params ?? {};
  if (![n, r, p, dklen].every((value) => Number.isInteger(value) && value > 0)) {
    console.error("[credentials] scrypt parameters missing or invalid");
    return false;
  }

  let salt;
  let expected;
  try {
    salt = Buffer.from(credential.salt, "base64");
    expected = Buffer.from(credential.hash, "base64");
  } catch {
    console.error("[credentials] salt or hash cannot be decoded");
    return false;
  }
  if (salt.length === 0 || expected.length !== dklen) {
    console.error("[credentials] empty salt or hash of unexpected length");
    return false;
  }

  let derived;
  try {
    derived = await scryptAsync(password, salt, dklen, { N: n, r, p, maxmem: MAXMEM });
  } catch (error) {
    console.error(`[credentials] scrypt failed: ${error.message}`);
    return false;
  }

  // Constant-time comparison: how long the answer takes must not say how many
  // bytes of the hash were right.
  return timingSafeEqual(derived, expected);
}
