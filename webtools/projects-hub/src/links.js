// A driver's links: the three addresses they hand out, and the discount code one of
// them carries.
//
// The three parameters are the ones the pre-analysis already reads
// (`webtools/preanalyst/src/server.js`, where `?ambassador=`, `?driver=` and
// `?discount=` are pulled off the URL), so nothing new is invented here — this is the
// other end of a contract that exists.
//
//   ?ambassador=<driver uid>     somebody was invited. Half the fee.
//   ?driver=<driver uid>         the project is supervised by this driver, no discount
//   ?discount=<discount code>    the same, with a discount
//
// **A link with a discount carries the code and not the driver.** In the preanalyst
// `discount` wins over `driver` when both arrive, so sending both would put a parameter
// in the address that nothing reads — and the code already says whose it is.
//
// The client is passed in from outside so these functions can be tested without
// anagraphics running, the way `webtools/sso/src/auth.js` takes its own.

import * as anagraphics from "./anagraphics.js";

export const AMBASSADOR = "ambassador";
export const DRIVER = "driver";

// Which levels may hand out which link. An ambassador's link is every driver's,
// whatever their level: inviting somebody is not supervising them, and a driver at 0 —
// registered, not yet interviewed — is an ambassador like any other. A driver's link is
// a project they will supervise, so it needs the level that allows supervising.
//
// The threshold is the same one `webtools/preanalyst/src/driver_link.js` applies when a
// client arrives on such a link, and it is written out here rather than imported
// because that file is another subsystem's: two subsystems agreeing on a rule is a
// contract, and copying the number with its reason is how the rest of this repository
// already states one (the pool applies it too, in Python).
const MIN_SUPERVISING_LEVEL = 1;

export function maySupervise(driver) {
  // `Number.isInteger` and not `>= 1` on its own: `true >= 1` is true in JavaScript, and
  // a `level: true` is a broken session, not a driver at level 1.
  return Number.isInteger(driver?.level) && driver.level >= MIN_SUPERVISING_LEVEL;
}

export function ambassadorLink(settings, driverUid) {
  return `${settings.preanalystUrl}/?ambassador=${encodeURIComponent(driverUid)}`;
}

export function driverLink(settings, driverUid) {
  return `${settings.preanalystUrl}/?driver=${encodeURIComponent(driverUid)}`;
}

export function discountLink(settings, discountCode) {
  return `${settings.preanalystUrl}/?discount=${encodeURIComponent(discountCode)}`;
}

// The percentages a driver may choose from, read from the configuration: how much of
// the price webtools is willing to give away is a commercial parameter somebody sets.
export function percentages(settings) {
  const { minPercentage, maxPercentage } = settings.discount;
  const choices = [];
  for (let percentage = minPercentage; percentage <= maxPercentage; percentage += 1) {
    choices.push(percentage);
  }
  return choices;
}

// A percentage that came in from a form. Only one of the configured ones: a number
// outside the range is not a smaller discount, it is a request nobody may make.
export function readPercentage(settings, value) {
  if (value === null || value === undefined || value === "") return null;
  const percentage = Number(value);
  if (!Number.isInteger(percentage)) return null;
  return percentages(settings).includes(percentage) ? percentage : null;
}

// The code for this percentage: the one the driver already has, or a new one.
//
// **A percentage that already has a code reuses it, and writes nothing.** A driver ends
// up with at most one code per percentage — five, with the range configured today — and
// a link already handed out goes on working, which is the whole reason not to make a
// second one.
//
//   { ok: true, code, created }      `created` says which of the two happened
//   { ok: false, reason }            anagraphics could not be read or written
//
// `created` is there because the two are different facts to count: one of them wrote a
// document and the other did not.
export async function codeFor(settings, driverUid, percentage, client = anagraphics) {
  const existing = await client.listDiscounts(settings, driverUid);
  if (!existing.ok) return existing;

  const already = existing.data.find((discount) => discount.percentage === percentage);
  if (already) return { ok: true, code: already.discount_code, created: false };

  const made = await client.createDiscount(settings, driverUid, percentage);
  if (!made.ok) return made;
  return { ok: true, code: made.data.discount_code, created: true };
}
