// Verifica di una password contro il blocco `credential` conservato in anagraphics.
//
// Il formato lo scrive anagraphics (`webtools_anagraphics/credentials.py`), qui si
// legge soltanto:
//
//   { algorithm: "scrypt", params: { n, r, p, dklen }, salt: <base64>, hash: <base64> }
//
// I parametri si prendono dal documento, non da costanti di qui: il giorno che si
// alzano, le password vecchie restano verificabili con i propri.

import { scrypt, timingSafeEqual } from "node:crypto";

const SCRYPT = "scrypt";
// 128 * n * r con n=16384 e r=8 fa 16 MB: il default di Node non basta.
const MAXMEM = 64 * 1024 * 1024;

function scryptAsync(password, salt, keylen, options) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

// true solo se la password corrisponde. Qualunque cosa non torni — algoritmo
// sconosciuto, parametri assenti, base64 rotto — è false, mai un'eccezione:
// un documento malfatto non deve far entrare nessuno, e nemmeno rompere il login.
export async function verifyPassword(password, credential) {
  if (!credential || credential.algorithm !== SCRYPT) {
    console.error(`[credentials] algoritmo non gestito: ${credential?.algorithm ?? "assente"}`);
    return false;
  }

  const { n, r, p, dklen } = credential.params ?? {};
  if (![n, r, p, dklen].every((value) => Number.isInteger(value) && value > 0)) {
    console.error("[credentials] parametri scrypt mancanti o non validi");
    return false;
  }

  let salt;
  let expected;
  try {
    salt = Buffer.from(credential.salt, "base64");
    expected = Buffer.from(credential.hash, "base64");
  } catch {
    console.error("[credentials] salt o hash non decodificabili");
    return false;
  }
  if (salt.length === 0 || expected.length !== dklen) {
    console.error("[credentials] salt vuoto o hash di lunghezza inattesa");
    return false;
  }

  let derived;
  try {
    derived = await scryptAsync(password, salt, dklen, { N: n, r, p, maxmem: MAXMEM });
  } catch (error) {
    console.error(`[credentials] scrypt fallito: ${error.message}`);
    return false;
  }

  // Confronto a tempo costante: la durata della risposta non deve dire
  // quanti byte dell'hash erano giusti.
  return timingSafeEqual(derived, expected);
}
