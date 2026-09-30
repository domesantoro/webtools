"""One run of the developer over one project, from the trigger to the driver.

Nobody waits in front of it: the trigger answers at once and the work goes on. What the
pipeline shows meanwhile is what is written in anagraphics, which is where the state
already lives.

**The step, and how it opens and closes.** The trigger writes the `development` step as
`open` and moves the project to `DEVELOPMENT` — one write, because anagraphics appends
the step and sets the state together. Two things come of it: a build that a restart can
find, instead of a project that looks untouched; and a second trigger that is refused,
because the refusal is decided on the **state** and the state has already moved. At the
end the run appends the step again, decided, and that is what closes the open one — the
convention the whole pipeline runs on.

**While it is open, the step grows.** A build is not one call: it is a plan and then one
call per file, over minutes or hours. Each thing it settles is written into the open
step as it happens (`PATCH .../steps/development`), the way the rounds of questions grow
turn by turn. So a driver looking at a project halfway through sees the plan and the
files that exist, not a project sitting in `DEVELOPMENT` with nothing to show.

**What a restart does not do.** It does not resume. The progress on the step is there to
be *read*, by a person, and a developer that was restarted mid-build leaves the project
in `DEVELOPMENT` with its step open and its files on disk — which is a project somebody
has to look at, and is visible as exactly that. Resuming would mean deciding which of
the written files to trust, and that is a decision with nobody's name on it; it is the
same shape the analyst leaves behind, and it is left the same way on purpose.

**Every outcome writes something.** A door that failed, an analysis that is not there, a
ceiling reached, a check nothing could satisfy: each of them appends the step as `failed`
and puts the project in `FAILED`. That state is not a refusal — nobody decided anything
about the request — and it is not somewhere a project passes through: it is where one is
left when the work that was supposed to move it stopped, and it is looked at rather than
waited on.

**The client is told when it stops.** Nobody is in front of a screen: the client
accepted the proposal and left. A project that stops with nothing said is one they find
out about by going to look, which is the same as not finding out. Which of the dozen
ways it stopped it was makes no difference to them — it stopped — and stays on the step,
where whoever repairs it looks.

**The gate after this one is opened here.** Once the build is done the run appends the
`alpha_test` step as `open`: nothing is decided by it, and the driver trying the tool is
what closes it. It is opened so that the wait on a person's desk has somewhere to be
counted.

**What was consumed is written down even when nothing was produced.** Every door that
answered consumed something, and a build that stopped at its fortieth file spent
everything up to there. It goes on the step with everything else, because the money at
the demo is not taken from metrics.
"""

import sys

from webtools_developer import anagraphics, build, comm_center, workspaces

STEP = "development"

# Where a project has to be for a build to start: the client has read the functional
# points and accepted them. Before that nothing has been agreed, and building would be
# building at our own expense. It is the state and never the steps: a project that has
# been through a phase has no open step for it — that is what finishing means — so the
# absence of one cannot be the test.
STARTS_FROM = "CLIENT_VALIDATION"

# Where a build that did not get to the end leaves the project.
FAILED_STATE = "FAILED"

DECIDED_STATE = "ALPHA_TEST"

# The gate that comes after this one: a person trying what was built. The developer
# decides nothing there — it only opens the step, so that the wait has somewhere to be
# counted.
NEXT_GATE = "alpha_test"


def _log(message: str) -> None:
    print(f"[developer] {message}", file=sys.stderr)


class NotStarted(Exception):
    """The build does not begin, and why. The route turns it into its own answer."""

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
        raise NotStarted(
            "PROJECT_NOT_FOUND" if found.reason == "not_found" else "ANAGRAPHICS_UNAVAILABLE",
            404 if found.reason == "not_found" else 503,
        )

    state = (found.data.get("pipeline") or {}).get("state")
    if state != STARTS_FROM:
        raise NotStarted(*_why_not(state))

    opened = anagraphics.append_step(
        settings, project_id, step=STEP, result="open", state="DEVELOPMENT", data={}
    )
    if not opened.ok:
        # Nothing has been spent and nothing has been written: the project is exactly as
        # it was, and the caller can ask again.
        raise NotStarted("ANAGRAPHICS_UNAVAILABLE", 503)
    _log(f"{project_id}: build begun")
    return opened.data


def _why_not(state) -> tuple[str, int]:
    """Three different facts, three codes. A caller that reads one word cannot tell a
    project that is not ready yet from one that has already been through here."""
    if state == "REJECTED":
        return "PROJECT_REJECTED", 409
    if state in ("PREVALIDATION", "PREANALYSIS", "UNDERSPECIFIED", "ANALYSIS", "DRIVER_VALIDATION"):
        return "PROJECT_NOT_READY", 409
    return "DEVELOPMENT_ALREADY_STARTED", 409


