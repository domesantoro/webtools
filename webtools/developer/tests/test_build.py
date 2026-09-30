"""One build: the loop, the ceilings, and what it does when a check refuses a file.

No model is called: the four doors are replaced by what they would have answered, which
is the whole point of their having one envelope for every outcome. **The checks are
real**: a parser runs on the files that get written, so a test that says a file was
repaired is a test where something actually refused it first. Which parser is a
configured command, as it is in the running subsystem — here it is python's, because a
check that has to be skipped on a machine without some runtime is coverage that
disappears in silence.

    uv run pytest
"""

import copy
import shutil
from dataclasses import replace
from pathlib import Path

import pytest

from tests.test_settings import BOOTSTRAP, CONFIGURATION
from webtools_developer import build, files, plan, readme
from webtools_developer.settings import settings_from

# The command that refuses a file in these tests, and it is deliberately about **no
# language at all**. What the loop promises is that whatever the command printed reaches
# the repair door, and that the file passes once the door has answered; asserting that
# the output contains `SyntaxError` would be asserting what one particular parser says,
# which is not the promise and would go stale the day the configured check is a type
# checker or a linter.
#
# So the check refuses a file that still carries a marker, and says so in its own words.
# The path arrives as the last argument, which is the convention every configured check
# is written against — here it lands in `$1`.
REFUSES = [
    "/bin/sh",
    "-c",
    'if grep -q NOT-YET "$1"; then echo "refused: $1 still says NOT-YET" >&2; exit 1; fi',
    "the-check",
]
BROKEN = "NOT-YET: this file has not been written properly\n"
FIXED = "this file is finished\n"

# A real parser on real source, used by one test only (`test_a_real_toolchain_checks_a_real_file`).
# Python's, because it is the one runtime a test suite running under python can be sure
# of: a check that has to be skipped for a missing runtime is coverage that disappears
# in silence. It is an example of a configured check like any other, and nothing in the
# code knows which one it is.
PARSES = ["/usr/bin/python3", "-c", "import ast, sys; ast.parse(open(sys.argv[1]).read())"]
PROJECT = "1f251606-bdba-40c4-bbee-bfedc6e57f70"
ANALYSIS = "# A register of matches\n\nOne row per match."
POINTS = ["Ogni partita si registra con data e risultato."]


class Measurements(list):
    def measure(self, metric, **fields):
        self.append({"metric": metric, **fields})

    def timer(self):
        return lambda: 0

    def of(self, metric):
        return [one for one in self if one["metric"] == metric]


# The two stacks these tests build with: one that configures every step, and one that
# configures none. The second is the one that catches code written for the first.
STACKS = {
    "web": {
        "prepare": ["/usr/bin/true"],
        "checks": {"source": REFUSES},
        "whole": ["/usr/bin/true"],
        "start": {"command": ["/bin/sh", "-c", "sleep 5"], "settle_ms": 300},
    },
    "page": {},
}


def settings_with(tmp_path, stacks=None, **limits):
    """The real machinery, with the confinement replaced by nothing.

    `/usr/bin/env` puts nothing in the way: these tests are about the loop, and what a
    command is allowed to do is `test_sandbox.py`'s question. Everything else — the
    checks, the writing, the ceilings — is the real thing.

    A test that needs a stack whose step fails passes that stack in, rather than
    reaching into the settings: what a stack is comes from a configuration document, so
    a test that wants a different one writes a different document.
    """
    document = copy.deepcopy(CONFIGURATION)
    document["build"]["root"] = str(tmp_path)
    document["build"]["limits"].update(limits)
    document["sandbox"]["profiles"] = {
        "closed": {"wrapper": ["/usr/bin/env"]},
        "preparation": {"wrapper": ["/usr/bin/env"]},
    }
    document["stacks"] = copy.deepcopy(stacks if stacks is not None else STACKS)
    return replace(settings_from(document, BOOTSTRAP), metrics=Measurements())


@pytest.fixture
def settings(tmp_path):
    return settings_with(tmp_path)


# Distinct from `None`, which is a legitimate value for `spend`: nothing came back, so
# nothing is claimed about what it cost.
UNSAID = object()


def envelope(output, ok=True, ended="complete", failure=None, spend=UNSAID) -> dict:
    return {
        "ok": ok,
        "provider": "anthropic",
        "model": "claude-opus-5-5",
        "ended": ended,
        "failure": failure,
        "attempts": 1,
        "fell_back": False,
        "spend": {"kinds": {"input": 100, "output": 20}} if spend is UNSAID else spend,
        "output": output,
        "policy": "a-policy-v1",
    }


