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

**Both endings are said to the client.** Nobody is in front of a screen when a run
fails — the client pressed a button minutes ago and left — so a project that stops with
nothing said is one they find out about by going to look, which is the same as not
finding out. The two endings are one communication and not two: which of them it was is
ours to repair and makes no difference to the person waiting. It is sent only once the
step is written, because the step is what makes it true, and it cannot fail the run: see
`_tell_client_stopped`.

**The gate after this one is opened here.** Once a driver is on the project, the run
appends a second step, `driver_validation`, as `open`: nothing is decided by it, and the
driver's yes or no is what closes it. It is opened so that the wait on a person's desk
has somewhere to be counted — see `_open_driver_gate`.

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

# The gate that comes after this one: a person reading what was written. The analyst
# does not decide anything there — it only opens the step, so that the wait has
# somewhere to be counted. See `_open_driver_gate`.
DRIVER_GATE = "driver_validation"


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
        _failed(settings, project_id, project.get("owner_uid"), "broken", {"error": type(error).__name__})
        raise


def _perform(settings, project_id: str, project: dict) -> None:
    # Who asked for the tool, read off the project once. It is carried rather than
    # fetched again at each ending: the run has the project in hand, and a second read
    # of the same field is a second thing that can disagree with the first.
    owner_uid = project.get("owner_uid")
    specification = workspaces.latest_spec(settings, project_id)
    if not specification.ok:
        _log(f"{project_id}: no pre-specification to read ({specification.reason})")
        _failed(settings, project_id, owner_uid, "no_specification", {"reason": specification.reason})
        return

    chat = chat_of(project)
    material = {"specification": specification.data, "chat": chat}

    written = analyse(settings, project_id=project_id, **material)
    if not written["ok"]:
        _failed(settings, project_id, owner_uid, "technical", interaction_of(written))
        return

    judged = judge(settings, analysis=written["output"]["analysis"], project_id=project_id, **material)
    if not judged["ok"]:
        _failed(settings, project_id, owner_uid, "judgement", interaction_of(judged), spent=[written])
        return

    listed = write_points(
        settings, analysis=written["output"]["analysis"], project_id=project_id, **material
    )
    if not listed["ok"]:
        _failed(settings, project_id, owner_uid, "points", interaction_of(listed), spent=[written, judged])
        return

    stored = _store_documents(settings, project_id, written["output"], listed["output"])
    if stored is None:
        _failed(settings, project_id, owner_uid, "documents", {}, spent=[written, judged, listed])
        return

    _describe(settings, project_id, listed["output"].get("description"))

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
    _hand_over(settings, project_id, owner_uid)


def _describe(settings, project_id: str, description: str | None) -> None:
    """The project's description, written onto it. It cannot stop the run.

    **Before the step, so that the ordering says something true**: a project whose step
    says the analysis passed has the description that step produced, and not one that
    arrives a moment later.

    Nothing here is a failure of the run. The door may have come back without a
    description, and then there is nothing to write — absent is absent. Anagraphics may
    refuse the write, and then the log says so as loudly as a log can: an analysis that
    is written, stored and paid for is not thrown away over a subtitle.
    """
    if description is None:
        return
    written = anagraphics.set_description(settings, project_id, description)
    if not written.ok:
        _log(f"{project_id}: DESCRIPTION NOT RECORDED ({written.reason} {written.code or ''}): the project stays without one")


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


def _failed(
    settings, project_id: str, owner_uid: str | None, door: str, what: dict, spent: list[dict] | None = None
) -> None:
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
        return
    _tell_client_stopped(settings, project_id, owner_uid)


