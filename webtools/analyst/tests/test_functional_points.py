"""The language, and the shape of the list.

No call is made here. What is tested is the two places this file decides something:
where the client's language comes from, and how a list of sentences becomes a list of
elements somebody can point at one at a time.

    uv run pytest
"""

from webtools_analyst.functional_points import SCHEMA, language_of, numbered, read_policy

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
    assert set(SCHEMA["properties"]) == {"points"}
    assert SCHEMA["properties"]["points"]["items"] == {"type": "string"}
    assert SCHEMA["additionalProperties"] is False


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
