"""The first door, used: from the analysis to the plan the build follows.

What comes back is the one decision of the build that everything after it reads — which
stack, and which files — so it is the one answer checked hardest here. Two things are
checked that the schema cannot say:

- **the stack is one of ours.** The names come out of the configuration and are handed
  to the door in the same call; a name that is not among them is an answer about a
  stack this machine has no commands for, and building it would mean writing files
  nobody can check, prepare or start. It is `unusable`, and the build stops with a
  reason that names the stack it asked for;
- **the files are files.** A path that is empty, a kind that is empty, a purpose that
  says nothing: each of those would be carried for the whole build and end up as an
  empty argument to a command.

The ceiling on how many files a plan may have is **not** checked here. It is not a
malformed answer — the model was not told a number — it is a build we decided not to
run, and where a decision of ours stops a build is `build.py`, with the other ceilings.
"""

import sys

from webtools_developer import policies
from webtools_developer.build_plan_ai.contract import unusable
from webtools_developer.build_plan_ai.webtools_build_plan_ai import plan as ask
from webtools_developer.measured_ai import (
    DEVELOPMENT_PLAN,
    report_interaction,
    report_unusable,
)

# No `minLength`, no `maxLength`, no `minimum` and no recursive schema: constrained
# output answers 400 to all of them. What has to be true of the values is checked below,
# after the answer has arrived.
SCHEMA = {
    "type": "object",
    "properties": {
        "stack": {"type": "string"},
        "files": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "purpose": {"type": "string"},
                    "kind": {"type": "string"},
                },
                "required": ["path", "purpose", "kind"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["stack", "files"],
    "additionalProperties": False,
}

REQUEST = (
    "Everything above is complete: the analysis is final, the points are what the client "
    "agreed to, and the stacks are all there are. Choose the stack and write the plan now."
)


def _log(message: str) -> None:
    print(f"[plan] {message}", file=sys.stderr)


def make(settings, *, analysis: str, points, stacks, project_id: str) -> dict:
    """One run of this door. The envelope comes back whatever happened.

    Nothing raises towards the caller: a model that did not answer, answered badly or
    was cut short is one of the contract's endings, and every one of them has to be
    something the build above can act on.
    """
    door = settings.doors.plan
    elapsed = settings.metrics.timer()
    answer = ask(
        door.ai,
        instructions=policies.read(door.policy),
        analysis=analysis,
        points=points,
        stacks=stacks.all_commands(),
        request=REQUEST,
        schema=SCHEMA,
    )
    # Reported **before** the output is judged: the model ran, and what it consumed is
    # real whether or not we can use what came back.
    report_interaction(
        settings,
        phase=DEVELOPMENT_PLAN,
        answer=answer,
        duration_ms=elapsed(),
        project_id=project_id,
    )
    if not answer["ok"]:
        return answer

    read = _read_output(answer["output"], stacks)
    if isinstance(read, str):
        _log(f"the plan came back unusable: {read}")
        # It answered inside the schema and what came back cannot be built. `ai.call`
        # has already gone out saying the provider completed, which it did: this is the
        # door's own verdict, and nothing else records it.
        report_unusable(
            settings,
            phase=DEVELOPMENT_PLAN,
            answer=answer,
            reason=read,
            project_id=project_id,
        )
        return unusable(
            provider=answer["provider"],
            model=answer["model"],
            ended="unusable",
            spend=answer["spend"],
            attempts=answer["attempts"],
            fell_back=answer["fell_back"],
        )

    settings.metrics.measure(
        "build.planned",
        dims={"stack": read["stack"]},
        amounts={"files": len(read["files"])},
        project_id=project_id,
    )
    return {**answer, "policy": door.policy, "output": read}


def _read_output(output, stacks) -> dict | str:
    """The plan in this file's words, or the name of what is wrong with it.

    A string back rather than `None`, because which way an answer was unusable is a
    number somebody reads: a door that keeps choosing a stack that does not exist and a
    door that keeps coming back empty are two different things to fix.
    """
    stack = str((output or {}).get("stack") or "").strip()
    if not stack:
        return "no_stack"
    if stacks.get(stack) is None:
        return "unknown_stack"

    entries = (output or {}).get("files")
    if not isinstance(entries, list) or not entries:
        return "no_files"

    files = []
    for entry in entries:
        if not isinstance(entry, dict):
            return "malformed_file"
        path = str(entry.get("path") or "").strip()
        purpose = str(entry.get("purpose") or "").strip()
        kind = str(entry.get("kind") or "").strip()
        if not path or not purpose or not kind:
            return "malformed_file"
        files.append({"path": path, "purpose": purpose, "kind": kind})

    # Two entries for the same path would have the second quietly overwrite the first,
    # and the plan would then say something the build cannot do.
    paths = [entry["path"] for entry in files]
    if len(set(paths)) != len(paths):
        return "repeated_path"

    return {"stack": stack, "files": files}
