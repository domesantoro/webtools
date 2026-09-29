// The providers the configuration holds, and the price of what they consume.
//
// A **provider object** is an object hanging from a `providers` branch —
// `<anything>.providers.<name>` — wherever that branch is. The doors have one
// each, under the section the door reads; a subsystem may hold one that belongs
// to no door. Nothing here knows which providers exist, which subsystems have
// doors or what a door is called: it all comes out of the documents, so a door
// added tomorrow appears here without a line being written.
//
// Two things the configuration says about a provider object, and both are
// optional, because only part of them holds either one:
//
// - `model`: which model that door asks. **A provider object that names no model
//   is not one of these.** It is not a door: nobody asks anything of a provider
//   through it, and there is no model whose tokens could have a price. What it
//   is, is whatever its own fields say — `metrics.providers.anthropic` declares
//   which kinds of token that provider counts and nothing else — and that is
//   read where the document is read, in the subsystem it belongs to. Putting it
//   under a heading called "providers" would say it is a provider in use, which
//   it is not;
// - `token_kinds`: which kinds of token that provider counts. **The kinds are
//   not a list in this file.** A price is one amount per kind, and the kinds
//   come from the provider's own declaration in the configuration: without one
//   we do not know what to ask a price for, and asking for "a price per token"
//   would be a rate between kinds that nobody decided.
//
// The amounts are hundredths of the unit of the currency, per million tokens.
// A hundredth is a hundredth in any currency: `1500` is `15.00`, and which
// currency that is, is the field beside it.

import { isBranch } from "./leaves.js";

export const PROVIDERS = "providers";

// Why a provider object that names a model cannot be given a price. Three
// different facts: each one is a different thing to do about it, which is why
// they are not one word.
export const NO_TOKEN_KINDS = "NO_TOKEN_KINDS";
export const TOKEN_KINDS_DISAGREE = "TOKEN_KINDS_DISAGREE";
export const PRICING_IS_SECRET = "PRICING_IS_SECRET";

// --- what a document holds -------------------------------------------------

