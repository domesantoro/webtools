// La sessione: come si costruisce, quando è scaduta, che cosa se ne mostra.
//
// Il documento conservato in anagraphics è questo, e non ce n'è un altro dentro
// il sso: chi risponde a `GET /session` legge esattamente quello che c'è nel
// database, così un secondo processo del sso vede le stesse sessioni del primo.
//
//   {
//     token:      stringa casuale, l'unico segreto che gira
//     uid:        identità della persona
//     username:   quello che ha digitato al login
//     issued_at:  quando è entrata
//     expires_at: quando smette di valere
//     data:       dati di sessione, liberi. Oggi contiene la fotografia
//                 dell'utente al momento del login (screen_name, driver_uid),
//                 così leggere una sessione non costa una seconda lettura.
//   }
//
// La fotografia invecchia: se cambia lo `screen_name`, le sessioni già aperte
// continuano a mostrare quello vecchio fino al login successivo. È lo stesso
// compromesso già fatto per il driver dentro i codici sconto.

import { randomBytes } from "node:crypto";

// 32 byte casuali: il token non contiene informazioni, non si può indovinare e
// non dice niente di sé. Chi lo ha, ha la sessione; chi la vuole leggere, chiede qui.
const TOKEN_BYTES = 32;

export function newToken() {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function buildSession(user, ttlSeconds, now = new Date()) {
  const issuedAt = new Date(now.getTime());
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
  return {
    token: newToken(),
    uid: user.uid,
    username: user.username,
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    data: {
      screen_name: user.screen_name ?? null,
      driver_uid: user.driver_uid ?? null,
    },
  };
}

// Una sessione senza scadenza leggibile è scaduta: se non si sa fino a quando
// vale, non vale.
export function isExpired(session, now = new Date()) {
  const expiresAt = Date.parse(session?.expires_at ?? "");
  if (Number.isNaN(expiresAt)) return true;
  return expiresAt <= now.getTime();
}
