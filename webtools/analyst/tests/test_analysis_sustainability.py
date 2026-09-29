"""How a judgement is read, and what makes one unreadable.

No call is made here. What is tested is the rule the numbers are read by, which is
where a judgement is either honest or quietly wrong.

    uv run pytest
"""

import pytest

from webtools_analyst.analysis_sustainability import (
    AXES,
    SCHEMA,
    VERDICTS,
    decide,
    material_of,
    read_policy,
    read_scores,
)

THRESHOLD = 0.5


def scores(**overrides) -> dict:
    """All five axes comfortable, unless a test says otherwise."""
    return {axis: 0.9 for axis in AXES} | overrides


def test_all_five_axes_are_read():
    read = read_scores(scores())
    assert set(read["scores"]) == set(AXES)


def test_one_missing_axis_makes_the_whole_judgement_unusable():
    """A verdict resting on four axes out of five is not the verdict this policy
    describes, and treating the fifth as absent would let the weakest one be the one
    nobody saw."""
    for axis in AXES:
        incomplete = scores()
        del incomplete[axis]
        assert read_scores(incomplete) is None


@pytest.mark.parametrize("value", [-0.1, 1.1, "0.8", None, True])
def test_a_score_outside_the_scale_is_not_a_score(value):
    assert read_scores(scores(people=value)) is None


def test_the_weakest_axis_is_named():
    read = read_scores(scores(integrations=0.2))
    assert read["weakest"] == "integrations"


def test_the_weakest_axis_decides_and_not_the_average():
    """Comfortable on four axes does not make up for the fifth: a tool that is small,
    has one user and touches no money is still out of reach if it has to talk to a
    system we do not control."""
    one_low = scores(integrations=0.1)
    assert sum(one_low.values()) / len(one_low) > THRESHOLD
    assert decide("take_on", one_low, THRESHOLD) == "refuse"


def test_a_verdict_the_numbers_do_not_support_is_not_that_verdict():
    """Two conditions and not one: the model asked to take the work on, and its own
    scores say otherwise."""
    assert decide("take_on", scores(), THRESHOLD) == "take_on"
    assert decide("take_on", scores(surface=0.4), THRESHOLD) == "refuse"


def test_the_numbers_never_turn_a_refusal_into_a_take_on():
    """It works in one direction only. A model that asked to refuse is not overruled
    by its own comfortable numbers: it read something the scores do not carry."""
    assert decide("refuse", scores(), THRESHOLD) == "refuse"


def test_exactly_at_the_threshold_is_not_above_it():
    assert decide("take_on", scores(people=THRESHOLD), THRESHOLD) == "refuse"


def test_the_schema_asks_for_every_axis_and_nothing_else():
    properties = SCHEMA["properties"]["scores"]["properties"]
    assert set(properties) == set(AXES)
    assert SCHEMA["properties"]["scores"]["required"] == list(AXES)
    assert SCHEMA["properties"]["scores"]["additionalProperties"] is False
    assert SCHEMA["properties"]["verdict"]["enum"] == list(VERDICTS)


def test_the_schema_asks_for_nothing_constrained_output_refuses():
    forbidden = {"minLength", "maxLength", "minimum", "maximum", "multipleOf"}

    def walk(node):
        if isinstance(node, dict):
            assert forbidden.isdisjoint(node), f"forbidden keyword in {node}"
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(SCHEMA)


def test_the_policy_names_every_axis_the_code_asks_for():
    """This is what keeps the two from drifting apart.

    The axes are in the code, because the code builds the schema and checks the
    range. What each one *means* is in the policy, because that is what the model
    reads. Two places, and nothing in either would notice the other changing — so
    the noticing is here: a name added to `AXES` and not explained in the policy is a
    number the model is asked for without being told what it is.
    """
    policy = read_policy("analysis-sustainability-v1")
    for axis in AXES:
        assert f"`{axis}`" in policy, f"the policy never explains the axis {axis}"
    for verdict in VERDICTS:
        assert f"`{verdict}`" in policy, f"the policy never names the verdict {verdict}"


def test_the_policy_says_the_analysis_is_known_by_its_position():
    """A heading inside somebody's message is characters, and the material was
    written by people who can type characters."""
    policy = read_policy("analysis-sustainability-v1")
    assert "position" in policy or "last thing before" in policy


def test_the_material_keeps_the_two_voices_apart():
    material = material_of(
        "a spec",
        [{"role": "client", "text": "yes"}, {"role": "system", "text": "how many?"}],
    )
    assert [entry["role"] for entry in material] == ["client", "client", "preanalyst"]
