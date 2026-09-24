// A driver's link, read from the URL: it decides what the driver box shows and
// which hidden fields travel with the form. It decides nothing about the project:
// the project's driver and discounts are written by `projectTerms()` in server.js
// (`review`, `billing`).
//
// Two roads lead to the same place — the driver already chosen and locked — but
// they are not the same thing:
//
//   ?discount=<UUID code>   a driver's link WITH a discount code
//   ?driver=<UUID uid>      a driver's link WITHOUT a discount
//
// If both arrive, `discount` wins, because it is the only one that carries an
// economic effect: ignoring it to follow `driver` would take away a discount the
// user is entitled to. The case stays in the log, because a link with both
// parameters is almost always a mistake by whoever built it.
//
// The outcomes, and the page knows no others:
//
//   none                      no parameter: the box is not shown at all
//   discount_applied          valid discount, driver recognised and enabled
//   discount_expired          reading the discount failed: the discount cannot apply
//   discount_driver_missing   discount read, but its driver can no longer be found
//   discount_driver_disabled  discount read, but its driver is not enabled: neither
//                             the discount nor the driver applies
//   driver_applied            the link's driver recognised and enabled, no discount
//   driver_unknown            the link's driver not found
//   driver_disabled           the link's driver found but not enabled
//   own_link                  the link belongs to whoever is using it: a driver does
//                             not send a client to themselves, so it does not apply
//
// A driver who is **not enabled** (`enabled` other than true) exists, but cannot
// supervise client projects: with them the system does not go on, and we assign
// the project ourselves.
//
// The driver is not chosen: either the link brings one, or we assign one.

import { findDiscount, findDriver } from "./anagraphics.js";

export const NONE = "none";
export const DISCOUNT_APPLIED = "discount_applied";
export const DISCOUNT_EXPIRED = "discount_expired";
export const DISCOUNT_DRIVER_MISSING = "discount_driver_missing";
export const DRIVER_APPLIED = "driver_applied";
export const DRIVER_UNKNOWN = "driver_unknown";
export const DISCOUNT_DRIVER_DISABLED = "discount_driver_disabled";
export const DRIVER_DISABLED = "driver_disabled";
export const OWN_LINK = "own_link";

// The states in which the driver has been recognised: there is a name to show and
// a uid to carry forward with the form. In the others we assign the driver.
const RESOLVED = new Set([DISCOUNT_APPLIED, DRIVER_APPLIED]);

export function isResolved(driverLink) {
  return RESOLVED.has(driverLink.state);
}

async function fromDiscount(settings, discountCode, drivers) {
  const result = await findDiscount(settings, discountCode);
  if (!result.ok) {
    // Both a non-existent code and a technical failure: for the user the discount
    // simply does not apply. The difference stays in anagraphics.js's log.
    return { state: DISCOUNT_EXPIRED, code: discountCode };
  }

  const discount = result.data;
  const driverUid = discount.driver?.uid;
  const known = drivers.find((driver) => driver.uid === driverUid);

  if (!known) {
    return {
      state: DISCOUNT_DRIVER_MISSING,
      code: discountCode,
      // The name comes from the copy duplicated inside the discount: it is the
      // only handle the user is left with for recognising whom to contact.
      driverName: discount.driver?.screen_name ?? null,
      driverUid: driverUid ?? null,
    };
  }

  if (known.enabled !== true) {
    return { state: DISCOUNT_DRIVER_DISABLED, code: discountCode, driver: known };
  }

  return {
    state: DISCOUNT_APPLIED,
    code: discountCode,
    driver: known,
    percentage: discount.percentage,
  };
}

function fromDriver(driverUid, drivers) {
  // No extra read: the driver list has already been loaded, and holds every
  // driver. If the uid is not in there, it exists nowhere else.
  const known = drivers.find((driver) => driver.uid === driverUid);
  if (!known) {
    return { state: DRIVER_UNKNOWN, driverUid };
  }
  if (known.enabled !== true) {
    return { state: DRIVER_DISABLED, driver: known };
  }
  return { state: DRIVER_APPLIED, driver: known };
}

// A driver filling in the pre-analysis for themselves cannot use their own link:
// neither their own discount nor their own uid. It would be a discount granted to
// oneself. Links **of other drivers** stay valid: that is work they brought in.
//
// The comparison is on the driver's uid, not on the username: the uid never
// changes, the username does.
export function withoutOwnLink(driverLink, ownDriverUid) {
  if (!ownDriverUid) return driverLink;

  const uid = driverLink.driver?.uid ?? driverLink.driverUid ?? null;
  if (uid !== ownDriverUid) return driverLink;

  return { state: OWN_LINK, code: driverLink.code ?? null };
}

export async function resolveDriverLink(settings, { discountCode, driverUid }, drivers) {
  if (discountCode) {
    if (driverUid) {
      console.warn(
        `[preanalyst] link with discount and driver together: discount wins ` +
          `(discount=${discountCode}, driver=${driverUid})`
      );
    }
    return fromDiscount(settings, discountCode, drivers);
  }
  if (driverUid) {
    return fromDriver(driverUid, drivers);
  }
  return { state: NONE };
}

// A driver's link **rebuilt from the project**, for the page that comes back when
// the request says too little (§16.6 of the README).
//
// There the address with the parameters is gone — it is the answer to a `POST` —
// but what the parameters carried was recorded on the project at the first
// submission: `review.driver_uid` with `preset`, and `billing.discount_code`. The
// box must show the same things as before, or the page comes back mutilated to
// whoever sees it again.
//
// Here the states are only the recognised ones: a driver who can no longer be
// found, or who has been disabled in the meantime, is not the user's problem — the
// project is already assigned, and telling them now would do them no good.
export async function driverLinkOfProject(settings, project) {
  const driverUid = project.review?.preset ? project.review?.driver_uid : null;
  if (!driverUid) return { state: NONE };

  const found = await findDriver(settings, driverUid);
  if (!found.ok) return { state: NONE };
  const driver = found.data;

  const discountCode = project.billing?.discount_code ?? null;
  if (!discountCode) return { state: DRIVER_APPLIED, driver };

  // The percentage is not on the project: it is read again from the discount. If
  // that fails, the driver remains — which is the part that matters to the reader.
  const discount = await findDiscount(settings, discountCode);
  if (!discount.ok) return { state: DRIVER_APPLIED, driver };
  return { state: DISCOUNT_APPLIED, code: discountCode, driver, percentage: discount.data.percentage };
}
