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
# Whoever asked for the tool. The project keeps only their uid, so the run reads them
# from anagraphics when it has something to say to them.
OWNER_UID = "c6d0f3a2-1f0e-4b7c-9d33-0b9a7c2e5511"
OWNER = {"uid": OWNER_UID, "screen_name": "Anna", "username": "anna@example.org"}


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
POINTS = door(
    output={
        "language": "it",
        "points": [{"id": "p1", "text": "Registri un intervento"}],
        "description": "Gli interventi di manutenzione del condominio",
    }
)
# The same door, having come back without a description: it is the case the run must
# carry on through, because the points are what was paid for.
POINTS_WITHOUT_DESCRIPTION = door(
    output={"language": "it", "points": [{"id": "p1", "text": "Registri un intervento"}]}
)


def project(state="PREANALYSIS", steps=None, owner_uid=OWNER_UID):
    return {
        "project_id": PROJECT,
        "owner_uid": owner_uid,
        "pipeline": {"state": state, "steps": steps or []},
    }


@pytest.fixture
def written(monkeypatch, settings):
    """Everything the run writes, recorded; everything it reads, answered."""
    steps = []
    stored_documents = []
    descriptions = []
    said = []

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

    def set_description(_settings, project_id, description):
        descriptions.append(description)
        return Answer(ok=True, data={"project_id": project_id, "description": description})

    monkeypatch.setattr(run.anagraphics, "set_description", set_description)
    monkeypatch.setattr(run.drivers_pool, "choose_driver", lambda *_: Answer(ok=True, data=DRIVER["uid"]))
    monkeypatch.setattr(
        run.anagraphics,
        "assign_driver",
        lambda *_a, **_k: Answer(ok=True, data={"review": {"driver": DRIVER}}),
    )
    monkeypatch.setattr(run.comm_center, "analysis_ready", lambda *_a, **_k: Answer(ok=True))
    monkeypatch.setattr(run.anagraphics, "find_user", lambda *_a, **_k: Answer(ok=True, data=OWNER))

    def project_stopped(_settings, project_id, client):
        said.append({"project_id": project_id, "client": client})
        return Answer(ok=True)

    monkeypatch.setattr(run.comm_center, "project_stopped", project_stopped)
    monkeypatch.setattr(run, "analyse", lambda *_a, **_k: ANALYSIS)
    monkeypatch.setattr(run, "judge", lambda *_a, **_k: JUDGEMENT)
    monkeypatch.setattr(run, "write_points", lambda *_a, **_k: POINTS)
    return {
        "steps": steps,
        "documents": stored_documents,
        "descriptions": descriptions,
        "said": said,
    }


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


def analysis_step(written):
    """The step that says how the analysis went.

    It is no longer the last one: once a driver is on the project the run opens the
    gate after this one, and that open step comes after. Asked for by name, so that a
    step added tomorrow does not make these tests read the wrong row.
    """
    return [one for one in written["steps"] if one["step"] == "analysis"][-1]


def test_the_run_writes_the_decision_the_points_and_the_two_documents(settings, written):
    run.perform(settings, project())

    kinds = [one["kind"] for one in written["documents"]]
    assert kinds == ["analysis", "proposal"]
    assert "Registri un intervento" in written["documents"][1]["text"]

    decided = analysis_step(written)
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


def test_the_description_is_written_before_the_step_that_says_the_analysis_passed(settings, written):
    """A project whose step says the analysis passed carries the description that step
    produced, and not one that arrives a moment later."""
    run.perform(settings, project())
    assert written["descriptions"] == ["Gli interventi di manutenzione del condominio"]


def test_a_run_whose_door_gave_no_description_writes_none_and_goes_on(
    monkeypatch, settings, written
):
    """Fifty-nine valid points are not thrown away because one sentence came back
    blank. Nothing is written in its place: absent is absent."""
    monkeypatch.setattr(run, "write_points", lambda *_a, **_k: POINTS_WITHOUT_DESCRIPTION)
    run.perform(settings, project())

    assert written["descriptions"] == []
    decided = analysis_step(written)
    assert (decided["result"], decided["state"]) == ("passed", "DRIVER_VALIDATION")
    assert [one["kind"] for one in written["documents"]] == ["analysis", "proposal"]


