"""What the subsystem refuses to start without.

No server is needed here: `settings_from` takes a configuration document already in
hand, which is the whole reason it is kept apart from the reading.

    uv run pytest
"""

import copy

import pytest

from webtools_analyst.commons.configuration_client import Bootstrap, ConfigurationError
from webtools_analyst.settings import settings_from

BOOTSTRAP = Bootstrap(anagraphics_url="http://127.0.0.1:9100", configuration_timeout_ms=500)

# The same document the seed produces (webtools/configurator/configuration/analyst.json),
# plus the `subsystem` key anagraphics adds when it serves it.
CONFIGURATION = {
    "subsystem": "analyst",
    "listen": {"host": "127.0.0.1", "port": 9800},
    "access": {"allowed_ips": ["127.0.0.1", "::1"]},
    "limits": {"body_max_bytes": 8192},
    "subsystems_infos": {
        "anagraphics": {"timeout_ms": 5000},
        "workspaces": {"url": "http://127.0.0.1:9400", "timeout_ms": 5000},
        "drivers_pool": {"url": "http://127.0.0.1:9001", "timeout_ms": 5000},
        "comm_center": {"url": "http://127.0.0.1:9002", "timeout_ms": 5000},
        "metrics": {"url": "http://127.0.0.1:9600", "timeout_ms": 2000},
    },
    "metrics": {"log_failures": False, "pending_max": 1000},
    "handover": {"max_attempts": 3},
    "i18n": {"locales": ["en", "it"], "fallback_locale": "en"},
    "analysis": {
        "technical": {
            "provider": "anthropic",
            "timeout_ms": 600000,
            "max_attempts": 3,
            "providers": {
                "anthropic": {
                    "model": "claude-opus-5",
                    "max_tokens": 32000,
                    "effort": "high",
                    # Deep-merged from configurator/secrets/analyst.json, which is
                    # outside git. Below this point it is a field like any other.
                    "api_key": "sk-test",
                }
            },
            "policy": "analysis-technical-v1",
            "stack_preferences": {
                "web": {"language": "JavaScript, Node.js 22 LTS", "store": "SQLite"}
            },
        },
        "judgement": {
            "provider": "anthropic",
            "timeout_ms": 600000,
            "max_attempts": 3,
            "providers": {
                "anthropic": {
                    "model": "claude-opus-5",
                    "max_tokens": 16000,
                    "effort": "high",
                    "api_key": "sk-test",
                }
            },
            "policy": "analysis-sustainability-v1",
            "take_on_threshold": 0.5,
        },
        "points": {
            "provider": "anthropic",
            "timeout_ms": 600000,
            "max_attempts": 3,
            "providers": {
                "anthropic": {
                    "model": "claude-opus-5",
                    "max_tokens": 16000,
                    "effort": "medium",
                    "api_key": "sk-test",
                }
            },
            "policy": "functional-points-v1",
        },
    },
}


def document(**changes) -> dict:
    """A copy of the seed, with something taken out or replaced.

    `changes` is keyed by dotted path, as the configuration is read: a value of
    `None` removes the field instead of setting it, which is how a missing field is
    written here.
    """
    result = copy.deepcopy(CONFIGURATION)
    for path, value in changes.items():
        keys = path.split(".")
        holder = result
        for key in keys[:-1]:
            holder = holder[key]
        if value is None:
            del holder[keys[-1]]
        else:
            holder[keys[-1]] = value
    return result


def test_the_seed_starts_the_subsystem():
    settings = settings_from(CONFIGURATION, BOOTSTRAP)
    assert settings.host == "127.0.0.1"
    assert settings.port == 9800
    assert settings.allowed_ips == frozenset({"127.0.0.1", "::1"})
    assert settings.body_max_bytes == 8192
    assert settings.workspaces.url == "http://127.0.0.1:9400"
    assert settings.workspaces.timeout_ms == 5000


def test_where_anagraphics_is_comes_from_the_bootstrap_not_the_document():
    """The document says how long to wait for anagraphics, never where it is.

    Where it is had to be known before this document could be fetched at all, so
    there is one copy of it and it is in the environment.
    """
    settings = settings_from(CONFIGURATION, BOOTSTRAP)
    assert settings.anagraphics.url == "http://127.0.0.1:9100"
    assert settings.anagraphics.timeout_ms == 5000
    assert "url" not in CONFIGURATION["subsystems_infos"]["anagraphics"]


@pytest.mark.parametrize(
    "path",
    [
        "listen.host",
        "listen.port",
        "access.allowed_ips",
        "limits.body_max_bytes",
        "subsystems_infos.anagraphics.timeout_ms",
        "subsystems_infos.workspaces.url",
        "subsystems_infos.workspaces.timeout_ms",
        "subsystems_infos.drivers_pool.url",
        "subsystems_infos.drivers_pool.timeout_ms",
        "subsystems_infos.comm_center.url",
        "subsystems_infos.comm_center.timeout_ms",
        "handover.max_attempts",
        "subsystems_infos.metrics.url",
        "subsystems_infos.metrics.timeout_ms",
        "metrics.log_failures",
        "metrics.pending_max",
        "i18n.locales",
        "i18n.fallback_locale",
        "analysis.technical.provider",
        "analysis.technical.timeout_ms",
        "analysis.technical.max_attempts",
        "analysis.technical.policy",
        "analysis.technical.stack_preferences",
        "analysis.technical.providers.anthropic.model",
        "analysis.technical.providers.anthropic.max_tokens",
        "analysis.technical.providers.anthropic.api_key",
        "analysis.judgement.provider",
        "analysis.judgement.timeout_ms",
        "analysis.judgement.max_attempts",
        "analysis.judgement.policy",
        "analysis.judgement.take_on_threshold",
        "analysis.judgement.providers.anthropic.model",
        "analysis.judgement.providers.anthropic.max_tokens",
        "analysis.judgement.providers.anthropic.api_key",
        "analysis.points.provider",
        "analysis.points.timeout_ms",
        "analysis.points.max_attempts",
        "analysis.points.policy",
        "analysis.points.providers.anthropic.model",
        "analysis.points.providers.anthropic.max_tokens",
        "analysis.points.providers.anthropic.api_key",
    ],
)
def test_a_missing_field_stops_the_start(path):
    """Every field, one at a time. There are no default values: a subsystem that
    cannot read a field does not invent one, it refuses to start, and the message
    says which field."""
    with pytest.raises(ConfigurationError) as raised:
        settings_from(document(**{path: None}), BOOTSTRAP)
    assert path in str(raised.value)
    assert "analyst" in str(raised.value)


