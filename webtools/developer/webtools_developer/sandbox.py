"""Running one command of a build, confined.

Everything a build executes comes through here: the command that installs its
dependencies, the command that checks a file, the command that checks the whole
project, the command that starts it. None of it is trusted — it is a project a model
wrote, and the commands are the ones a configuration names — so all of it runs the same
way:

- **inside the build's own directory**, which is the working directory and also `HOME`.
  `HOME` matters more than it looks: a package manager keeps its cache under it, and
  left alone it would read and write the cache of whoever is running the developer. A
  build would then be able to poison the next one, and the first `npm install` this
  subsystem ever ran failed for exactly that reason;
- **with an environment built here and nothing inherited**. Whatever is in the
  developer's own environment — a key, a token, a proxy — is not a build's business,
  and a variable that arrives by accident is a variable somebody will end up depending
  on. `PATH` is configuration, because a command that launches another one looks for it
  there and where a runtime lives is a fact about the machine;
- **under a ceiling on time, memory, processor and the size of what it writes**, so a
  loop in generated code is a failed check and not a machine that has to be rebooted;
- **inside the wrapper its profile names**, which is what actually confines it.

**Two profiles, and the difference is the network.** `preparation` may reach out,
because a project with dependencies cannot be installed otherwise. `closed` may not,
and everything else runs under it: writing files, checking them, starting the result. A
webtool that phones home while being checked is not something to run on this machine,
and a check that quietly needed the network would pass here and fail at the client's.

**What the wrapper is, is not this file's business.** It is a list of words from the
configuration, put in front of the command. On this machine it is `sandbox-exec` with a
profile; somewhere else it is something else, and nothing here has to change for that.
What this file guarantees is that no command runs without one: a profile with no
wrapper stops the subsystem at startup (`settings.py`), because the absent thing in
that case is the confinement itself.

**Every outcome is a fact, and they are different facts.** A command that ran and
refused what it was given, a command that never finished, and a command that could not
be started at all are three things: the first is the code's fault, the second may be
either, and the third is ours — a path in the configuration that is not there. Reading
them off one boolean is how a build ends up reporting that a file is wrong because
`npm` is not installed.
"""

import os
import resource
import shutil
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

# The profiles, as `settings.py` requires them and the configuration names them.
CLOSED = "closed"
PREPARATION = "preparation"

# What is kept of a long output: the end. A parser says where it stopped on its last
# line, a test runner sums up at the bottom, and a stack trace ends with the frame that
# matters. The beginning is what a build system prints about itself.
_CUT_NOTICE = "[… earlier output dropped: only the last {kept} bytes are kept …]\n"


@dataclass(frozen=True)
class Outcome:
    """What running one command was.

    `ended` says which of the three things happened, and nothing infers it from `code`:

        exited            it ran to the end. `code` is what it exited with, and `0`
                          means it accepted what it was given
        timed_out         it was still running when we stopped waiting. `code` is
                          None: it never said anything
        could_not_start   there was nothing to run — the file is not there, or it is
                          not executable. `code` is None and `output` says what the
                          operating system said

    `output` is everything it printed, both streams together, cut to the configured
    ceiling. Together and not apart because a command's complaint may come out of
    either one, and a build that read only one of them would drop half the failures.
    """

    ended: str
    code: int | None
    output: str
    duration_ms: int
    # Whether the output above is only the end of what was printed.
    cut: bool

    @property
    def accepted(self) -> bool:
        """Whether this is a command that ran and was satisfied."""
        return self.ended == "exited" and self.code == 0


def _log(message: str) -> None:
    print(f"[sandbox] {message}", file=sys.stderr)


def _environment(sandbox, directory: Path) -> dict[str, str]:
    """What the command sees. Built, not inherited — see the file's docstring."""
    return {
        "HOME": str(directory),
        "PATH": sandbox.path,
        # The build's own directory, so a toolchain that wants a scratch space does not
        # reach for the machine's shared one.
        "TMPDIR": str(directory),
    }


