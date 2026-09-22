// L'ambassador, letto dall'URL: `?ambassador=<uid del driver>`.
//
// Un ambassador è un driver, abilitato o no, che ha invitato qualcuno a usare
// webtools: se il progetto va a buon fine gli spetta metà della fee. Vale
// solo se nient'altro indica chi porta il progetto:
//
// - con `?discount=` o `?driver=` nell'URL l'ambassador si ignora;
// - l'uid deve essere quello di un driver, altrimenti non c'è ambassador;
// - un driver non è ambassador di se stesso;
// - con il lavoro autonomo segnato non vale: il box lo spegne il CSS, e il
//   server non lo scrive nel progetto (`projectTerms()` in server.js).
//
// Se l'ambassador non vale non si dice niente: il box semplicemente non c'è.

import { findDriver } from "./anagraphics.js";

// Per la pagina: il driver dell'ambassador, cercato nell'elenco già caricato,
// oppure null.
export function resolveAmbassador(params, drivers, ownDriverUid) {
  if (!params.ambassadorUid || params.discountCode || params.driverUid) return null;
  if (params.ambassadorUid === ownDriverUid) return null;
  return drivers.find((driver) => driver.uid === params.ambassadorUid) ?? null;
}

// Per l'invio: l'uid dell'ambassador da scrivere in `billing`, oppure null.
// Il campo del form non è una prova: si verifica di nuovo che sia un driver.
// `{ ok: false }` solo se anagraphics non risponde: in quel caso l'invio non si
// registra, invece di perdere l'ambassador.
export async function ambassadorOf(settings, form, ownDriverUid) {
  const uid = form.get("ambassador") || null;
  const autonomous = Boolean(ownDriverUid) && form.get("autonomous_work") === "yes";
  if (!uid || autonomous || form.get("discount") || form.get("driver") || uid === ownDriverUid) {
    return { ok: true, uid: null };
  }
  const result = await findDriver(settings, uid);
  if (result.ok) return { ok: true, uid };
  if (result.reason === "not_found") return { ok: true, uid: null };
  return { ok: false };
}