def a_plan(stack="page", entries=None) -> dict:
    return envelope(
        {
            "stack": stack,
            "files": entries
            or [{"path": "index.html", "purpose": "the page", "kind": "html"}],
        }
    )


def a_file(content="<!doctype html>", exposes="nothing", notes="") -> dict:
    return envelope({"content": content, "exposes": exposes, "notes": notes})


class Doors:
    """What the four doors answered, and what they were asked.

    A list per door rather than one answer, so that a test can make the first attempt
    fail and the second succeed — which is the whole of what the repair loop is.
    """

    def __init__(self, plan_answer, write_answers, repair_answers=(), readme_answer=None):
        self.plan_answer = plan_answer
        self.write_answers = list(write_answers)
        self.repair_answers = list(repair_answers)
        self.readme_answer = readme_answer or envelope({"readme": "# Il registro\n"})
        self.asked = {"plan": [], "write": [], "repair": [], "readme": []}

    def install(self, monkeypatch):
        def make(settings, **asked):
            self.asked["plan"].append(asked)
            return self.plan_answer

        def write(settings, **asked):
            self.asked["write"].append(asked)
            return self.write_answers[min(len(self.asked["write"]) - 1, len(self.write_answers) - 1)]

        def repair(settings, **asked):
            self.asked["repair"].append(asked)
            if not self.repair_answers:
                raise AssertionError("the repair door was asked and this test gave it no answer")
            return self.repair_answers[
                min(len(self.asked["repair"]) - 1, len(self.repair_answers) - 1)
            ]

        def document(settings, **asked):
            self.asked["readme"].append(asked)
            return self.readme_answer

        monkeypatch.setattr(plan, "make", make)
        monkeypatch.setattr(files, "write", write)
        monkeypatch.setattr(files, "repair", repair)
        monkeypatch.setattr(readme, "write", document)
        return self


class Recorded(list):
    def __call__(self, *, fields=None, appends=None):
        self.append({"fields": fields, "appends": appends})


def run(settings, doors, monkeypatch, project_id=PROJECT):
    doors.install(monkeypatch)
    recorded = Recorded()
    result = build.run(
        settings,
        project_id=project_id,
        analysis=ANALYSIS,
        points=POINTS,
        language="it",
        record=recorded,
    )
    return result, recorded


# ------------------------------------------------------------------ it is built


def test_a_stack_with_nothing_configured_builds(settings, monkeypatch):
    """The one that catches code written for the stack that has everything. Nothing is
    installed, nothing is checked, nothing is started — and the build is not worse for
    it."""
    result, _ = run(settings, Doors(a_plan("page"), [a_file()]), monkeypatch)
    assert result.outcome == build.BUILT
    assert result.documented
    assert [file["path"] for file in result.written] == ["index.html", "README.md"]
    assert (Path(result.directory) / "index.html").read_text() == "<!doctype html>"
    assert (Path(result.directory) / "README.md").read_text() == "# Il registro\n"
    # Nothing was prepared, and that is not the same as preparing instantly.
    assert settings.metrics.of("build.prepared") == []


def test_a_file_of_a_kind_with_no_check_is_counted(settings, monkeypatch):
    """Absent is absent — and it is a number, because how much of a build nobody
    verified is something somebody will want to know."""
    run(settings, Doors(a_plan("page"), [a_file()]), monkeypatch)
    unchecked = settings.metrics.of("build.unchecked")
    assert [one["dims"]["kind"] for one in unchecked] == ["html"]
    assert settings.metrics.of("build.verified") == []


def test_a_stack_with_everything_builds(settings, monkeypatch):
    plan_of_two = a_plan(
        "web",
        [
            {"path": "src/server.txt", "purpose": "the server", "kind": "source"},
            {"path": "notes.txt", "purpose": "a note", "kind": "text"},
        ],
    )
    doors = Doors(plan_of_two, [a_file(FIXED), a_file("a note\n")])
    result, _ = run(settings, doors, monkeypatch)
    assert result.outcome == build.BUILT
    # The real check ran on the real file, and passed.
    passed = [one for one in settings.metrics.of("build.verified") if one["dims"]["check"] == "source"]
    assert passed and passed[0]["dims"]["outcome"] == "passed"
    assert settings.metrics.of("build.prepared")[0]["dims"]["outcome"] == "ok"


