"""What was checked, and what the checks said.

Three questions, asked at three different moments, and they are not the same question:

- **a file**, as soon as it is written, with the command its stack configures for its
  kind. It is the cheapest check and the one whose failure is easiest to act on, since
  only one file has changed;
- **the whole project**, once every file is there. It is the check that finds what no
  single file could be wrong about: a name one file expects and another never defined,
  a test that fails because two files disagree;
- **the start**, last, which is the only one that passes by the command *not* finishing.

Each of them may not exist for a given stack, and then it is not run and nothing is put
in its place. That is not the same as passing, and it is not counted as passing: a file
whose kind this stack has no command for is `build.unchecked`, which is a number
somebody can act on, where a silence is not.

**A check that could not be started is not a file that is wrong.** The command is a
path in a configuration; when it is not there, what failed is the machine's setup, and
saying so is the difference between fixing one line of configuration and asking a model
to repair a file that was fine.
"""

import sys
from dataclasses import dataclass

from webtools_developer import sandbox

# Names for the two checks that are not about one kind of file. Parenthesised for the
# same reason `(other)` is in `main.py`: it marks a bucket that is not one of the
# configured names, so a stack that happens to configure a kind called `start` cannot
# quietly land in the same bucket as the start check.
WHOLE = "(whole)"
START = "(start)"


@dataclass(frozen=True)
class Refusal:
    """One check that did not pass, as the repair door will read it.

    `ended` is kept beside the output because the three ways a check can not pass are
    three different things to do: a command that ran and refused the file is the file's
    problem, a command that never finished may be the file's or the machine's, and a
    command that could not be started is neither.
    """

    check: str
    ended: str
    code: int | None
    output: str

    def as_told(self) -> dict:
        """What the repair door is told about it.

        The exit code goes in as it is and is not translated into a sentence: it is the
        command's own word for what happened, and a model reading a build's output is
        better served by the number the command printed than by our paraphrase of it.
        """
        return {
            "check": self.check,
            "ended": self.ended,
            **({"exit_code": self.code} if self.code is not None else {}),
            "output": self.output,
        }


def _log(message: str) -> None:
    print(f"[verification] {message}", file=sys.stderr)


def _measured(settings, *, check: str, outcome: sandbox.Outcome, project_id: str) -> None:
    settings.metrics.measure(
        "build.verified",
        dims={
            "check": check,
            "outcome": "passed"
            if outcome.accepted
            else ("timed_out" if outcome.ended == "timed_out" else "failed"),
        },
        duration_ms=outcome.duration_ms,
        project_id=project_id,
    )


def of_file(settings, *, stack, workspace, path: str, kind: str, project_id: str) -> Refusal | None:
    """One file, checked with the command its kind is configured with.

    The file's path is appended to that command as its last argument, relative to the
    build: it is the one thing the command cannot know in advance, and appending it is
    the convention every check in the configuration is written against.
    """
    command = stack.check_for(kind)
    if command is None:
        # This stack has nothing to say about this kind of file. It is counted, so that
        # how much of a build nobody verified is a number and not something to be
        # worked out by reading the configuration.
        settings.metrics.measure("build.unchecked", dims={"kind": kind}, project_id=project_id)
        return None

    outcome = sandbox.run(
        settings,
        directory=workspace.directory,
        command=[*command, path],
        profile=sandbox.CLOSED,
    )
    _measured(settings, check=kind, outcome=outcome, project_id=project_id)
    if outcome.accepted:
        return None
    _log(f"{path}: {kind} check {outcome.ended} ({outcome.code})")
    return Refusal(check=kind, ended=outcome.ended, code=outcome.code, output=outcome.output)


def of_whole(settings, *, stack, workspace, project_id: str) -> Refusal | None:
    """The project, checked as a whole. `None` when this stack has no such command."""
    if stack.whole is None:
        return None
    outcome = sandbox.run(
        settings, directory=workspace.directory, command=stack.whole, profile=sandbox.CLOSED
    )
    _measured(settings, check=WHOLE, outcome=outcome, project_id=project_id)
    if outcome.accepted:
        return None
    _log(f"the whole project: {outcome.ended} ({outcome.code})")
    return Refusal(check=WHOLE, ended=outcome.ended, code=outcome.code, output=outcome.output)


def of_start(settings, *, stack, workspace, project_id: str) -> Refusal | None:
    """The project, started. `None` when this stack has nothing to start.

    It passes when the command is **still running** after its settle time, which
    `sandbox.stays_up` reports as `timed_out`: the same fact as everywhere else — it was
    still going when we stopped waiting — read here as the answer we wanted. A command
    that finished on its own did not stay up, whatever it exited with, and a `0` is
    still a failure of this check: what was supposed to be serving is not.
    """
    if stack.start is None:
        return None
    outcome = sandbox.stays_up(
        settings,
        directory=workspace.directory,
        command=stack.start.command,
        settle_ms=stack.start.settle_ms,
    )
    stayed_up = outcome.ended == "timed_out"
    settings.metrics.measure(
        "build.verified",
        dims={"check": START, "outcome": "passed" if stayed_up else "failed"},
        duration_ms=outcome.duration_ms,
        project_id=project_id,
    )
    if stayed_up:
        return None
    _log(f"the start: {outcome.ended} ({outcome.code}) before the settle time")
    return Refusal(
        check=START,
        ended=outcome.ended,
        code=outcome.code,
        # What it printed is the whole of what there is to go on, and a process that
        # stopped at once usually says why in its last line.
        output=outcome.output
        or "it stopped before the settle time and printed nothing",
    )