def perform(settings, project: dict) -> None:
    """The rest of the run, with nobody waiting. It raises nothing that it can write
    down first."""
    project_id = project.get("project_id")
    try:
        _perform(settings, project_id, project)
    except Exception as error:  # noqa: BLE001 - the last line before a build vanishes
        # A build that dies without writing anything leaves a project in `DEVELOPMENT`
        # that nothing can move. Whatever the fault was, the step is closed.
        _log(f"{project_id}: build broken: {type(error).__name__} {error}")
        _failed(
            settings,
            project_id,
            project.get("owner_uid"),
            build.BROKEN,
            {"at": "run", "error": type(error).__name__},
        )
        raise


def _perform(settings, project_id: str, project: dict) -> None:
    # Who asked for the tool, read off the project once. It is carried rather than
    # fetched again at each ending: the run has the project in hand, and a second read
    # of the same field is a second thing that can disagree with the first.
    owner_uid = project.get("owner_uid")

    analysis = workspaces.latest_analysis(settings, project_id)
    if not analysis.ok:
        _log(f"{project_id}: no analysis to read ({analysis.reason})")
        _failed(settings, project_id, owner_uid, "no_analysis", {"at": "analysis", "reason": analysis.reason})
        return

    agreed = agreed_of(project)
    if agreed is None:
        # A project in `CLIENT_VALIDATION` has been through the analyst, so this cannot
        # happen without something upstream being wrong. It stops here rather than
        # building against a perimeter nobody agreed to.
        _log(f"{project_id}: the project carries no agreed functional points")
        _failed(settings, project_id, owner_uid, "no_points", {"at": "analysis"})
        return

    result = build.run(
        settings,
        project_id=project_id,
        # The document, whole. The assumptions the analysis declared are a closing
        # section of it, so they arrive with it: reading them off the step as well
        # would be a second copy of the same words, and the two could disagree.
        analysis=analysis.data,
        points=agreed["points"],
        language=agreed["language"],
        record=_recorder(settings, project_id),
    )
    _measured(settings, project_id, result)

    if not result.built:
        _failed(settings, project_id, owner_uid, result.outcome, result.stopped_by or {}, result=result)
        return

    decided = anagraphics.append_step(
        settings,
        project_id,
        step=STEP,
        result="passed",
        state=DECIDED_STATE,
        data={
            # What the driver needs in order to try it.
            "stack": result.stack,
            "directory": result.directory,
            "files": [{"path": file["path"], "kind": file["kind"]} for file in result.written],
            "documented": result.documented,
            # What the doors had to decide for themselves, per file. Nothing else
            # records it, and it is the first thing to read when something is odd.
            "notes": result.notes,
            # What it consumed, per door and per kind. The tier that is paid by
            # consumption is worked out from here.
            "spend": result.spend.as_recorded(),
            "attempts": result.attempts,
            "duration_ms": result.duration_ms,
        },
    )
    if not decided.ok:
        # The files are on disk and the project is still in `DEVELOPMENT`. Nothing here
        # can repair that: writing it somewhere else would be a second answer to the
        # same question. It is said as loudly as a log can say it.
        _log(f"{project_id}: BUILT AND NOT RECORDED ({decided.reason}): the project is left in DEVELOPMENT")
        return

    _open_next_gate(settings, project_id)
    _tell_driver(settings, project_id, project, result.documented)


def agreed_of(project: dict) -> dict | None:
    """The perimeter, off the last `analysis` step: the points and their language.

    The last one and not the first: a project that went round again has more than one,
    and what the client agreed to is what the most recent one produced.

    `None` when there is no such step, or it carries no points. It is not an empty list
    with a shrug: a build with no agreed points has no perimeter, and everything it
    produced would be outside it.
    """
    steps = (project or {}).get("pipeline", {}).get("steps")
    if not isinstance(steps, list):
        return None
    for step in reversed(steps):
        if step.get("step") != "analysis":
            continue
        data = step.get("data") or {}
        points = data.get("points")
        language = data.get("language")
        if not isinstance(points, list) or not points or not isinstance(language, str) or not language:
            return None
        return {"points": [str(point) for point in points], "language": language}
    return None


def _recorder(settings, project_id: str):
    """How a build reports where it has got to: one closure, so that `build.py` has
    nothing to say about anagraphics.

    It cannot fail a build. A progress note that does not arrive costs a driver the
    sight of one file while it is being made; stopping a build over it would cost the
    build. It is logged and the work goes on.
    """

    def record(*, fields=None, appends=None) -> None:
        written = anagraphics.update_open_step(
            settings, project_id, step=STEP, fields=fields, appends=appends
        )
        if not written.ok:
            _log(f"{project_id}: progress not recorded ({written.reason} {written.code or ''})")

    return record


