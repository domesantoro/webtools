"""What the door refuses to let through.

The call to the provider is not tested: it costs and it is not repeatable. What is
tested is the boundary — that an adapter which drifts is caught here, at the door,
and not three files downstream where a missing field shows up only as a number that
quietly stays at zero.

    uv run pytest
"""

import pytest

from webtools_analyst.analysis_technical_ai.contract import (
    ContractError,
    answered,
    check,
    material,
    no_answer,
    unusable,
)

SPEND = {"kinds": {"input": 1200, "output": 800}}


def test_an_answer_carries_everything_about_the_call():
    envelope = answered(
        provider="anthropic", model="claude-opus-5", output={"analysis": "…"}, spend=SPEND
    )
    assert envelope["ok"] is True
    assert envelope["ended"] == "complete"
    assert envelope["failure"] is None
    assert envelope["attempts"] == 1
    assert envelope["fell_back"] is False
    assert envelope["spend"] == SPEND


def test_the_model_ran_so_the_spend_travels_with_the_failure():
    """Cut short, refused, or answering something that does not fit: in all three the
    model ran, and what it consumed is real."""
    for ended in ("cut", "refused", "unusable"):
        envelope = unusable(
            provider="anthropic", model="claude-opus-5", ended=ended, spend=SPEND, attempts=2
        )
        assert envelope["ok"] is False
        assert envelope["ended"] == ended
        assert envelope["spend"] == SPEND
        assert envelope["output"] is None


def test_nothing_came_back_so_there_is_no_spend_to_report():
    """A zero would be a claim we cannot make: we do not know what the call consumed
    before it failed, and saying nothing is not the same as saying nothing was spent."""
    envelope = no_answer(provider="anthropic", failure="timed_out", attempts=3)
    assert envelope["spend"] is None
    assert envelope["model"] is None
    assert envelope["ended"] == "no_answer"
    assert envelope["failure"] == "timed_out"


def test_an_ending_and_a_failure_are_two_different_questions():
    with pytest.raises(ContractError):
        unusable(provider="anthropic", model="m", ended="no_answer", spend=None)
    with pytest.raises(ContractError):
        no_answer(provider="anthropic", failure="the network was sad")


@pytest.mark.parametrize(
    "drift",
    [
        {"provider": ""},
        {"provider": None},
        {"ended": "finished"},
        {"attempts": 0},
        {"attempts": 1.5},
        # bool is an int in Python: True must not pass as one attempt.
        {"attempts": True},
        {"fell_back": None},
        {"model": ""},
        {"failure": "timed_out"},
        {"ok": False},
        {"spend": {"kinds": {"input": -1}}},
        {"spend": {"kinds": {"input": "1200"}}},
        {"spend": {"input": 1200}},
        {"output": None},
    ],
)
def test_an_adapter_that_drifts_is_caught_at_the_door(drift):
    envelope = answered(
        provider="anthropic", model="claude-opus-5", output={"analysis": "…"}, spend=SPEND
    )
    with pytest.raises(ContractError):
        check({**envelope, **drift})


def test_the_kinds_of_spend_are_whatever_the_adapter_reports():
    """No list of kinds exists here. A provider counting something else entirely is
    counted all the same, and nothing above the adapter had to be told about it."""
    envelope = answered(
        provider="somebody-else",
        model="their-model",
        output={"analysis": "…"},
        spend={"kinds": {"seconds": 12, "images": 3, "reasoning-units": 900}},
    )
    assert envelope["spend"]["kinds"]["reasoning-units"] == 900


def test_a_provider_s_own_roles_never_reach_this_side_of_the_door():
    """`user` and `assistant` are one API's words. Above the adapter there is a client
    and the engine that questioned them."""
    with pytest.raises(ContractError):
        material([{"role": "user", "text": "hello"}])
    with pytest.raises(ContractError):
        material([{"role": "assistant", "text": "hello"}])
    assert material([{"role": "client", "text": "hello"}]) == [
        {"role": "client", "text": "hello"}
    ]


def test_the_analyst_is_not_one_of_the_voices_in_the_material():
    """It is reading a conversation it did not take part in."""
    with pytest.raises(ContractError):
        material([{"role": "analyst", "text": "…"}])


def test_a_message_with_no_text_is_an_empty_message_not_a_missing_one():
    assert material([{"role": "client", "text": None}]) == [{"role": "client", "text": ""}]
