"""An Anthropic adapter for this door.

**An adapter belongs to one door.** A provider used by two doors is two adapters,
with two configurations, two keys and two clients: a door is a question with its own
model and its own consumption, and nothing here may be shared with another door just
because the API behind it happens to be the same one.

What crosses the door, in both directions, is this door's contract
(`../contract.py`). Inside here: this API's field names, its reasons for stopping,
its errors, its SDK. Outside: ours.

The official SDK `anthropic` is used, not HTTP by hand: the API contract changes, and
the SDK is where that change is already written down.

Three choices, all for the same reason — this is a judgement made once, on material
already in hand, and nobody is waiting in front of it:

- `output_config.format` with a JSON schema: the model **cannot** answer in prose.
  A judgement read out of a paragraph is a judgement somebody had to interpret;
- the thinking and the token ceiling are the configuration's business, not this
  file's: `effort` says how much the model may reason and `max_tokens` how much room
  it has to do it in. Which model is in use is a configured value, and a model that
  thinks and one that does not want different numbers;
- **the call is streamed**, and not because anybody is watching it arrive: nobody is.
  What comes back here is short — a handful of numbers and a paragraph — but the
  thinking that precedes it counts against the same ceiling, and at a high effort it
  is not short. A call that is not streamed has to come back inside one HTTP
  response, and past a certain size what arrives is not a long answer, it is a
  timeout — with the model having run, so paid for. Streaming makes the whole
  configured range legal instead of only the part somebody happened to try;
- the instructions (the policy) go in the `system` with `cache_control`, because
  they never change from one call to the next. Whether it does anything depends on
  the configured model: the cache has a minimum prefix, and under it the marker is
  accepted and silently ignored (`cache_creation_input_tokens: 0`) — entry 8 of
  `contesto/optimisations.md`.

It reads its own fields under whatever section it is pointed at, and receives them
back in `analyse()`. Nobody upstream knows which fields a provider needs, which is
what lets another provider ask for different ones.
"""

import json
import sys

import anthropic

from webtools_analyst.analysis_sustainability_ai.contract import answered, no_answer, unusable
from webtools_analyst.commons.configuration_client import ConfigurationError

NAME = "anthropic"

# What this provider counts, in its own words. Declared so that the configuration
# which declares them can be checked against something, and so that nothing above
# this file has to contain the list.
SPEND_KINDS = ("input", "output", "cache_write", "cache_read")

# How much the model may think before answering, and therefore how many tokens it
# spends — on the models that have the notion at all. Not all of them do, which is
# why the configuration may leave it out: see read_configuration.
EFFORTS = ("low", "medium", "high", "xhigh", "max")

# This door's roles in this API's words. The mapping lives here and nowhere else:
# above this file the material is a client and the engine that questioned them.
ROLES = {"client": "user", "preanalyst": "assistant"}


def read_configuration(configuration, base: str) -> dict:
    """What this provider needs in order to work.

    Read with the usual accessors: no default values, and a missing field stops the
    subsystem from starting rather than being filled in.
    """
    path = f"{base}.providers.{NAME}"
    # Optional: some models have no notion of effort, and on those nothing is sent.
    # Absent and wrong are two different things, though — unwritten means the model
    # decides what it does, written must be one of the levels, because a typo is a
    # typo either way.
    effort = configuration.get(f"{path}.effort")
    if effort is not None and effort not in EFFORTS:
        raise ConfigurationError(
            f"configuration of {configuration.subsystem}: {path}.effort, when it is there, "
            f"must be one of {', '.join(EFFORTS)}, found {effort!r}"
        )
    return {
        "model": configuration.string(f"{path}.model"),
        # The ceiling of the answer, **thinking included**. It is not what gets
        # spent, it is what may be spent before the answer is cut short — and on a
        # model that thinks it is not the size of the document: a ceiling cut to the
        # size of the scores stops the answer half way, before the numbers are
        # written, and a cut answer is spent and thrown away.
        "max_tokens": configuration.integer(f"{path}.max_tokens"),
        "effort": effort,
        "api_key": configuration.string(f"{path}.api_key"),
    }


# One client per key and timeout, not one per process: the analyst's three doors are
# three separate configurations and may carry three different keys. A single shared
# client would silently give the second one the first one's key.
_clients: dict[tuple[str, int], anthropic.Anthropic] = {}


def _client_of(ai) -> anthropic.Anthropic:
    key = (ai.configuration["api_key"], ai.timeout_ms)
    if key not in _clients:
        _clients[key] = anthropic.Anthropic(
            api_key=ai.configuration["api_key"],
            # This SDK counts the timeout in seconds, where ours is in
            # milliseconds everywhere. Converting here is the point of an adapter.
            timeout=ai.timeout_ms / 1000,
            # Ours, in `analyse`: a retry inside the library is tokens and a delay
            # that never reach anybody's numbers.
            max_retries=0,
        )
    return _clients[key]


