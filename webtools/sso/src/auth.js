// Le operazioni del sso: entrare, sapere chi è entrato, uscire, cambiare lingua.
//
// Qui sta la decisione; il dato sta in anagraphics. Il client di anagraphics si
// passa da fuori (`client`) perché queste funzioni si possano provare senza
// avere anagraphics acceso.
//
// Ogni funzione restituisce { ok: true, body } oppure { ok: false, status, code }:
// la traduzione in HTTP la fa il server, non questa parte.

import * as anagraphics from "./anagraphics.js";
import { verifyPassword } from "./credentials.js";
import { buildSession, isExpired } from "./sessions.js";
import { buildTicket, isExpired as ticketIsExpired } from "./tickets.js";

export const INVALID_CREDENTIALS = "INVALID_CREDENTIALS";
export const ANAGRAPHICS_UNAVAILABLE = "ANAGRAPHICS_UNAVAILABLE";
export const TICKET_NOT_FOUND = "TICKET_NOT_FOUND";
export const TICKET_EXPIRED = "TICKET_EXPIRED";
export const TICKET_MISMATCH = "TICKET_MISMATCH";

const unavailable = { ok: false, status: 503, code: ANAGRAPHICS_UNAVAILABLE };
// Utente sconosciuto, utente disattivato, password mai impostata, password
// sbagliata: all'utente si risponde sempre la stessa cosa. Sapere *quale* dei
// quattro è vero direbbe a chi prova se un indirizzo è registrato. Il motivo
// vero resta nel log.
const refused = { ok: false, status: 401, code: INVALID_CREDENTIALS };

// `locale`: la lingua in cui si stava guardando la pagina di login, se c'è.
// Vince quella salvata nel profilo; se il profilo non ne ha, si salva questa.
export async function login(settings, { username, password, locale = null }, client = anagraphics) {
  const userResult = await client.findUser(settings, username);
  if (!userResult.ok) {
    if (userResult.reason === "not_found") {
      console.warn(`[sso] login rifiutato: utente sconosciuto (${username})`);
      return refused;
    }
    return unavailable;
  }

  const user = userResult.data;
  if (user.active === false) {
    console.warn(`[sso] login rifiutato: utente disattivato (${username})`);
    return refused;
  }

  const credentialResult = await client.findUserCredential(settings, username);
  if (!credentialResult.ok) {
    if (credentialResult.reason === "not_found") {
      // CREDENTIAL_NOT_SET: l'utente esiste ma non ha una password.
      console.warn(`[sso] login rifiutato: ${credentialResult.code} (${username})`);
      return refused;
    }
    return unavailable;
  }

  if (!(await verifyPassword(password, credentialResult.data.credential))) {
    console.warn(`[sso] login rifiutato: password sbagliata (${username})`);
    return refused;
  }

  const sessionLocale = user.locale ?? locale;
  if (!user.locale && locale) {
    // Se non si riesce a salvarla il login va avanti lo stesso: la lingua
    // resta nel cookie e nella sessione.
    const salvata = await client.setUserLocale(settings, username, locale);
    if (!salvata.ok) console.error(`[sso] lingua non salvata nel profilo di ${username}: ${salvata.reason}`);
  }

  const session = buildSession(user, settings.sessionTtlSeconds, new Date(), sessionLocale);
  const created = await client.createSession(settings, session);
  if (!created.ok) {
    // Anche il 409: due token casuali da 32 byte non si scontrano, quindi un
    // conflitto qui è un difetto, non un caso sfortunato. Va guardato.
    console.error(`[sso] sessione non creata per ${username}: ${created.reason} ${created.code ?? ""}`);
    return unavailable;
  }

  console.log(`[sso] login di ${username} (uid ${user.uid})`);
  return { ok: true, status: 201, body: { logged: true, session: created.data } };
}