def test_a_description_anagraphics_would_not_take_does_not_stop_the_run(
    monkeypatch, settings, written
):
    """The analysis is written, stored and paid for: it is not thrown away over a
    subtitle. The step is written all the same."""
    monkeypatch.setattr(
        run.anagraphics,
        "set_description",
        lambda *_a, **_k: Answer(ok=False, reason="unavailable", code="DATABASE_UNAVAILABLE"),
    )
    run.perform(settings, project())

    decided = analysis_step(written)
    assert (decided["result"], decided["state"]) == ("passed", "DRIVER_VALIDATION")


def test_a_run_that_failed_before_the_points_describes_nothing(monkeypatch, settings, written):
    """There is nothing to describe about a tool that was never analysed, and a sentence
    invented from the pre-specification would be a claim nobody made."""
    monkeypatch.setattr(
        run, "analyse", lambda *_a, **_k: door(ok=False, ended="no_answer", failure="timed_out")
    )
    run.perform(settings, project())
    assert written["descriptions"] == []


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


def test_nobody_supervising_is_an_answer_and_is_not_asked_twice(monkeypatch, settings, written):
    """Asking again buys the same answer. The project is left maimed, and that is said
    out loud and counted — nothing else in the system notices."""
    asked = []

    def choose(_settings, project_id):
        asked.append(project_id)
        return Answer(ok=False, reason="rejected", code="NO_DRIVER_AVAILABLE")

    monkeypatch.setattr(run.drivers_pool, "choose_driver", choose)
    run.perform(settings, project())
    assert len(asked) == 1
    assert settings.metrics.of("driver.handover")[0]["dims"] == {"outcome": "nobody_supervising"}
    # The analysis passed and is on the project — that step is not undone — and a
    # second step says the handover did not, so the project does not sit in
    # DRIVER_VALIDATION looking as though somebody were reading it.
    # Still the last two: the gate after this one is not opened for a project nobody was
    # given, which is the whole point of `FAILED_NO_DRIVERS`.
    passed, no_driver = written["steps"][-2], written["steps"][-1]
    assert (passed["result"], passed["state"]) == ("passed", "DRIVER_VALIDATION")
    assert (no_driver["result"], no_driver["state"]) == ("failed", "FAILED_NO_DRIVERS")
    assert no_driver["data"] == {"failed_at": "handover", "outcome": "nobody_supervising", "attempts": 1}


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


def test_the_gate_after_this_one_is_opened_once_there_is_a_driver(settings, written):
    """The step the driver's decision will close.

    It is opened so that the wait has somewhere to be counted: `gate.duration` is
    reported by whoever closes an open step, and with nothing open the longest wait in
    the pipeline after the rounds of questions would belong to nobody.
    """
    run.perform(settings, project())
    opened = written["steps"][-1]
    assert opened["step"] == "driver_validation"
    assert (opened["result"], opened["state"]) == ("open", "DRIVER_VALIDATION")
    assert opened["data"] == {}
    # It decides nothing, so it carries no refusal's name.
    assert opened["reason"] is None


def test_a_project_nobody_was_given_has_no_gate_opened_on_it(monkeypatch, settings, written):
    """An open step would say somebody is reading it while nobody is, which is the one
    shape `FAILED_NO_DRIVERS` exists to avoid."""
    monkeypatch.setattr(
        run.drivers_pool,
        "choose_driver",
        lambda *_: Answer(ok=False, reason="rejected", code="NO_DRIVER_AVAILABLE"),
    )
    run.perform(settings, project())
    assert [one["step"] for one in written["steps"]].count("driver_validation") == 0


def test_a_gate_that_could_not_be_opened_does_not_spoil_the_run(monkeypatch, settings, written):
    """What is lost is one duration. The analysis is written, the driver is on the
    project, and the decision still closes — reporting no duration, which is the truth
    about that project."""
    real = run.anagraphics.append_step

    def refuse_the_gate(settings_, project_id, *, step, **rest):
        if step == "driver_validation":
            return Answer(ok=False, reason="unavailable")
        return real(settings_, project_id, step=step, **rest)

    monkeypatch.setattr(run.anagraphics, "append_step", refuse_the_gate)
    run.perform(settings, project())
    assert analysis_step(written)["state"] == "DRIVER_VALIDATION"
    assert settings.metrics.of("driver.handover")[0]["dims"] == {"outcome": "assigned"}


