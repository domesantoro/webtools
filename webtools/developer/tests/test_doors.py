"""What each door does with an answer the schema allowed but we cannot use.

The schema keeps the shape; it cannot say that a stack has to be one of ours, that a
plan naming no file is not a plan, or that a file has to have something in it. Those are
the door's own verdict, and they are a different fact from how the provider ended: by
the time a door has read an answer and found it empty, `ai.call` has already gone out
saying the provider completed — which it did.

    uv run pytest
"""

import copy
from dataclasses import replace

import pytest

from tests.test_settings import BOOTSTRAP, CONFIGURATION
from webtools_developer import files, plan, readme
from webtools_developer.settings import settings_from


class Measurements(list):
    def measure(self, metric, **fields):
        self.append({"metric": metric, **fields})

    def timer(self):
        return lambda: 0

    def of(self, metric):
        return [one for one in self if one["metric"] == metric]


@pytest.fixture
def settings(tmp_path):
    document = copy.deepcopy(CONFIGURATION)
    document["build"]["root"] = str(tmp_path)
    return replace(settings_from(document, BOOTSTRAP), metrics=Measurements())


def envelope(output) -> dict:
    return {
        "ok": True,
        "provider": "anthropic",
        "model": "claude-opus-5-5",
        "ended": "complete",
        "failure": None,
        "attempts": 1,
        "fell_back": False,
        "spend": {"kinds": {"input": 100, "output": 20}},
        "output": output,
    }


# ------------------------------------------------------------------- the plan


def make(settings, monkeypatch, output) -> dict:
    monkeypatch.setattr(plan, "ask", lambda ai, **asked: envelope(output))
    return plan.make(
        settings,
        analysis="# A register",
        points=["Una riga per partita."],
        stacks=settings.stacks,
        project_id="a-project",
    )


@pytest.mark.parametrize(
    "output,reason",
    [
        ({"stack": "a-stack-nobody-configured", "files": [{"path": "a", "purpose": "b", "kind": "c"}]}, "unknown_stack"),
        ({"stack": "", "files": [{"path": "a", "purpose": "b", "kind": "c"}]}, "no_stack"),
        ({"stack": "page", "files": []}, "no_files"),
        ({"stack": "page", "files": [{"path": "", "purpose": "b", "kind": "c"}]}, "malformed_file"),
        ({"stack": "page", "files": [{"path": "a", "purpose": "", "kind": "c"}]}, "malformed_file"),
        ({"stack": "page", "files": [{"path": "a", "purpose": "b", "kind": ""}]}, "malformed_file"),
        (
            {"stack": "page", "files": [{"path": "a", "purpose": "b", "kind": "c"},
                                        {"path": "a", "purpose": "d", "kind": "c"}]},
            "repeated_path",
        ),
    ],
)
def test_a_plan_we_cannot_build_is_unusable(settings, monkeypatch, output, reason):
    answer = make(settings, monkeypatch, output)
    assert answer["ok"] is False
    assert answer["ended"] == "unusable"
    # The tokens were spent all the same, and they travel with the failure.
    assert answer["spend"]["kinds"]["input"] == 100
    # Which way it was unusable is a number somebody reads: a door that keeps choosing a
    # stack that does not exist and one that keeps coming back empty are two different
    # things to fix.
    assert settings.metrics.of("ai.unusable")[0]["dims"]["reason"] == reason


def test_the_call_is_counted_before_the_answer_is_judged(settings, monkeypatch):
    """`ai.call` goes out as soon as the call comes back — that is when what it cost is
    known — and it is reported before anything has been decided about the answer."""
    make(settings, monkeypatch, {"stack": "nowhere", "files": []})
    counted = settings.metrics.of("ai.call")[0]
    assert counted["dims"]["outcome"] == "complete"
    assert counted["tokens"] == {"input": 100, "output": 20}
    # And nothing was planned, so nothing says it was.
    assert settings.metrics.of("build.planned") == []


def test_a_plan_we_can_build_is_read_and_counted(settings, monkeypatch):
    answer = make(
        settings,
        monkeypatch,
        {"stack": "page", "files": [{"path": "index.html", "purpose": "the page", "kind": "html"}]},
    )
    assert answer["ok"] is True
    assert answer["output"]["stack"] == "page"
    planned = settings.metrics.of("build.planned")[0]
    assert planned["dims"] == {"stack": "page"}
    assert planned["amounts"] == {"files": 1}