export async function readSession(settings, token, client = anagraphics) {
  const result = await client.findSession(settings, token);
  if (!result.ok) {
    // Token sconosciuto: non è un errore, è la risposta alla domanda.
    if (result.reason === "not_found") return { ok: true, status: 200, body: { logged: false } };
    // Archivio irraggiungibile: qui non si può dire "non è loggato", perché non
    // lo sappiamo. Dire di no farebbe sloggare tutti a ogni guasto di Mongo.
    return unavailable;
  }

  const session = result.data;
  if (isExpired(session)) {
    // La cancellazione la fa l'indice TTL di anagraphics, non serve chiederla qui.
    return { ok: true, status: 200, body: { logged: false } };
  }

  return { ok: true, status: 200, body: { logged: true, session } };
}

// Emette un biglietto per una sessione già aperta. Lo usa la pagina di login,
// subito dopo il login e anche quando il browser è già entrato: è il solo modo
// di passare la sessione a un indirizzo diverso da questo (vedi tickets.js).
export async function issueTicket(settings, token, service, client = anagraphics) {
  const ticket = buildTicket(token, service, settings.ticketTtlSeconds);
  const created = await client.createTicket(settings, ticket);
  if (!created.ok) {
    console.error(`[sso] biglietto non emesso per ${service}: ${created.reason} ${created.code ?? ""}`);
    return unavailable;
  }
  return { ok: true, status: 201, body: { ticket: ticket.ticket } };
}

// Lo scambio, chiamato dal sottosistema da server a server: biglietto dentro,
// sessione fuori. Il biglietto viene cancellato nel momento in cui viene letto,
// quindi un secondo tentativo con lo stesso biglietto non trova più niente.
export async function exchangeTicket(settings, { ticket, service }, client = anagraphics) {
  const consumed = await client.consumeTicket(settings, ticket);
  if (!consumed.ok) {
    if (consumed.reason === "not_found") {
      // Sconosciuto, già usato, o tolto dal TTL: per chi chiama è la stessa cosa.
      console.warn(`[sso] biglietto non valido presentato da ${service}`);
      return { ok: false, status: 404, code: TICKET_NOT_FOUND };
    }
    return unavailable;
  }

  const record = consumed.data;
  if (ticketIsExpired(record)) {
    console.warn(`[sso] biglietto scaduto presentato da ${service}`);
    return { ok: false, status: 400, code: TICKET_EXPIRED };
  }
  if (record.service !== service) {
    // Un biglietto emesso per un sottosistema non vale per un altro. Oggi il
    // `service` lo dichiara chi chiama e nessuno lo verifica davvero: questo
    // controllo ferma gli errori, non un attacco (vedi i limiti noti).
    console.warn(`[sso] biglietto emesso per ${record.service}, presentato da ${service}`);
    return { ok: false, status: 403, code: TICKET_MISMATCH };
  }

  // La sessione potrebbe essere stata chiusa nel frattempo: il biglietto è
  // valido, ma non c'è più niente a cui dia accesso.
  return readSession(settings, record.token, client);
}

export async function logout(settings, token, client = anagraphics) {
  const result = await client.deleteSession(settings, token);
  if (!result.ok && result.reason !== "not_found") return unavailable;
  // Token sconosciuto o già scaduto: il risultato chiesto — quella sessione non
  // esiste più — è comunque vero. Ripetere il logout non è un errore.
  return { ok: true, status: 200, body: { logged: false } };
}

// La lingua scelta da chi è entrato: va nella sessione e nel profilo, così il
// login successivo la ritrova. La lingua delle pagine la decide il cookie
// comune; questa è la memoria che sopravvive al logout.
export async function setLocale(settings, token, locale, client = anagraphics) {
  const current = await readSession(settings, token, client);
  if (!current.ok || !current.body.logged) return current;

  const updated = await client.setSessionLocale(settings, token, locale);
  if (!updated.ok) {
    if (updated.reason === "not_found") return { ok: true, status: 200, body: { logged: false } };
    return unavailable;
  }
  const saved = await client.setUserLocale(settings, current.body.session.username, locale);
  if (!saved.ok) return unavailable;

  return { ok: true, status: 200, body: { logged: true, session: updated.data } };
}
