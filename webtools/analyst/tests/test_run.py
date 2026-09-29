"""One run over one project: what it writes, and what it writes when it fails.

No model is called and no subsystem is running: the doors and the four clients are
replaced by what they would have answered, which is the whole point of their having one
envelope for every outcome.

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
from webtools_analyst import run  # noqa: E402
from webtools_analyst.anagraphics import Answer  # noqa: E402
from webtools_analyst.settings import settings_from  # noqa: E402

PROJECT = "1f251606-bdba-40c4-bbee-bfedc6e57f70"
DRIVER = {"uid": "8ff93901-673e-44ba-b05b-56011395dcba", "screen_name": "Ada", "username": "ada@example.org"}


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


def door(ok=True, output=None, ended="complete", failure=None, spend=None):
    """A door's envelope, in the shape the contract fixes."""
    return {
        "ok": ok,
        "provider": "anthropic",
        "model": "claude-opus-5",
        "ended": ended,
        "failure": failure,
        "attempts": 1,
        "fell_back": False,
        "spend": spend,
        "output": output,
        "policy": "a-policy-v1",
    }


ANALYSIS = door(output={"analysis": "# The register\n\nOne row.", "assumptions": ["Nobody logs in."]})
JUDGEMENT = door(
    output={
        "verdict": "take_on",
        "asked_for": "take_on",
        "scores": {"clarity": 0.8, "size": 0.7},
        "weakest": "size",
        "confidence": 0.9,
        "reason": "The request is small and clear.",
    }
)
POINTS = door(output={"language": "it", "points": [{"id": "p1", "text": "Registri un intervento"}]})


def project(state="PREANALYSIS", steps=None):
    return {"project_id": PROJECT, "pipeline": {"state": state, "steps": steps or []}}


@pytest.fixture
def written(monkeypatch, settings):
    """Everything the run writes, recorded; everything it reads, answered."""
    steps = []
    stored_documents = []

    def append_step(_settings, project_id, *, step, result, state, data, reason=None):
        steps.append({"step": step, "result": result, "state": state, "data": data, "reason": reason})
        return Answer(ok=True, data=project(state=state, steps=list(steps)))

    monkeypatch.setattr(run.anagraphics, "append_step", append_step)
    monkeypatch.setattr(
        run.workspaces, "latest_spec", lambda *_: Answer(ok=True, data="---\nlanguage: it\n---\nA need.")
    )

    def store_document(_settings, project_id, kind, text):
        stored_documents.append({"kind": kind, "text": text})
        return Answer(ok=True, data={"project_id": project_id, "kind": kind, "version": 1})

    monkeypatch.setattr(run.workspaces, "store_document", store_document)
    monkeypatch.setattr(run.drivers_pool, "choose_driver", lambda *_: Answer(ok=True, data=DRIVER["uid"]))
    monkeypatch.setattr(
        run.anagraphics,
        "assign_driver",
        lambda *_a, **_k: Answer(ok=True, data={"review": {"driver": DRIVER}}),
    )
    monkeypatch.setattr(run.comm_center, "analysis_ready", lambda *_a, **_k: Answer(ok=True))
    monkeypatch.setattr(run, "analyse", lambda *_a, **_k: ANALYSIS)
    monkeypatch.setattr(run, "judge", lambda *_a, **_k: JUDGEMENT)
    monkeypatch.setattr(run, "write_points", lambda *_a, **_k: POINTS)
    return {"steps": steps, "documents": stored_documents}


# --------------------------------------------------------------- what is read


def test_the_rounds_of_questions_are_read_from_the_last_preanalysis_step():
    """A project sent back for want of detail and come again has more than one: the
    conversation that matters is the one that led here."""
    steps = [
        {"step": "preanalysis", "data": {"chat": [{"role": "client", "text": "the first time"}]}},
        {"step": "prevalidation", "data": {}},
        {"step": "preanalysis", "data": {"chat": [{"role": "client", "text": "the second time"}]}},
    ]
    assert run.chat_of(project(steps=steps))[0]["text"] == "the second time"


def test_a_project_with_no_rounds_is_material_all_the_same():
    """The pre-specification on its own is something to analyse: an empty list, not a
    reason to stop."""
    assert run.chat_of(project()) == []
    assert run.chat_of({}) == []


def test_what_a_call_was_carries_no_empty_fields():
    """Absent is absent: a call that did not fail has no `failure`, and one that
    reported nothing has no `spend`."""
    complete = run.interaction_of(ANALYSIS)
    assert "failure" not in complete and "spend" not in complete
    lost = run.interaction_of(door(ok=False, ended="no_answer", failure="timed_out"))
    assert lost["failure"] == "timed_out" and "spend" not in lost


# --------------------------------------------------------------- the trigger


def test_a_run_begins_by_writing_that_it_has_begun(monkeypatch, settings, written):
    monkeypatch.setattr(run.anagraphics, "find_project", lambda *_: Answer(ok=True, data=project()))
    run.start(settings, PROJECT)
    # No reason: an opening refuses nothing, and only a decision that refuses has one.
    assert written["steps"] == [
        {"step": "analysis", "result": "open", "state": "ANALYSIS", "data": {}, "reason": None}
    ]