# The ceilings, by the name a person would use, the kernel's name for them, and the
# configured field they come from. `None` as a field means the value is not configurable
# because there is nothing to decide: a build has no business writing a core dump.
_CEILINGS = (
    ("memory", resource.RLIMIT_AS, "address_space_max_bytes"),
    ("processor time", resource.RLIMIT_CPU, "cpu_seconds_max"),
    ("the size of a file", resource.RLIMIT_FSIZE, "file_size_max_bytes"),
    ("core dumps", resource.RLIMIT_CORE, None),
)

# Which of them this kernel will actually take, worked out once. Not every operating
# system implements every one: macOS refuses `RLIMIT_AS` outright, whatever the number.
_accepted: dict[int, bool] = {}


def _values(sandbox) -> list[tuple[str, int, int]]:
    """Each ceiling as a name, a kernel limit and a number."""
    return [
        (name, limit, 0 if field is None else getattr(sandbox, field))
        for name, limit, field in _CEILINGS
    ]


def _takes(limit: int, value: int) -> bool:
    """Whether this kernel accepts that ceiling, asked **in this process**.

    Asked here and not in the child, where the answer could only be found out by the
    child dying of a confusing error in the moment between fork and exec — which is
    what it did, and what it looked like was every command of every build failing to
    start. So it is tried on ourselves, put back at once, and remembered.
    """
    if limit in _accepted:
        return _accepted[limit]
    was = resource.getrlimit(limit)
    try:
        resource.setrlimit(limit, (value, was[1]))
        _accepted[limit] = True
    except (ValueError, OSError):
        _accepted[limit] = False
    else:
        try:
            resource.setrlimit(limit, was)
        except (ValueError, OSError):
            # It went on and will not come back. Nothing here can undo it, and it is
            # this process's own ceiling, so it is said rather than hidden.
            _log(f"our own limit {limit} could not be put back to {was}")
    return _accepted[limit]


def refused_ceilings(sandbox) -> list[str]:
    """The ceilings this machine will not apply, by name.

    They are **not** a reason to refuse to run: a ceiling the kernel does not implement
    is a fact about the operating system, and the remaining ones still hold. It is a
    reason to say so out loud, once, at startup — a number in a configuration that
    nothing enforces is worse than no number, because it reads as a guarantee.
    """
    return [name for name, limit, value in _values(sandbox) if not _takes(limit, value)]


def _limits(sandbox):
    """The ceilings, applied in the child between fork and exec.

    In the child and not with a wrapper command, because these are the kernel's own
    limits and they are inherited by everything the command goes on to launch: a
    package manager that spawns a compiler does not get to start again from no ceiling.

    Only the ones this kernel takes, worked out in the parent (`_takes`). Each is still
    wrapped, because between that check and this call the kernel is not ours to promise
    anything about, and a ceiling that cannot be set must not stop the command from
    running unconfined-by-one-number when the wrapper is confining it anyway.
    """
    wanted = [(limit, value) for _, limit, value in _values(sandbox) if _takes(limit, value)]

    def apply() -> None:
        for limit, value in wanted:
            try:
                resource.setrlimit(limit, (value, value))
            except (ValueError, OSError):
                pass

    return apply


def _findable(sandbox, command: list[str]) -> str | None:
    """Whether the command is on this machine, asked before it is run.

    It has to be asked here, and the reason is the wrapper. A command that does not
    exist, run through a wrapper, comes back as the **wrapper's** exit code with
    `command not found` printed — which is a non-zero exit like any other, and
    indistinguishable from a check that read the file and refused it. The build would
    then send a perfectly good file to the repair door because a runtime is not
    installed, and go on doing it until it ran out of attempts.

    Looked up along the `PATH` the command will actually see, not ours: that is the one
    the configuration gives, and a runtime that is on our own path and not on that one
    is not going to be found.
    """
    named = command[0]
    if shutil.which(named, path=sandbox.path) is not None:
        return None
    if Path(named).is_file() and os.access(named, os.X_OK):
        return None
    return f"{named} is not on this machine, or is not something that can be run"