def test_the_plan_door_is_told_every_stack_and_what_will_be_run_on_it(settings, monkeypatch):
    """Handed over so the answer can only name one of them, and so that whoever plans
    knows how the plan will be checked."""
    asked = {}
    monkeypatch.setattr(plan, "ask", lambda ai, **given: asked.update(given) or envelope(
        {"stack": "page", "files": [{"path": "a", "purpose": "b", "kind": "c"}]}
    ))
    make(settings, monkeypatch, None) if False else plan.make(
        settings, analysis="a", points=["b"], stacks=settings.stacks, project_id="a-project"
    )
    assert list(asked["stacks"]) == settings.stacks.names()
    assert "check_by_kind_of_file" in asked["stacks"]["web"]
    # The stack with nothing configured is told as having nothing, not as having
    # nothing-under-a-name.
    assert asked["stacks"]["page"] == {"check_by_kind_of_file": {"json": ["/usr/bin/python3", "-c", "pass"]}}


# -------------------------------------------------------------------- a file


def write(settings, monkeypatch, output) -> dict:
    monkeypatch.setattr(files, "ask_write", lambda ai, **asked: envelope(output))
    return files.write(
        settings,
        analysis="# A register",
        points=["Una riga."],
        plan={"stack": "page", "files": []},
        written=[],
        target={"path": "a.txt", "purpose": "a", "kind": "text"},
        commands={},
        project_id="a-project",
    )


@pytest.mark.parametrize(
    "content,reason",
    [
        ("", "empty_content"),
        ("   \n\t ", "empty_content"),
        ("x" * (CONFIGURATION["build"]["limits"]["file_max_bytes"] + 1), "content_too_large"),
    ],
)
def test_a_file_we_cannot_write_is_unusable(settings, monkeypatch, content, reason):
    """Nothing is a file that satisfies no purpose, and a file far larger than any file
    of a small tool is what a runaway answer looks like."""
    answer = write(settings, monkeypatch, {"content": content, "exposes": "", "notes": ""})
    assert answer["ended"] == "unusable"
    assert settings.metrics.of("ai.unusable")[0]["dims"]["reason"] == reason


def test_an_account_of_what_a_file_exposes_may_be_empty(settings, monkeypatch):
    """A stylesheet exposes nothing to the rest of the project, so absence here is kept
    as absence and not refused."""
    answer = write(settings, monkeypatch, {"content": "body {}", "exposes": "", "notes": ""})
    assert answer["ok"] is True
    assert answer["output"]["exposes"] == ""


def test_the_repair_door_builds_its_own_envelope(settings, monkeypatch):
    """The two doors have two contracts, and an envelope built by the wrong one is the
    one mistake this module could make that nothing downstream would notice."""
    monkeypatch.setattr(files, "ask_repair", lambda ai, **asked: envelope(
        {"content": "", "exposes": "", "notes": ""}
    ))
    answer = files.repair(
        settings,
        analysis="a",
        plan={"stack": "page", "files": []},
        written=[],
        target={"path": "a.txt", "purpose": "a", "kind": "text", "content": "x"},
        failures=[{"check": "text", "ended": "exited", "output": "no"}],
        commands={},
        project_id="a-project",
    )
    assert answer["ended"] == "unusable"
    assert settings.metrics.of("ai.unusable")[0]["dims"]["phase"] == "development_repair"


# ------------------------------------------------------------------ the README


def test_a_readme_that_says_nothing_is_unusable(settings, monkeypatch):
    monkeypatch.setattr(readme, "ask", lambda ai, **asked: envelope({"readme": "  \n "}))
    answer = readme.write(
        settings,
        analysis="a",
        points=["b"],
        plan={"stack": "page", "files": []},
        written=[],
        commands={},
        language="it",
        project_id="a-project",
    )
    assert answer["ended"] == "unusable"
    assert settings.metrics.of("readme.written") == []


def test_a_readme_is_counted_in_the_language_it_was_written_in(settings, monkeypatch):
    monkeypatch.setattr(readme, "ask", lambda ai, **asked: envelope({"readme": "# Il registro"}))
    answer = readme.write(
        settings,
        analysis="a",
        points=["b"],
        plan={"stack": "page", "files": []},
        written=[],
        commands={},
        language="it",
        project_id="a-project",
    )
    assert answer["ok"] is True
    written = settings.metrics.of("readme.written")[0]
    assert written["dims"] == {"language": "it"}
    # One newline at the end, whatever came back: a text file that does not end in one
    # is the thing every reader of one complains about.
    assert answer["output"]["readme"] == "# Il registro\n"
    assert written["bytes"] == len("# Il registro\n".encode("utf-8"))
