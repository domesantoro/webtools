"""**A door's contract with its providers.**

A door is one question this subsystem asks a model. Every door owns a contract of
its own — what it sends, and what comes back — and **contracts are not shared
between doors**. This one and the technical analysis' look alike in most of their
length, and that is the price of their independence, paid on purpose: the two may
run on different providers, with different keys, different models and different
consumption, and either has to be able to change without the other being
disentangled first.

What it is for: **a door must not be tied to one provider.** A provider is an
adapter — it receives a request in the words written here, speaks whatever language
its API speaks, and answers in the words written here. Nothing above an adapter may
know a provider's field names, its roles, its reasons for stopping, its errors, or
what it calls a token. Swap the provider and only that one file changes.

This door asks for the **judgement of sustainability**: whether what has been
described is a small tool that can be built in one pass.

------------------------------------------------------------- what is asked

    instructions   the policy, as text — the standing brief, identical at every
                   call, which is what makes it worth caching
    material       the pre-specification and the rounds of questions, as messages
                   in **our** roles (ROLES below)
    analysis       the technical analysis just written, as text. It is a field of
                   its own, and not one more message of the material, for two
                   reasons that pull the same way. It was not written by the client,
                   so it is not one of their turns; and it was not written by this
                   model either — **it must not arrive as something this model said**,
                   because the whole reason this door exists is that whoever wrote
                   something is not a fair judge of it. Where it goes is the
                   adapter's, and what tells the judge what it is looking at is its
                   position, never a label inside the text: a label is characters,
                   and characters can be forged by whoever wrote the material
    request        what is being asked of the model **now**, after everything it has
                   to read
    schema         the shape the answer must have

------------------------------------------------------------ what comes back

One envelope for every outcome, so nothing has to be inferred from which fields
happen to be there::

    {ok, provider, model, ended, failure, attempts, fell_back, spend, output}

`ended` and `failure` answer two different questions, and collapsing them is how a
system stops knowing what happened to it:

    complete    there is an answer, and it is ours to use
    cut         the model stopped before finishing — our ceiling, our decision
    refused     the model declined — its policy, not our bug
    unusable    it answered, and the answer does not fit what we asked for
    no_answer   nothing came back at all; `failure` says why

In the first four the model ran, so the tokens were consumed. That is why `spend`
travels with a failure as much as with an answer.

`spend["kinds"]` maps a name to a number of units, and **the names are the
adapter's**. Nothing above the adapter contains that list — not the callers, not the
logs, not the metrics, which count them under the names they arrive with. They are
counted and never converted: what a unit is worth is not this subsystem's to say.
"""

# Who can have spoken in the material. The analysis is not here: it is a field of
# its own, for the reason written above.
ROLES = ("client", "preanalyst")

ENDINGS = ("complete", "cut", "refused", "unusable", "no_answer")

FAILURES = (
    # Nothing at the other end: no connection, a 5xx, a name that does not resolve.
    "unreachable",
    # We gave up waiting. Not the same as unreachable: the model may well be
    # working, and it is certainly consuming something.
    "timed_out",
    # We are asking too fast, or have spent our allowance. It is about us, not about
    # the provider's health.
    "rate_limited",
    # The key is wrong, missing, or not allowed to do this. It never fixes itself.
    "unauthorised",
    # The provider understood us and said the request was wrong. Ours to fix, and
    # asking again with the same request buys the same refusal again.
    "rejected",
    # The configuration names a provider this door does not have.
    "unknown_provider",
)

_RAN_AND_UNUSABLE = ("cut", "refused", "unusable")


class ContractError(Exception):
    """An adapter handed over something this contract does not allow."""


def answered(*, provider, model, output, spend, attempts=1, fell_back=False) -> dict:
    return check(
        {
            "ok": True,
            "provider": provider,
            "model": model,
            "ended": "complete",
            "failure": None,
            "attempts": attempts,
            "fell_back": fell_back,
            "spend": spend,
            "output": output,
        }
    )


def unusable(*, provider, model, ended, spend, attempts=1, fell_back=False) -> dict:
    """The model ran and there is nothing to use. The tokens were spent all the same."""
    if ended not in _RAN_AND_UNUSABLE:
        raise ContractError(
            f"unusable(): ended must be one of {', '.join(_RAN_AND_UNUSABLE)}, found {ended!r}"
        )
    return check(
        {
            "ok": False,
            "provider": provider,
            "model": model,
            "ended": ended,
            "failure": None,
            "attempts": attempts,
            "fell_back": fell_back,
            "spend": spend,
            "output": None,
        }
    )


def no_answer(*, provider, failure, attempts=1) -> dict:
    """Nothing came back. `spend` stays None: a zero would be a claim we cannot make."""
    if failure not in FAILURES:
        raise ContractError(
            f"no_answer(): failure must be one of {', '.join(FAILURES)}, found {failure!r}"
        )
    return check(
        {
            "ok": False,
            "provider": provider,
            "model": None,
            "ended": "no_answer",
            "failure": failure,
            "attempts": attempts,
            "fell_back": False,
            "spend": None,
            "output": None,
        }
    )


def check(answer) -> dict:
    """The door runs this on whatever its adapter returned.

    An adapter that drifts is caught **here**, at the boundary, not three files
    downstream where a missing field is noticed only by a number that quietly stays
    at zero.
    """
    if not isinstance(answer, dict):
        raise ContractError("the adapter did not return an answer")
    provider = answer.get("provider")
    model = answer.get("model")
    ended = answer.get("ended")
    failure = answer.get("failure")
    attempts = answer.get("attempts")
    spend = answer.get("spend")

    if not isinstance(provider, str) or not provider:
        raise ContractError("the answer does not say which provider it came from")
    if ended not in ENDINGS:
        raise ContractError(f"ended must be one of {', '.join(ENDINGS)}, found {ended!r}")
    if ended == "no_answer":
        if failure not in FAILURES:
            raise ContractError("an answer that never came must say why")
    elif failure is not None:
        raise ContractError("an answer that came back has no failure")
    if answer.get("ok") is not (ended == "complete"):
        raise ContractError("ok and ended disagree")
    # bool is an int in Python: `True` must not pass as one attempt.
    if isinstance(attempts, bool) or not isinstance(attempts, int) or attempts < 1:
        raise ContractError(f"attempts must be an integer of at least 1, found {attempts!r}")
    if not isinstance(answer.get("fell_back"), bool):
        raise ContractError("fell_back must be said either way")
    if model is not None and (not isinstance(model, str) or not model):
        raise ContractError("model must be a name or None")
    if spend is not None:
        _check_spend(spend)
    if ended == "complete" and answer.get("output") is None:
        raise ContractError("a complete answer carries an output")
    return answer


def _check_spend(spend) -> None:
    if not isinstance(spend, dict) or not isinstance(spend.get("kinds"), dict):
        raise ContractError('spend must be {"kinds": {<name>: <units>}}')
    for kind, units in spend["kinds"].items():
        if isinstance(units, bool) or not isinstance(units, int) or units < 0:
            raise ContractError(
                f"spend.kinds.{kind} must be a whole number of units, found {units!r}"
            )


def material(entries) -> list[dict]:
    """The material in our words.

    Nothing outside an adapter builds a provider's roles, so this is where a wrong
    one is caught.
    """
    checked = []
    for entry in entries:
        role = entry.get("role")
        if role not in ROLES:
            raise ContractError(
                f"a message's role must be one of {', '.join(ROLES)}, found {role!r}"
            )
        text = entry.get("text")
        checked.append({"role": role, "text": "" if text is None else str(text)})
    return checked
