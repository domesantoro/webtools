"""The second and third doors, used: writing one file, and repairing one file.

They are in one module because they answer about the same thing — one file of the plan —
and whoever calls them does so in one loop: write, check, and while it is refused,
repair. They remain two doors with two contracts and two configurations: what is shared
here is the shape of the answer, which both produce, and the reading of it, which is the
same reading.

**The answer is content plus an account of it.** `exposes` is what the files after this
one will be told about it, and it is the model's own words, not something read back out
of the file: reading it back would mean parsing the language it is written in, and which
languages exist is exactly what this subsystem must not know. A name left out of
`exposes` is a name the next file cannot call, so it is carried whole and never
summarised further.

**A file that comes back empty is unusable.** The plan asked for a file with a purpose;
nothing is a file that satisfies no purpose, and writing it would put an empty file in
what gets delivered and pass every check that only asks whether it parses.

**A file over the ceiling is unusable too**, and that is a ceiling of ours: an answer
far larger than any file of a small tool is what a runaway answer looks like, and the
one after it would carry it as context.
"""

import sys

from webtools_developer import policies
from webtools_developer.measured_ai import (
    DEVELOPMENT_FILE,
    DEVELOPMENT_REPAIR,
    report_interaction,
    report_unusable,
)
from webtools_developer.repair_file_ai.contract import unusable as repair_unusable
from webtools_developer.repair_file_ai.webtools_repair_file_ai import repair_file as ask_repair
from webtools_developer.write_file_ai.contract import unusable as write_unusable
from webtools_developer.write_file_ai.webtools_write_file_ai import write_file as ask_write

# One shape for both doors. No `minLength` and no `maxLength`: constrained output
# answers 400 to them, and what has to be true of the values is checked after the answer
# has arrived.
SCHEMA = {
    "type": "object",
    "properties": {
        "content": {"type": "string"},
        "exposes": {"type": "string"},
        "notes": {"type": "string"},
    },
    "required": ["content", "exposes", "notes"],
    "additionalProperties": False,
}

WRITE_REQUEST = (
    "Everything above is complete. Write the file named in `file_to_write` now, whole, "
    "and nothing else."
)

REPAIR_REQUEST = (
    "Everything above is complete. Write `file_that_failed` again, whole, so that the "
    "checks that refused it pass."
)


def _log(message: str) -> None:
    print(f"[files] {message}", file=sys.stderr)


def write(settings, *, analysis, points, plan, written, target, commands, project_id) -> dict:
    """One file of the plan, asked for."""
    door = settings.doors.write
    elapsed = settings.metrics.timer()
    answer = ask_write(
        door.ai,
        instructions=policies.read(door.policy),
        analysis=analysis,
        points=points,
        plan=plan,
        written=written,
        target=target,
        commands=commands,
        request=WRITE_REQUEST,
        schema=SCHEMA,
    )
    return _judged(
        settings,
        answer=answer,
        phase=DEVELOPMENT_FILE,
        duration_ms=elapsed(),
        policy=door.policy,
        project_id=project_id,
        unusable=write_unusable,
    )


def repair(settings, *, analysis, plan, written, target, failures, commands, project_id) -> dict:
    """The same file, after a check refused it.

    `target` carries the content that was refused, whole: a repair is written against
    what is actually on disk, and not against what the plan asked for — those two are
    the same thing only when nothing went wrong, which is not this door's case.
    """
    door = settings.doors.repair
    elapsed = settings.metrics.timer()
    answer = ask_repair(
        door.ai,
        instructions=policies.read(door.policy),
        analysis=analysis,
        plan=plan,
        written=written,
        target=target,
        failures=failures,
        commands=commands,
        request=REPAIR_REQUEST,
        schema=SCHEMA,
    )
    return _judged(
        settings,
        answer=answer,
        phase=DEVELOPMENT_REPAIR,
        duration_ms=elapsed(),
        policy=door.policy,
        project_id=project_id,
        unusable=repair_unusable,
    )


def _judged(settings, *, answer, phase, duration_ms, policy, project_id, unusable) -> dict:
    """The envelope, measured and then read.

    `unusable` is the constructor of the door that answered, passed in by the caller:
    the two doors have two contracts, and an envelope built by the wrong one is the one
    mistake this module could make that nothing downstream would notice.
    """
    # Reported **before** the output is judged: the model ran, and what it consumed is
    # real whether or not we can use what came back.
    report_interaction(
        settings, phase=phase, answer=answer, duration_ms=duration_ms, project_id=project_id
    )
    if not answer["ok"]:
        return answer

    read = _read_output(answer["output"], settings.build.limits.file_max_bytes)
    if isinstance(read, str):
        _log(f"the file came back unusable: {read}")
        report_unusable(
            settings, phase=phase, answer=answer, reason=read, project_id=project_id
        )
        return unusable(
            provider=answer["provider"],
            model=answer["model"],
            ended="unusable",
            spend=answer["spend"],
            attempts=answer["attempts"],
            fell_back=answer["fell_back"],
        )
    return {**answer, "policy": policy, "output": read}


def _read_output(output, ceiling: int) -> dict | str:
    """The file in this module's words, or the name of what is wrong with it."""
    content = (output or {}).get("content")
    if not isinstance(content, str) or content.strip() == "":
        return "empty_content"
    if len(content.encode("utf-8")) > ceiling:
        return "content_too_large"
    return {
        "content": content,
        # An account of what it exposes may legitimately be empty — a stylesheet
        # exposes nothing to the rest of the project — so absence here is kept as
        # absence and not refused.
        "exposes": str((output or {}).get("exposes") or "").strip(),
        "notes": str((output or {}).get("notes") or "").strip(),
    }