def _cut(text: str, ceiling: int) -> tuple[str, bool]:
    raw = text.encode("utf-8", "replace")
    if len(raw) <= ceiling:
        return text, False
    kept = raw[-ceiling:].decode("utf-8", "replace")
    return _CUT_NOTICE.format(kept=ceiling) + kept, True


def run(settings, *, directory: Path, command: list[str], profile: str, timeout_ms: int | None = None) -> Outcome:
    """One command, run to the end or stopped.

    `profile` names the wrapper, and an unknown one is refused here rather than run
    unconfined: it can only be a mistake in this repository, since the two names are
    checked at startup.
    """
    sandbox = settings.build.sandbox
    wrapper = sandbox.wrappers.get(profile)
    if wrapper is None:
        # Never "run it anyway". A profile this code does not know is a bug in this
        # code, and the safe reading of a bug about confinement is that nothing runs.
        return Outcome(
            ended="could_not_start",
            code=None,
            output=f"no wrapper is configured for the sandbox profile {profile!r}",
            duration_ms=0,
            cut=False,
        )

    unfindable = _findable(sandbox, command)
    if unfindable is not None:
        _log(unfindable)
        return Outcome(
            ended="could_not_start", code=None, output=unfindable, duration_ms=0, cut=False
        )

    whole = [*wrapper, *command]
    waited = (timeout_ms if timeout_ms is not None else sandbox.timeout_ms) / 1000
    started = time.monotonic()
    try:
        finished = subprocess.run(
            whole,
            cwd=str(directory),
            env=_environment(sandbox, directory),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=waited,
            preexec_fn=_limits(sandbox),  # noqa: PLW1509 — the point is the child
            # Its own process group, so that stopping it stops everything it launched.
            # A package manager that spawns a compiler leaves the compiler behind
            # otherwise, and the build directory is then being written to by something
            # nobody is waiting for.
            start_new_session=True,
        )
    except subprocess.TimeoutExpired as expired:
        elapsed = round((time.monotonic() - started) * 1000)
        _log(f"{command[0]} did not finish within {waited:.0f}s: stopped")
        output, cut = _cut(_decoded(expired.output), sandbox.output_max_bytes)
        return Outcome(ended="timed_out", code=None, output=output, duration_ms=elapsed, cut=cut)
    except OSError as error:
        elapsed = round((time.monotonic() - started) * 1000)
        _log(f"{command[0]} could not be started: {type(error).__name__} {error}")
        return Outcome(
            ended="could_not_start",
            code=None,
            output=f"{type(error).__name__}: {error}",
            duration_ms=elapsed,
            cut=False,
        )

    elapsed = round((time.monotonic() - started) * 1000)
    output, cut = _cut(_decoded(finished.stdout), sandbox.output_max_bytes)
    return Outcome(
        ended="exited", code=finished.returncode, output=output, duration_ms=elapsed, cut=cut
    )


