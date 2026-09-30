"""Running a command of a build, for real.

These are not tests with a fake in them: they start processes. Confinement is the one
thing in this subsystem that cannot be verified by reading the code — a profile that
allows what it should deny reads exactly like one that does not — so the tests that
matter here run the real wrapper with the real profiles and try to get out.

The ones that do that are skipped where the wrapper is not on this machine, because the
wrapper is a path in a configuration and another machine's is something else.

    uv run pytest
"""

import copy
import json
import shutil
from dataclasses import replace
from pathlib import Path

import pytest

from tests.test_settings import BOOTSTRAP, CONFIGURATION
from webtools_developer import sandbox
from webtools_developer.commons.configuration_client import Bootstrap
from webtools_developer.settings import settings_from

SEED = Path(__file__).resolve().parent.parent.parent / "configurator" / "configuration" / "developer.json"


class Measurements(list):
    def measure(self, metric, **fields):
        self.append({"metric": metric, **fields})

    def timer(self):
        return lambda: 0


def _settings(document):
    return replace(settings_from(document, BOOTSTRAP), metrics=Measurements())


@pytest.fixture
def plain(tmp_path):
    """Settings whose wrappers run the command and confine nothing.

    `/usr/bin/env` puts nothing in the way, which is what these tests want: they are
    about how a command's outcome is read, not about what it is allowed to do.
    """
    document = copy.deepcopy(CONFIGURATION)
    document["build"]["root"] = str(tmp_path)
    document["sandbox"]["profiles"] = {
        "closed": {"wrapper": ["/usr/bin/env"]},
        "preparation": {"wrapper": ["/usr/bin/env"]},
    }
    return _settings(document)


@pytest.fixture
def confined():
    """Settings exactly as the seed configures them: the real wrapper, the real
    profiles, the real builds root."""
    if not SEED.exists():
        pytest.skip("the configuration seed is not here")
    document = json.loads(SEED.read_text())
    document["subsystem"] = "developer"
    for door in ("plan", "write", "repair", "readme"):
        document[door]["providers"]["anthropic"]["api_key"] = "sk-test"
    settings = _settings(document)
    # Only the wrapper decides whether these tests can run. `usable` also reports the
    # ceilings this kernel will not apply, which is worth saying at startup and is not
    # a reason to skip a test about confinement.
    for wrapper in settings.build.sandbox.wrappers.values():
        if not Path(wrapper[0]).exists():
            pytest.skip(f"the sandbox wrapper {wrapper[0]} is not on this machine")
    return settings


@pytest.fixture
def area(confined):
    directory = confined.build.root / "a-test-of-the-sandbox"
    if directory.exists():
        shutil.rmtree(directory)
    directory.mkdir(parents=True)
    yield directory
    shutil.rmtree(directory, ignore_errors=True)


# ------------------------------------------------------- how an outcome is read


def test_a_command_that_is_satisfied(plain, tmp_path):
    outcome = sandbox.run(
        plain, directory=tmp_path, command=["/usr/bin/true"], profile=sandbox.CLOSED
    )
    assert outcome.ended == "exited"
    assert outcome.code == 0
    assert outcome.accepted


def test_a_command_that_refuses_what_it_was_given(plain, tmp_path):
    """The ordinary failing check: it ran, it said no, and what it printed is what the
    repair door reads."""
    outcome = sandbox.run(
        plain,
        directory=tmp_path,
        command=["/bin/sh", "-c", "echo 'it is broken on line 3' >&2; exit 3"],
        profile=sandbox.CLOSED,
    )
    assert outcome.ended == "exited"
    assert outcome.code == 3
    assert not outcome.accepted
    # Both streams together: a command's complaint may come out of either.
    assert "broken on line 3" in outcome.output


def test_a_command_that_never_finishes_is_stopped(plain, tmp_path):
    settings = replace(
        plain, build=replace(plain.build, sandbox=replace(plain.build.sandbox, timeout_ms=500))
    )
    outcome = sandbox.run(
        settings, directory=tmp_path, command=["/bin/sh", "-c", "sleep 30"], profile=sandbox.CLOSED
    )
    assert outcome.ended == "timed_out"
    assert outcome.code is None
    assert not outcome.accepted


def test_a_command_that_is_not_there_is_not_a_file_that_is_wrong(plain, tmp_path):
    """Three outcomes and not one boolean: a build must never report that a file is
    broken because a runtime is not installed."""
    outcome = sandbox.run(
        plain,
        directory=tmp_path,
        command=["/usr/local/bin/a-runtime-nobody-installed"],
        profile=sandbox.CLOSED,
    )
    assert outcome.ended == "could_not_start"
    assert outcome.code is None


