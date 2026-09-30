"""What a stack is, and what a stack does not have.

The point of these is the second half. Three of the four steps a stack may configure
are absent for something as ordinary as a page made of HTML and CSS, and code written
against the stack that has all four is code that only builds that one.

    uv run pytest
"""

import pytest

from webtools_developer.commons.configuration_client import Configuration, ConfigurationError
from webtools_developer.stack import load_stacks


def stacks(document: dict):
    return load_stacks(Configuration("developer", {"stacks": document}), "stacks")


def test_a_stack_may_have_everything():
    stack = stacks(
        {
            "web": {
                "prepare": ["npm", "install"],
                "checks": {"javascript": ["node", "--check"]},
                "whole": ["npm", "test"],
                "start": {"command": ["npm", "start"], "settle_ms": 3000},
            }
        }
    ).get("web")
    assert stack.prepare == ["npm", "install"]
    assert stack.check_for("javascript") == ["node", "--check"]
    assert stack.whole == ["npm", "test"]
    assert stack.start.settle_ms == 3000


def test_a_stack_may_have_nothing():
    """Legitimate: files are written and nothing is run on them. What that produces is
    a number (`build.unchecked`), not a silence."""
    stack = stacks({"page": {}}).get("page")
    assert stack.prepare is None
    assert stack.whole is None
    assert stack.start is None
    assert stack.checks == {}
    assert stack.check_for("html") is None


def test_a_kind_nobody_configured_is_not_checked():
    """Absent is absent. Nothing is put in the place of a check that does not exist."""
    stack = stacks({"web": {"checks": {"javascript": ["node", "--check"]}}}).get("web")
    assert stack.check_for("css") is None


def test_the_commands_a_door_is_told_are_only_the_ones_that_exist():
    """Sending `"prepare": null` would be telling a model there is a preparation step
    whose command is nothing."""
    told = stacks({"page": {"checks": {"json": ["python3", "-c", "pass"]}}}).commands_of("page")
    assert "prepare" not in told
    assert "start" not in told
    assert "check_the_whole_project" not in told
    assert told["check_by_kind_of_file"]["json"] == ["python3", "-c", "pass"]


def test_every_stack_with_its_commands_is_what_the_plan_door_chooses_from():
    all_of_them = stacks({"web": {"prepare": ["npm", "i"]}, "page": {}}).all_commands()
    assert list(all_of_them) == ["web", "page"]
    assert all_of_them["page"] == {}


def test_the_names_are_the_configured_ones_and_nothing_else():
    """Nothing in the code knows which stacks exist. A stack added to the configuration
    costs no code, which is the whole reason this file exists."""
    assert stacks({"one": {}, "two": {}, "brand-new": {}}).names() == ["one", "two", "brand-new"]
    assert stacks({"one": {}}).get("web") is None


@pytest.mark.parametrize(
    "document",
    [
        {"web": {"prepare": "npm install"}},
        {"web": {"prepare": []}},
        {"web": {"prepare": ["npm", 3]}},
        {"web": {"checks": ["node", "--check"]}},
        {"web": {"checks": {"javascript": "node --check"}}},
        {"web": {"whole": {}}},
        {"web": {"start": ["npm", "start"]}},
        {"web": {"start": {"command": ["npm", "start"]}}},
        {"web": {"start": {"settle_ms": 3000}}},
    ],
)
def test_a_step_that_is_there_and_malformed_is_refused(document):
    """Absent and wrong are different things, and only one of them is a decision
    somebody made. A command that is a string where it should be a list is a mistake in
    a file, and finding it out three hours into a build means a build paid for and
    thrown away."""
    with pytest.raises(ConfigurationError):
        stacks(document)
