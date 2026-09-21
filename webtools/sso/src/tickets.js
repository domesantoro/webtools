// Il biglietto: come si passa una sessione da un indirizzo a un altro.
//
// Il problema che risolve. Un cookie appartiene a un indirizzo: il sso, che sta
// su `127.0.0.1:8300`, non può mettere un cookie per conto di preanalyst, che sta
// su un altro. E il token della sessione non può viaggiare nell'indirizzo, perché
// l'indirizzo finisce nella cronologia del browser, nei log dei proxy e nei link
// che la gente si passa: uno scontrino che vale otto ore non si lascia in giro.
//
// La soluzione è un secondo scontrino, fatto apposta per essere lasciato in giro:
//
//   1. il sso crea un biglietto che punta alla sessione, e vive un minuto;
//   2. manda il browser da preanalyst con il biglietto nell'indirizzo;
//   3. preanalyst lo scambia **da dietro**, da server a server, e riceve la sessione;
//   4. il biglietto viene cancellato nello stesso momento in cui viene letto.
//
// Quindi anche chi legge il biglietto in un log trova qualcosa di scaduto e già
// consumato. Il token vero non è mai passato dall'indirizzo.

import { randomBytes } from "node:crypto";

const TICKET_BYTES = 32;

export function newTicket() {
  return randomBytes(TICKET_BYTES).toString("base64url");
}

export function buildTicket(token, service, ttlSeconds, now = new Date()) {
  return {
    ticket: newTicket(),
    token,
    // A chi è stato dato. Serve a non far scambiare a un sottosistema un
    // biglietto emesso per un altro.
    service,
    issued_at: new Date(now.getTime()).toISOString(),
    expires_at: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
  };
}

export function isExpired(ticket, now = new Date()) {
  const expiresAt = Date.parse(ticket?.expires_at ?? "");
  if (Number.isNaN(expiresAt)) return true;
  return expiresAt <= now.getTime();
}

// Il sottosistema che riceve il biglietto: `http://127.0.0.1:8200` da
// `http://127.0.0.1:8200/qualcosa?x=1`. È la parte che si confronta con il
// `service` scritto dentro il biglietto.
export function serviceOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

// Aggiunge il biglietto all'indirizzo di ritorno, senza perdere i parametri
// che c'erano già (per esempio `?discount=` di preanalyst).
export function withTicket(next, ticket) {
  const url = new URL(next);
  url.searchParams.set("ticket", ticket);
  return url.toString();
}