def test_an_unknown_profile_runs_nothing(plain, tmp_path):
    """A profile this code does not know is a bug in this code, and the safe reading of
    a bug about confinement is that nothing runs."""
    marker = tmp_path / "it-ran"
    outcome = sandbox.run(
        plain,
        directory=tmp_path,
        command=["/usr/bin/touch", str(marker)],
        profile="half-open",
    )
    assert outcome.ended == "could_not_start"
    assert not marker.exists()


def test_a_long_output_keeps_its_end(plain, tmp_path):
    """The end, because a parser says where it stopped on its last line and a stack
    trace ends with the frame that matters."""
    settings = replace(
        plain,
        build=replace(plain.build, sandbox=replace(plain.build.sandbox, output_max_bytes=200)),
    )
    outcome = sandbox.run(
        settings,
        directory=tmp_path,
        command=["/bin/sh", "-c", "for i in $(seq 1 500); do echo padding; done; echo THE-LAST-LINE"],
        profile=sandbox.CLOSED,
    )
    assert outcome.cut
    assert "THE-LAST-LINE" in outcome.output
    assert len(outcome.output.encode("utf-8")) < 400


def test_the_environment_is_built_and_not_inherited(plain, tmp_path, monkeypatch):
    """Whatever is in the developer's own environment — a key, a token, a proxy — is not
    a build's business."""
    monkeypatch.setenv("A_SECRET_OF_OURS", "sk-do-not-leak")
    outcome = sandbox.run(
        plain, directory=tmp_path, command=["/usr/bin/env"], profile=sandbox.CLOSED
    )
    assert "sk-do-not-leak" not in outcome.output
    assert f"HOME={tmp_path}" in outcome.output


def test_a_command_that_stays_up_passes(plain, tmp_path):
    outcome = sandbox.stays_up(
        plain, directory=tmp_path, command=["/bin/sh", "-c", "sleep 30"], settle_ms=400
    )
    assert outcome.ended == "timed_out"


def test_a_command_that_stops_by_itself_did_not_stay_up(plain, tmp_path):
    """A `0` is a failure of this check too, in the sense that matters: what was
    supposed to be serving is not."""
    outcome = sandbox.stays_up(
        plain,
        directory=tmp_path,
        command=["/bin/sh", "-c", "echo 'port already in use' >&2; exit 0"],
        settle_ms=3000,
    )
    assert outcome.ended == "exited"
    assert outcome.code == 0
    assert "port already in use" in outcome.output


# ------------------------------------------------------------- what is confined


def test_the_closed_profile_denies_the_network(confined, area):
    """The whole reason there are two profiles."""
    outcome = sandbox.run(
        confined,
        directory=area,
        command=[
            "/usr/bin/python3",
            "-c",
            "import socket; socket.create_connection(('1.1.1.1', 443), 2)",
        ],
        profile=sandbox.CLOSED,
    )
    assert not outcome.accepted
    assert "PermissionError" in outcome.output or "Operation not permitted" in outcome.output


def test_the_closed_profile_denies_writing_outside_the_builds_root(confined, area):
    escaped = Path.home() / "escaped-from-a-build.txt"
    outcome = sandbox.run(
        confined,
        directory=area,
        command=["/usr/bin/python3", "-c", f"open({str(escaped)!r}, 'w').write('x')"],
        profile=sandbox.CLOSED,
    )
    assert not outcome.accepted
    assert not escaped.exists()


def test_the_closed_profile_denies_reading_the_keys(confined, area):
    """The keys are on this machine and the code being checked was written by a model."""
    secrets = Path(__file__).resolve().parent.parent.parent / "configurator" / "secrets"
    outcome = sandbox.run(
        confined,
        directory=area,
        command=["/usr/bin/python3", "-c", f"import os; print(os.listdir({str(secrets)!r}))"],
        profile=sandbox.CLOSED,
    )
    assert not outcome.accepted


def test_a_build_may_write_inside_its_own_directory(confined, area):
    outcome = sandbox.run(
        confined,
        directory=area,
        command=["/usr/bin/python3", "-c", "open('written-by-a-build.txt', 'w').write('x')"],
        profile=sandbox.CLOSED,
    )
    assert outcome.accepted
    assert (area / "written-by-a-build.txt").exists()
