// The providers the configuration holds, and the price of their tokens.
//
// The documents are made up: what is decided here must hold for any
// configuration, not for the one the system has today. So the provider is called
// `example`, the doors are not ours, and the kinds of token are whatever the
// document declares.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  NO_TOKEN_KINDS,
  PRICING_IS_SECRET,
  TOKEN_KINDS_DISAGREE,
  buildProviders,
  currencyOptions,
  priceRows,
  providerObjects,
  storedPricing,
  tokenKindsByProvider,
} from "../src/providers.js";
import {
  CURRENCY_NOT_GIVEN,
  NO_PRICE_GIVEN,
  PRICE_NOT_A_WHOLE_NUMBER,
  SUBSYSTEM_OR_PATH_MISSING,
  readPricingForm,
} from "../src/pricing_form.js";

const CURRENCIES = ["USD", "EUR", "JPY"];

const DECLARATION = {
  subsystem: "counting",
  providers: { example: { token_kinds: ["input", "output"] } },
};

const DOORS = {
  subsystem: "asking",
  first: { providers: { example: { model: "example-small", max_tokens: 512 } } },
  second: {
    deeper: {
      providers: {
        example: {
          model: "example-large",
          pricing: {
            currency: "EUR",
            cents_per_million_tokens: { input: 1400, output: 7000 },
            updated_at: "2026-09-26T10:22:31Z",
          },
        },
      },
    },
  },
};

// --- which objects are provider objects -------------------------------------

test("a provider object is one hanging from a `providers` branch, at any depth", () => {
  assert.deepEqual(
    providerObjects(DOORS).map((entry) => entry.path),
    ["first.providers.example", "second.deeper.providers.example"]
  );
  assert.deepEqual(providerObjects(DECLARATION).map((entry) => entry.path), ["providers.example"]);
});

test("the branch itself is not a provider object, and neither is what is under one", () => {
  const document = {
    subsystem: "x",
    // `providers` at the top of the document: the branch, not an object in it.
    providers: { example: { model: "m", nested: { deep: 1 } } },
  };
  assert.deepEqual(providerObjects(document).map((entry) => entry.path), ["providers.example"]);
});

test("what a `providers` branch holds and is not an object is not a provider object", () => {
  const document = { subsystem: "x", providers: { example: "anthropic", other: ["a"] } };
  assert.deepEqual(providerObjects(document), []);
});

test("a document with no `providers` branch has no provider object", () => {
  assert.deepEqual(providerObjects({ subsystem: "x", listen: { host: "127.0.0.1" } }), []);
});

// --- the kinds of token -----------------------------------------------------

test("the kinds come from the declarations, and say where they were declared", () => {
  const kinds = tokenKindsByProvider(providerObjects(DECLARATION));
  assert.deepEqual(kinds.get("example"), {
    kinds: ["input", "output"],
    declaredIn: ["counting.providers.example"],
    agree: true,
  });
});

test("two declarations that say the same thing agree, in whatever order", () => {
  const second = { subsystem: "other", providers: { example: { token_kinds: ["output", "input"] } } };
  const kinds = tokenKindsByProvider([...providerObjects(DECLARATION), ...providerObjects(second)]);
  assert.equal(kinds.get("example").agree, true);
  assert.deepEqual(kinds.get("example").declaredIn, [
    "counting.providers.example",
    "other.providers.example",
  ]);
});

test("two declarations that differ do not make a set of kinds to choose from", () => {
  const second = { subsystem: "other", providers: { example: { token_kinds: ["input"] } } };
  const kinds = tokenKindsByProvider([...providerObjects(DECLARATION), ...providerObjects(second)]);
  assert.equal(kinds.get("example").agree, false);
});

test("a declaration that is there and is not one is not a declaration", () => {
  for (const declared of [[], ["input", 3], "input", { input: true }]) {
    const document = { subsystem: "x", providers: { example: { token_kinds: declared } } };
    assert.equal(tokenKindsByProvider(providerObjects(document)).has("example"), false);
  }
});

// --- the price as it is stored ----------------------------------------------

test("a price is read as it is stored", () => {
  const [door] = providerObjects(DOORS).filter((entry) => entry.path.startsWith("second"));
  const pricing = storedPricing(door.object);
  assert.equal(pricing.currency, "EUR");
  assert.equal(pricing.updatedAt, "2026-09-26T10:22:31Z");
  assert.deepEqual([...pricing.byKind], [["input", 1400], ["output", 7000]]);
  assert.equal(pricing.unreadable, false);
});

