"""One build: from a plan to a project that has been checked, or to the reason it was
not.

The order is the whole design, and each step is where it is for a reason:

1. **the plan**, once. Nothing can be written before it, and it is recorded before
   anything is written so that a person can read what is about to be built;
2. **each file, written and checked**, in the order the plan gives. A file that its
   check refuses goes back to the repair door until it passes or until the ceiling on
   attempts is reached. Cheap and immediate: only one file has changed, so what refused
   it is about that file;
3. **the preparation**, once, after every file is there and not before. It cannot come
   first: what a package manager reads — a manifest, a lock file — is one of the files
   the plan names, so installing before writing would be installing from nothing;
4. **the whole project**, checked with the command the stack configures for it. It finds
   what no single file can be wrong about: a name one file expects and another never
   defined, two files that disagree;
5. **the start**, last of the checks, and the only one that passes by the command not
   finishing;
6. **the README**, last of everything, because it describes what now exists.

**A failure of step 4 or 5 is not repaired, and that is deliberate.** Repairing needs a
file to repair, and the output of a test run or a process that would not start does not
say which file it is. Picking one by resemblance to the text of an error is the guess
this repository refuses; what happens instead is that the build ends with that outcome
and the output goes on the step, where the driver reads it. A per-file check knows which
file it was about, which is exactly why steps 2 and 4 are different steps.

**Where a per-file check sits relative to the preparation.** Before it. That makes the
feedback immediate and costs one thing: a stack whose per-file check needs the
dependencies installed cannot be checked that way, and a stack like that configures
`whole` and leaves `checks` empty. It is written here because it is the one ordering
decision in this file that somebody configuring a new stack has to know about.

**Every ceiling here is ours.** Files in a plan, attempts on one file, attempts in a
build, bytes in a file, minutes in total: each is a number somebody chose, so reaching
one is never reported as the build having failed by itself — it is `too_many_files`,
`file_not_repaired`, `attempts_exhausted`, `timed_out`, and each names the decision it
came from.
"""

import sys
import time
from dataclasses import dataclass, field

from webtools_developer import files, plan as planning, readme as documenting, sandbox, verification, workspace
from webtools_developer.workspace import PathRefused

# The outcomes, as `build.finished` closes them. They are here rather than spelled at
# the call sites so that an outcome this file can produce and an outcome the vocabulary
# allows cannot drift apart.
BUILT = "built"
NO_PLAN = "no_plan"
TOO_MANY_FILES = "too_many_files"
PREPARATION_FAILED = "preparation_failed"
FILE_NOT_WRITTEN = "file_not_written"
FILE_NOT_REPAIRED = "file_not_repaired"
WHOLE_CHECK_FAILED = "whole_check_failed"
START_FAILED = "start_failed"
ATTEMPTS_EXHAUSTED = "attempts_exhausted"
TIMED_OUT = "timed_out"
# Ours: a defect of this code, not of the model and not of the machine. It is kept
# apart from the rest because it is the only outcome whose remedy is a commit here.
BROKEN = "broken"

# The doors, under the names the consumption is added up by. One name per door, because
# what the plan cost and what the repairs cost are two different questions.
DOORS = ("plan", "write", "repair", "readme")


def _log(message: str) -> None:
    print(f"[build] {message}", file=sys.stderr)


@dataclass
class Spend:
    """What a build consumed, per door and per kind.

    **Per kind, and never across kinds**: a token of one kind and a token of another
    are not the same thing, and a sum of the two would be a rate between them that
    nobody decided. The kinds are the adapters' own names, carried up as they arrived.

    `calls` is beside them because a build makes hundreds of calls and the number of
    them is a fact of its own: the same consumption over three calls and over three
    hundred are different builds.
    """

    by_door: dict = field(default_factory=lambda: {door: {"calls": 0} for door in DOORS})

    def add(self, door: str, answer: dict) -> None:
        """One interaction of one door, added.

        A call that consumed nothing we were told about still counts as a call: what is
        missing then is the report, not the consumption, and writing nothing at all
        would make the two look the same.
        """
        entry = self.by_door[door]
        entry["calls"] += 1
        spend = answer.get("spend")
        if not spend:
            return
        kinds = entry.setdefault("kinds", {})
        for kind, units in (spend.get("kinds") or {}).items():
            kinds[kind] = kinds.get(kind, 0) + units

    def as_recorded(self) -> dict:
        """What goes on the step: only the doors that were actually asked something."""
        return {door: entry for door, entry in self.by_door.items() if entry["calls"]}


