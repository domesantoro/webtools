"""What the configuration says about a stack, and what it does not say.

A **stack** is a name — `web`, `page`, whatever somebody configures tomorrow — under
which four things may be written: how a project of that stack is prepared, how a file
of a given kind is checked, how the whole project is checked, how it is started. The
plan door chooses one of these names, and from then on everything the build runs is
read from under it.

**Nothing here lists the stacks, and nothing here lists the kinds of file.** Both are
keys of a configured object, so a stack added to the configuration costs no code and a
kind of file this repository has never seen is checked the day somebody writes the
command for it. That is the whole reason this file exists: without it the checks would
be a `match` on a file extension, which is a list of the stacks somebody happened to
think of.

**All four are optional, and optional means the step does not exist for that stack.**
A page made of HTML and CSS has nothing to install and no process to start: it is not
verified worse than a server, and nothing is put in the place of the steps it does not
have. A stack with nothing at all configured under it is legitimate too — files are
written and none of them is checked — and what that produces is a number
(`build.unchecked`) rather than a silence.

What **is** refused is a step that is there and malformed: a command that is not a list
of strings, a settle time that is not a number. Absent and wrong are different things,
and only one of them is a decision somebody made.
"""

from dataclasses import dataclass

from webtools_developer.commons.configuration_client import ConfigurationError


@dataclass(frozen=True)
class Start:
    """How a project of this stack is started, and how long it has to stay up.

    It is the one check that does not pass by exiting: a webtool that is a server is
    supposed **not** to finish. So the command is started, left alone for `settle_ms`,
    and judged on whether it is still running — and then it is stopped. A command that
    exits before the settle time has crashed, and what it printed is the failure.
    """

    command: list[str]
    settle_ms: int


@dataclass(frozen=True)
class Stack:
    """One stack, as it is configured. Every field may be absent."""

    name: str
    # How dependencies are installed. The only step that reaches the network.
    prepare: list[str] | None
    # Kind of file → the command that checks one. The file's path is appended to the
    # command as its last argument.
    checks: dict[str, list[str]]
    # How the whole project is checked once every file is written — tests, a build, a
    # type check.
    whole: list[str] | None
    start: Start | None

    def check_for(self, kind: str) -> list[str] | None:
        """The command that checks a file of this kind, or `None` when there is none.

        `None` is an answer and not a failure: it means this stack has nothing to say
        about that kind of file, which is the ordinary case for a template, a
        stylesheet, a text file.
        """
        return self.checks.get(kind)


class Stacks:
    """Every configured stack, by name."""

    def __init__(self, by_name: dict[str, Stack]) -> None:
        self._by_name = by_name

    def names(self) -> list[str]:
        """The names, in the order they are configured in.

        This is the list the plan door is handed and the list its answer is checked
        against. Nothing else decides what may be chosen.
        """
        return list(self._by_name)

    def get(self, name: str) -> Stack | None:
        return self._by_name.get(name)

    def commands_of(self, name: str) -> dict:
        """What a stack runs, as the doors are told it.

        The same words the configuration uses, and only the steps that exist: a stack
        with no preparation has no `prepare` key here, so what a model is told matches
        what will actually happen to what it writes. Sending `"prepare": null` would be
        telling it there is a preparation step whose command is nothing.
        """
        stack = self._by_name.get(name)
        if stack is None:
            return {}
        commands: dict = {}
        if stack.prepare is not None:
            commands["prepare"] = stack.prepare
        if stack.checks:
            commands["check_by_kind_of_file"] = {
                kind: command for kind, command in stack.checks.items()
            }
        if stack.whole is not None:
            commands["check_the_whole_project"] = stack.whole
        if stack.start is not None:
            commands["start"] = stack.start.command
        return commands

    def all_commands(self) -> dict:
        """Every stack with its commands: what the plan door is given to choose from."""
        return {name: self.commands_of(name) for name in self._by_name}


def load_stacks(configuration, base: str) -> Stacks:
    """Every stack, checked at startup.

    Checked **here and not when a build runs**: a command that is a string where it
    should be a list is a mistake in a file, and finding it out three hours into a build
    means a build paid for and thrown away. An empty set of stacks is refused for the
    same reason — a developer with nothing to build with cannot build anything, and it
    is better said at startup than at the first trigger.
    """
    document = configuration.mapping(base)
    if not document:
        raise ConfigurationError(
            f"configuration of {configuration.subsystem}: {base} names no stack, so nothing "
            f"can be built"
        )
    stacks = {}
    for name in document:
        stacks[name] = _stack(configuration, f"{base}.{name}", name)
    return Stacks(stacks)


def _stack(configuration, path: str, name: str) -> Stack:
    return Stack(
        name=name,
        prepare=_command(configuration, f"{path}.prepare"),
        checks=_checks(configuration, f"{path}.checks"),
        whole=_command(configuration, f"{path}.whole"),
        start=_start(configuration, f"{path}.start"),
    )


def _command(configuration, path: str) -> list[str] | None:
    """A command, or `None` when this stack has not got that step.

    The first element is what is executed and is never looked up in a shell: a shell
    would make the whole string one more language, with its own quoting, inside a field
    that is already a list.
    """
    value = configuration.get(path)
    if value is None:
        return None
    if not isinstance(value, list) or not value or not all(
        isinstance(part, str) and part for part in value
    ):
        raise ConfigurationError(
            f"configuration of {configuration.subsystem}: {path}, when it is there, must be "
            f"a non-empty list of strings: {value!r}"
        )
    return list(value)


def _checks(configuration, path: str) -> dict[str, list[str]]:
    """Kind of file → its command. An absent `checks` is an empty one: no file of this
    stack is checked on its own, which is a state, not a fault."""
    value = configuration.get(path)
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ConfigurationError(
            f"configuration of {configuration.subsystem}: {path}, when it is there, must be "
            f"an object of kind → command: {value!r}"
        )
    checks = {}
    for kind in value:
        command = _command(configuration, f"{path}.{kind}")
        if command is None:
            # The key is there with nothing under it, which is not the same as the key
            # not being there: somebody wrote a kind and meant to give it a command.
            raise ConfigurationError(
                f"configuration of {configuration.subsystem}: {path}.{kind} has no command"
            )
        checks[kind] = command
    return checks


def _start(configuration, path: str) -> Start | None:
    value = configuration.get(path)
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ConfigurationError(
            f"configuration of {configuration.subsystem}: {path}, when it is there, must be "
            f'{{"command": [...], "settle_ms": <number>}}: {value!r}'
        )
    command = _command(configuration, f"{path}.command")
    if command is None:
        raise ConfigurationError(
            f"configuration of {configuration.subsystem}: {path}.command has no command"
        )
    return Start(command=command, settle_ms=configuration.integer(f"{path}.settle_ms"))