test("no price is not a price of zero", () => {
  assert.equal(storedPricing({ model: "m" }), null);
});

test("a `pricing` with no amount that can be read says so", () => {
  for (const amounts of [{ input: -1 }, { input: 1.5 }, { input: "1500" }, {}, 1500]) {
    const pricing = storedPricing({ pricing: { currency: "USD", cents_per_million_tokens: amounts } });
    assert.equal(pricing.unreadable, true, JSON.stringify(amounts));
    assert.equal(pricing.byKind.size, 0);
  }
});

// --- the rows of the form ----------------------------------------------------

test("a row per declared kind, in the order they are declared", () => {
  assert.deepEqual(priceRows(["input", "output"], null), [
    { kind: "input", declared: true, cents: null, text: null },
    { kind: "output", declared: true, cents: null, text: null },
  ]);
});

test("a stored kind that is no longer declared is still a row, and says so", () => {
  const pricing = storedPricing({
    pricing: { currency: "USD", cents_per_million_tokens: { input: 1500, cache_read: 150 } },
  });
  // The write replaces the price whole: a kind left out of the form would be
  // dropped from what is stored.
  assert.deepEqual(priceRows(["input"], pricing), [
    { kind: "input", declared: true, cents: 1500, text: "15.00" },
    { kind: "cache_read", declared: false, cents: 150, text: "1.50" },
  ]);
});

// --- the currency ------------------------------------------------------------

test("nothing is selected when nothing is stored: there is no default currency", () => {
  const options = currencyOptions(CURRENCIES, null);
  assert.equal(options.length, 3);
  assert.equal(options.some((option) => option.selected), false);
});

test("a stored currency that is not offered is offered all the same, and marked", () => {
  const options = currencyOptions(CURRENCIES, "SEK");
  assert.deepEqual(options.at(-1), { code: "SEK", selected: true, known: false });
});

// --- the whole section --------------------------------------------------------

function sectionOf(configurations, { secretsBySubsystem = new Map(), outcome = null } = {}) {
  return buildProviders({ configurations, secretsBySubsystem, currencies: CURRENCIES, outcome });
}

test("the doors are grouped by the provider they name", () => {
  const [entry] = sectionOf([DECLARATION, DOORS]);
  assert.equal(entry.provider, "example");
  assert.deepEqual(entry.doors.map((door) => `${door.subsystem}.${door.path}`), [
    "asking.first.providers.example",
    "asking.second.deeper.providers.example",
  ]);
});

test("a provider object that names a model, with the kinds declared, takes a price", () => {
  const [entry] = sectionOf([DECLARATION, DOORS]);
  const door = entry.doors.find((each) => each.path === "first.providers.example");
  assert.equal(door.writable, true);
  assert.equal(door.model, "example-small");
  assert.deepEqual(door.rows.map((row) => row.kind), ["input", "output"]);
  assert.equal(door.updatedAt, null);
  assert.equal(door.priced, false);
});

test("a provider object that names no model is not a door, and is not listed as one", () => {
  // `counting.providers.example` declares which kinds that provider counts and
  // nothing else. Nobody asks anything of a provider through it, so it is not
  // under the provider's name — it is read where its own document is read.
  const [entry] = sectionOf([DECLARATION, DOORS]);
  assert.equal(entry.doors.some((door) => door.subsystem === "counting"), false);
  // And what it declares is still what the kinds come from.
  assert.deepEqual(entry.kinds.declaredIn, ["counting.providers.example"]);
});

test("a provider named only by a declaration is not a provider to show", () => {
  // Nothing asks it anything: there is no door for it anywhere.
  assert.deepEqual(sectionOf([DECLARATION]), []);
});

test("without a declaration of the kinds there is nothing to ask a price for", () => {
  const [entry] = sectionOf([DOORS]);
  assert.equal(entry.doors.every((door) => door.refusal === NO_TOKEN_KINDS), true);
});

test("declarations that disagree stop the price, and say where they are", () => {
  const other = { subsystem: "other", providers: { example: { token_kinds: ["input"] } } };
  const [entry] = sectionOf([DECLARATION, other, DOORS]);
  const door = entry.doors.find((each) => each.path === "first.providers.example");
  assert.equal(door.refusal, TOKEN_KINDS_DISAGREE);
  assert.deepEqual(entry.kinds.declaredIn, ["counting.providers.example", "other.providers.example"]);
});

