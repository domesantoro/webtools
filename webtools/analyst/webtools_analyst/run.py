"""One run of the analyst over one project, from the trigger to the driver.

Nobody waits in front of it: the trigger answers at once and the work goes on. What
the pipeline shows meanwhile is what is written in anagraphics, which is where the
state already lives.

**The step, and how it opens and closes.** The trigger writes the `analysis` step as
`open` and moves the project to `ANALYSIS` — one write, because anagraphics appends the
step and sets the state together. Two things come of it: a run that a restart can find,
instead of a project that looks untouched; and a second trigger that is refused,
because the refusal is decided on the **state** and the state has already moved. At the
end the run appends the step again, decided, and **that is what closes the open one** —
the convention the pipeline already runs on, the same one under which the rounds of
questions are opened by the prevalidation and closed by whatever comes after them.

**Every outcome writes something.** A door that failed, a document that could not be
stored, a pre-specification that is not there: each of them appends the step as
`failed` and puts the project in `FAILED`. That state is not a refusal — nobody decided
anything about the request — and it is not somewhere a project passes through: it is
where one is left when the work that was supposed to move it stopped, and it is looked
at rather than waited on.

**A project nobody can be given to ends in `FAILED_NO_DRIVERS`**, which is a different
fact and has its own name: the analysis is written and paid for, and what is missing is
a person. As far as the machine goes that project is finished.

**What was consumed is written down even when nothing was produced.** In three of the
four ways an answer can end badly the model ran, and those tokens are real. They go on
the step with everything else, because the money at the demo is not taken from metrics.
"""

import sys

from webtools_analyst import anagraphics, comm_center, documents, drivers_pool, workspaces
from webtools_analyst.analysis_sustainability import judge
from webtools_analyst.analysis_technical import analyse
from webtools_analyst.functional_points import write as write_points

STEP = "analysis"

# Where a project has to be for a run to start. It is the state and never the steps: a
# project that has been through a phase has no open step for it — that is what
# finishing means — so the absence of one cannot be the test.
STARTS_FROM = "PREANALYSIS"

# Where a run that did not get to the end leaves the project.
FAILED_STATE = "FAILED"

# And where one that was done and could not be handed to anybody leaves it.
NO_DRIVER_STATE = "FAILED_NO_DRIVERS"

DECIDED_STATE = "DRIVER_VALIDATION"


def _log(message: str) -> None:
    print(f"[analyst] {message}", file=sys.stderr)


def interaction_of(answer: dict) -> dict:
    """What a call with a model was, as a step records it.

    No provider vocabulary passes through: `ended` and `failure` are already our words,
    and `spend` carries the kinds under the names the adapter reported them by.
    """
    return {
        "provider": answer["provider"],
        "model": answer["model"],
        "ended": answer["ended"],
        "attempts": answer["attempts"],
        "fell_back": answer["fell_back"],
        **({"failure": answer["failure"]} if answer["failure"] else {}),
        **({"spend": answer["spend"]} if answer["spend"] else {}),
        **({"policy": answer["policy"]} if answer.get("policy") else {}),
    }


def chat_of(project: dict) -> list[dict]:
    """The rounds of questions, from the last `preanalysis` step of the project.

    The last one and not the first: a project that went back for want of detail and
    came again has more than one, and the conversation that matters is the one that led
    here. A project with no rounds at all is not an error — the pre-specification on its
    own is material — so the answer is an empty list and the run goes on.
    """
    steps = (project or {}).get("pipeline", {}).get("steps")
    if not isinstance(steps, list):
        return []
    for step in reversed(steps):
        if step.get("step") == "preanalysis":
            chat = (step.get("data") or {}).get("chat")
            return [entry for entry in chat if isinstance(entry, dict)] if isinstance(chat, list) else []
    return []


class NotStarted(Exception):
    """The run does not begin, and why. The route turns it into its own answer."""

    def __init__(self, code: str, status_code: int) -> None:
        self.code = code
        self.status_code = status_code


def start(settings, project_id: str) -> dict:
    """The part of a run that happens while the caller is still on the line.

    It reads the project, refuses on the state, and writes the open step. What it
    returns is the project as anagraphics has it **after** that write, so the work that
    follows does not have to ask for it again.
    """
    found = anagraphics.find_project(settings, project_id)
    if not found.ok:
        raise NotStarted("PROJECT_NOT_FOUND" if found.reason == "not_found" else "ANAGRAPHICS_UNAVAILABLE",
                         404 if found.reason == "not_found" else 503)

    state = (found.data.get("pipeline") or {}).get("state")
    if state != STARTS_FROM:
        raise NotStarted(*_why_not(state))

    opened = anagraphics.append_step(
        settings, project_id, step=STEP, result="open", state="ANALYSIS", data={}
    )
    if not opened.ok:
        # Nothing has been spent and nothing has been written: the project is exactly
        # as it was, and the caller can ask again.
        raise NotStarted("ANAGRAPHICS_UNAVAILABLE", 503)
    _log(f"{project_id}: run begun")
    return opened.data


