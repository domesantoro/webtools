"""One run over one project: what it writes, and what it writes when it fails.

No model is called, no command is run and no subsystem is up: the build and the three
clients are replaced by what they would have answered.

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
from webtools_developer import build, run  # noqa: E402
from webtools_developer.anagraphics import Answer  # noqa: E402
from webtools_developer.settings import settings_from  # noqa: E402

PROJECT = "1f251606-bdba-40c4-bbee-bfedc6e57f70"
DRIVER = {"uid": "8ff93901-673e-44ba-b05b-56011395dcba", "screen_name": "Ada", "username": "ada@example.org"}
OWNER_UID = "c6d0f3a2-1f0e-4b7c-9d33-0b9a7c2e5511"
OWNER = {"uid": OWNER_UID, "screen_name": "Anna", "username": "anna@example.org"}
POINTS = ["Ogni partita si registra con data e risultato."]


class Measurements(list):
    def measure(self, metric, **fields):
        self.append({"metric": metric, **fields})

    def timer(self):
        return lambda: 0

    def of(self, metric):
        return [one for one in self if one["metric"] == metric]


@pytest.fixture
def settings(tmp_path):
    document = {**CONFIGURATION, "build": {**CONFIGURATION["build"], "root": str(tmp_path)}}
    return replace(settings_from(document, BOOTSTRAP), metrics=Measurements())


def project(state="CLIENT_VALIDATION", steps=None, driver=DRIVER, owner=OWNER_UID) -> dict:
    return {
        "project_id": PROJECT,
        "owner_uid": owner,
        "review": {"driver": driver} if driver else {},
        "pipeline": {
            "state": state,
            "steps": steps
            if steps is not None
            else [
                {
                    "step": "analysis",
                    "result": "passed",
                    "data": {"points": POINTS, "language": "it"},
                }
            ],
        },
    }


class World:
    """Every call that leaves this subsystem, written down instead of made."""

    def __init__(self, monkeypatch, *, result=None, analysis="# The register", steps=None,
                 step_writes=True):
        self.steps = []
        self.progress = []
        self.told = []
        self.result = result or built()
        monkeypatch.setattr(run.workspaces, "latest_analysis",
                            lambda settings, project_id: Answer(ok=True, data=analysis)
                            if analysis is not None else Answer(ok=False, reason="not_found"))
        monkeypatch.setattr(run.anagraphics, "append_step", self._append)
        monkeypatch.setattr(run.anagraphics, "update_open_step", self._update)
        monkeypatch.setattr(run.anagraphics, "find_user",
                            lambda settings, uid: Answer(ok=True, data=OWNER))
        monkeypatch.setattr(run.comm_center, "alpha_test_ready", self._alpha)
        monkeypatch.setattr(run.comm_center, "project_stopped", self._stopped)
        monkeypatch.setattr(run.build, "run", self._build)
        self.step_writes = step_writes

    def _append(self, settings, project_id, *, step, result, state, data, reason=None):
        self.steps.append({"step": step, "result": result, "state": state, "data": data, "reason": reason})
        return Answer(ok=True, data=project()) if self.step_writes else Answer(ok=False, reason="unavailable")

    def _update(self, settings, project_id, *, step, fields=None, appends=None):
        self.progress.append({"fields": fields, "appends": appends})
        return Answer(ok=True, data={})

    def _alpha(self, settings, project_id, driver, *, documented):
        self.told.append({"what": "alpha_test_ready", "driver": driver, "documented": documented})
        return Answer(ok=True)

    def _stopped(self, settings, project_id, client):
        self.told.append({"what": "project_stopped", "client": client})
        return Answer(ok=True)

    def _build(self, settings, *, project_id, analysis, points, language, record):
        self.asked = {"analysis": analysis, "points": points, "language": language}
        record(fields={"stack": "page"})
        return self.result

    def of(self, step, result=None):
        return [
            one for one in self.steps
            if one["step"] == step and (result is None or one["result"] == result)
        ]


def built(**changes) -> build.Result:
    result = build.Result(
        outcome=build.BUILT,
        stack="page",
        plan={"stack": "page", "files": []},
        directory="/tmp/a-build",
        written=[{"path": "index.html", "kind": "html", "exposes": ""}],
        documented=True,
        attempts=1,
        duration_ms=1234,
    )
    result.spend.add("plan", {"spend": {"kinds": {"input": 10}}})
    for field, value in changes.items():
        setattr(result, field, value)
    return result


# --------------------------------------------------------------- the trigger


def test_a_build_begins_from_client_validation(settings, monkeypatch):
    """`CLIENT_VALIDATION` and nothing else: before that nothing has been agreed, and
    building would be building at our own expense."""
    world = World(monkeypatch)
    monkeypatch.setattr(run.anagraphics, "find_project",
                        lambda s, p: Answer(ok=True, data=project()))
    run.start(settings, PROJECT)
    opened = world.of("development", "open")[0]
    assert opened["state"] == "DEVELOPMENT"


@pytest.mark.parametrize(
    "state,code",
    [
        ("PREANALYSIS", "PROJECT_NOT_READY"),
        ("ANALYSIS", "PROJECT_NOT_READY"),
        ("DRIVER_VALIDATION", "PROJECT_NOT_READY"),
        ("REJECTED", "PROJECT_REJECTED"),
        ("DEVELOPMENT", "DEVELOPMENT_ALREADY_STARTED"),
        ("ALPHA_TEST", "DEVELOPMENT_ALREADY_STARTED"),
        ("PAID", "DEVELOPMENT_ALREADY_STARTED"),
    ],
)
def test_the_refusal_is_decided_on_the_state(settings, monkeypatch, state, code):
    """Three different facts, three codes: a caller that reads one word cannot tell a
    project that is not ready yet from one that has already been through here."""
    World(monkeypatch)
    monkeypatch.setattr(run.anagraphics, "find_project",
                        lambda s, p: Answer(ok=True, data=project(state=state)))
    with pytest.raises(run.NotStarted) as refused:
        run.start(settings, PROJECT)
    assert refused.value.code == code
    assert refused.value.status_code == 409


def test_a_project_that_is_not_there(settings, monkeypatch):
    World(monkeypatch)
    monkeypatch.setattr(run.anagraphics, "find_project",
                        lambda s, p: Answer(ok=False, reason="not_found"))
    with pytest.raises(run.NotStarted) as refused:
        run.start(settings, PROJECT)
    assert (refused.value.code, refused.value.status_code) == ("PROJECT_NOT_FOUND", 404)


def test_nothing_is_written_when_the_step_could_not_be(settings, monkeypatch):
    """Nothing has been spent and nothing has been written: the project is exactly as it
    was, and the caller can ask again."""
    World(monkeypatch, step_writes=False)
    monkeypatch.setattr(run.anagraphics, "find_project",
                        lambda s, p: Answer(ok=True, data=project()))
    with pytest.raises(run.NotStarted) as refused:
        run.start(settings, PROJECT)
    assert refused.value.status_code == 503


# ------------------------------------------------------------- it was built


def test_a_built_project_goes_to_the_alpha_test(settings, monkeypatch):
    world = World(monkeypatch)
    run.perform(settings, project())

    decided = world.of("development", "passed")[0]
    assert decided["state"] == "ALPHA_TEST"
    assert decided["data"]["stack"] == "page"
    assert decided["data"]["directory"] == "/tmp/a-build"
    assert decided["data"]["documented"] is True
    assert decided["data"]["spend"]["plan"] == {"calls": 1, "kinds": {"input": 10}}
    # What it exposes is for the doors, not for the step.
    assert decided["data"]["files"] == [{"path": "index.html", "kind": "html"}]


def test_the_alpha_test_gate_is_opened_so_the_wait_can_be_counted(settings, monkeypatch):
    world = World(monkeypatch)
    run.perform(settings, project())
    opened = world.of("alpha_test", "open")
    assert opened and opened[0]["state"] == "ALPHA_TEST"


def test_the_driver_is_told_and_is_the_one_on_the_project(settings, monkeypatch):
    """Not asked of the pool again: who supervises this project was decided when the
    analysis was handed over."""
    world = World(monkeypatch)
    run.perform(settings, project())
    assert world.told == [{"what": "alpha_test_ready", "driver": DRIVER, "documented": True}]


def test_a_build_with_no_readme_is_still_handed_over_and_says_so(settings, monkeypatch):
    world = World(monkeypatch, result=built(documented=False))
    run.perform(settings, project())
    assert world.of("development", "passed")[0]["data"]["documented"] is False
    assert world.told[0]["documented"] is False


def test_a_project_with_no_driver_is_not_a_failed_build(settings, monkeypatch):
    world = World(monkeypatch)
    run.perform(settings, project(driver=None))
    assert world.of("development", "passed")
    assert world.told == []


def test_the_build_is_given_the_analysis_and_the_agreed_points(settings, monkeypatch):
    world = World(monkeypatch, analysis="# The register\n\n## Assumptions\n\n- Nobody logs in.")
    run.perform(settings, project())
    assert world.asked["points"] == POINTS
    assert world.asked["language"] == "it"
    # The assumptions arrive inside the document: reading them off the step as well
    # would be a second copy of the same words.
    assert "Assumptions" in world.asked["analysis"]


def test_the_progress_reaches_the_project_while_the_build_runs(settings, monkeypatch):
    world = World(monkeypatch)
    run.perform(settings, project())
    assert world.progress == [{"fields": {"stack": "page"}, "appends": None}]


# --------------------------------------------------------- it was not built


@pytest.mark.parametrize(
    "outcome",
    [
        build.NO_PLAN,
        build.TOO_MANY_FILES,
        build.PREPARATION_FAILED,
        build.FILE_NOT_WRITTEN,
        build.FILE_NOT_REPAIRED,
        build.WHOLE_CHECK_FAILED,
        build.START_FAILED,
        build.ATTEMPTS_EXHAUSTED,
        build.TIMED_OUT,
    ],
)
def test_every_way_a_build_can_stop_is_written_on_the_project(settings, monkeypatch, outcome):
    world = World(monkeypatch, result=built(outcome=outcome, documented=False))
    run.perform(settings, project())
    failed = world.of("development", "failed")[0]
    assert failed["state"] == "FAILED"
    assert failed["data"]["failed_at"] == outcome
    # Where it stopped is also the gate's reason: the ways a build can stop are not one
    # problem.
    assert failed["reason"] == outcome
    # What ran before it stopped was paid for.
    assert failed["data"]["spend"]["plan"]["calls"] == 1


def test_the_client_is_told_when_the_work_stops(settings, monkeypatch):
    """Nobody is in front of a screen: a project that stops with nothing said is one
    they find out about by going to look."""
    world = World(monkeypatch, result=built(outcome=build.TIMED_OUT))
    run.perform(settings, project())
    assert world.told == [{"what": "project_stopped", "client": OWNER}]


def test_a_project_with_no_analysis_stops_before_anything_is_built(settings, monkeypatch):
    world = World(monkeypatch, analysis=None)
    run.perform(settings, project())
    failed = world.of("development", "failed")[0]
    assert failed["data"]["failed_at"] == "no_analysis"
    assert not hasattr(world, "asked")


def test_a_project_with_no_agreed_points_is_not_built(settings, monkeypatch):
    """A build with no agreed points has no perimeter, and everything it produced would
    be outside it."""
    world = World(monkeypatch, steps=[])
    run.perform(settings, project(steps=[{"step": "analysis", "result": "passed", "data": {}}]))
    assert world.of("development", "failed")[0]["data"]["failed_at"] == "no_points"


def test_the_last_analysis_step_is_the_one_that_counts(settings, monkeypatch):
    """A project that went round again has more than one, and what the client agreed to
    is what the most recent one produced."""
    steps = [
        {"step": "analysis", "result": "passed", "data": {"points": ["old"], "language": "en"}},
        {"step": "analysis", "result": "passed", "data": {"points": ["new"], "language": "it"}},
    ]
    assert run.agreed_of(project(steps=steps)) == {"points": ["new"], "language": "it"}


def test_a_build_that_breaks_still_closes_the_step(settings, monkeypatch):
    """A build that dies without writing anything leaves a project in `DEVELOPMENT` that
    nothing can move."""
    world = World(monkeypatch)

    def broken(settings_, **asked):
        raise RuntimeError("a defect of ours")

    monkeypatch.setattr(run.build, "run", broken)
    with pytest.raises(RuntimeError):
        run.perform(settings, project())
    failed = world.of("development", "failed")[0]
    assert failed["data"]["failed_at"] == build.BROKEN
    assert failed["state"] == "FAILED"


# ------------------------------------------------------------- what is measured


def test_how_the_build_ended_is_measured_whatever_it_was(settings, monkeypatch):
    World(monkeypatch, result=built(outcome=build.START_FAILED, documented=False))
    run.perform(settings, project())
    finished = settings.metrics.of("build.finished")[0]
    assert finished["dims"] == {"stack": "page", "outcome": "start_failed", "documented": "no"}
    assert finished["duration_ms"] == 1234
    assert finished["amounts"] == {"files": 1, "attempts": 1}
    # No tokens: they are on `ai.call`, and the same tokens under a second name would be
    # counted twice.
    assert "tokens" not in finished


def test_a_build_that_never_got_a_stack_is_still_counted(settings, monkeypatch):
    """The dimension is required, so it says so rather than being left out: `(none)` is
    a bucket somebody can read, where a refused measurement is a silence."""
    World(monkeypatch, result=built(outcome=build.NO_PLAN, stack=None, documented=False))
    run.perform(settings, project())
    assert settings.metrics.of("build.finished")[0]["dims"]["stack"] == "(none)"