@dataclass
class Result:
    """How a build ended, and everything the step and the metrics need to say so."""

    outcome: str
    stack: str | None = None
    plan: dict | None = None
    # Where the files are. It goes on the step because it is the only way anybody —
    # the driver in the α-test, whoever publishes the demo — finds what was built: it
    # is not in workspaces and not in the repository.
    directory: str | None = None
    # Every file that is on disk: path, kind, and what it exposes.
    written: list = field(default_factory=list)
    documented: bool = False
    # What stopped it, in this file's words: which file, which check, what it printed.
    # Absent when the build finished.
    stopped_by: dict | None = None
    spend: Spend = field(default_factory=Spend)
    attempts: int = 0
    duration_ms: int = 0
    # What the doors said about their own work, per file. It is for the driver: a model
    # that had to decide something says so here, and nothing else records it.
    notes: list = field(default_factory=list)

    @property
    def built(self) -> bool:
        return self.outcome == BUILT


class _Clock:
    """How long the build has been going, against the ceiling it was given."""

    def __init__(self, duration_max_ms: int) -> None:
        self._started = time.monotonic()
        self._ceiling = duration_max_ms / 1000

    def elapsed_ms(self) -> int:
        return round((time.monotonic() - self._started) * 1000)

    def over(self) -> bool:
        return (time.monotonic() - self._started) > self._ceiling


def run(settings, *, project_id: str, analysis: str, points, language: str, record) -> Result:
    """The whole of one build. It raises nothing that is not a defect of ours.

    `record` is how progress reaches the project — a callable taking `fields` and
    `appends` —
    and it is passed in rather than imported so that this file has nothing to say about
    anagraphics, and so that a test can watch what a build records without a server
    being up.
    """
    clock = _Clock(settings.build.limits.duration_max_ms)
    result = Result(outcome=NO_PLAN)

    made = planning.make(
        settings, analysis=analysis, points=points, stacks=settings.stacks, project_id=project_id
    )
    result.spend.add("plan", made)
    if not made["ok"]:
        result.stopped_by = {"at": "plan", "ended": made["ended"], "failure": made["failure"]}
        result.duration_ms = clock.elapsed_ms()
        return result

    the_plan = made["output"]
    result.stack = the_plan["stack"]
    result.plan = the_plan
    stack = settings.stacks.get(the_plan["stack"])
    commands = settings.stacks.commands_of(the_plan["stack"])
    record(fields={"stack": the_plan["stack"], "plan": the_plan["files"]})
    _log(f"{project_id}: {len(the_plan['files'])} file(s) on {the_plan['stack']}")

    if len(the_plan["files"]) > settings.build.limits.files_max:
        result.outcome = TOO_MANY_FILES
        result.stopped_by = {
            "at": "plan",
            "files": len(the_plan["files"]),
            "allowed": settings.build.limits.files_max,
        }
        result.duration_ms = clock.elapsed_ms()
        return result

    try:
        area = workspace.fresh(settings, project_id)
    except PathRefused as refused:
        # The project's identifier is not a name a directory can have. It is ours to
        # fix and it is not a failure of the model's: the outcome says the build broke.
        result.outcome = BROKEN
        result.stopped_by = {"at": "workspace", "refused": str(refused)}
        result.duration_ms = clock.elapsed_ms()
        return result

    result.directory = area.path

    _write_files(settings, result=result, clock=clock, area=area, stack=stack, commands=commands,
                 the_plan=the_plan, analysis=analysis, points=points, project_id=project_id,
                 record=record)
    if result.outcome != BUILT:
        result.duration_ms = clock.elapsed_ms()
        return result

    if not _prepared(settings, result=result, area=area, stack=stack, project_id=project_id):
        result.duration_ms = clock.elapsed_ms()
        return result

    refused = verification.of_whole(settings, stack=stack, workspace=area, project_id=project_id)
    if refused is not None:
        result.outcome = WHOLE_CHECK_FAILED
        result.stopped_by = {"at": "whole", **refused.as_told()}
        result.duration_ms = clock.elapsed_ms()
        return result

    refused = verification.of_start(settings, stack=stack, workspace=area, project_id=project_id)
    if refused is not None:
        result.outcome = START_FAILED
        result.stopped_by = {"at": "start", **refused.as_told()}
        result.duration_ms = clock.elapsed_ms()
        return result

    _document(settings, result=result, area=area, the_plan=the_plan, commands=commands,
              analysis=analysis, points=points, language=language, project_id=project_id,
              record=record)
    result.duration_ms = clock.elapsed_ms()
    _log(f"{project_id}: built on {result.stack}, {len(result.written)} file(s), "
         f"{'documented' if result.documented else 'with no README'}")
    return result