def test_a_notice_that_did_not_go_out_leaves_the_project_whole(monkeypatch, settings, written):
    monkeypatch.setattr(
        run.comm_center, "analysis_ready", lambda *_a, **_k: Answer(ok=False, reason="unavailable")
    )
    run.perform(settings, project())
    assert analysis_step(written)["result"] == "passed"
    assert settings.metrics.of("driver.handover")[0]["dims"] == {"outcome": "assigned"}


# ------------------------------------------------- what the client is told about it


def test_a_run_that_failed_is_said_to_the_client(monkeypatch, settings, written):
    """Nobody is in front of a screen when a run fails: a project that stops with
    nothing said is one the client finds out about by going to look."""
    monkeypatch.setattr(
        run, "judge", lambda *_a, **_k: door(ok=False, ended="no_answer", failure="timed_out")
    )
    run.perform(settings, project())

    assert written["steps"][-1]["state"] == "FAILED"
    assert written["said"] == [{"project_id": PROJECT, "client": OWNER}]


def test_an_analysis_nobody_can_be_given_is_said_to_the_client_too(monkeypatch, settings, written):
    """The two endings are one fact for the person waiting — it stopped. Which of them
    it was stays on the step, where whoever repairs it looks."""
    monkeypatch.setattr(
        run.drivers_pool,
        "choose_driver",
        lambda *_a, **_k: Answer(ok=False, reason="rejected", code="NOBODY_SUPERVISING"),
    )
    run.perform(settings, project())

    assert written["steps"][-1]["state"] == "FAILED_NO_DRIVERS"
    assert written["said"] == [{"project_id": PROJECT, "client": OWNER}]


def test_a_run_that_ended_well_says_nothing_to_the_client(settings, written):
    """This communication is about a project that stopped. One that did not stop is
    the driver's to look at, and the client is told nothing by this subsystem."""
    run.perform(settings, project())
    assert written["said"] == []


def test_a_failure_that_was_not_recorded_is_not_announced(monkeypatch, settings, written):
    """The state is what makes it true that the project stopped. Before it is written
    the system still says `ANALYSIS`, and a message saying otherwise would be a claim
    nothing here can stand behind."""
    monkeypatch.setattr(
        run, "judge", lambda *_a, **_k: door(ok=False, ended="no_answer", failure="timed_out")
    )
    monkeypatch.setattr(
        run.anagraphics, "append_step", lambda *_a, **_k: Answer(ok=False, reason="unavailable")
    )
    run.perform(settings, project())
    assert written["said"] == []


def test_a_project_with_no_owner_stops_without_anybody_being_told(monkeypatch, settings, written):
    """Absent is absent: there is nobody to write to, and nothing is put in their
    place. The project is left in `FAILED` exactly as it would have been."""
    monkeypatch.setattr(
        run, "judge", lambda *_a, **_k: door(ok=False, ended="no_answer", failure="timed_out")
    )
    run.perform(settings, project(owner_uid=None))

    assert written["steps"][-1]["state"] == "FAILED"
    assert written["said"] == []


def test_a_client_who_cannot_be_read_does_not_change_what_the_project_says(
    monkeypatch, settings, written
):
    monkeypatch.setattr(
        run, "judge", lambda *_a, **_k: door(ok=False, ended="no_answer", failure="timed_out")
    )
    monkeypatch.setattr(
        run.anagraphics, "find_user", lambda *_a, **_k: Answer(ok=False, reason="unavailable")
    )
    run.perform(settings, project())

    assert written["steps"][-1]["state"] == "FAILED"
    assert written["said"] == []


def test_a_notice_that_did_not_go_out_leaves_the_failure_where_it_was(
    monkeypatch, settings, written
):
    """The same rule as the driver's notice: the telling is what is missing, and
    undoing any of the rest would be worse than saying so."""
    monkeypatch.setattr(
        run, "judge", lambda *_a, **_k: door(ok=False, ended="no_answer", failure="timed_out")
    )
    monkeypatch.setattr(
        run.comm_center, "project_stopped", lambda *_a, **_k: Answer(ok=False, reason="unavailable")
    )
    run.perform(settings, project())

    assert written["steps"][-1]["state"] == "FAILED"