def test_a_real_toolchain_checks_a_real_file(tmp_path, monkeypatch):
    """The one test here that runs a real parser on real source.

    Everything else about the loop is checked with a command that is about no language,
    which is what the loop promises. This one answers the different question: that a
    configured check which is an actual toolchain, invoked the way the configuration
    says, refuses a broken file and accepts the repaired one.
    """
    settings = settings_with(tmp_path, {"web": {"checks": {"python": PARSES}}})
    doors = Doors(
        a_plan("web", [{"path": "src/a.py", "purpose": "a", "kind": "python"}]),
        [a_file("def a(:\n")],
        repair_answers=[a_file("def a():\n    return 1\n")],
    )
    result, _ = run(settings, doors, monkeypatch)
    assert result.outcome == build.BUILT
    # What the parser itself said reached the door.
    assert "SyntaxError" in doors.asked["repair"][0]["failures"][0]["output"]


def test_the_preparation_comes_after_the_files(settings, monkeypatch):
    """It cannot come first: what a package manager reads is one of the files the plan
    names."""
    order = []
    settings.build.sandbox.wrappers["preparation"] = ["/usr/bin/env"]
    doors = Doors(
        a_plan("web", [{"path": "src/a.txt", "purpose": "a", "kind": "source"}]),
        [a_file(FIXED)],
    )

    original = build.sandbox.run

    def watched(settings_, *, directory, command, profile, timeout_ms=None):
        order.append(profile)
        return original(settings_, directory=directory, command=command, profile=profile, timeout_ms=timeout_ms)

    monkeypatch.setattr(build.sandbox, "run", watched)
    monkeypatch.setattr(build.verification.sandbox, "run", watched)
    run(settings, doors, monkeypatch)
    # The file's own check runs under the closed profile before the preparation does.
    assert order[0] == "closed"
    assert "preparation" in order


# ------------------------------------------------------- a check refuses a file


def test_a_file_that_is_refused_is_repaired(settings, monkeypatch):
    """The whole point of the loop, and a real parser is what refuses it."""
    doors = Doors(
        a_plan("web", [{"path": "src/a.txt", "purpose": "a", "kind": "source"}]),
        [a_file(BROKEN)],  # the check refuses it
        repair_answers=[a_file(FIXED)],
    )
    result, _ = run(settings, doors, monkeypatch)
    assert result.outcome == build.BUILT
    assert len(doors.asked["repair"]) == 1
    # What the door was told: the file as it is on disk, and what refused it.
    told = doors.asked["repair"][0]
    assert told["target"]["content"] == BROKEN
    assert told["failures"][0]["check"] == "source"
    # Whatever the command printed, word for word. That is the promise, and nothing here
    # depends on which command it was.
    assert "still says NOT-YET" in told["failures"][0]["output"]
    repaired = settings.metrics.of("build.repaired")
    assert repaired[0]["dims"] == {"check": "source", "outcome": "fixed"}
    assert repaired[0]["amounts"] == {"attempts": 1}


def test_a_file_nothing_can_repair_gives_up_at_the_ceiling(settings, monkeypatch):
    doors = Doors(
        a_plan("web", [{"path": "src/a.txt", "purpose": "a", "kind": "source"}]),
        [a_file(BROKEN)],
        repair_answers=[a_file("NOT-YET: and the repair did not fix it either\n")],
    )
    result, _ = run(settings, doors, monkeypatch)
    assert result.outcome == build.FILE_NOT_REPAIRED
    assert len(doors.asked["repair"]) == settings.build.limits.attempts_per_file_max
    assert result.stopped_by["file"] == "src/a.txt"
    assert "still says NOT-YET" in result.stopped_by["output"]
    gave_up = settings.metrics.of("build.repaired")[-1]
    assert gave_up["dims"]["outcome"] == "gave_up"


