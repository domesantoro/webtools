"""What the subsystem refuses to start without.

No server is needed here: `settings_from` takes a configuration document already in
hand, which is the whole reason it is kept apart from the reading.

    uv run pytest
"""

import copy

import pytest

from webtools_developer.commons.configuration_client import Bootstrap, ConfigurationError
from webtools_developer.settings import settings_from

BOOTSTRAP = Bootstrap(anagraphics_url="http://127.0.0.1:9900", configuration_timeout_ms=500)

# Somewhere no test writes and nothing else reads: the builds root is created when the
# settings are built, so it must not be the real one.
ROOT = "/tmp/webtools-developer-tests/builds"


def door(policy: str, tokens: int = 32000) -> dict:
    return {
        "provider": "anthropic",
        "timeout_ms": 600000,
        "max_attempts": 3,
        "providers": {
            "anthropic": {
                "model": "claude-opus-5-5",
                "max_tokens": tokens,
                "effort": "high",
                # Deep-merged from configurator/secrets/developer.json, which is
                # outside git. Below this point it is a field like any other.
                "api_key": "sk-test",
            }
        },
        "policy": policy,
    }


# The same document the seed produces (webtools/configurator/configuration/developer.json),
# plus the `subsystem` key anagraphics adds when it serves it.
CONFIGURATION = {
    "subsystem": "developer",
    "listen": {"host": "127.0.0.1", "port": 9101},
    "access": {"allowed_ips": ["127.0.0.1", "::1"]},
    "limits": {"body_max_bytes": 8192},
    "subsystems_infos": {
        "anagraphics": {"timeout_ms": 5000},
        "workspaces": {"url": "http://127.0.0.1:9400", "timeout_ms": 5000},
        "comm_center": {"url": "http://127.0.0.1:9002", "timeout_ms": 5000},
        "metrics": {"url": "http://127.0.0.1:9600", "timeout_ms": 2000},
    },
    "metrics": {"log_failures": False, "pending_max": 1000},
    "build": {
        "root": ROOT,
        "limits": {
            "files_max": 60,
            "file_max_bytes": 262144,
            "attempts_per_file_max": 3,
            "attempts_total_max": 60,
            "duration_max_ms": 10800000,
        },
    },
    "sandbox": {
        "path": "/usr/local/bin:/usr/bin:/bin",
        "timeout_ms": 300000,
        "address_space_max_bytes": 6442450944,
        "cpu_seconds_max": 240,
        "file_size_max_bytes": 268435456,
        "output_max_bytes": 65536,
        "profiles": {
            "closed": {"wrapper": ["/usr/bin/true", "-f", "closed.sb"]},
            "preparation": {"wrapper": ["/usr/bin/true", "-f", "preparation.sb"]},
        },
    },
    "stacks": {
        # One stack with everything, and one with almost nothing. Both are legitimate,
        # and the second is the one that catches code written for the first.
        "web": {
            "prepare": ["/usr/local/bin/npm", "install"],
            "checks": {"javascript": ["/usr/local/bin/node", "--check"]},
            "whole": ["/usr/local/bin/npm", "test"],
            "start": {"command": ["/usr/local/bin/npm", "start"], "settle_ms": 4000},
        },
        "page": {"checks": {"json": ["/usr/bin/python3", "-c", "pass"]}},
    },
    "plan": door("build-plan-v1"),
    "write": door("write-file-v1"),
    "repair": door("repair-file-v1"),
    "readme": door("build-readme-v1"),
}


def without(*path):
    """The configuration with one field taken out."""
    document = copy.deepcopy(CONFIGURATION)
    branch = document
    for key in path[:-1]:
        branch = branch[key]
    del branch[path[-1]]
    return document


def test_the_whole_configuration_builds_the_settings():
    settings = settings_from(copy.deepcopy(CONFIGURATION), BOOTSTRAP)
    assert settings.port == 9101
    assert settings.stacks.names() == ["web", "page"]
    assert settings.doors.plan.policy == "build-plan-v1"
    # The address of anagraphics is the bootstrap's, never the document's.
    assert settings.anagraphics.url == "http://127.0.0.1:9900"


