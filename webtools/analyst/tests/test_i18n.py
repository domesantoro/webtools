"""The catalogues, read by a subsystem that writes documents instead of pages.

It is the generated copy under `webtools_analyst/commons/i18n/` that is exercised,
because that is the only place the module ever runs. The original is in
`webtools/commons/i18n/webtools_i18n.py`; edit it there and run the deployer.

    uv run pytest
"""

import pytest

from webtools_analyst.commons.configuration_client import Configuration, ConfigurationError
from webtools_analyst.commons.i18n.webtools_i18n import load_i18n

OFFERED = {"subsystem": "analyst", "i18n": {"locales": ["en", "it"], "fallback_locale": "en"}}


def texts_from(document):
    return load_i18n(Configuration("analyst", document))


def test_the_text_comes_back_in_the_language_asked_for():
    texts = texts_from(OFFERED)
    assert texts.in_language("it").t("analyst.proposal.title") == "Cosa potrai fare"
    assert texts.in_language("en").t("analyst.proposal.title") == "What you will be able to do"


def test_a_language_we_have_no_catalogue_for_falls_back():
    """The language is the one the client wrote in, and it is not ours to refuse: a
    pre-specification in French is a real project. The points stay French, the fixed
    words come back in the fallback language."""
    words = texts_from(OFFERED).in_language("fr")
    assert words.t("analyst.proposal.title") == "What you will be able to do"


def test_a_key_nobody_wrote_comes_back_as_itself(capsys):
    words = texts_from(OFFERED).in_language("it")
    assert words.t("analyst.proposal.nothing_here") == "analyst.proposal.nothing_here"
    assert not words.has("analyst.proposal.nothing_here")
    assert "missing from en" in capsys.readouterr().out


def test_a_missing_key_is_reported_once():
    texts = texts_from(OFFERED)
    texts.in_language("it").t("analyst.proposal.nothing_here")
    texts.in_language("en").t("analyst.proposal.nothing_here")
    assert texts._reported == {"analyst.proposal.nothing_here"}


def test_the_values_go_into_the_holes_and_an_unfilled_hole_stays_visible():
    texts = texts_from(OFFERED)
    texts.catalogues["en"]["analyst"]["test"] = {"line": "{a} and {b}"}
    words = texts.in_language("en")
    assert words.t("analyst.test.line", a="one", b=2) == "one and 2"
    # A placeholder nobody passed is a key written with a hole in it. Showing the hole
    # says more than hiding it.
    assert words.t("analyst.test.line", a="one") == "one and {b}"


def test_the_fallback_has_to_be_among_the_languages_offered():
    with pytest.raises(ConfigurationError):
        texts_from({"subsystem": "analyst", "i18n": {"locales": ["it"], "fallback_locale": "en"}})


def test_a_language_offered_without_a_catalogue_stops_the_subsystem():
    """No defaults and no guessing: a language in the configuration with no file
    behind it is a configuration nobody finished."""
    with pytest.raises(ConfigurationError):
        texts_from({"subsystem": "analyst", "i18n": {"locales": ["en", "xx"], "fallback_locale": "en"}})