def test_a_failure_of_the_whole_project_is_not_repaired(tmp_path, monkeypatch):
    """Repairing needs a file to repair, and the output of a test run does not say which
    file it is. Picking one by resemblance is the guess this repository refuses."""
    settings = settings_with(
        tmp_path,
        {"web": {"whole": ["/bin/sh", "-c", "echo '2 tests failed' >&2; exit 1"]}},
    )
    doors = Doors(a_plan("web", [{"path": "a.txt", "purpose": "a", "kind": "text"}]), [a_file("x")])
    result, _ = run(settings, doors, monkeypatch)
    assert result.outcome == build.WHOLE_CHECK_FAILED
    assert "2 tests failed" in result.stopped_by["output"]
    # The repair door was never asked: it would have raised if it had been.
    assert doors.asked["repair"] == []


def test_a_project_that_will_not_stay_up_fails_the_start(tmp_path, monkeypatch):
    settings = settings_with(
        tmp_path,
        {
            "web": {
                "start": {
                    "command": ["/bin/sh", "-c", "echo 'port in use' >&2; exit 1"],
                    "settle_ms": 300,
                }
            }
        },
    )
    doors = Doors(a_plan("web", [{"path": "a.txt", "purpose": "a", "kind": "text"}]), [a_file("x")])
    result, _ = run(settings, doors, monkeypatch)
    assert result.outcome == build.START_FAILED
    assert "port in use" in result.stopped_by["output"]


def test_a_preparation_that_fails_says_so_and_stops(tmp_path, monkeypatch):
    settings = settings_with(
        tmp_path,
        {"web": {"prepare": ["/bin/sh", "-c", "echo 'the registry is unreachable' >&2; exit 1"]}},
    )
    doors = Doors(a_plan("web", [{"path": "a.txt", "purpose": "a", "kind": "text"}]), [a_file("x")])
    result, _ = run(settings, doors, monkeypatch)
    assert result.outcome == build.PREPARATION_FAILED
    assert "registry is unreachable" in result.stopped_by["output"]
    assert settings.metrics.of("build.prepared")[0]["dims"]["outcome"] == "failed"


# --------------------------------------------------------------- our ceilings


def test_a_plan_with_too_many_files_is_not_built(settings, monkeypatch):
    entries = [
        {"path": f"f{number}.txt", "purpose": "a file", "kind": "text"}
        for number in range(settings.build.limits.files_max + 1)
    ]
    result, _ = run(settings, Doors(a_plan("page", entries), [a_file()]), monkeypatch)
    assert result.outcome == build.TOO_MANY_FILES
    assert result.stopped_by["allowed"] == settings.build.limits.files_max
    # Nothing was written: the ceiling is read before the first file.
    assert result.written == []


def test_a_build_that_runs_out_of_attempts_stops(tmp_path, monkeypatch):
    settings = settings_with(tmp_path, attempts_total_max=2)
    entries = [{"path": f"f{n}.txt", "purpose": "a file", "kind": "text"} for n in range(5)]
    result, _ = run(settings, Doors(a_plan("page", entries), [a_file()]), monkeypatch)
    assert result.outcome == build.ATTEMPTS_EXHAUSTED
    assert result.stopped_by["allowed"] == 2


def test_a_build_that_runs_out_of_time_stops(tmp_path, monkeypatch):
    """The ceiling is read before each file, so what has to take time is the work on a
    file: a check that sleeps makes this a test about the ceiling and not about how fast
    this machine happens to write three small files."""
    settings = settings_with(
        tmp_path,
        {"page": {"checks": {"text": ["/bin/sh", "-c", "sleep 0.2"]}}},
        duration_max_ms=100,
    )
    entries = [{"path": f"f{n}.txt", "purpose": "a file", "kind": "text"} for n in range(3)]
    result, _ = run(settings, Doors(a_plan("page", entries), [a_file()]), monkeypatch)
    assert result.outcome == build.TIMED_OUT
    # The first file was written and checked; the ceiling stopped the second.
    assert [file["path"] for file in result.written] == ["f0.txt"]


# ------------------------------------------------------------ a door that fails


def test_no_plan_means_no_build(settings, monkeypatch):
    doors = Doors(envelope(None, ok=False, ended="no_answer", failure="timed_out", spend=None), [])
    result, _ = run(settings, doors, monkeypatch)
    assert result.outcome == build.NO_PLAN
    assert result.stopped_by == {"at": "plan", "ended": "no_answer", "failure": "timed_out"}
    assert doors.asked["write"] == []


def test_a_file_the_door_would_not_write_stops_the_build(settings, monkeypatch):
    doors = Doors(
        a_plan("page"),
        [envelope(None, ok=False, ended="refused", failure=None)],
    )
    result, _ = run(settings, doors, monkeypatch)
    assert result.outcome == build.FILE_NOT_WRITTEN
    assert result.stopped_by["ended"] == "refused"


