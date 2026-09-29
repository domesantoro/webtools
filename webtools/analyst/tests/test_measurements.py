"""What is measured about a run, and about the gate a run closes.

Two questions that had wrong or missing answers until 2026-09-29, and both of them
are decided on values already in hand — no model is called and nothing is running.

    uv run pytest
"""

from webtools_analyst import measured_ai
from webtools_analyst.anagraphics import _gate_that_finished


class Measurements(list):
    """The metrics client, which here only writes down what it was given."""

    def measure(self, metric, **fields):
        self.append({"metric": metric, **fields})

    def of(self, metric):
        return [one for one in self if one["metric"] == metric]


class Settings:
    def __init__(self):
        self.metrics = Measurements()


def answer(**changes) -> dict:
    return {
        "ok": True,
        "provider": "anthropic",
        "model": "claude-opus-5",
        "ended": "complete",
        "failure": None,
        "attempts": 1,
        "fell_back": False,
        "spend": {"kinds": {"input": 10, "output": 5}},
        "output": {},
        **changes,
    }


def step(name, result, decided_at):
    return {"step": name, "result": result, "decided_at": decided_at}


# ------------------------------------------------- which gate a duration belongs to


def test_the_gate_that_finished_is_the_one_that_was_open():
    """The step that closes an open one may belong to another gate entirely. Naming
    the interval after the step that closes it filed the whole rounds of questions
    under `analysis`, where it was added to the run's own minutes in the same
    bucket."""
    finished = _gate_that_finished(
        {
            "pipeline": {
                "steps": [
                    step("preanalysis", "open", "2026-09-29T10:00:00Z"),
                    step("analysis", "open", "2026-09-29T10:20:00Z"),
                ]
            }
        }
    )
    assert finished == ("preanalysis", 20 * 60 * 1000)


def test_a_gate_that_opened_and_decided_is_its_own_duration():
    finished = _gate_that_finished(
        {
            "pipeline": {
                "steps": [
                    step("analysis", "open", "2026-09-29T10:20:00Z"),
                    step("analysis", "passed", "2026-09-29T10:23:00Z"),
                ]
            }
        }
    )
    assert finished == ("analysis", 3 * 60 * 1000)


def test_nothing_was_open_so_nothing_finished():
    """Between one gate deciding and the next writing anything there is dead time. It
    is real and it is a different question from how long a gate took: counting it as
    a gate's duration put two things under one name."""
    assert (
        _gate_that_finished(
            {
                "pipeline": {
                    "steps": [
                        step("prevalidation", "passed", "2026-09-29T10:00:00Z"),
                        step("preanalysis", "open", "2026-09-29T10:00:01Z"),
                    ]
                }
            }
        )
        is None
    )


def test_the_first_step_of_a_pipeline_has_nothing_before_it():
    assert _gate_that_finished({"pipeline": {"steps": [step("prevalidation", "passed", "2026-09-29T10:00:00Z")]}}) is None


def test_a_clock_that_stepped_back_is_a_wrong_number_and_is_not_reported():
    assert (
        _gate_that_finished(
            {
                "pipeline": {
                    "steps": [
                        step("analysis", "open", "2026-09-29T10:20:00Z"),
                        step("analysis", "passed", "2026-09-29T10:19:00Z"),
                    ]
                }
            }
        )
        is None
    )


# --------------------------------------------------------- what a call is reported as


def test_a_call_says_whether_what_answered_is_what_was_asked_for():
    """`model` alone cannot say it: a configuration whose primary model was changed
    and a primary model that is being fallen back from every time are the same
    bucket without this, and they are not the same thing to know."""
    settings = Settings()
    measured_ai.report_model_call(
        settings, phase="analysis_technical", answer=answer(fell_back=True), duration_ms=1000
    )
    assert settings.metrics.of("ai.call")[0]["dims"]["fell_back"] == "yes"

    settings = Settings()
    measured_ai.report_model_call(
        settings, phase="analysis_technical", answer=answer(), duration_ms=1000
    )
    assert settings.metrics.of("ai.call")[0]["dims"]["fell_back"] == "no"


def test_the_door_s_verdict_is_a_second_measurement():
    """`ai.call` goes out as soon as the call comes back, because that is when what it
    cost is known — before anybody has read the answer. An answer that is inside the
    schema and says nothing is found later, and there was nothing to record it."""
    settings = Settings()
    measured_ai.report_unusable(
        settings,
        phase="analysis_technical",
        answer=answer(),
        reason="empty_analysis",
        project_id="a-project",
    )
    reported = settings.metrics.of("ai.unusable")[0]
    assert reported["dims"] == {
        "phase": "analysis_technical",
        "provider": "anthropic",
        "model": "claude-opus-5",
        "reason": "empty_analysis",
    }
    assert reported["project_id"] == "a-project"
    # No tokens: the call that produced this answer already reported them, and the
    # same tokens under a second name would be counted twice.
    assert "tokens" not in reported


def test_an_answer_with_no_provider_is_not_counted_under_a_bucket_that_means_something_else():
    settings = Settings()
    measured_ai.report_unusable(
        settings, phase="analysis_points", answer=answer(model=None), reason="empty_points"
    )
    assert settings.metrics.of("ai.unusable") == []
