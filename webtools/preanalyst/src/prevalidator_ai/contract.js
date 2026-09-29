// **A door's contract with its providers.**
//
// A door is one question this subsystem asks a model. Every door owns a contract
// of its own — what it sends, and what comes back — and **contracts are not
// shared between doors**: two doors may run on different providers, with
// different keys, different models and different consumption, and each has to be
// able to change without the others being disentangled first. Two of these files
// looking alike is the price of that independence, and it is paid on purpose.
//
// What it is for: **a door must not be tied to one provider.** A provider is an
// adapter — it receives a request in the words written here, speaks whatever
// language its API speaks, and answers in the words written here. Nothing above
// an adapter may know a provider's field names, its roles, its reasons for
// stopping, its errors, or what it calls a token. Swap the provider and only that
// one file changes.
//
// This door asks for a **classification**: a policy, one document, and the shape
// the answer must have. It does not talk, so it sends no conversation.
//
// ------------------------------------------------------------- what is asked
//
//   instructions   the policy, as text
//   document       the pre-specification, as one document. **Not** a
//                  conversation: this door classifies a text, it does not talk
//   schema         the shape the answer must have
//
// ------------------------------------------------------------ what comes back
//
// One envelope for every outcome, so nothing has to be inferred from which
// fields happen to be there:
//
//   { ok, provider, model, ended, failure, attempts, fell_back, spend, output }
//
// `ended` and `failure` answer two different questions, and collapsing them is
// how a system stops knowing what happened to it:
//
//   complete    there is an answer, and it is ours to use
//   cut         the model stopped before finishing — our ceiling, our decision
//   refused     the model declined — its policy, not our bug
//   unusable    it answered, and the answer does not fit what we asked for
//   no_answer   nothing came back at all; `failure` says why
//
// In the first four the model ran, so the tokens were consumed. That is why
// `spend` travels with a failure as much as with an answer — and here it matters
// twice, because a prevalidation that fails is consumption on a project that may
// never exist.
//
// `spend.kinds` maps a name to a number of units, and **the names are the
// adapter's**: nothing above it contains that list. They are counted and never
// converted: what a unit is worth is not this subsystem's to say.

export const ENDINGS = Object.freeze(["complete", "cut", "refused", "unusable", "no_answer"]);

export const FAILURES = Object.freeze([
  // Nothing at the other end: no connection, a 5xx, a name that does not resolve.
  "unreachable",
  // We gave up waiting. Not the same as unreachable: the model may well be
  // working, and it is certainly consuming something.
  "timed_out",
  // We are asking too fast, or have spent our allowance. It is about us, not
  // about the provider's health.
  "rate_limited",
  // The key is wrong, missing, or not allowed to do this. It never fixes itself.
  "unauthorised",
  // The configuration names a provider this door does not have.
  "unknown_provider",
]);

export class ContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "ContractError";
  }
}

export function answered({ provider, model, output, spend, attempts = 1, fellBack = false }) {
  return check({
    ok: true,
    provider,
    model,
    ended: "complete",
    failure: null,
    attempts,
    fell_back: fellBack,
    spend: spend ?? null,
    output,
  });
}

// The model ran and there is nothing to use. The tokens were spent all the same.
export function unusable({ provider, model, ended, spend, attempts = 1, fellBack = false }) {
  if (!["cut", "refused", "unusable"].includes(ended)) {
    throw new ContractError(`unusable(): ended must be cut, refused or unusable, found ${JSON.stringify(ended)}`);
  }
  return check({
    ok: false,
    provider,
    model: model ?? null,
    ended,
    failure: null,
    attempts,
    fell_back: fellBack,
    spend: spend ?? null,
    output: null,
  });
}

// Nothing came back. `spend` stays null: a zero would be a claim we cannot make.
export function noAnswer({ provider, failure, attempts = 1 }) {
  if (!FAILURES.includes(failure)) {
    throw new ContractError(`noAnswer(): failure must be one of ${FAILURES.join(", ")}, found ${JSON.stringify(failure)}`);
  }
  return check({
    ok: false,
    provider,
    model: null,
    ended: "no_answer",
    failure,
    attempts,
    fell_back: false,
    spend: null,
    output: null,
  });
}

// The door runs this on whatever its adapter returned. An adapter that drifts is
// caught **here**, at the boundary, not three files downstream where a missing
// field is noticed only by a number that quietly stays at zero.
export function check(answer) {
  if (answer === null || typeof answer !== "object") {
    throw new ContractError("the adapter did not return an answer");
  }
  const { provider, model, ended, failure, attempts, spend, output } = answer;
  if (typeof provider !== "string" || provider === "") {
    throw new ContractError("the answer does not say which provider it came from");
  }
  if (!ENDINGS.includes(ended)) {
    throw new ContractError(`ended must be one of ${ENDINGS.join(", ")}, found ${JSON.stringify(ended)}`);
  }
  if (ended === "no_answer") {
    if (!FAILURES.includes(failure)) throw new ContractError("an answer that never came must say why");
  } else if (failure !== null) {
    throw new ContractError("an answer that came back has no failure");
  }
  if (answer.ok !== (ended === "complete")) throw new ContractError("ok and ended disagree");
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new ContractError(`attempts must be an integer of at least 1, found ${JSON.stringify(attempts)}`);
  }
  if (typeof answer.fell_back !== "boolean") throw new ContractError("fell_back must be said either way");
  if (model !== null && (typeof model !== "string" || model === "")) {
    throw new ContractError("model must be a name or null");
  }
  if (spend !== null) checkSpend(spend);
  if (ended === "complete" && (output === null || output === undefined)) {
    throw new ContractError("a complete answer carries an output");
  }
  return answer;
}

function checkSpend(spend) {
  if (typeof spend !== "object" || spend === null || typeof spend.kinds !== "object" || spend.kinds === null) {
    throw new ContractError("spend must be { kinds: { <name>: <units> } }");
  }
  for (const [kind, units] of Object.entries(spend.kinds)) {
    if (!Number.isInteger(units) || units < 0) {
      throw new ContractError(`spend.kinds.${kind} must be a whole number of units, found ${JSON.stringify(units)}`);
    }
  }
}
