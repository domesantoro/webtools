"""The language, the shape of the list, and the description beside it.

No model is called. What is tested is the places this file decides something: where the
client's language comes from, how a list of sentences becomes a list of elements
somebody can point at one at a time, and what one run of the door writes down about
itself.

    uv run pytest
"""

import os
from dataclasses import replace

os.environ.update(
    {
        "WEBTOOLS_ANAGRAPHICS_URL": "http://127.0.0.1:9199",
        "WEBTOOLS_CONFIGURATION_TIMEOUT_MS": "500",
    }
)

import pytest  # noqa: E402

from tests.test_settings import BOOTSTRAP, CONFIGURATION  # noqa: E402
from webtools_analyst import functional_points  # noqa: E402
from webtools_analyst.functional_points import (  # noqa: E402
    SCHEMA,
    described,
    language_of,
    numbered,
    read_policy,
)
from webtools_analyst.settings import settings_from  # noqa: E402


class Measurements(list):
    """The metrics client, which here only writes down what it was given."""

    def measure(self, metric, **fields):
        self.append({"metric": metric, **fields})

    def timer(self):
        return lambda: 0

    def of(self, metric):
        return [one for one in self if one["metric"] == metric]


@pytest.fixture
def settings():
    return replace(settings_from(CONFIGURATION, BOOTSTRAP), metrics=Measurements())


def an_answer(output) -> dict:
    """What the door's provider hands back, in the shape the contract fixes."""
    return {
        "ok": True,
        "provider": "anthropic",
        "model": "claude-opus-5",
        "ended": "complete",
        "failure": None,
        "attempts": 1,
        "fell_back": False,
        "spend": {"kinds": {"input": 10, "output": 5}},
        "output": output,
    }

SPEC = """---
project_id: 71560f42-9420-4c71-aabc-3e52ef533cd6
kind: prespec
template: prespec/1
language: it
---
# Pre-specification

> Alleno una squadra di pallavolo.
"""


def test_the_language_is_read_off_the_front_matter():
    assert language_of(SPEC) == "it"


def test_a_language_written_in_the_body_is_not_the_language():
    """The front matter is ours: the form wrote it. The body is the client's own
    words, so a `language:` line down there is something they typed — and a client who
    types it has not chosen the language the list is written in."""
    forged = SPEC.replace("> Alleno una squadra di pallavolo.", "language: fr\n\n> Alleno.")
    assert language_of(forged) == "it"


def test_no_front_matter_means_no_language_and_not_a_guess():
    """There is nothing to fall back on. A list the client has to agree to, handed to
    them in a language they did not write in, is worse than no list."""
    assert language_of("# Pre-specification\n\nAlleno una squadra.") is None
    assert language_of(SPEC.replace("language: it\n", "")) is None


def test_the_identifiers_are_ours_and_they_run_without_holes():
    """A model asked for identifiers gives two points the same one sooner or later,
    and two points with one identifier is a demo nobody can accept by halves."""
    points = numbered(["Registri un allenamento", "  ", "Vedi chi mancava", ""])
    assert points == [
        {"id": "p1", "text": "Registri un allenamento"},
        {"id": "p2", "text": "Vedi chi mancava"},
    ]


def test_a_list_that_is_not_a_list_is_no_points_at_all():
    assert numbered(None) == []
    assert numbered("Registri un allenamento") == []
    assert numbered([]) == []
    assert numbered(["   ", ""]) == []


def test_the_schema_asks_for_sentences_and_nothing_else():
    """The model returns text. The numbering is ours, and it is not something it can
    get wrong."""
    assert set(SCHEMA["properties"]) == {"description", "points"}
    assert SCHEMA["properties"]["points"]["items"] == {"type": "string"}
    assert SCHEMA["properties"]["description"] == {"type": "string"}
    # Both required, so the constrained output always sends both: a description that
    # came back empty is a different fact from a key that is not there, and only one of
    # the two is the model answering.
    assert set(SCHEMA["required"]) == {"description", "points"}
    assert SCHEMA["additionalProperties"] is False


