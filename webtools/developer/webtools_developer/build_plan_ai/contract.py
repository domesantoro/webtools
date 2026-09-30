"""**The plan door's contract with its providers.**

A door is one question this subsystem asks a model. Every door owns a contract of its
own — what it sends, and what comes back — and **contracts are not shared between
doors**. The developer's four look alike in most of their length, and that is the price
of their independence, paid on purpose: each may run on a different provider, with a
different key, a different model and its own consumption, and any of them has to be
able to change without the others being disentangled first.

This one asks the question the whole build rests on: **what is being built, and out of
what**. It is asked once per build, it is the shortest of the four and the one whose
answer is read by a person before anything is written — the driver can see the plan on
the project's open step while the files are still being made. It is also the only door
here that chooses, and what it chooses is a name out of a list we hand it.

What it is for: **a door must not be tied to one provider.** A provider is an adapter —
it receives a request in the words written here, speaks whatever language its API
speaks, and answers in the words written here. Nothing above an adapter may know a
provider's field names, its roles, its reasons for stopping, its errors, or what it
calls a token. Swap the provider and only that one file changes.

------------------------------------------------------------- what is asked

    instructions   the policy, as text — the standing brief, identical at every
                   call, which is what makes it worth caching
    analysis       the technical analysis, as text: the document the tool is built
                   from
    points         the sentences the client agreed to, as a list of strings. The
                   perimeter, and a field of its own rather than part of the
                   analysis: they were written for the client and agreed to by
                   them, and what the build may not exceed is them
    stacks         what we can build with, as a mapping from a stack's name to the
                   commands that will be run on it. It is handed over so the answer
                   can only name one of them, and so that whoever plans knows how
                   the plan will be checked. Which stacks exist is configuration:
                   nothing here and nothing above knows the names
    request        what is being asked of the model **now**, after everything it has
                   to read
    schema         the shape the answer must have

Nothing the client typed is sent to this door. Their request became the
pre-specification, the rounds of questions and then the analysis, and what is built is
built from that: a door that also read the original wording would be a second, unagreed
source for the same decisions.

------------------------------------------------------------ what comes back

One envelope for every outcome, so nothing has to be inferred from which fields happen
to be there::

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

`spend["kinds"]` maps a name to a number of units, and **the names are the adapter's**.
Nothing above the adapter contains that list — not the callers, not the logs, not the
metrics, which count them under the names they arrive with. They are counted and never
converted: what a unit is worth is not this subsystem's to say.
"""

ENDINGS = ("complete", "cut", "refused", "unusable", "no_answer")

FAILURES = (
    # Nothing at the other end: no connection, a 5xx, a name that does not resolve.
    "unreachable",
    # We gave up waiting. Not the same as unreachable: the model may well be working,
    # and it is certainly consuming something.
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
    downstream where a missing field is noticed only by a number that quietly stays at
    zero.
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
