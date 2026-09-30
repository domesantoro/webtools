"""Settings, read at startup. No default values: if anything is missing the server does
not start.

Where they come from:

- the environment (webtools/configurator/bootstrap.env): where anagraphics is and how
  long to wait for it while reading the configuration. Nothing else. This subsystem has
  no database of its own — what a build does is written on the project in anagraphics,
  and the files it makes are on disk under the builds root — so the Mongo variables are
  none of its business;
- everything else: the `developer` document of the `configuration` collection, served
  by anagraphics (`GET /configuration/developer`), seeded from
  `webtools/configurator/configuration/developer.json`.

The address of anagraphics is **not** in the configuration: it is the one thing that
has to be known before the configuration can be read, so there is one copy of it and it
is in the bootstrap. The timeout of the calls we make to anagraphics afterwards is
configuration, because it is a different question from "how long do we wait at
startup".

**What can be run, and how, is configuration and not code.** The stacks, the commands
each one is prepared, checked and started with, the wrapper that confines them: none of
those is written here. This file reads them and checks their shape; what they are is
somebody's decision, made in a file, and a stack added tomorrow costs no code.
"""

from dataclasses import dataclass
from pathlib import Path

from webtools_developer.build_plan_ai.webtools_build_plan_ai import (
    Door as PlanDoor,
    load_build_plan_ai,
)
from webtools_developer.build_readme_ai.webtools_build_readme_ai import (
    Door as ReadmeDoor,
    load_build_readme_ai,
)
from webtools_developer.commons.configuration_client import (
    Bootstrap,
    Configuration,
    ConfigurationError,
    http_url,
    read_bootstrap,
    read_configuration,
)
from webtools_developer.commons.webtools_metrics_client import Metrics, load_metrics
from webtools_developer.repair_file_ai.webtools_repair_file_ai import (
    Door as RepairDoor,
    load_repair_file_ai,
)
from webtools_developer.stack import Stacks, load_stacks
from webtools_developer.write_file_ai.webtools_write_file_ai import (
    Door as WriteDoor,
    load_write_file_ai,
)

SUBSYSTEM = "developer"


@dataclass(frozen=True)
class Dependency:
    """Another subsystem this one calls: where it is and how long we wait for it.

    One shape for every dependency, because the two questions are the same wherever
    they are asked, and a client that took its timeout from somewhere else would be a
    second answer to the same question.
    """

    url: str
    timeout_ms: int


@dataclass(frozen=True)
class Limits:
    """Where a build stops, when it is not going to finish.

    Every one of these is a ceiling we chose, so reaching one is a fact about a decision
    of ours and is reported as such — never as the build having failed on its own.
    Without them a build that cannot be made to pass its checks asks again for as long
    as there is money.
    """

    # How many files a plan may name. A plan far over this is not a big webtool, it is
    # a plan for something that is not one.
    files_max: int
    # How large one file may come back. It is also what a runaway answer looks like.
    file_max_bytes: int
    # How many times one file may go back to the repair door before the build gives up
    # on it.
    attempts_per_file_max: int
    # How many calls to the write and repair doors a whole build may make. It is the
    # ceiling that catches a build where every file needs two repairs — each file
    # under its own limit, and the build as a whole out of hand.
    attempts_total_max: int
    # How long a build may take from the trigger to the end.
    duration_max_ms: int


@dataclass(frozen=True)
class Sandbox:
    """How a command of a build is run, and what it may do while it runs.

    `wrappers` maps the name of a profile to the command that confines it — the whole
    of what this file knows about confinement, because how a machine confines a process
    is that machine's business and not this code's. Two profiles exist, and the
    difference between them is the network: see `sandbox.py`.
    """

    # What `PATH` a command sees. A command that launches another one looks for it
    # there, and where a runtime lives is a fact about this machine.
    path: str
    # How long one command may run before it is stopped.
    timeout_ms: int
    address_space_max_bytes: int
    cpu_seconds_max: int
    file_size_max_bytes: int
    # How much of what a command printed is kept. It is read by a person and sent to
    # the repair door, and a test suite that prints megabytes would otherwise become
    # the whole of what that door reads.
    output_max_bytes: int
    wrappers: dict[str, list[str]]


@dataclass(frozen=True)
class Build:
    """Where builds live, and where they stop."""

    # The directory every build gets a directory of its own under. Outside the
    # repository on purpose: what a model writes is not ours, and a build that wrote
    # into the working tree would put it in a commit.
    root: Path
    limits: Limits
    sandbox: Sandbox


@dataclass(frozen=True)
class PlanStep:
    """One door: which policy it asks with, and everything about the call itself.

    The policy is here and not inside the door because it is not the provider's
    business: swapping provider does not change what the model is asked to do.
    """

    policy: str
    ai: PlanDoor


@dataclass(frozen=True)
class WriteStep:
    policy: str
    ai: WriteDoor


@dataclass(frozen=True)
class RepairStep:
    policy: str
    ai: RepairDoor


@dataclass(frozen=True)
class ReadmeStep:
    policy: str
    ai: ReadmeDoor


@dataclass(frozen=True)
class Doors:
    """The developer's four doors, each with its own provider, key and consumption."""

    plan: PlanStep
    write: WriteStep
    repair: RepairStep
    readme: ReadmeStep


