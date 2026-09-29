// The doors' contracts with their providers.
//
// Two files are tested here, one per door, and they are tested **separately** on
// purpose: they are not one contract with two copies, they are two contracts that
// happen to look alike today and are free to stop looking alike tomorrow. A test
// that looped over both would be the first thing to make that impossible.
//
// What is being defended is one sentence: nothing above an adapter may know a
// provider's words. So the checks are about what the door refuses to hand on.
//
//   node --test

import assert from "node:assert/strict";
import { test } from "node:test";

import * as preanalystDoor from "../src/preanalyst_ai/contract.js";
import * as prevalidationDoor from "../src/prevalidator_ai/contract.js";

const spend = { kinds: { input: 1841, output: 612 } };

test("an answer carries how it ended, what it cost and who gave it", () => {
  const answer = preanalystDoor.answered({
    provider: "somebody",
    model: "a-model",
    output: { message: "hello" },
    spend,
    attempts: 2,
    fellBack: true,
  });
  assert.equal(answer.ok, true);
  assert.equal(answer.ended, "complete");
  assert.equal(answer.failure, null);
  assert.equal(answer.attempts, 2);
  assert.equal(answer.fell_back, true);
  assert.deepEqual(answer.spend, spend);
});

test("a model that ran and gave nothing usable still reports what it spent", () => {
  // The three are different facts: our ceiling, the model's policy, an answer
  // that does not fit. A single word for all three is how a system stops knowing
  // what happened to it.
  for (const ended of ["cut", "refused", "unusable"]) {
    const answer = preanalystDoor.unusable({ provider: "somebody", model: "a-model", ended, spend });
    assert.equal(answer.ok, false);
    assert.equal(answer.ended, ended);
    assert.equal(answer.failure, null);
    assert.deepEqual(answer.spend, spend);
    assert.equal(answer.output, null);
  }
  assert.throws(
    () => preanalystDoor.unusable({ provider: "somebody", ended: "no_answer", spend }),
    preanalystDoor.ContractError,
  );
});

test("nothing came back: why is said, and no spend is claimed", () => {
  for (const failure of preanalystDoor.FAILURES) {
    const answer = preanalystDoor.noAnswer({ provider: "somebody", failure, attempts: 3 });
    assert.equal(answer.ended, "no_answer");
    assert.equal(answer.failure, failure);
    // Not zero: a zero would be a claim about a call we never saw the end of.
    assert.equal(answer.spend, null);
  }
  assert.throws(() => preanalystDoor.noAnswer({ provider: "somebody", failure: "broken" }), /failure must be one of/);
});

test("the door catches an adapter that drifts", () => {
  const good = preanalystDoor.answered({ provider: "somebody", model: "a-model", output: {}, spend });

  // The shapes an adapter could plausibly hand back, each of which would be
  // noticed downstream only as a number that quietly stays at zero.
  assert.throws(() => preanalystDoor.check(null), preanalystDoor.ContractError);
  assert.throws(() => preanalystDoor.check({ ...good, provider: "" }), /which provider/);
  assert.throws(() => preanalystDoor.check({ ...good, ended: "finished" }), /ended must be one of/);
  assert.throws(() => preanalystDoor.check({ ...good, failure: "timed_out" }), /has no failure/);
  assert.throws(() => preanalystDoor.check({ ...good, ok: false }), /ok and ended disagree/);
  assert.throws(() => preanalystDoor.check({ ...good, attempts: 0 }), /attempts must be/);
  assert.throws(() => preanalystDoor.check({ ...good, fell_back: undefined }), /fell_back/);
  assert.throws(() => preanalystDoor.check({ ...good, output: null }), /carries an output/);
  assert.throws(
    () => preanalystDoor.check({ ...good, spend: { input_tokens: 10 } }),
    /spend must be/,
  );
  assert.throws(
    () => preanalystDoor.check({ ...good, spend: { kinds: { input: 1.5 } } }),
    /whole number of units/,
  );
});

test("the spend's kinds are whatever the adapter bills, and nothing is assumed", () => {
  // A provider that bills by the second, or by the image, or by a cache nobody
  // else has: the contract counts units under the names it is given and has no
  // list of its own to check them against.
  const odd = { kinds: { seconds: 12, images: 3, "reasoning-units": 900 } };
  const answer = preanalystDoor.answered({ provider: "somebody-else", model: "m", output: {}, spend: odd });
  assert.deepEqual(answer.spend, odd);
});

test("a message's role is ours, and a provider's is refused", () => {
  const messages = preanalystDoor.conversation([
    { role: "client", text: "I keep the training sessions" },
    { role: "preanalyst", text: "What does a session contain?" },
  ]);
  assert.deepEqual(
    messages.map((message) => message.role),
    ["client", "preanalyst"],
  );
  // `user` and `assistant` are what one family of APIs calls them. Written here
  // they are a provider's vocabulary in the wrong file.
  assert.throws(() => preanalystDoor.conversation([{ role: "user", text: "hello" }]), /role must be one of/);
  assert.throws(() => preanalystDoor.conversation([{ role: "assistant", text: "hello" }]), /role must be one of/);
});

test("the prevalidation door has a contract of its own, and it is not a conversation", () => {
  const answer = prevalidationDoor.answered({
    provider: "somebody",
    model: "a-model",
    output: { distribution: {} },
    spend,
  });
  assert.equal(answer.ended, "complete");
  assert.throws(() => prevalidationDoor.check({ ...answer, ended: "no_answer" }), /must say why/);
  // This door classifies a document: it has no roles to translate, so it offers
  // no conversation at all. The absence is the point, not an oversight.
  assert.equal(prevalidationDoor.conversation, undefined);
});
