"""The documents rendered from the models the configurator distributes.

No call is made here: a document is rendered from values already in hand.

    uv run pytest
"""

import pytest
from jinja2 import UndefinedError

from webtools_analyst import documents
from webtools_analyst.commons.configuration_client import Configuration
from webtools_analyst.commons.i18n.webtools_i18n import load_i18n

PROJECT = "1f251606-bdba-40c4-bbee-bfedc6e57f70"

TEXTS = load_i18n(
    Configuration("analyst", {"i18n": {"locales": ["en", "it"], "fallback_locale": "en"}})
)

POINTS = [
    {"id": "p1", "text": "Registri un intervento con data, cliente e durata"},
    {"id": "p2", "text": "Cerchi gli interventi di un cliente"},
]


def test_the_file_begins_with_the_front_matter():
    """The subtle one. The model's own comment must leave nothing in front of the first
    dash: a file whose first line is anything else has no front matter as far as
    workspaces is concerned, and it would be given a fresh one with ours in the body."""
    written = documents.analysis(project_id=PROJECT, analysis="# Title\n\nBody.", assumptions=[])
    assert written.startswith("---\n")


def test_the_front_matter_says_what_the_document_is():
    written = documents.analysis(project_id=PROJECT, analysis="Body.", assumptions=[])
    front_matter = written.split("---\n")[1]
    assert f"project_id: {PROJECT}" in front_matter
    assert "kind: analysis" in front_matter
    assert f"template: {documents.ANALYSIS}" in front_matter


def test_the_analysis_is_the_document_and_carries_no_title_of_ours():
    """The policy says the model's answer is the document, whole, with its own
    headings. A heading of ours on top would be a second title."""
    written = documents.analysis(
        project_id=PROJECT, analysis="# The register\n\n## What it keeps\n\nOne row.", assumptions=[]
    )
    body = written.split("---\n", 2)[2]
    assert body.startswith("# The register\n")


def test_the_assumptions_are_a_list_and_an_empty_one_is_said():
    listed = documents.analysis(
        project_id=PROJECT, analysis="Body.", assumptions=["Nobody logs in.", "Twenty a month."]
    )
    assert "- Nobody logs in.\n- Twenty a month.\n" in listed

    # An empty list is a real answer, not a reason to leave the section out: whoever
    # reads the document has to see that nothing was assumed, not wonder.
    none = documents.analysis(project_id=PROJECT, analysis="Body.", assumptions=[])
    assert "## Assumptions" in none
    assert "None declared." in none


def test_a_models_words_are_written_and_never_rendered():
    """What comes back from a door is text, and text that happens to look like a
    template stays what it is. A value rendered a second time would let whatever the
    material contained reach into the document."""
    written = documents.analysis(
        project_id=PROJECT,
        analysis="It keeps {{ 7 * 7 }} rows and {% raw %}a tag{% endraw %}.",
        assumptions=["{{ project_id }}"],
    )
    assert "It keeps {{ 7 * 7 }} rows and {% raw %}a tag{% endraw %}." in written
    assert "- {{ project_id }}" in written


def test_a_line_of_dashes_in_the_body_is_not_a_second_front_matter():
    """A model writing a horizontal rule must not look like the end of a front matter.
    Ours is the first block of the file, which is the one whoever stores it reads."""
    written = documents.analysis(
        project_id=PROJECT, analysis="First part.\n\n---\n\nSecond part.", assumptions=[]
    )
    assert written.index("kind: analysis") < written.index("First part.")
    assert "\n---\n\nSecond part." in written


def test_a_value_nobody_passed_is_an_error_and_not_a_gap():
    """StrictUndefined. A document is read by a person, and a missing value that
    renders as nothing is a bug that ships."""
    model = documents._environment.get_template("analysis.md.j2")
    with pytest.raises(UndefinedError):
        model.render(project_id=PROJECT, template=documents.ANALYSIS)


def test_the_proposal_says_what_it_is_and_in_which_language():
    written = documents.proposal(
        project_id=PROJECT, language="it", points=POINTS, texts=TEXTS
    )
    assert written.startswith("---\n")
    front_matter = written.split("---\n")[1]
    assert f"project_id: {PROJECT}" in front_matter
    assert "kind: proposal" in front_matter
    assert f"template: {documents.PROPOSAL}" in front_matter
    assert "language: it" in front_matter


def test_the_fixed_words_come_from_the_catalogue_in_the_clients_language():
    """Nothing a person reads is written in a model of a document: the title and the
    line under it are keys, and they arrive in the language the client wrote in."""
    italian = documents.proposal(project_id=PROJECT, language="it", points=POINTS, texts=TEXTS)
    english = documents.proposal(project_id=PROJECT, language="en", points=POINTS, texts=TEXTS)
    assert "# Cosa potrai fare" in italian
    assert "# What you will be able to do" in english
    # The points themselves are the model's words and are untouched by the language.
    assert POINTS[0]["text"] in italian and POINTS[0]["text"] in english


def test_every_point_is_a_row_carrying_its_own_identifier():
    """The identifier is what lets a point be named without counting rows: the client
    agrees point by point, and the demo is checked against the same identifiers."""
    written = documents.proposal(project_id=PROJECT, language="it", points=POINTS, texts=TEXTS)
    assert "| p1 | Registri un intervento con data, cliente e durata |" in written
    assert "| p2 | Cerchi gli interventi di un cliente |" in written


def test_a_point_cannot_break_out_of_its_row():
    """A bar ends a column and a newline ends a row. Both can arrive inside a model's
    sentence, and a point read as two points is a list nobody agreed to."""
    written = documents.proposal(
        project_id=PROJECT,
        language="it",
        points=[{"id": "p1", "text": "Registri nome | cognome\ne la data"}],
        texts=TEXTS,
    )
    rows = [line for line in written.splitlines() if line.startswith("| p")]
    assert rows == ["| p1 | Registri nome \\| cognome e la data |"]


def test_a_proposal_with_no_points_is_not_a_document():
    """The door that writes the points already refuses an empty list. One arriving
    here is a fault in the run above, and it stops here rather than being stored."""
    with pytest.raises(ValueError):
        documents.proposal(project_id=PROJECT, language="it", points=[], texts=TEXTS)
