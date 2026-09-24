// The prevalidator's tests: how the model's answer is read and what is done with
// it. The call to the provider is not tested here — it costs and is not repeatable:
// what is tested are the functions that decide, which are the ones that can be
// wrong.
//
//   node --test

import assert from "node:assert/strict";
import { test } from "node:test";

import { normalize, OUTCOMES, rejects, REJECTING, UNDERSPECIFIED, verdict } from "../src/prevalidator.js";

const sum = (distribution) => OUTCOMES.reduce((total, name) => total + distribution[name], 0);

// A complete distribution built from what the test cares about: the outcomes not
// named count as zero. Without it, every case would have to write five numbers
// just to test one.
const dist = (values) => Object.fromEntries(OUTCOMES.map((name) => [name, values[name] ?? 0]));

test("normalize: a distribution that sums to 1 is left alone", () => {
  const raw = dist({ run_out_certain: 0.1, run_out_likely: 0.2, safe: 0.5, ultrasafe: 0.2 });
  const { distribution, outcome } = normalize(raw);
  assert.equal(outcome, "safe");
  assert.equal(distribution.safe, 0.5);
  assert.ok(Math.abs(sum(distribution) - 1) < 1e-9);
});

test("normalize: a distribution that does not sum to 1 is brought back to 1", () => {
  // The model declares five numbers and they almost never sum to exactly one.
  const raw = dist({ run_out_certain: 2, run_out_likely: 2, safe: 4, ultrasafe: 2 });
  const { distribution, outcome } = normalize(raw);
  assert.equal(outcome, "safe");
  assert.equal(distribution.safe, 0.4);
  assert.ok(Math.abs(sum(distribution) - 1) < 1e-9);
});

test("normalize: on a tie the most cautious wins", () => {
  const raw = dist(Object.fromEntries(OUTCOMES.map((name) => [name, 1])));
  // The first of the list: among six equally probable readings we keep the one
  // that stops everything.
  assert.equal(normalize(raw).outcome, OUTCOMES[0]);
  assert.ok(REJECTING.includes(normalize(raw).outcome));
});

test("normalize: `non_sequitur` is an outcome like the others", () => {
  const raw = dist({ non_sequitur: 0.8, run_out_likely: 0.1, safe: 0.1 });
  assert.equal(normalize(raw).outcome, "non_sequitur");
});

test("normalize: `underspecified` is an outcome like the others", () => {
  const raw = dist({ run_out_likely: 0.2, underspecified: 0.6, safe: 0.2 });
  assert.equal(normalize(raw).outcome, UNDERSPECIFIED);
});

test("normalize: rejects what is not a distribution", () => {
  assert.equal(normalize(undefined), null);
  assert.equal(normalize({}), null);
  // A missing outcome: with five numbers out of six we do not know what the sixth
  // says, and a missing outcome is not worth zero.
  assert.equal(
    normalize({ run_out_certain: 0.5, run_out_likely: 0, safe: 0.5, ultrasafe: 0 }),
    null
  );
  // Values that are not numbers, or are impossible.
  assert.equal(normalize(dist({ run_out_certain: "alto" })), null);
  assert.equal(normalize(dist({ run_out_certain: -1, safe: 1 })), null);
  assert.equal(normalize(dist({ run_out_certain: NaN, safe: 1 })), null);
  // All at zero: there is nothing to normalise, and dividing by zero would give
  // NaN. It is the case that really happened — the model zeroing everything on an
  // off-domain request, before `non_sequitur` gave it somewhere to sit. The policy
  // forbids it, the guard stays.
  assert.equal(normalize(dist({})), null);
});

test("rejects: needs the most probable outcome AND the threshold passed", () => {
  const sopra = normalize(dist({ run_out_certain: 0.8, run_out_likely: 0.1, safe: 0.1 }));
  assert.equal(rejects(sopra.distribution, sopra.outcome, 0.6), true);

  // The highest of the five, but below the threshold: it is a certainty of nothing.
  const sotto = normalize(dist({ run_out_certain: 0.35, run_out_likely: 0.3, safe: 0.2, ultrasafe: 0.15 }));
  assert.equal(sotto.outcome, "run_out_certain");
  assert.equal(rejects(sotto.distribution, sotto.outcome, 0.6), false);
});

test("rejects: only the two refusing outcomes refuse", () => {
  const probabile = normalize(dist({ run_out_certain: 0.1, run_out_likely: 0.8, safe: 0.1 }));
  assert.equal(probabile.outcome, "run_out_likely");
  assert.equal(rejects(probabile.distribution, probabile.outcome, 0.6), false);

  // `non_sequitur` refuses like `run_out_certain`, and on the same terms.
  const fuori = normalize(dist({ non_sequitur: 0.9, run_out_certain: 0.1 }));
  assert.equal(rejects(fuori.distribution, fuori.outcome, 0.6), true);

  const incerto = normalize(dist({ non_sequitur: 0.4, safe: 0.35, run_out_likely: 0.25 }));
  assert.equal(incerto.outcome, "non_sequitur");
  assert.equal(rejects(incerto.distribution, incerto.outcome, 0.6), false);
});

// ---------------------------------------------------------------- the verdict

const decide = (valori, { attempts = 0, maxAttempts = 2 } = {}) => {
  const { distribution, outcome } = normalize(dist(valori));
  return verdict(distribution, outcome, { threshold: 0.6, attempts, maxAttempts });
};

test("verdict: what sits inside the perimeter passes", () => {
  assert.equal(decide({ safe: 0.7, run_out_likely: 0.3 }), "passed");
  assert.equal(decide({ ultrasafe: 0.9, safe: 0.1 }), "passed");
  // `run_out_likely` is not a refusal: the gate stops certainties only.
  assert.equal(decide({ run_out_likely: 0.8, safe: 0.2 }), "passed");
});

test("verdict: the refusal comes before everything else", () => {
  assert.equal(decide({ run_out_certain: 0.9, underspecified: 0.1 }), "rejected");
});

test("verdict: what we could not build is refused", () => {
  // A logo, an opinion, a consultancy: it is not a matter of size, and the fate is
  // that of a request that is too big.
  assert.equal(decide({ non_sequitur: 0.95, run_out_likely: 0.05 }), "rejected");
  // Below the threshold, no: two conditions, as for every refusal.
  assert.equal(decide({ non_sequitur: 0.5, safe: 0.3, run_out_likely: 0.2 }), "passed");
});

test("verdict: a request that says too little comes back", () => {
  assert.equal(decide({ underspecified: 0.7, safe: 0.3 }, { attempts: 0 }), "underspecified");
  assert.equal(decide({ underspecified: 0.7, safe: 0.3 }, { attempts: 1 }), "underspecified");
});

test("verdict: once the rounds are over no more is asked, it is refused", () => {
  // Somebody who has already rewritten `maxAttempts` times is not sent back once
  // more: going on asking is not an invitation, it is a wall.
  assert.equal(decide({ underspecified: 0.7, safe: 0.3 }, { attempts: 2, maxAttempts: 2 }), "rejected");
  assert.equal(decide({ underspecified: 0.7, safe: 0.3 }, { attempts: 5, maxAttempts: 2 }), "rejected");
});

test("verdict: the round cap does not touch the other outcomes", () => {
  // A clear request stays clear on the third round too.
  assert.equal(decide({ safe: 0.8, underspecified: 0.2 }, { attempts: 9, maxAttempts: 2 }), "passed");
});