def _hand_over(settings, project_id: str, owner_uid: str | None) -> None:
    """Who supervises this project, asked of the pool and written on the project.

    The pool can name somebody who no longer exists — it reads a list, and a driver can
    be deleted between that read and this write — and that is worth asking again for.
    Nobody being able to supervise at all is not: asking again buys the same answer.

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
            outcome = "nobody_supervising" if chosen.reason == "rejected" else "unavailable"
            _log(f"{project_id}: NO DRIVER ({chosen.code or chosen.reason}): the analysis is waiting for nobody")
            return _no_driver(settings, project_id, owner_uid, outcome, attempts)

        assigned = anagraphics.assign_driver(settings, project_id, chosen.data)
        if assigned.ok:
            driver = (assigned.data.get("review") or {}).get("driver") or {}
            _log(f"{project_id}: handed to {driver.get('screen_name')} after {attempts} attempt(s)")
            _handover_measured(settings, project_id, "assigned", attempts)
            _open_driver_gate(settings, project_id)
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
        return _no_driver(settings, project_id, owner_uid, "unavailable", attempts)

    _log(f"{project_id}: GAVE UP handing over after {attempts} attempt(s): the analysis is waiting for nobody")
    _no_driver(settings, project_id, owner_uid, "gave_up", attempts)


def _open_driver_gate(settings, project_id: str) -> None:
    """The driver's gate, opened the moment there is a driver to open it for.

    An `open` step has decided nothing and lasts, and the step that comes after it is
    what closes it — here, the driver saying yes or no. It is written for one reason:
    without it, the time an analysis spends on a driver's desk belongs to nobody.
    `gate.duration` is reported by whoever closes an open step, and with no step open
    there is nothing to close and nothing to report. That wait is the longest one in
    the pipeline after the rounds of questions, and it is a person's.

    It is opened **after** the assignment and never before it: an open step on a project
    the pool could not hand to anybody would say somebody is reading it while nobody is,
    which is the one shape `FAILED_NO_DRIVERS` exists to avoid.

    It cannot fail the run. The analysis is written, the driver is on the project and
    the state says so; what is lost when this write does not arrive is one duration, and
    the gate still closes — a decision with nothing open before it reports no duration,
    which is the truth about that project.
    """
    opened = anagraphics.append_step(
        settings, project_id, step=DRIVER_GATE, result="open", state=DECIDED_STATE, data={}
    )
    if not opened.ok:
        _log(f"{project_id}: driver gate not opened ({opened.reason}): the wait will not be measured")


def _no_driver(settings, project_id: str, owner_uid: str | None, outcome: str, attempts: int) -> None:
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
        return
    _tell_client_stopped(settings, project_id, owner_uid)


def _tell_client_stopped(settings, project_id: str, owner_uid: str | None) -> None:
    """The client, told that the work on their project stopped.

    **Only once the step is written.** The state is what makes it true that the project
    stopped; before it, the run has stopped and the system still says `ANALYSIS`, and a
    message saying otherwise would be a claim nothing here can stand behind. When the
    write failed anagraphics is not answering anyway, so there would also be no way to
    learn where the person is reached.

    **It cannot fail anything.** Every way it can go wrong — a project with no owner on
    it, a person who is no longer there, anagraphics or the comm-center not answering —
    ends the same way: the log says the project stopped and nobody was told, and the
    project keeps the state it already has. There is nothing to undo, and nothing here
    is worth leaving a project in a worse shape for.
    """
    if not owner_uid:
        _log(f"{project_id}: stopped and no owner on the project: nobody to tell")
        return
    found = anagraphics.find_user(settings, owner_uid)
    if not found.ok:
        _log(f"{project_id}: stopped and the client could not be read ({found.reason} {found.code or ''}): nobody told")
        return
    told = comm_center.project_stopped(settings, project_id, found.data)
    if not told.ok:
        _log(f"{project_id}: stopped and the client not told ({told.reason}): the project's state says so, the client does not")


def _handover_measured(settings, project_id: str, outcome: str, attempts: int) -> None:
    settings.metrics.measure(
        "driver.handover",
        dims={"outcome": outcome},
        # How many times we had to ask. One is the ordinary case, and the day it is not
        # one any more, that is the number that says so.
        amounts={"attempts": attempts},
        project_id=project_id,
    )