def _measured(settings, project_id: str, result) -> None:
    """How the build ended, as one measurement.

    It goes out whatever the outcome, and before the step is written: the step can be
    refused by anagraphics, and a build whose end nobody counted because a write failed
    would be missing from the one number the price model rests on.

    No tokens: they are on `ai.call`, once per call, and the same tokens under a second
    name would be counted twice by whoever adds up the consumption.
    """
    settings.metrics.measure(
        "build.finished",
        dims={
            # A build that stopped before there was a plan has no stack. The dimension
            # is required, so it says that rather than being left out — `(none)` is a
            # bucket somebody can read, where a refused measurement is a silence.
            "stack": result.stack or "(none)",
            "outcome": result.outcome,
            "documented": "yes" if result.documented else "no",
        },
        amounts={"files": len(result.written), "attempts": result.attempts},
        duration_ms=result.duration_ms,
        project_id=project_id,
    )


def _failed(settings, project_id: str, owner_uid, outcome: str, what: dict, result=None) -> None:
    """The build did not get to the end. The step says where it stopped and what it cost.

    **Where it stopped is also the gate's reason.** `gate.decided` has a dimension for
    exactly this, and the ways a build can stop are not one problem: a registry that
    could not be reached, a file no repair could satisfy, a ceiling of ours, and a
    defect of ours are four different things to do.
    """
    data = {"failed_at": outcome, "stopped_by": what}
    if result is not None:
        data.update(
            {
                "stack": result.stack,
                "directory": result.directory,
                "files": [{"path": file["path"], "kind": file["kind"]} for file in result.written],
                "notes": result.notes,
                # What ran before it stopped was paid for.
                "spend": result.spend.as_recorded(),
                "attempts": result.attempts,
                "duration_ms": result.duration_ms,
            }
        )
    stored = anagraphics.append_step(
        settings, project_id, step=STEP, result="failed", state=FAILED_STATE, data=data, reason=outcome
    )
    if not stored.ok:
        _log(f"{project_id}: FAILED BUILD NOT RECORDED ({stored.reason}): the project is left in DEVELOPMENT")
        return
    _tell_client_stopped(settings, project_id, owner_uid)


def _open_next_gate(settings, project_id: str) -> None:
    """The α-test, opened the moment there is something to try.

    An `open` step has decided nothing and lasts, and the step that comes after it is
    what closes it — here, the driver's verdict on the built tool. It is written for one
    reason: without it, the time a built webtool spends waiting on a driver's desk
    belongs to nobody, and `gate.duration` is reported by whoever closes an open step.

    It cannot fail the run. What is lost when this write does not arrive is one
    duration, and the gate still closes.
    """
    opened = anagraphics.append_step(
        settings, project_id, step=NEXT_GATE, result="open", state=DECIDED_STATE, data={}
    )
    if not opened.ok:
        _log(f"{project_id}: alpha-test gate not opened ({opened.reason}): the wait will not be measured")


def _tell_driver(settings, project_id: str, project: dict, documented: bool) -> None:
    """The driver, told there is something to try.

    The driver is read off the project, where the analyst wrote a copy of them when it
    handed the project over. Not asked of the pool again: who supervises this project
    was decided then, and asking again would be a second answer to the same question.

    A project with no driver on it is not a failure of the build — the webtool is
    built, checked and recorded — so it is said in the log and nothing is undone. It can
    only mean something upstream went wrong, since a project in `CLIENT_VALIDATION` was
    validated by somebody.
    """
    driver = ((project.get("review") or {}).get("driver")) or {}
    if not driver.get("uid"):
        _log(f"{project_id}: built and no driver on the project: nobody to tell")
        return
    told = comm_center.alpha_test_ready(settings, project_id, driver, documented=documented)
    if not told.ok:
        # The project is whole: the files are there, the step says what was built, the
        # state says a person has it. Only the telling is missing, and undoing any of
        # the rest would be worse than saying so.
        _log(f"{project_id}: driver not told ({told.reason}): the project is whole, the notice is not")


def _tell_client_stopped(settings, project_id: str, owner_uid) -> None:
    """The client, told that the work on their project stopped.

    **Only once the step is written.** The state is what makes it true that the project
    stopped; before it, the build has stopped and the system still says `DEVELOPMENT`,
    and a message saying otherwise would be a claim nothing here can stand behind. When
    the write failed anagraphics is not answering anyway, so there would also be no way
    to learn where the person is reached.

    **It cannot fail anything.** Every way it can go wrong ends the same way: the log
    says the project stopped and nobody was told, and the project keeps the state it
    already has.
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