@dataclass(frozen=True)
class Settings:
    host: str
    port: int
    allowed_ips: frozenset[str]
    # How large a request body may be. What reaches this subsystem is a trigger naming
    # a project, not a document: anything larger is a mistake, and it is refused rather
    # than read.
    body_max_bytes: int
    anagraphics: Dependency
    workspaces: Dependency
    comm_center: Dependency
    # The client that sends measurements. It is built here, with everything else, so
    # that a subsystem whose `metrics` block is missing does not start — the same rule
    # as every other field.
    metrics: Metrics
    build: Build
    stacks: Stacks
    doors: Doors


def settings_from(document: dict, bootstrap: Bootstrap) -> Settings:
    """The settings from a configuration document already in hand.

    Kept apart from the reading so that whoever has the document — a test, a script —
    does not need anagraphics to be running to build the settings.
    """
    configuration = Configuration(SUBSYSTEM, document)
    return Settings(
        host=configuration.string("listen.host"),
        port=configuration.port("listen.port"),
        allowed_ips=frozenset(configuration.string_list("access.allowed_ips")),
        body_max_bytes=configuration.integer("limits.body_max_bytes"),
        anagraphics=Dependency(
            # Where anagraphics is comes from the bootstrap, not from here: it had to
            # be known before this document could be fetched at all.
            url=bootstrap.anagraphics_url,
            timeout_ms=configuration.integer("subsystems_infos.anagraphics.timeout_ms"),
        ),
        workspaces=Dependency(
            url=http_url(configuration, "subsystems_infos.workspaces.url"),
            timeout_ms=configuration.integer("subsystems_infos.workspaces.timeout_ms"),
        ),
        comm_center=Dependency(
            url=http_url(configuration, "subsystems_infos.comm_center.url"),
            timeout_ms=configuration.integer("subsystems_infos.comm_center.timeout_ms"),
        ),
        metrics=load_metrics(configuration),
        build=Build(
            root=_root(configuration, "build.root"),
            limits=Limits(
                files_max=configuration.integer("build.limits.files_max"),
                file_max_bytes=configuration.integer("build.limits.file_max_bytes"),
                attempts_per_file_max=configuration.integer("build.limits.attempts_per_file_max"),
                attempts_total_max=configuration.integer("build.limits.attempts_total_max"),
                duration_max_ms=configuration.integer("build.limits.duration_max_ms"),
            ),
            sandbox=Sandbox(
                path=configuration.string("sandbox.path"),
                timeout_ms=configuration.integer("sandbox.timeout_ms"),
                address_space_max_bytes=configuration.integer("sandbox.address_space_max_bytes"),
                cpu_seconds_max=configuration.integer("sandbox.cpu_seconds_max"),
                file_size_max_bytes=configuration.integer("sandbox.file_size_max_bytes"),
                output_max_bytes=configuration.integer("sandbox.output_max_bytes"),
                wrappers=_wrappers(configuration),
            ),
        ),
        stacks=load_stacks(configuration, "stacks"),
        doors=Doors(
            plan=PlanStep(
                policy=configuration.string("plan.policy"),
                # The branch is named by the caller: the door does not assume where in
                # the document it lives.
                ai=load_build_plan_ai(configuration, "plan"),
            ),
            write=WriteStep(
                policy=configuration.string("write.policy"),
                ai=load_write_file_ai(configuration, "write"),
            ),
            repair=RepairStep(
                policy=configuration.string("repair.policy"),
                ai=load_repair_file_ai(configuration, "repair"),
            ),
            readme=ReadmeStep(
                policy=configuration.string("readme.policy"),
                ai=load_build_readme_ai(configuration, "readme"),
            ),
        ),
    )


# The profiles a build runs under. Both are required: a profile that is missing is not
# a build that runs unconfined — it is a subsystem that does not start. This is the one
# place in the developer where absence is refused rather than accepted, and the reason
# is that the absent thing here is the confinement itself.
PROFILES = ("closed", "preparation")


def _wrappers(configuration) -> dict[str, list[str]]:
    wrappers = {}
    for profile in PROFILES:
        path = f"sandbox.profiles.{profile}.wrapper"
        wrapper = configuration.get(path)
        if not isinstance(wrapper, list) or not wrapper or not all(
            isinstance(part, str) and part for part in wrapper
        ):
            raise ConfigurationError(
                f"configuration of {configuration.subsystem}: {path} is not a non-empty "
                f"list of strings: {wrapper!r}"
            )
        wrappers[profile] = list(wrapper)
    return wrappers


def _root(configuration, path: str) -> Path:
    """The builds root, which has to be an absolute path and has to exist.

    Absolute because a relative one would be read against whatever directory the
    process happens to have been started in, and the sandbox profile is handed the same
    string: the two would then confine different places. It is created if it is not
    there, because a root that does not exist yet is not a wrong configuration — but a
    root that is a file, or that cannot be made, is.
    """
    root = Path(configuration.string(path))
    if not root.is_absolute():
        raise ConfigurationError(
            f"configuration of {configuration.subsystem}: {path} is not an absolute path: {root}"
        )
    try:
        root.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        raise ConfigurationError(
            f"configuration of {configuration.subsystem}: {path} cannot be used as the "
            f"builds root ({type(error).__name__} {error})"
        ) from error
    if not root.is_dir():
        raise ConfigurationError(
            f"configuration of {configuration.subsystem}: {path} is not a directory: {root}"
        )
    return root


def load_settings() -> Settings:
    bootstrap = read_bootstrap()
    return settings_from(read_configuration(SUBSYSTEM, bootstrap).document, bootstrap)