def test_a_path_that_walks_out_of_the_build_is_not_written(settings, monkeypatch):
    """It is the plan's fault and not the file's, so it is not a thing to repair: asking
    again would produce the same path."""
    doors = Doors(
        a_plan("page", [{"path": "../../escaped.txt", "purpose": "out", "kind": "text"}]),
        [a_file("x")],
    )
    result, _ = run(settings, doors, monkeypatch)
    assert result.outcome == build.FILE_NOT_WRITTEN
    assert "escaped" in result.stopped_by["refused"]
    assert doors.asked["repair"] == []


def test_a_readme_that_does_not_come_back_does_not_throw_the_build_away(settings, monkeypatch):
    """An hour of calls is not thrown away over one document. The driver is told, and
    the number that says how often this happens is on `build.finished`."""
    doors = Doors(
        a_plan("page"),
        [a_file()],
        readme_answer=envelope(None, ok=False, ended="unusable", failure=None),
    )
    result, _ = run(settings, doors, monkeypatch)
    assert result.outcome == build.BUILT
    assert result.documented is False
    assert not (Path(result.directory) / "README.md").exists()


# ------------------------------------------------------ what it consumed, and what it told


def test_what_was_consumed_is_kept_per_door_and_per_kind(settings, monkeypatch):
    """Never across kinds: a token of one kind and a token of another are not the same
    thing, and a sum of the two would be a rate nobody decided."""
    doors = Doors(
        a_plan("page", [{"path": "a.txt", "purpose": "a", "kind": "text"}]),
        [envelope({"content": "x", "exposes": "", "notes": ""}, spend={"kinds": {"input": 7, "cache_read": 3}})],
    )
    result, _ = run(settings, doors, monkeypatch)
    spend = result.spend.as_recorded()
    assert spend["plan"] == {"calls": 1, "kinds": {"input": 100, "output": 20}}
    assert spend["write"] == {"calls": 1, "kinds": {"input": 7, "cache_read": 3}}
    assert spend["readme"]["calls"] == 1
    # A door that was never asked is not in there at all.
    assert "repair" not in spend


def test_a_call_that_reported_no_consumption_is_still_a_call(settings, monkeypatch):
    """What is missing then is the report, not the consumption."""
    doors = Doors(a_plan("page"), [envelope({"content": "x", "exposes": "", "notes": ""}, spend=None)])
    result, _ = run(settings, doors, monkeypatch)
    assert result.spend.as_recorded()["write"] == {"calls": 1}


def test_the_plan_and_every_file_are_recorded_as_they_happen(settings, monkeypatch):
    """A driver looking at a project halfway through sees the plan and the files that
    exist, not a project sitting in `DEVELOPMENT` with nothing to show."""
    entries = [
        {"path": "a.txt", "purpose": "a", "kind": "text"},
        {"path": "b.txt", "purpose": "b", "kind": "text"},
    ]
    result, recorded = run(settings, Doors(a_plan("page", entries), [a_file("x")]), monkeypatch)
    assert recorded[0]["fields"]["stack"] == "page"
    assert len(recorded[0]["fields"]["plan"]) == 2
    written = [one["appends"]["files"][0]["path"] for one in recorded[1:]]
    assert written == ["a.txt", "b.txt", "README.md"]
    # What it exposes is not on the step: it runs to several lines a file, and the step
    # is a document a person opens.
    assert "exposes" not in recorded[1]["appends"]["files"][0]


def test_the_notes_a_door_wrote_reach_the_driver(settings, monkeypatch):
    doors = Doors(
        a_plan("page"),
        [a_file(notes="The analysis did not say which date format, so I used ISO.")],
    )
    result, _ = run(settings, doors, monkeypatch)
    assert result.notes == [
        {"file": "index.html", "notes": "The analysis did not say which date format, so I used ISO."}
    ]


def test_a_second_build_of_a_project_starts_from_nothing(settings, monkeypatch):
    first, _ = run(settings, Doors(a_plan("page"), [a_file()]), monkeypatch)
    (Path(first.directory) / "left-over.txt").write_text("from the first build")
    second, _ = run(settings, Doors(a_plan("page"), [a_file()]), monkeypatch)
    assert not (Path(second.directory) / "left-over.txt").exists()