@pytest.mark.parametrize(
    "path",
    [
        ("listen", "port"),
        ("access", "allowed_ips"),
        ("limits", "body_max_bytes"),
        ("subsystems_infos", "workspaces"),
        ("subsystems_infos", "comm_center"),
        ("metrics", "pending_max"),
        ("build", "root"),
        ("build", "limits", "files_max"),
        ("build", "limits", "attempts_per_file_max"),
        ("build", "limits", "duration_max_ms"),
        ("sandbox", "path"),
        ("sandbox", "timeout_ms"),
        ("sandbox", "output_max_bytes"),
        ("stacks",),
        ("plan", "policy"),
        ("plan", "providers"),
        ("write", "policy"),
        ("repair", "policy"),
        ("readme", "policy"),
    ],
)
def test_a_missing_field_stops_the_subsystem(path):
    """No defaults. Every one of these is a field somebody has to have decided."""
    with pytest.raises(ConfigurationError):
        settings_from(without(*path), BOOTSTRAP)


@pytest.mark.parametrize("profile", ["closed", "preparation"])
def test_a_profile_with_no_wrapper_stops_the_subsystem(profile):
    """The one place in the developer where absence is refused rather than accepted.

    Everywhere else a missing step means that step does not exist for that stack. Here
    the missing thing is the confinement itself, and a developer that started without
    it would run generated code on this machine unconfined.
    """
    with pytest.raises(ConfigurationError) as refused:
        settings_from(without("sandbox", "profiles", profile), BOOTSTRAP)
    assert profile in str(refused.value)


def test_a_wrapper_that_is_not_a_list_of_words_stops_the_subsystem():
    document = copy.deepcopy(CONFIGURATION)
    document["sandbox"]["profiles"]["closed"]["wrapper"] = "/usr/bin/sandbox-exec -f closed.sb"
    with pytest.raises(ConfigurationError):
        settings_from(document, BOOTSTRAP)


def test_no_stacks_at_all_stops_the_subsystem():
    """A developer with nothing to build with cannot build anything, and it is better
    said at startup than at the first trigger."""
    document = copy.deepcopy(CONFIGURATION)
    document["stacks"] = {}
    with pytest.raises(ConfigurationError) as refused:
        settings_from(document, BOOTSTRAP)
    assert "stacks" in str(refused.value)


def test_a_relative_builds_root_stops_the_subsystem():
    """It would be read against whatever directory the process was started in, and the
    sandbox profile is handed the same string: the two would confine different places."""
    document = copy.deepcopy(CONFIGURATION)
    document["build"]["root"] = "builds"
    with pytest.raises(ConfigurationError):
        settings_from(document, BOOTSTRAP)


def test_an_unknown_provider_on_a_door_stops_the_subsystem():
    document = copy.deepcopy(CONFIGURATION)
    document["write"]["provider"] = "a-provider-we-do-not-have"
    with pytest.raises(ConfigurationError) as refused:
        settings_from(document, BOOTSTRAP)
    assert "write.provider" in str(refused.value)


def test_an_effort_that_is_not_a_level_stops_the_subsystem():
    """Absent and wrong are different things: unwritten means the model decides, written
    must be one of the levels, because a typo is a typo either way."""
    document = copy.deepcopy(CONFIGURATION)
    document["plan"]["providers"]["anthropic"]["effort"] = "very-high"
    with pytest.raises(ConfigurationError):
        settings_from(document, BOOTSTRAP)


def test_an_effort_left_out_is_left_out():
    document = copy.deepcopy(CONFIGURATION)
    del document["plan"]["providers"]["anthropic"]["effort"]
    settings = settings_from(document, BOOTSTRAP)
    assert settings.doors.plan.ai.configuration["effort"] is None