test("a price coming from the secrets' files is not written from here", () => {
  const secrets = new Map([["asking", new Set(["first.providers.example.pricing.currency"])]]);
  const [entry] = sectionOf([DECLARATION, DOORS], { secretsBySubsystem: secrets });
  const door = entry.doors.find((each) => each.path === "first.providers.example");
  assert.equal(door.refusal, PRICING_IS_SECRET);
});

test("a model that is secret is not shown, and the price is still that door's", () => {
  const secrets = new Map([["asking", new Set(["first.providers.example.model"])]]);
  const [entry] = sectionOf([DECLARATION, DOORS], { secretsBySubsystem: secrets });
  const door = entry.doors.find((each) => each.path === "first.providers.example");
  assert.equal(door.modelIsSecret, true);
  assert.equal(door.model, "");
  // The price is written into the provider object, not into the model's name.
  assert.equal(door.writable, true);
});

test("a stored price is shown with the currency it is stored in", () => {
  const [entry] = sectionOf([DECLARATION, DOORS]);
  const door = entry.doors.find((each) => each.path === "second.deeper.providers.example");
  assert.equal(door.currency, "EUR");
  assert.equal(door.updatedAt, "2026-09-26T10:22:31Z");
  assert.equal(door.priced, true);
  assert.deepEqual(door.rows.map((row) => row.text), ["14.00", "70.00"]);
  assert.equal(door.currencies.find((option) => option.selected).code, "EUR");
});

test("the outcome of a write goes beside the provider object it was about", () => {
  const outcome = { subsystem: "asking", path: "first.providers.example", written: true, reason: null };
  const [entry] = sectionOf([DECLARATION, DOORS], { outcome });
  const placed = entry.doors.filter((door) => door.outcome);
  assert.deepEqual(placed.map((door) => door.path), ["first.providers.example"]);
});

// --- the form that writes a price ---------------------------------------------

test("a filled form is read into a price", () => {
  const form = readPricingForm(
    "subsystem=asking&provider_path=first.providers.example&currency=USD&kind.input=1500&kind.output=7500"
  );
  assert.deepEqual(form, {
    ok: true,
    subsystem: "asking",
    providerPath: "first.providers.example",
    currency: "USD",
    centsPerMillionTokens: { input: 1500, output: 7500 },
  });
});

test("an amount left empty is a kind that is not priced, not a zero", () => {
  const form = readPricingForm("subsystem=s&provider_path=a.providers.b&currency=USD&kind.input=1500&kind.output=");
  assert.deepEqual(form.centsPerMillionTokens, { input: 1500 });
});

test("a kind this code has never heard of is a kind", () => {
  const form = readPricingForm("subsystem=s&provider_path=a.providers.b&currency=USD&kind.moonbeams=3");
  assert.deepEqual(form.centsPerMillionTokens, { moonbeams: 3 });
});

test("a form that says nothing about which provider object it is about has no target", () => {
  for (const text of ["", "subsystem=s", "provider_path=a.providers.b", "subsystem=&provider_path=x"]) {
    const form = readPricingForm(text);
    assert.equal(form.code, SUBSYSTEM_OR_PATH_MISSING, text);
    assert.equal(form.target, null);
  }
});

test("a refusal that has a target says which form it is about", () => {
  const start = "subsystem=s&provider_path=a.providers.b";
  const refusals = [
    [`${start}&currency=&kind.input=1`, CURRENCY_NOT_GIVEN],
    [`${start}&currency=USD`, NO_PRICE_GIVEN],
    [`${start}&currency=USD&kind.input=`, NO_PRICE_GIVEN],
    [`${start}&currency=USD&kind.input=-1`, PRICE_NOT_A_WHOLE_NUMBER],
    [`${start}&currency=USD&kind.input=1.5`, PRICE_NOT_A_WHOLE_NUMBER],
    [`${start}&currency=USD&kind.input=abc`, PRICE_NOT_A_WHOLE_NUMBER],
    [`${start}&currency=USD&kind.input=99999999999999999999`, PRICE_NOT_A_WHOLE_NUMBER],
  ];
  for (const [text, code] of refusals) {
    const form = readPricingForm(text);
    assert.equal(form.code, code, text);
    assert.deepEqual(form.target, { subsystem: "s", providerPath: "a.providers.b" });
  }
});