def test_a_dependency_address_must_be_http():
    """A field that ends up being called is checked for being callable.

    Mongo's own address is not among these: this subsystem has no storage.
    """
    with pytest.raises(ConfigurationError) as raised:
        settings_from(document(**{"subsystems_infos.workspaces.url": "ftp://example.test"}), BOOTSTRAP)
    assert "subsystems_infos.workspaces.url" in str(raised.value)


def test_log_failures_is_a_switch_and_not_a_number():
    """`0` and `1` are not booleans here.

    In Python a bool is an int, so a looser check would let a number through and a
    field meant as a switch would silently take one.
    """
    with pytest.raises(ConfigurationError) as raised:
        settings_from(document(**{"metrics.log_failures": 0}), BOOTSTRAP)
    assert "metrics.log_failures" in str(raised.value)


def test_a_provider_the_door_does_not_have_stops_the_start():
    """Named in the configuration, absent from the door's registry.

    Caught at startup and not at the first call: the first call is a client's
    project, and finding out then costs that project."""
    with pytest.raises(ConfigurationError) as raised:
        settings_from(document(**{"analysis.technical.provider": "jev"}), BOOTSTRAP)
    assert "analysis.technical.provider" in str(raised.value)
    assert "jev" in str(raised.value)


def test_effort_may_be_left_out_but_not_invented():
    """Not every model has the notion of how much it may think.

    Left out, nothing is sent and the model decides for itself — absent is absent,
    not a value we chose. Written, it has to be one of the levels: a typo is a typo
    whether or not the field was optional.
    """
    without = settings_from(document(**{"analysis.technical.providers.anthropic.effort": None}), BOOTSTRAP)
    assert without.analysis.technical.ai.configuration["effort"] is None

    with pytest.raises(ConfigurationError) as raised:
        settings_from(document(**{"analysis.technical.providers.anthropic.effort": "enormous"}), BOOTSTRAP)
    assert "effort" in str(raised.value)


def test_only_the_chosen_provider_s_section_is_read():
    """A section belonging to a provider that is not in use is never looked at, so it
    can be half-written without stopping the subsystem."""
    half_written = document()
    half_written["analysis"]["technical"]["providers"]["jev"] = {"endpoint": ""}
    settings = settings_from(half_written, BOOTSTRAP)
    assert settings.analysis.technical.ai.provider == "anthropic"
    assert "jev" not in settings.analysis.technical.ai.configuration


def test_the_door_carries_the_policy_and_the_call_s_own_limits():
    door = settings_from(CONFIGURATION, BOOTSTRAP).analysis.technical
    assert door.policy == "analysis-technical-v1"
    assert door.ai.timeout_ms == 600000
    assert door.ai.max_attempts == 3
    assert door.ai.configuration["model"] == "claude-opus-5"


def test_the_two_doors_are_configured_apart():
    """Each has its own provider, its own model and its own key slot. The judgement
    may well end up on a different model from the analysis it reads, and that has to
    be a line of configuration rather than a piece of work."""
    analysis = settings_from(CONFIGURATION, BOOTSTRAP).analysis
    assert analysis.technical.policy != analysis.judgement.policy
    assert analysis.technical.ai is not analysis.judgement.ai
    assert analysis.technical.ai.configuration["max_tokens"] == 32000
    assert analysis.judgement.ai.configuration["max_tokens"] == 16000


def test_a_broken_door_does_not_stop_the_other_from_being_read():
    """They are separate branches on purpose: one configured wrongly is one door
    down, and the message says which."""
    with pytest.raises(ConfigurationError) as raised:
        settings_from(document(**{"analysis.judgement.provider": "jev"}), BOOTSTRAP)
    assert "analysis.judgement.provider" in str(raised.value)
    assert "analysis.technical" not in str(raised.value)


def test_the_threshold_is_a_decimal_and_has_to_be_a_share():
    """Read as an integer it would refuse 0.5; unbounded it would accept 7, and every
    judgement would come back `refuse` with nothing looking wrong."""
    assert settings_from(CONFIGURATION, BOOTSTRAP).analysis.judgement.take_on_threshold == 0.5
    for outside in (7, -0.2):
        with pytest.raises(ConfigurationError) as raised:
            settings_from(document(**{"analysis.judgement.take_on_threshold": outside}), BOOTSTRAP)
        assert "take_on_threshold" in str(raised.value)


def test_the_measurements_are_sent_under_this_subsystem_s_own_name():
    """The subsystem does not name itself to the metrics client: the name is the one
    its configuration was read under, so the two cannot disagree."""
    settings = settings_from(CONFIGURATION, BOOTSTRAP)
    assert settings.metrics._subsystem == "analyst"
    assert settings.metrics.counters() == {"sent": 0, "failed": 0}