def _why_not(state) -> tuple[str, int]:
    """Three different facts, three codes. A caller that reads one word cannot tell a
    project that is not ready yet from one that has already been through here."""
    if state == "REJECTED":
        return "PROJECT_REJECTED", 409
    if state in ("PREVALIDATION", "UNDERSPECIFIED"):
        return "PROJECT_NOT_READY", 409
    return "ANALYSIS_ALREADY_STARTED", 409


def perform(settings, project: dict) -> None:
    """The rest of the run, with nobody waiting. It raises nothing: every way it can
    end is written on the project."""
    project_id = project.get("project_id")
    try:
        _perform(settings, project_id, project)
    except Exception as error:  # noqa: BLE001 - the last line before a run vanishes
        # A run that dies without writing anything leaves a project in `ANALYSIS` that
        # nothing can move. Whatever the fault was, the step is closed.
        _log(f"{project_id}: run broken: {type(error).__name__} {error}")
        _failed(settings, project_id, "broken", {"error": type(error).__name__})
        raise


def _perform(settings, project_id: str, project: dict) -> None:
    specification = workspaces.latest_spec(settings, project_id)
    if not specification.ok:
        _log(f"{project_id}: no pre-specification to read ({specification.reason})")
        _failed(settings, project_id, "no_specification", {"reason": specification.reason})
        return

    chat = chat_of(project)
    material = {"specification": specification.data, "chat": chat}

    written = analyse(settings, project_id=project_id, **material)
    if not written["ok"]:
        _failed(settings, project_id, "technical", interaction_of(written))
        return

    judged = judge(settings, analysis=written["output"]["analysis"], project_id=project_id, **material)
    if not judged["ok"]:
        _failed(settings, project_id, "judgement", interaction_of(judged), spent=[written])
        return

    listed = write_points(
        settings, analysis=written["output"]["analysis"], project_id=project_id, **material
    )
    if not listed["ok"]:
        _failed(settings, project_id, "points", interaction_of(listed), spent=[written, judged])
        return

    stored = _store_documents(settings, project_id, written["output"], listed["output"])
    if stored is None:
        _failed(settings, project_id, "documents", {}, spent=[written, judged, listed])
        return

    verdict = judged["output"]
    decided = anagraphics.append_step(
        settings,
        project_id,
        step=STEP,
        result="passed",
        state=DECIDED_STATE,
        data={
            # What the driver needs in order to disagree.
            "verdict": verdict["verdict"],
            "asked_for": verdict["asked_for"],
            "scores": verdict["scores"],
            "weakest": verdict["weakest"],
            "confidence": verdict["confidence"],
            "reason": verdict["reason"],
            "assumptions": written["output"]["assumptions"],
            # The points as data. The document is rendered from this same list, so the
            # two cannot disagree, and whoever accepts the demo works on single points.
            "language": listed["output"]["language"],
            "points": listed["output"]["points"],
            "documents": stored,
            # One entry per door: what it cost, and how it ended.
            "interactions": {
                "technical": interaction_of(written),
                "judgement": interaction_of(judged),
                "points": interaction_of(listed),
            },
        },
    )
    if not decided.ok:
        # The documents are stored and the project is still in `ANALYSIS`. Nothing here
        # can repair that: writing it somewhere else would be a second answer to the
        # same question. It is said as loudly as a log can say it.
        _log(f"{project_id}: ANALYSIS WRITTEN AND NOT RECORDED ({decided.reason}): the project is left in ANALYSIS")
        return

    _log(f"{project_id}: {verdict['verdict']} (weakest {verdict['weakest']}), {len(listed['output']['points'])} points")
    _hand_over(settings, project_id)


def _store_documents(settings, project_id: str, analysis: dict, points: dict) -> dict | None:
    """The two documents, stored. `None` when either of them did not get there.

    They go before the step is written: a step saying the analysis is ready, with no
    analysis anywhere, would be worse than a run that failed.
    """
    written = {}
    for kind, text in (
        ("analysis", documents.analysis(project_id=project_id, **analysis)),
        (
            "proposal",
            documents.proposal(
                project_id=project_id,
                language=points["language"],
                points=points["points"],
                texts=settings.texts,
            ),
        ),
    ):
        stored = workspaces.store_document(settings, project_id, kind, text)
        if not stored.ok:
            _log(f"{project_id}: {kind} not stored ({stored.reason} {stored.code or ''})")
            return None
        written[kind] = {
            "template": documents.ANALYSIS if kind == "analysis" else documents.PROPOSAL,
            "version": (stored.data or {}).get("version"),
        }
    return written