def _write_files(settings, *, result, clock, area, stack, commands, the_plan, analysis, points,
                 project_id, record) -> None:
    """Every file of the plan, written and checked. `result.outcome` says how it went.

    It is left at `BUILT` when every file is on disk and satisfied: that is not the end
    of the build, and the caller goes on to the preparation and the checks that come
    after. Anything else and the build is over.
    """
    limits = settings.build.limits
    result.outcome = BUILT

    for entry in the_plan["files"]:
        if clock.over():
            result.outcome = TIMED_OUT
            result.stopped_by = {"at": "files", "file": entry["path"], "allowed_ms": limits.duration_max_ms}
            return
        if result.attempts >= limits.attempts_total_max:
            result.outcome = ATTEMPTS_EXHAUSTED
            result.stopped_by = {"at": "files", "file": entry["path"], "allowed": limits.attempts_total_max}
            return

        written = files.write(
            settings,
            analysis=analysis,
            points=points,
            plan=the_plan,
            written=result.written,
            target=entry,
            commands=commands,
            project_id=project_id,
        )
        result.spend.add("write", written)
        result.attempts += 1
        if not written["ok"]:
            result.outcome = FILE_NOT_WRITTEN
            result.stopped_by = {
                "at": "files",
                "file": entry["path"],
                "ended": written["ended"],
                "failure": written["failure"],
            }
            return

        if not _kept(settings, result=result, area=area, entry=entry, answer=written,
                     project_id=project_id):
            return

        _repair_until_it_passes(
            settings, result=result, clock=clock, area=area, stack=stack, commands=commands,
            the_plan=the_plan, entry=entry, analysis=analysis, project_id=project_id,
        )
        if result.outcome != BUILT:
            return
        record(appends={"files": [_as_recorded(result.written[-1])]})


def _kept(settings, *, result, area, entry, answer, project_id) -> bool:
    """The file, written to disk and recorded. `False` when it could not be.

    A path the build refuses is the plan's fault and not the file's, so it is not a
    thing to repair: asking again would produce the same path, because the path is what
    the plan says.
    """
    try:
        size = area.write(entry["path"], answer["output"]["content"])
    except PathRefused as refused:
        result.outcome = FILE_NOT_WRITTEN
        result.stopped_by = {"at": "files", "file": entry["path"], "refused": str(refused)}
        return False
    except OSError as error:
        result.outcome = FILE_NOT_WRITTEN
        result.stopped_by = {
            "at": "files",
            "file": entry["path"],
            "refused": f"{type(error).__name__}: {error}",
        }
        return False

    settings.metrics.measure(
        "build.file_written", dims={"kind": entry["kind"]}, bytes=size, project_id=project_id
    )
    exposed = {
        "path": entry["path"],
        "kind": entry["kind"],
        "exposes": answer["output"]["exposes"],
    }
    # A file already written is replaced rather than added twice: the repair door
    # answers about a file that is already in this list.
    result.written = [file for file in result.written if file["path"] != entry["path"]]
    result.written.append(exposed)
    if answer["output"]["notes"]:
        result.notes.append({"file": entry["path"], "notes": answer["output"]["notes"]})
    return True


def _repair_until_it_passes(settings, *, result, clock, area, stack, commands, the_plan, entry,
                            analysis, project_id) -> None:
    """One file, checked and repaired until it passes or until a ceiling is reached."""
    limits = settings.build.limits
    attempts = 0

    while True:
        refused = verification.of_file(
            settings,
            stack=stack,
            workspace=area,
            path=entry["path"],
            kind=entry["kind"],
            project_id=project_id,
        )
        if refused is None:
            if attempts:
                settings.metrics.measure(
                    "build.repaired",
                    dims={"check": entry["kind"], "outcome": "fixed"},
                    amounts={"attempts": attempts},
                    project_id=project_id,
                )
            return

        if attempts >= limits.attempts_per_file_max:
            settings.metrics.measure(
                "build.repaired",
                dims={"check": refused.check, "outcome": "gave_up"},
                amounts={"attempts": attempts},
                project_id=project_id,
            )
            result.outcome = FILE_NOT_REPAIRED
            result.stopped_by = {"at": "files", "file": entry["path"], "attempts": attempts,
                                 **refused.as_told()}
            return
        if clock.over():
            result.outcome = TIMED_OUT
            result.stopped_by = {"at": "repair", "file": entry["path"], "allowed_ms": limits.duration_max_ms}
            return
        if result.attempts >= limits.attempts_total_max:
            result.outcome = ATTEMPTS_EXHAUSTED
            result.stopped_by = {"at": "repair", "file": entry["path"], "allowed": limits.attempts_total_max}
            return

        attempts += 1
        repaired = files.repair(
            settings,
            analysis=analysis,
            plan=the_plan,
            # What the other files expose, without this one: it is the file being
            # repaired, and its own previous account of itself is not something to
            # repair against.
            written=[file for file in result.written if file["path"] != entry["path"]],
            target={**entry, "content": _on_disk(area, entry["path"])},
            failures=[refused.as_told()],
            commands=commands,
            project_id=project_id,
        )
        result.spend.add("repair", repaired)
        result.attempts += 1
        if not repaired["ok"]:
            result.outcome = FILE_NOT_REPAIRED
            result.stopped_by = {
                "at": "repair",
                "file": entry["path"],
                "attempts": attempts,
                "ended": repaired["ended"],
                "failure": repaired["failure"],
            }
            return
        if not _kept(settings, result=result, area=area, entry=entry, answer=repaired,
                     project_id=project_id):
            return


