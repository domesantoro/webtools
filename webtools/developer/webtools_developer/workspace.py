"""The directory one build happens in, and the files that go into it.

One build, one directory under the configured root, named after the project. Everything
the build writes is inside it and nothing it writes is outside it, and that second half
is this file's whole job: the paths come out of a model, and a path out of a model is a
path somebody else chose.

**Why the check is here and not only in the sandbox.** The sandbox confines what the
*commands* may touch, and it does that well. But the files are written by this process,
which is not confined at all: it holds the keys, it can reach anagraphics, it can write
anywhere the user can. A plan naming `../../.ssh/authorized_keys` would be written by
us, with our own hands, before any command ran. So the path is checked before every
write, against the directory the build owns, and what is checked is the **resolved**
path — a name that is a symbolic link to somewhere else is the oldest way round a check
that only reads the string it was given.

**The directory is made fresh.** A build starts from nothing: a directory left over
from a previous attempt would mean a file that is not in the plan sitting in what gets
delivered, and a check passing because of something nobody wrote this time.
"""

import shutil
import sys
from dataclasses import dataclass
from pathlib import Path, PurePosixPath


class PathRefused(Exception):
    """A path that is not this build's to write.

    It carries the reason because the reason is a fact about the plan: a path that
    escapes, a path that is absolute, a name that cannot be a file. Whoever handles it
    writes it on the step, so that what the model asked for is recorded rather than
    summarised as "a bad path".
    """


@dataclass(frozen=True)
class Written:
    """A file that is on disk, and what the files after it may use from it.

    `exposes` is the model's own account of what it wrote, not something read back out
    of the file: reading it back would mean parsing the language it is written in, and
    which languages exist here is exactly what this subsystem must not know.
    """

    path: str
    kind: str
    exposes: str
    bytes_written: int


def _log(message: str) -> None:
    print(f"[workspace] {message}", file=sys.stderr)


class Workspace:
    """Where one build's files live."""

    def __init__(self, directory: Path) -> None:
        self.directory = directory

    @property
    def path(self) -> str:
        return str(self.directory)

    def write(self, relative: str, content: str) -> int:
        """One file, written. Answers how many bytes it came to.

        The parent directories are made as needed — a plan that says `src/server.js`
        means the directory too — and they are made **after** the path has been
        checked, never before: creating a directory is already a write, and a path that
        escapes would have escaped by the time the file itself was refused.
        """
        target = self.resolve(relative)
        target.parent.mkdir(parents=True, exist_ok=True)
        raw = content.encode("utf-8")
        target.write_bytes(raw)
        return len(raw)

    def read(self, relative: str) -> str:
        """A file back off the disk, as text.

        Read from disk rather than kept in memory, so that what goes to the repair door
        is what the check actually refused, and not what we believe we wrote.
        """
        return self.resolve(relative).read_text(encoding="utf-8")

    def resolve(self, relative: str) -> Path:
        """The path this name means inside this build, or `PathRefused`.

        Five things are refused, and they are different mistakes:

        - an empty name, or one with a NUL in it: not a file name at all;
        - an absolute path, which is not a name inside anything;
        - a Windows-style drive or a backslash, which on this machine would become part
          of the file's name and quietly produce a file nobody asked for;
        - a `..` component, which is the ordinary way out of a directory. A `.` is
          refused in the same line, though nothing hinges on it: a single dot means the
          directory it is already in, and the parsing removes it before this code sees
          it. The check stays because it costs nothing and because a reader should not
          have to know that to be sure;
        - anything whose resolved path is not inside this build — which is what catches
          the case the four above miss, a name that is or goes through a symbolic link.
        """
        if not relative or "\0" in relative:
            raise PathRefused(f"{relative!r} is not a file name")
        if "\\" in relative or ":" in relative:
            raise PathRefused(f"{relative!r} contains a character that cannot be in a path here")
        name = PurePosixPath(relative)
        if name.is_absolute():
            raise PathRefused(f"{relative!r} is an absolute path")
        if any(part in (".", "..") for part in name.parts):
            raise PathRefused(f"{relative!r} walks out of the build")

        target = (self.directory / Path(*name.parts)).resolve()
        root = self.directory.resolve()
        if target != root and root not in target.parents:
            raise PathRefused(f"{relative!r} resolves outside the build ({target})")
        return target


def fresh(settings, project_id: str) -> Workspace:
    """The directory for this build, empty, whatever was there before.

    The name is the project's identifier, which is one build per project: a second build
    of the same project replaces the first, because there is only one webtool at the end
    of it and two directories would leave somebody choosing between them.
    """
    root = settings.build.root
    # The project's identifier arrives on a route, so it is a name from outside like
    # any other: a `..` in it would put the build somewhere else entirely, and the
    # check that every file is inside the build would then be checking the wrong
    # directory. It is refused here rather than cleaned up, because a project whose
    # identifier is not a name is not a project this can build.
    if not project_id or "/" in project_id or "\\" in project_id or project_id in (".", ".."):
        raise PathRefused(f"{project_id!r} cannot name a build directory")
    directory = root / project_id
    if directory.resolve().parent != root.resolve():
        raise PathRefused(f"{project_id!r} does not name a directory inside the builds root")
    if directory.exists():
        _log(f"{project_id}: a previous build was there and is being removed")
        shutil.rmtree(directory)
    directory.mkdir(parents=True)
    return Workspace(directory)
