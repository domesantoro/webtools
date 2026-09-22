// Il driver e lo sconto del progetto, ricontrollati all'invio.
//
// La pagina li fa viaggiare come campi nascosti (`driver`, `discount`), ma un
// campo nascosto non è una prova: chiunque può mandare quello che vuole. Qui si
// rilegge tutto da anagraphics, con le stesse regole del box del driver
// (src/driver_link.js):
//
// - lo sconto vale solo se esiste; il driver del progetto è quello dello sconto,
//   qualunque cosa dica il campo `driver`;
// - il driver vale solo se esiste ed è abilitato (`enabled: true`): con uno non
//   abilitato non si prosegue, e sconto e driver cadono insieme;
// - un driver non porta un cliente a se stesso: il proprio uid non vale;
// - con il lavoro autonomo non si guarda niente: il driver è chi compila.
//
// Quando non vale, il driver lo assegna il sistema (`driver_uid: null`).
// `{ ok: false }` solo se anagraphics non risponde: l'invio non si registra,
// invece di perdere driver e sconto.

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