def stays_up(settings, *, directory: Path, command: list[str], settle_ms: int) -> Outcome:
    """A command that is supposed **not** to finish, started and then stopped.

    It is the start check, and it is the one check that cannot be read off an exit code:
    a webtool that is a server passes by still being there. So it is started, left alone
    for as long as it was given to settle, and then judged:

        exited     it finished on its own before the settle time, which for something
                   meant to stay up is a crash. `code` is what it exited with — and a
                   `0` is a crash too, in the sense that matters: what was supposed to
                   be serving is not
        timed_out  it was still running, which is the outcome we want. It is then
                   stopped, and `code` is None because it never reached an end of its
                   own

    The word `timed_out` meaning success here is deliberate: it is the same fact as
    everywhere else — the command was still running when we stopped waiting — and
    giving it a second name would be the same fact under two words. What it *means* is
    this function's caller's business, not this file's.
    """
    sandbox = settings.build.sandbox
    wrapper = sandbox.wrappers.get(CLOSED)
    if wrapper is None:
        return Outcome(
            ended="could_not_start",
            code=None,
            output=f"no wrapper is configured for the sandbox profile {CLOSED!r}",
            duration_ms=0,
            cut=False,
        )

    unfindable = _findable(sandbox, command)
    if unfindable is not None:
        _log(unfindable)
        return Outcome(
            ended="could_not_start", code=None, output=unfindable, duration_ms=0, cut=False
        )

    started = time.monotonic()
    try:
        process = subprocess.Popen(  # noqa: S603 — every part comes from configuration
            [*wrapper, *command],
            cwd=str(directory),
            env=_environment(sandbox, directory),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            preexec_fn=_limits(sandbox),  # noqa: PLW1509
            start_new_session=True,
        )
    except OSError as error:
        _log(f"{command[0]} could not be started: {type(error).__name__} {error}")
        return Outcome(
            ended="could_not_start",
            code=None,
            output=f"{type(error).__name__}: {error}",
            duration_ms=round((time.monotonic() - started) * 1000),
            cut=False,
        )

    try:
        output = process.communicate(timeout=settle_ms / 1000)[0]
    except subprocess.TimeoutExpired:
        # Still up, which is what was wanted. Everything it launched goes with it.
        _stop(process)
        output = process.communicate()[0]
        kept, cut = _cut(_decoded(output), sandbox.output_max_bytes)
        return Outcome(
            ended="timed_out",
            code=None,
            output=kept,
            duration_ms=round((time.monotonic() - started) * 1000),
            cut=cut,
        )

    kept, cut = _cut(_decoded(output), sandbox.output_max_bytes)
    return Outcome(
        ended="exited",
        code=process.returncode,
        output=kept,
        duration_ms=round((time.monotonic() - started) * 1000),
        cut=cut,
    )


def _stop(process) -> None:
    """The process and everything it launched, asked to go and then made to.

    The group and not the process: what was started is a wrapper, which started a
    package manager, which started a runtime. Signalling only the first leaves the
    last one running in a directory we are about to read.
    """
    try:
        group = os.getpgid(process.pid)
    except OSError:
        return
    for sign in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(group, sign)
        except OSError:
            return
        try:
            process.wait(timeout=2)
            return
        except subprocess.TimeoutExpired:
            continue


def _decoded(output) -> str:
    if output is None:
        return ""
    if isinstance(output, bytes):
        return output.decode("utf-8", "replace")
    return str(output)


def usable(settings) -> str | None:
    """Whether the confinement this machine is configured with is actually there.

    It is called at startup, and what it answers is a sentence for the log or `None`.
    It is **not** a reason to refuse to start: the wrapper is a path on a machine, and
    a developer that would not start because a build could not be confined is a
    developer nobody can even look at. What must never happen is a build running
    unconfined, and that is guaranteed elsewhere — `run` refuses a profile it has no
    wrapper for, so a wrapper that is not there makes every command a
    `could_not_start`, which is a failed build and not an unconfined one.
    """
    said = []
    missing = []
    for profile, wrapper in settings.build.sandbox.wrappers.items():
        if shutil.which(wrapper[0]) is None and not Path(wrapper[0]).exists():
            missing.append(f"{profile} → {wrapper[0]}")
    if missing:
        said.append(
            "the sandbox wrapper is not on this machine, so every build will fail on its "
            "first command: " + ", ".join(missing)
        )

    refused = refused_ceilings(settings.build.sandbox)
    if refused:
        # Said as its own sentence: the wrapper being absent means no build can run at
        # all, and a ceiling being refused means builds run with one limit fewer. They
        # are not the same news.
        said.append(
            "this kernel does not apply these ceilings, so builds run without them: "
            + ", ".join(refused)
        )
    return "; ".join(said) or None
