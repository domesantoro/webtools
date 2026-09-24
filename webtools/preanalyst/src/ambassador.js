// The ambassador, read from the URL: `?ambassador=<driver uid>`.
//
// An ambassador is a driver, enabled or not, who invited somebody to use
// webtools: if the project goes through, half the fee is theirs. It counts only
// if nothing else says who brings the project:
//
// - with `?discount=` or `?driver=` in the URL the ambassador is ignored;
// - the uid must be a driver's, otherwise there is no ambassador;
// - a driver is not their own ambassador;
// - with autonomous work ticked it does not count: the CSS switches the box off,
//   and the server does not write it into the project (`projectTerms()` in
//   server.js).
//
// If the ambassador does not count, nothing is said: the box simply is not there.

import { findDriver } from "./anagraphics.js";

// For the page: the ambassador's driver, looked up in the list already loaded, or
// null.
export function resolveAmbassador(params, drivers, ownDriverUid) {
  if (!params.ambassadorUid || params.discountCode || params.driverUid) return null;
  if (params.ambassadorUid === ownDriverUid) return null;
  return drivers.find((driver) => driver.uid === params.ambassadorUid) ?? null;
}

// For the submission: the ambassador's uid to write into `billing`, or null. The
// form field is not proof: it is checked again that it is a driver.
// `{ ok: false }` only if anagraphics does not answer: in that case the submission
// is not recorded, rather than losing the ambassador.
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