def test_a_description_that_is_not_a_sentence_is_no_description():
    assert described(None) is None
    assert described("") is None
    assert described("   \n ") is None
    assert described(["a sentence"]) is None
    assert described(42) is None


def test_a_description_comes_back_without_its_spaces():
    assert described("  Le presenze agli allenamenti  ") == "Le presenze agli allenamenti"


def test_the_schema_asks_for_nothing_constrained_output_refuses():
    forbidden = {"minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems"}

    def walk(node):
        if isinstance(node, dict):
            assert forbidden.isdisjoint(node), f"forbidden keyword in {node}"
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(SCHEMA)


def test_the_policy_says_what_the_description_is_for():
    policy = read_policy("functional-points-v1")
    # The sentence's job is to tell this project from the others, and the policy has to
    # say so: a rule the model is not told is a rule nobody follows.
    assert "description" in policy
    assert "`description`" in policy


def test_the_policy_forbids_the_words_of_our_trade_by_name():
    """Naming them is the point: a policy that said "write simply" would leave the
    model to decide what simply means."""
    policy = read_policy("functional-points-v1")
    for word in ("record", "entità", "workflow", "dashboard", "database"):
        assert word in policy, f"the policy never rules out {word}"


def test_the_policy_says_not_to_gender_the_reader():
    policy = read_policy("functional-points-v1")
    assert "gender" in policy
    assert "sei sicuro" in policy


# ------------------------------------------------- one run of the door, measured


@pytest.fixture
def asked(monkeypatch):
    """The provider replaced by what it would have answered. What it was asked is kept,
    so the request can be looked at as well."""
    calls = []
    answers = []

    def ask(_ai, **arguments):
        calls.append(arguments)
        return answers.pop(0)

    monkeypatch.setattr(functional_points, "ask", ask)
    return {"calls": calls, "answers": answers}


def test_a_run_writes_down_that_it_described_the_project(settings, asked):
    asked["answers"].append(
        an_answer({"description": "Le presenze agli allenamenti", "points": ["Registri un allenamento"]})
    )
    written = functional_points.write(settings, specification=SPEC, chat=[], analysis="# The analysis")

    assert written["ok"]
    assert written["output"]["description"] == "Le presenze agli allenamenti"
    measured = settings.metrics.of("points.written")
    assert len(measured) == 1
    assert measured[0]["dims"] == {"language": "it", "described": "yes"}
    assert measured[0]["amounts"] == {"points": 1}


def test_a_run_writes_down_that_it_did_not(settings, asked):
    """The one thing that would otherwise be a silence: the row renders without a label
    and nothing anywhere says how often that happens."""
    asked["answers"].append(an_answer({"description": "   ", "points": ["Registri un allenamento"]}))
    written = functional_points.write(settings, specification=SPEC, chat=[], analysis="# The analysis")

    # The points came through, which is what was paid for.
    assert written["ok"]
    assert written["output"]["points"] == [{"id": "p1", "text": "Registri un allenamento"}]
    # And no description at all: absent is absent, not an empty string.
    assert "description" not in written["output"]
    assert settings.metrics.of("points.written")[0]["dims"]["described"] == "no"


def test_an_empty_list_of_points_is_still_unusable_whatever_the_description(settings, asked):
    """The asymmetry stated on purpose: a tool the client can do nothing with is not
    something to put in front of them, and a label is not that."""
    asked["answers"].append(an_answer({"description": "Le presenze agli allenamenti", "points": []}))
    written = functional_points.write(settings, specification=SPEC, chat=[], analysis="# The analysis")

    assert not written["ok"]
    assert written["ended"] == "unusable"
    # Nothing was written down about points that are not there.
    assert settings.metrics.of("points.written") == []


def test_a_project_named_on_the_measurement_when_there_is_one(settings, asked):
    asked["answers"].append(
        an_answer({"description": "Le presenze agli allenamenti", "points": ["Registri un allenamento"]})
    )
    functional_points.write(
        settings, specification=SPEC, chat=[], analysis="# The analysis", project_id="a-project"
    )
    assert settings.metrics.of("points.written")[0]["project_id"] == "a-project"
