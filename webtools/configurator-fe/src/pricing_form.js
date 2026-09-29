// The form that writes a provider object's price, read at the boundary.
//
// What arrives is `application/x-www-form-urlencoded`, which is text: every
// field is a string, and an empty field and an absent one look alike. So the
// reading here is explicit about both.
//
//   subsystem      which document the provider object is in
//   provider_path  where in that document it is
//   currency       what the amounts are in
//   kind.<name>    the amount for that kind of token, in hundredths, per million
//
// **The kinds are not a list here either.** The form is drawn from what the
// configuration declares, and whatever comes back under `kind.` is a kind: a
// name this file had never heard of is one the provider declared today.
//
// Two kinds of refusal, and they are not the same thing:
//
// - one with a `target`: the form says which provider object it is about, and
//   the page can say, next to that very form, what was wrong with it;
// - one without: the request does not say what it is about at all. Nothing on
//   the page could carry that sentence, and it is an error of the request.

export const SUBSYSTEM_OR_PATH_MISSING = "SUBSYSTEM_OR_PATH_MISSING";
export const CURRENCY_NOT_GIVEN = "CURRENCY_NOT_GIVEN";
export const NO_PRICE_GIVEN = "NO_PRICE_GIVEN";
export const PRICE_NOT_A_WHOLE_NUMBER = "PRICE_NOT_A_WHOLE_NUMBER";

const KIND = "kind.";

// → { ok: true, subsystem, providerPath, currency, centsPerMillionTokens }
//   | { ok: false, code, target: { subsystem, providerPath } | null }
export function readPricingForm(text) {
  const fields = new URLSearchParams(text);
  const subsystem = (fields.get("subsystem") ?? "").trim();
  const providerPath = (fields.get("provider_path") ?? "").trim();
  if (!subsystem || !providerPath) {
    return { ok: false, code: SUBSYSTEM_OR_PATH_MISSING, target: null };
  }
  const target = { subsystem, providerPath };

  const currency = (fields.get("currency") ?? "").trim();
  // No default currency: the dropdown opens on nothing when nothing is stored,
  // and a price without one is not written. Which currency it would have been is
  // not this file's to decide.
  if (!currency) return { ok: false, code: CURRENCY_NOT_GIVEN, target };

  const centsPerMillionTokens = {};
  for (const [field, value] of fields.entries()) {
    if (!field.startsWith(KIND)) continue;
    const kind = field.slice(KIND.length);
    const written = value.trim();
    // A field left empty is a kind that is not priced. Absent is absent: it is
    // left out of what is written, and no amount is put in its place.
    if (!kind || written === "") continue;
    if (!/^\d+$/.test(written)) return { ok: false, code: PRICE_NOT_A_WHOLE_NUMBER, target };
    const cents = Number(written);
    if (!Number.isSafeInteger(cents)) return { ok: false, code: PRICE_NOT_A_WHOLE_NUMBER, target };
    centsPerMillionTokens[kind] = cents;
  }
  // A form sent with every field empty asks for nothing. Removing a price is
  // another thing to do, and this form does not do it.
  if (Object.keys(centsPerMillionTokens).length === 0) {
    return { ok: false, code: NO_PRICE_GIVEN, target };
  }
  return { ok: true, subsystem, providerPath, currency, centsPerMillionTokens };
}