def _messages_for(material, analysis: str, request: str) -> list[dict]:
    """Everything the judge reads, in this API's words, in the order it reads it.

    The **analysis goes in as a turn of its own, on the user's side**, after the
    material and before the request. Both halves of that matter.

    A turn of its own, because what tells the judge which of these texts is the
    analysis is where it sits, and not a heading written inside it. A heading is
    characters, and the material it follows was written by somebody who can type
    characters: a client who writes `# Technical analysis` into their own answer
    would be handing the judge a second analysis to weigh. Message boundaries are
    not theirs to forge.

    On the user's side, because the assistant's side would be this model saying it.
    The judge exists because whoever wrote something is not a fair judge of it, and a
    call that hands it its own supposed words has undone that before the policy is
    even read.
    """
    messages = [{"role": ROLES[entry["role"]], "content": entry["text"]} for entry in material]
    messages.append({"role": "user", "content": analysis})
    messages.append({"role": "user", "content": request})
    return messages


def _failure_of(error: Exception) -> str:
    """This API's failures in the contract's words.

    The typed classes are used rather than the text of the message: the text is not
    part of anybody's contract and changes without warning.
    """
    if isinstance(error, (anthropic.AuthenticationError, anthropic.PermissionDeniedError)):
        return "unauthorised"
    if isinstance(error, anthropic.RateLimitError):
        return "rate_limited"
    if isinstance(error, anthropic.APITimeoutError):
        return "timed_out"
    if isinstance(error, anthropic.APIStatusError) and error.status_code == 408:
        return "timed_out"
    if isinstance(error, anthropic.APIStatusError) and 400 <= error.status_code < 500:
        # The provider understood us and refused the request: a field it does not
        # know, a shape it does not accept, a model that is not there. It is our
        # mistake, it never fixes itself, and the first run of this door paid for
        # three identical refusals before this line existed.
        return "rejected"
    # Connection errors, 5xx, and anything this SDK has not got a class for.
    return "unreachable"


# Asking again is worth it only when asking again might answer: a wrong key stays
# wrong.
_WORTH_RETRYING = frozenset({"timed_out", "rate_limited", "unreachable"})


def _spend_of(response) -> dict:
    """What the call consumed, by kind, under this provider's own names.

    A kind the provider did not report is **left out**, not set to zero. Zero is a
    claim — this call wrote nothing to the cache — and absent is the absence of one.
    Writing zero where nothing was said makes a call that was never measured
    indistinguishable from a call that cost nothing, and the ledger is then wrong in
    the one direction nobody checks, because nothing looks anomalous.
    """
    usage = response.usage
    reported = {
        "input": getattr(usage, "input_tokens", None),
        "output": getattr(usage, "output_tokens", None),
        "cache_write": getattr(usage, "cache_creation_input_tokens", None),
        "cache_read": getattr(usage, "cache_read_input_tokens", None),
    }
    return {"kinds": {kind: units for kind, units in reported.items() if units is not None}}


def _log(message: str) -> None:
    print(f"[analysis_sustainability_ai/anthropic] {message}", file=sys.stderr)


def judge(ai, *, instructions: str, material, analysis: str, request: str, schema: dict) -> dict:
    configuration = ai.configuration
    messages = _messages_for(material, analysis, request)

    attempts = 0
    response = None
    failure = None
    while attempts < ai.max_attempts:
        attempts += 1
        try:
            with _client_of(ai).beta.messages.stream(
                model=configuration["model"],
                max_tokens=configuration["max_tokens"],
                system=[
                    {
                        "type": "text",
                        "text": instructions,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                messages=messages,
                output_config={
                    "format": {"type": "json_schema", "schema": schema},
                    # Nothing travels when nothing was configured: a field left out
                    # and a field set to a value the code chose are not the same
                    # thing.
                    **({} if configuration["effort"] is None else {"effort": configuration["effort"]}),
                },
                # A refusal is re-run on another model inside the same call. Without
                # it a declined request simply stops, and what stops here is the
                # judgement that decides whether the project goes on at all.
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            ) as stream:
                response = stream.get_final_message()
            failure = None
            break
        except Exception as error:  # noqa: BLE001 — translated into the contract's words
            failure = _failure_of(error)
            _log(f"attempt {attempts}: {type(error).__name__}: {error} → {failure}")
            if failure not in _WORTH_RETRYING:
                break

    if response is None:
        return no_answer(provider=NAME, failure=failure, attempts=attempts)

    # From here on the tokens have been spent, whatever happens next.
    model = response.model or configuration["model"]
    outcome = {
        "provider": NAME,
        "model": model,
        "spend": _spend_of(response),
        "attempts": attempts,
        "fell_back": model != configuration["model"],
    }

    if response.stop_reason == "max_tokens":
        _log("answer cut short by max_tokens")
        return unusable(**outcome, ended="cut")
    if response.stop_reason == "refusal":
        category = getattr(response.stop_details, "category", None)
        _log(f"the model refused{f' ({category})' if category else ''}")
        return unusable(**outcome, ended="refused")

    # Thinking blocks come back too, with their text empty: only the text blocks
    # carry the answer.
    text = "".join(block.text for block in response.content if block.type == "text")

    try:
        output = json.loads(text)
    except ValueError:
        _log("answer is not JSON, despite the schema")
        return unusable(**outcome, ended="unusable")

    return answered(**outcome, output=output)
