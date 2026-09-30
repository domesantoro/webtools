"""The four contracts: what an adapter may hand over, and what is caught at the boundary.

A door checks the contract on whatever its adapter returned, so an adapter that drifts
is caught there instead of three files downstream, where it shows up only as a number
that quietly stays at zero. These tests are that check.

The four are tested together and asserted to be **separate**: they are four modules on
purpose, and the day one of them gains an outcome the others must not.

    uv run pytest
"""

import pytest

from webtools_developer.build_plan_ai import contract as plan_contract
from webtools_developer.build_readme_ai import contract as readme_contract
from webtools_developer.repair_file_ai import contract as repair_contract
from webtools_developer.write_file_ai import contract as write_contract

CONTRACTS = [plan_contract, write_contract, repair_contract, readme_contract]


def envelope(**changes) -> dict:
    return {
        "ok": True,
        "provider": "anthropic",
        "model": "claude-opus-5-5",
        "ended": "complete",
        "failure": None,
        "attempts": 1,
        "fell_back": False,
        "spend": {"kinds": {"input": 10, "output": 5}},
        "output": {"anything": True},
        **changes,
    }


def test_the_four_contracts_are_four_modules():
    """Not one imported four times. Each door has to be able to change alone."""
    assert len({id(contract) for contract in CONTRACTS}) == 4


@pytest.mark.parametrize("contract", CONTRACTS)
def test_an_answer_passes(contract):
    assert contract.check(envelope())["ok"] is True


@pytest.mark.parametrize("contract", CONTRACTS)
def test_the_five_endings_are_the_five_endings(contract):
    assert contract.ENDINGS == ("complete", "cut", "refused", "unusable", "no_answer")


@pytest.mark.parametrize("contract", CONTRACTS)
@pytest.mark.parametrize(
    "broken",
    [
        {"provider": None},
        {"provider": ""},
        {"ended": "finished"},
        # ok and ended disagree: an answer that says it is complete and is not.
        {"ok": False},
        {"attempts": 0},
        # bool is an int in Python: `True` must not pass as one attempt.
        {"attempts": True},
        {"fell_back": None},
        {"model": ""},
        {"spend": {"kinds": {"input": -1}}},
        {"spend": {"kinds": {"input": 1.5}}},
        {"spend": {"tokens": 10}},
        # A complete answer with nothing in it.
        {"output": None},
        # A failure on an answer that came back.
        {"failure": "timed_out"},
    ],
)
def test_what_an_adapter_may_not_hand_over(contract, broken):
    with pytest.raises(contract.ContractError):
        contract.check(envelope(**broken))


@pytest.mark.parametrize("contract", CONTRACTS)
def test_nothing_at_all_is_not_an_answer(contract):
    with pytest.raises(contract.ContractError):
        contract.check(None)


@pytest.mark.parametrize("contract", CONTRACTS)
def test_an_answer_that_never_came_must_say_why(contract):
    with pytest.raises(contract.ContractError):
        contract.check(
            envelope(ok=False, ended="no_answer", failure=None, output=None, spend=None)
        )
    assert contract.check(
        envelope(ok=False, ended="no_answer", failure="timed_out", output=None, spend=None)
    )["failure"] == "timed_out"


@pytest.mark.parametrize("contract", CONTRACTS)
def test_a_failure_must_be_one_of_ours(contract):
    with pytest.raises(contract.ContractError):
        contract.no_answer(provider="anthropic", failure="everything_went_wrong")


@pytest.mark.parametrize("contract", CONTRACTS)
def test_nothing_came_back_carries_no_spend(contract):
    """`spend` stays None: a zero would be a claim we cannot make."""
    answer = contract.no_answer(provider="anthropic", failure="unreachable")
    assert answer["spend"] is None
    assert answer["model"] is None


@pytest.mark.parametrize("contract", CONTRACTS)
@pytest.mark.parametrize("ended", ["cut", "refused", "unusable"])
def test_the_model_ran_and_there_is_nothing_to_use(contract, ended):
    """In three of the four bad endings the model ran, so what it consumed is real and
    travels with the failure."""
    answer = contract.unusable(
        provider="anthropic",
        model="claude-opus-5-5",
        ended=ended,
        spend={"kinds": {"input": 100, "output": 20}},
    )
    assert answer["ok"] is False
    assert answer["output"] is None
    assert answer["spend"]["kinds"]["input"] == 100


@pytest.mark.parametrize("contract", CONTRACTS)
def test_unusable_is_not_for_an_answer_that_never_came(contract):
    with pytest.raises(contract.ContractError):
        contract.unusable(
            provider="anthropic", model="m", ended="no_answer", spend=None
        )