// Every provider object of one document, in the document's own order.
// → [{ subsystem, path, provider, object }]
//
// Only plain objects are descended into, lists included nowhere: that is the
// same path a dotted path walks when the price is written, and the two must
// agree on what is reachable.
export function providerObjects(document) {
  const found = [];
  const walk = (value, path, parentKey) => {
    if (!isBranch(value)) return;
    const key = path.split(".").at(-1);
    // The rule is the path's, not the object's: what makes this a provider
    // object is hanging from a `providers` branch. Its own name is the
    // provider's.
    if (parentKey === PROVIDERS) {
      found.push({ subsystem: document.subsystem, path, provider: key, object: value });
    }
    for (const [childKey, child] of Object.entries(value)) walk(child, `${path}.${childKey}`, key);
  };
  for (const [key, value] of Object.entries(document)) {
    if (key === "subsystem") continue;
    // A key at the top of the document has no key above it, and a provider
    // object needs one: `providers` alone is the branch, not an object in it.
    walk(value, key, null);
  }
  return found;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// The kinds a provider object declares, or nothing. A declaration that is there
// and is not one — a list with a number in it, an empty list — is not a
// declaration, and is treated as none: what is asked for here is knowing the
// kinds, and half of them is not knowing them.
export function declaredKinds(object) {
  const kinds = object.token_kinds;
  if (!Array.isArray(kinds) || kinds.length === 0) return null;
  return kinds.every((kind) => nonEmptyString(kind)) ? kinds : null;
}

// --- the kinds, across the documents ---------------------------------------

// Which kinds each provider counts, worked out from every declaration in the
// configuration. → Map<provider, { kinds, declaredIn, agree }>
//
// Two subsystems declaring different kinds for the same provider is not a set of
// kinds to choose from: it is a disagreement about what that provider counts,
// and until it is settled there is nothing to ask a price for. `agree` says so,
// `declaredIn` says where to go and look.
export function tokenKindsByProvider(entries) {
  const byProvider = new Map();
  for (const entry of entries) {
    const kinds = declaredKinds(entry.object);
    if (!kinds) continue;
    const known = byProvider.get(entry.provider);
    const where = `${entry.subsystem}.${entry.path}`;
    if (!known) {
      byProvider.set(entry.provider, { kinds, declaredIn: [where], agree: true });
      continue;
    }
    known.declaredIn.push(where);
    const same = [...known.kinds].sort().join(",") === [...kinds].sort().join(",");
    if (!same) known.agree = false;
  }
  return byProvider;
}

// --- one provider object's price -------------------------------------------

function amountText(cents) {
  return `${(cents / 100).toFixed(2)}`;
}

// The price as it is stored, or nothing. What is not a price is not shown as
// one: a `pricing` written by hand with a number where the amounts go is said to
// be unreadable rather than half read.
export function storedPricing(object) {
  const pricing = object.pricing;
  if (!isBranch(pricing)) return null;
  const amounts = isBranch(pricing.cents_per_million_tokens) ? pricing.cents_per_million_tokens : {};
  const byKind = new Map();
  for (const [kind, cents] of Object.entries(amounts)) {
    if (Number.isInteger(cents) && cents >= 0) byKind.set(kind, cents);
  }
  return {
    currency: nonEmptyString(pricing.currency),
    byKind,
    updatedAt: nonEmptyString(pricing.updated_at),
    // A `pricing` that is there and holds nothing readable: worth saying,
    // because an empty table would read as "no price has been given".
    unreadable: byKind.size === 0,
  };
}

// The rows of one provider object's price: one per kind the provider declares,
// plus any kind that is stored and is no longer declared.
//
// The stored ones are there because the write replaces the price **whole**: a
// kind left out of the form would be dropped from what is stored, and dropping
// a price nobody asked to drop is not a form filling itself in. It is shown as
// what it is — a kind this provider does not declare — and left for whoever
// looks to decide.
export function priceRows(kinds, pricing) {
  const rows = kinds.map((kind) => ({
    kind,
    declared: true,
    cents: pricing?.byKind.get(kind) ?? null,
    text: pricing?.byKind.has(kind) ? amountText(pricing.byKind.get(kind)) : null,
  }));
  const extra = [...(pricing?.byKind.keys() ?? [])].filter((kind) => !kinds.includes(kind)).sort();
  for (const kind of extra) {
    rows.push({ kind, declared: false, cents: pricing.byKind.get(kind), text: amountText(pricing.byKind.get(kind)) });
  }
  return rows;
}

// The currencies offered, with the stored one selected. A currency that is
// stored and is not among the ones offered is offered too: it is what the price
// is written in, and leaving it out would turn a redisplay of the form into a
// silent change of currency. Nothing is selected when nothing is stored — there
// is no default currency, and the first of a list is not one.
export function currencyOptions(currencies, stored) {
  const offered = currencies.includes(stored) || stored === null ? currencies : [...currencies, stored];
  return offered.map((code) => ({ code, selected: code === stored, known: currencies.includes(code) }));
}

// --- the whole section ------------------------------------------------------

function anchorOf(subsystem, path) {
  return `provider-${`${subsystem}.${path}`.replace(/[^A-Za-z0-9]+/g, "-")}`;
}

// `secretsBySubsystem` is what readSecretPaths gave, `currencies` the ones the
// configuration offers, `outcome` what came back from the last write (or null).
//
// → [{ provider, kinds, doors }], one entry per provider name, in alphabetical
// order, each with the provider objects that name it in the order the documents
// hold them.
export function buildProviders({ configurations = [], secretsBySubsystem = new Map(), currencies = [], outcome = null }) {
  const entries = configurations.flatMap((document) => providerObjects(document));
  const kindsByProvider = tokenKindsByProvider(entries);

  const byProvider = new Map();
  for (const entry of entries) {
    // Not a door: see above. Its declaration has already been read into
    // `kindsByProvider`, which is what it is for.
    if (!nonEmptyString(entry.object.model)) continue;
    const secretPaths = secretsBySubsystem.get(entry.subsystem) ?? new Set();
    const declaration = kindsByProvider.get(entry.provider);
    const pricing = storedPricing(entry.object);
    const modelPath = `${entry.path}.model`;
    const modelIsSecret = secretPaths.has(modelPath);
    const model = modelIsSecret ? "" : nonEmptyString(entry.object.model);
    // A price coming from the secrets' files is not written from here: what is
    // written into Mongo would be replaced by the file at the next
    // load_configuration.sh, and a form that quietly loses what it writes is
    // worse than one that is not there.
    const pricingIsSecret = [...secretPaths].some((path) => path === `${entry.path}.pricing` || path.startsWith(`${entry.path}.pricing.`));

    let refusal = null;
    if (pricingIsSecret) refusal = PRICING_IS_SECRET;
    else if (!declaration) refusal = NO_TOKEN_KINDS;
    else if (!declaration.agree) refusal = TOKEN_KINDS_DISAGREE;

    const door = {
      subsystem: entry.subsystem,
      path: entry.path,
      anchor: anchorOf(entry.subsystem, entry.path),
      model,
      modelIsSecret,
      declaredIn: declaration?.declaredIn ?? [],
      writable: refusal === null,
      refusal,
      rows: refusal === null ? priceRows(declaration.kinds, pricing) : priceRows([], pricing),
      currency: pricing?.currency ?? null,
      currencies: currencyOptions(currencies, pricing?.currency ?? null),
      updatedAt: pricing?.updatedAt ?? null,
      priced: pricing !== null && !pricing.unreadable,
      unreadable: pricing?.unreadable ?? false,
      // What the last write said about this very provider object, if the last
      // write was about this one.
      outcome: outcome && outcome.subsystem === entry.subsystem && outcome.path === entry.path ? outcome : null,
    };
    const known = byProvider.get(entry.provider) ?? {
      provider: entry.provider,
      kinds: kindsByProvider.get(entry.provider) ?? null,
      doors: [],
    };
    known.doors.push(door);
    byProvider.set(entry.provider, known);
  }

  return [...byProvider.values()].sort((first, second) => first.provider.localeCompare(second.provider));
}