def _failed(settings, project_id: str, door: str, what: dict, spent: list[dict] | None = None) -> None:
    """The run did not get to the end. The step says where it stopped and what it cost.

    `spent` carries the doors that had already answered before this one: they ran, and
    what they consumed does not stop being real because a later call failed.

    **Where it stopped is also the gate's reason.** `gate.decided` has a dimension for
    exactly this and it was going out empty, so every way a run can fail — a door that
    answered nothing, a pre-specification that is not there, a document that could not
    be stored, a defect of ours — was one number nobody could act on. They are not one
    problem: three of them are somebody else's service and one of them is our bug.
    """
    data = {"failed_at": door, **what}
    if spent:
        data["interactions"] = {
            name: interaction_of(answer)
            for name, answer in zip(("technical", "judgement", "points"), spent)
        }
    stored = anagraphics.append_step(
        settings, project_id, step=STEP, result="failed", state=FAILED_STATE, data=data, reason=door
    )
    if not stored.ok:
        _log(f"{project_id}: FAILED RUN NOT RECORDED ({stored.reason}): the project is left in ANALYSIS")


def _hand_over(settings, project_id: str) -> None:
    """Who supervises this project, asked of the pool and written on the project.

    The pool can name somebody who no longer exists — it reads a list, and a driver can
    be deleted between that read and this write — and that is worth asking again for.
    Nobody being enabled at all is not: asking again buys the same answer.

    When it does not succeed the project goes to `FAILED_NO_DRIVERS` and stays there. It
    is not left in `DRIVER_VALIDATION`, which would say a person is looking at it while
    no person is — the worst shape a stuck project can have, because everything about it
    looks finished.
    """
    attempts = 0
    while attempts < settings.handover_max_attempts:
        attempts += 1
        chosen = drivers_pool.choose_driver(settings, project_id)
        if not chosen.ok:
            outcome = "nobody_enabled" if chosen.reason == "rejected" else "unavailable"
            _log(f"{project_id}: NO DRIVER ({chosen.code or chosen.reason}): the analysis is waiting for nobody")
            return _no_driver(settings, project_id, outcome, attempts)

        assigned = anagraphics.assign_driver(settings, project_id, chosen.data)
        if assigned.ok:
            driver = (assigned.data.get("review") or {}).get("driver") or {}
            _log(f"{project_id}: handed to {driver.get('screen_name')} after {attempts} attempt(s)")
            _handover_measured(settings, project_id, "assigned", attempts)
            told = comm_center.analysis_ready(settings, project_id, driver)
            if not told.ok:
                # The project is whole: the analysis is written, the step says what was
                # decided, the driver is on it. Only the telling is missing, and undoing
                # any of the rest would be worse than saying so.
                _log(f"{project_id}: driver not told ({told.reason}): the project is whole, the notice is not")
            return

        if assigned.reason == "not_found" and assigned.code == "DRIVER_NOT_FOUND":
            _log(f"{project_id}: the pool named a driver who is no longer there, asking again")
            continue
        _log(f"{project_id}: the driver could not be written on the project ({assigned.reason})")
        return _no_driver(settings, project_id, "unavailable", attempts)

    _log(f"{project_id}: GAVE UP handing over after {attempts} attempt(s): the analysis is waiting for nobody")
    _no_driver(settings, project_id, "gave_up", attempts)


def _no_driver(settings, project_id: str, outcome: str, attempts: int) -> None:
    """The analysis is done and there is nobody to give it to.

    A second step, because it is a second fact: the first says the analysis passed, this
    one says the handover did not. The state goes with it, so that a project waiting for
    nobody does not look like one a person is reading.
    """
    _handover_measured(settings, project_id, outcome, attempts)
    stored = anagraphics.append_step(
        settings,
        project_id,
        step=STEP,
        result="failed",
        state=NO_DRIVER_STATE,
        data={"failed_at": "handover", "outcome": outcome, "attempts": attempts},
        # The same rule as everywhere else here: the gate's reason is where the run
        # stopped. Which of the three ways the handover failed is on `driver.handover`,
        # which is the metric that exists to say it.
        reason="handover",
    )
    if not stored.ok:
        _log(f"{project_id}: NO DRIVER AND NOT RECORDED ({stored.reason}): the project is left in DRIVER_VALIDATION")


def _handover_measured(settings, project_id: str, outcome: str, attempts: int) -> None:
    settings.metrics.measure(
        "driver.handover",
        dims={"outcome": outcome},
        # How many times we had to ask. One is the ordinary case, and the day it is not
        # one any more, that is the number that says so.
        amounts={"attempts": attempts},
        project_id=project_id,
    )