@pytest.mark.parametrize(
    ("state", "code"),
    [
        ("ANALYSIS", "ANALYSIS_ALREADY_STARTED"),
        ("DRIVER_VALIDATION", "ANALYSIS_ALREADY_STARTED"),
        ("PAID", "ANALYSIS_ALREADY_STARTED"),
        ("UNDERSPECIFIED", "PROJECT_NOT_READY"),
        ("PREVALIDATION", "PROJECT_NOT_READY"),
        ("REJECTED", "PROJECT_REJECTED"),
    ],
)
def test_a_second_run_is_refused_on_the_state(monkeypatch, settings, written, state, code):
    """And on the state only. A project that has been through a phase has no open step
    for it, so the absence of one cannot be the test."""
    monkeypatch.setattr(run.anagraphics, "find_project", lambda *_: Answer(ok=True, data=project(state)))
    with pytest.raises(run.NotStarted) as refused:
        run.start(settings, PROJECT)
    assert refused.value.code == code
    assert written["steps"] == []


def test_a_project_that_is_not_there_and_an_anagraphics_that_is_not_answering(monkeypatch, settings):
    monkeypatch.setattr(
        run.anagraphics, "find_project", lambda *_: Answer(ok=False, reason="not_found")
    )
    with pytest.raises(run.NotStarted) as missing:
        run.start(settings, PROJECT)
    assert (missing.value.code, missing.value.status_code) == ("PROJECT_NOT_FOUND", 404)

    monkeypatch.setattr(
        run.anagraphics, "find_project", lambda *_: Answer(ok=False, reason="unavailable")
    )
    with pytest.raises(run.NotStarted) as down:
        run.start(settings, PROJECT)
    assert (down.value.code, down.value.status_code) == ("ANAGRAPHICS_UNAVAILABLE", 503)


# --------------------------------------------------------------- the whole run


def test_the_run_writes_the_decision_the_points_and_the_two_documents(settings, written):
    run.perform(settings, project())

    kinds = [one["kind"] for one in written["documents"]]
    assert kinds == ["analysis", "proposal"]
    assert "Registri un intervento" in written["documents"][1]["text"]

    decided = written["steps"][-1]
    assert decided["result"] == "passed"
    assert decided["state"] == "DRIVER_VALIDATION"
    data = decided["data"]
    assert data["verdict"] == "take_on"
    assert data["weakest"] == "size"
    assert data["points"] == [{"id": "p1", "text": "Registri un intervento"}]
    assert data["language"] == "it"
    assert data["documents"]["proposal"] == {"template": "proposal/1", "version": 1}
    # One entry per door, so what the project consumed is on the project and not only
    # in metrics: the money at the demo is not taken from metrics.
    assert set(data["interactions"]) == {"technical", "judgement", "points"}


def test_a_door_that_failed_leaves_the_project_in_failed(monkeypatch, settings, written):
    """Not a refusal — nobody decided anything about the request — and not somewhere a
    project passes through: it is where one is left when the work stopped."""
    monkeypatch.setattr(
        run, "judge", lambda *_a, **_k: door(ok=False, ended="no_answer", failure="timed_out")
    )
    run.perform(settings, project())

    failed = written["steps"][-1]
    assert (failed["result"], failed["state"]) == ("failed", "FAILED")
    assert failed["data"]["failed_at"] == "judgement"
    assert failed["data"]["failure"] == "timed_out"
    # The analysis ran before it, and what it consumed does not stop being real
    # because a later call failed.
    assert "technical" in failed["data"]["interactions"]
    assert written["documents"] == []


@pytest.mark.parametrize(
    "broken,expected",
    [
        (lambda m: m.setattr(run, "analyse", lambda *_a, **_k: door(ok=False, ended="cut")), "technical"),
        (lambda m: m.setattr(run, "judge", lambda *_a, **_k: door(ok=False, ended="cut")), "judgement"),
        (lambda m: m.setattr(run, "write_points", lambda *_a, **_k: door(ok=False, ended="cut")), "points"),
        (
            lambda m: m.setattr(
                run.workspaces, "latest_spec", lambda *_: Answer(ok=False, reason="not_found")
            ),
            "no_specification",
        ),
    ],
)
def test_where_a_run_stopped_is_the_gate_s_reason(monkeypatch, settings, written, broken, expected):
    """`gate.decided` has a dimension for the refusal's own name and it was going out
    empty: every way a run can fail was one number nobody could act on, although the
    step beside it said exactly which."""
    broken(monkeypatch)
    run.perform(settings, project())
    assert written["steps"][-1]["reason"] == expected


def test_a_run_that_broke_says_so_where_it_can_be_counted(monkeypatch, settings, written):
    """A run that dies on a defect of ours used to leave a log line and nothing else:
    `failed` with no reason, indistinguishable from a provider that timed out."""
    monkeypatch.setattr(run, "analyse", lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("boom")))
    with pytest.raises(RuntimeError):
        run.perform(settings, project())
    assert written["steps"][-1]["reason"] == "broken"