def _on_disk(area, path: str) -> str:
    """What is actually in the file, for the door that has to repair it.

    From disk and not from what we believe we wrote: the check ran on the bytes that are
    there, and a repair written against anything else is a repair of a different file.
    A file that cannot be read back is a defect of ours, and saying so in the material
    is better than sending nothing and letting the door invent the content.
    """
    try:
        return area.read(path)
    except (OSError, PathRefused) as error:
        return f"[the build could not read this file back: {type(error).__name__} {error}]"


def _prepared(settings, *, result, area, stack, project_id) -> bool:
    """The dependencies, installed. `True` when there was nothing to install.

    It is the only step that reaches the network, and the only one that fails for
    reasons that are nobody's fault here — a registry that is down, a package that was
    withdrawn. That is why it is measured on its own and why its outcome has its own
    name: what to do about it is to look at the network, not at the code.
    """
    if stack.prepare is None:
        # Nothing to install. Not reported: a build that had nothing to prepare is not
        # a build that prepared instantly, and a zero here would say it was.
        return True

    outcome = sandbox.run(
        settings,
        directory=area.directory,
        command=stack.prepare,
        profile=sandbox.PREPARATION,
    )
    settings.metrics.measure(
        "build.prepared",
        dims={
            "stack": stack.name,
            "outcome": "ok"
            if outcome.accepted
            else ("timed_out" if outcome.ended == "timed_out" else "failed"),
        },
        duration_ms=outcome.duration_ms,
        project_id=project_id,
    )
    if outcome.accepted:
        return True
    _log(f"{project_id}: the preparation {outcome.ended} ({outcome.code})")
    result.outcome = PREPARATION_FAILED
    result.stopped_by = {
        "at": "preparation",
        "ended": outcome.ended,
        **({"exit_code": outcome.code} if outcome.code is not None else {}),
        "output": outcome.output,
    }
    return False


def _document(settings, *, result, area, the_plan, commands, analysis, points, language,
              project_id, record) -> None:
    """The README, written into the build. It cannot fail the build.

    Every way it can go wrong ends the same: the project stays exactly as it is, the
    result says it is not documented, and the driver is told. An hour of calls is not
    thrown away over one document, and the number that says how often this happens is
    on `build.finished`.
    """
    written = documenting.write(
        settings,
        analysis=analysis,
        points=points,
        plan=the_plan,
        written=result.written,
        commands=commands,
        language=language,
        project_id=project_id,
    )
    result.spend.add("readme", written)
    if not written["ok"]:
        _log(f"{project_id}: NO README ({written['ended']} {written['failure'] or ''}): "
             f"the project is built and undocumented")
        return

    try:
        size = area.write(documenting.NAME, written["output"]["readme"])
    except (OSError, PathRefused) as error:
        _log(f"{project_id}: the README could not be written ({type(error).__name__} {error})")
        return

    result.documented = True
    result.written.append({"path": documenting.NAME, "kind": "markdown", "exposes": ""})
    record(appends={"files": [{"path": documenting.NAME, "kind": "markdown", "bytes": size}]})


def _as_recorded(written: dict) -> dict:
    """A written file as the step keeps it: its path and its kind.

    Not what it exposes. That account is written for the door that reads it next and
    runs to several lines a file; on the step it would be the whole project's source in
    prose, on a document a person opens to see how far the build has got.
    """
    return {"path": written["path"], "kind": written["kind"]}
