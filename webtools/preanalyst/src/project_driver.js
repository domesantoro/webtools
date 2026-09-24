// The project's driver and discount, checked again at submission time.
//
// The page carries them as hidden fields (`driver`, `discount`), but a hidden
// field is not proof: anybody can send whatever they like. Here everything is
// read again from anagraphics, with the same rules as the driver box
// (src/driver_link.js):
//
// - a discount counts only if it exists; the project's driver is the discount's
//   one, whatever the `driver` field says;
// - a driver counts only if they exist and are enabled (`enabled: true`): with one
//   who is not enabled we do not go on, and discount and driver fall together;
// - a driver does not bring a client to themselves: their own uid does not count;
// - with autonomous work nothing is looked at: the driver is whoever is filling
//   the form in.
//
// When it does not count, the driver is assigned by the system
// (`driver_uid: null`). `{ ok: false }` only if anagraphics does not answer: the
// submission is not recorded, rather than losing driver and discount.

import { findDiscount, findDriver } from "./anagraphics.js";

const NONE = { ok: true, driverUid: null, discountCode: null };

export async function linkTermsOf(settings, form, ownDriverUid, autonomous) {
  if (autonomous) return NONE;

  const discountCode = form.get("discount") || null;
  let driverUid = form.get("driver") || null;

  if (discountCode) {
    const discount = await findDiscount(settings, discountCode);
    if (!discount.ok) return discount.reason === "not_found" ? NONE : { ok: false };
    driverUid = discount.data.driver?.uid ?? null;
  }
  if (!driverUid || driverUid === ownDriverUid) return NONE;

  const driver = await findDriver(settings, driverUid);
  if (!driver.ok) return driver.reason === "not_found" ? NONE : { ok: false };
  if (driver.data.enabled !== true) return NONE;

  return { ok: true, driverUid, discountCode };
}