def test_nobody_to_hand_it_to_is_a_reason_of_its_own(monkeypatch, settings, written):
    monkeypatch.setattr(
        run.drivers_pool, "choose_driver", lambda *_: Answer(ok=False, reason="rejected")
    )
    run.perform(settings, project())
    assert written["steps"][-1]["reason"] == "handover"


def test_a_model_that_was_cut_short_still_reports_what_it_spent(monkeypatch, settings, written):
    spent = {"kinds": {"input": 1200, "output": 300}}
    monkeypatch.setattr(run, "analyse", lambda *_a, **_k: door(ok=False, ended="cut", spend=spent))
    run.perform(settings, project())

    failed = written["steps"][-1]
    assert failed["data"]["ended"] == "cut"
    assert failed["data"]["spend"] == spent


def test_without_a_pre_specification_there_is_nothing_to_analyse(monkeypatch, settings, written):
    monkeypatch.setattr(
        run.workspaces, "latest_spec", lambda *_: Answer(ok=False, reason="not_found")
    )
    run.perform(settings, project())
    assert written["steps"][-1]["data"]["failed_at"] == "no_specification"


def test_a_document_that_could_not_be_stored_is_not_a_finished_analysis(
    monkeypatch, settings, written
):
    """A step saying the analysis is ready, with no analysis anywhere, is worse than a
    run that failed."""
    monkeypatch.setattr(
        run.workspaces,
        "store_document",
        lambda *_a, **_k: Answer(ok=False, reason="rejected", code="DOCUMENT_TOO_LARGE"),
    )
    run.perform(settings, project())

    last = written["steps"][-1]
    assert (last["result"], last["state"]) == ("failed", "FAILED")
    assert last["data"]["failed_at"] == "documents"


# --------------------------------------------------------------- the handover


def test_the_driver_is_written_on_the_project_and_then_told(settings, written):
    run.perform(settings, project())
    handovers = settings.metrics.of("driver.handover")
    assert handovers[0]["dims"] == {"outcome": "assigned"}
    assert handovers[0]["amounts"] == {"attempts": 1}


def test_a_driver_who_is_no_longer_there_is_a_reason_to_ask_again(monkeypatch, settings, written):
    answers = [
        Answer(ok=False, reason="not_found", code="DRIVER_NOT_FOUND"),
        Answer(ok=True, data={"review": {"driver": DRIVER}}),
    ]
    monkeypatch.setattr(run.anagraphics, "assign_driver", lambda *_a, **_k: answers.pop(0))
    run.perform(settings, project())
    assert settings.metrics.of("driver.handover")[0]["amounts"] == {"attempts": 2}


def test_nobody_enabled_is_an_answer_and_is_not_asked_twice(monkeypatch, settings, written):
    """Asking again buys the same answer. The project is left maimed, and that is said
    out loud and counted — nothing else in the system notices."""
    asked = []

    def choose(_settings, project_id):
        asked.append(project_id)
        return Answer(ok=False, reason="rejected", code="NO_DRIVER_AVAILABLE")

    monkeypatch.setattr(run.drivers_pool, "choose_driver", choose)
    run.perform(settings, project())
    assert len(asked) == 1
    assert settings.metrics.of("driver.handover")[0]["dims"] == {"outcome": "nobody_enabled"}
    # The analysis passed and is on the project — that step is not undone — and a
    # second step says the handover did not, so the project does not sit in
    # DRIVER_VALIDATION looking as though somebody were reading it.
    passed, no_driver = written["steps"][-2], written["steps"][-1]
    assert (passed["result"], passed["state"]) == ("passed", "DRIVER_VALIDATION")
    assert (no_driver["result"], no_driver["state"]) == ("failed", "FAILED_NO_DRIVERS")
    assert no_driver["data"] == {"failed_at": "handover", "outcome": "nobody_enabled", "attempts": 1}


def test_a_pool_that_keeps_naming_ghosts_is_given_up_on(monkeypatch, settings, written):
    monkeypatch.setattr(
        run.anagraphics,
        "assign_driver",
        lambda *_a, **_k: Answer(ok=False, reason="not_found", code="DRIVER_NOT_FOUND"),
    )
    run.perform(settings, project())
    handover = settings.metrics.of("driver.handover")[0]
    assert handover["dims"] == {"outcome": "gave_up"}
    assert handover["amounts"] == {"attempts": CONFIGURATION["handover"]["max_attempts"]}
    assert written["steps"][-1]["state"] == "FAILED_NO_DRIVERS"


def test_a_notice_that_did_not_go_out_leaves_the_project_whole(monkeypatch, settings, written):
    monkeypatch.setattr(
        run.comm_center, "analysis_ready", lambda *_a, **_k: Answer(ok=False, reason="unavailable")
    )
    run.perform(settings, project())
    assert written["steps"][-1]["result"] == "passed"
    assert settings.metrics.of("driver.handover")[0]["dims"] == {"outcome": "assigned"}
