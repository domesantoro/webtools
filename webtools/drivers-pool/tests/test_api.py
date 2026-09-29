"""How a driver is chosen, and what happens when there is nobody to choose.

    uv run pytest
"""

import os

os.environ.update(
    {
        "WEBTOOLS_ANAGRAPHICS_URL": "http://127.0.0.1:9199",
        "WEBTOOLS_CONFIGURATION_TIMEOUT_MS": "500",
    }
)

CONFIGURATION = {
    "subsystem": "drivers-pool",
    "listen": {"host": "127.0.0.1", "port": 9001},
    "access": {"allowed_ips": ["127.0.0.1", "::1"]},
    "limits": {"body_max_bytes": 8192},
    "subsystems_infos": {
        "anagraphics": {"timeout_ms": 500},
        "metrics": {"url": "http://127.0.0.1:9600", "timeout_ms": 500},
    },
    "metrics": {"log_failures": False, "pending_max": 100},
}

import webtools_drivers_pool.settings as settings_module  # noqa: E402
from webtools_drivers_pool.commons.configuration_client import Configuration  # noqa: E402

settings_module.read_configuration = lambda subsystem, bootstrap: Configuration(
    subsystem, CONFIGURATION
)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from webtools_drivers_pool import anagraphics, main  # noqa: E402
from webtools_drivers_pool.anagraphics import Answer  # noqa: E402

LOCALHOST = ("127.0.0.1", 50000)
OUTSIDER = ("10.0.0.1", 50000)
PROJECT = "1f251606-bdba-40c4-bbee-bfedc6e57f70"

ENABLED = {"uid": "aaaa", "screen_name": "Dome", "enabled": True}
ALSO_ENABLED = {"uid": "bbbb", "screen_name": "Prova", "enabled": True}
NOT_ENABLED = {"uid": "cccc", "screen_name": "Nuovo", "enabled": False}


@pytest.fixture
def client():
    return TestClient(main.app, client=LOCALHOST)


def drivers_are(monkeypatch, answer: Answer) -> None:
    monkeypatch.setattr(main.anagraphics, "list_drivers", lambda settings: answer)


def choose(client) -> dict:
    return client.post("/drivers/choice", json={"project_id": PROJECT})


def test_a_driver_is_chosen_among_the_enabled_ones(monkeypatch, client):
    drivers_are(monkeypatch, Answer(ok=True, data=[ENABLED, ALSO_ENABLED]))
    response = choose(client)
    assert response.status_code == 200
    assert response.json()["driver_uid"] in {"aaaa", "bbbb"}


def test_somebody_not_enabled_is_never_chosen(monkeypatch, client):
    """Only enabled drivers supervise clients' projects. It is a rule of the service,
    not of this file, so handing back somebody who has not been interviewed would be
    wrong now and not later."""
    drivers_are(monkeypatch, Answer(ok=True, data=[NOT_ENABLED, ENABLED]))
    for _ in range(20):
        assert choose(client).json()["driver_uid"] == "aaaa"


def test_nobody_enabled_is_a_state_of_the_system_and_not_a_failure(monkeypatch, client):
    """The caller has to be able to tell it from anagraphics being down: in one case
    asking again in a minute may work, in the other it never will."""
    drivers_are(monkeypatch, Answer(ok=True, data=[NOT_ENABLED]))
    response = choose(client)
    assert response.status_code == 409
    assert response.json() == {"error": "NO_DRIVER_AVAILABLE"}


def test_no_drivers_at_all_is_the_same_state(monkeypatch, client):
    drivers_are(monkeypatch, Answer(ok=True, data=[]))
    assert choose(client).json() == {"error": "NO_DRIVER_AVAILABLE"}


def test_anagraphics_down_is_said_and_not_worked_around(monkeypatch, client):
    """The drivers live there. Answering with a driver we made up would put a name on
    a project that nobody answers to."""
    drivers_are(monkeypatch, Answer(ok=False, reason="unavailable"))
    response = choose(client)
    assert response.status_code == 503
    assert response.json() == {"error": "ANAGRAPHICS_UNAVAILABLE"}


def test_the_choice_is_spread_over_the_enabled_ones(monkeypatch, client):
    """Not a test of randomness, which cannot be tested: a test that the second
    enabled driver is reachable at all. A pool that always returned the first one
    would pass every other test here."""
    drivers_are(monkeypatch, Answer(ok=True, data=[ENABLED, ALSO_ENABLED]))
    seen = {choose(client).json()["driver_uid"] for _ in range(60)}
    assert seen == {"aaaa", "bbbb"}


def test_a_project_must_be_named(client):
    """Nothing reads it yet, and it is still required: a driver is chosen **for** a
    project, and every rule that will replace the randomness needs to know which."""
    assert client.post("/drivers/choice", json={}).status_code == 400


def test_an_address_outside_the_pool_gets_the_contract_s_error(client):
    assert TestClient(main.app, client=OUTSIDER).post(
        "/drivers/choice", json={"project_id": PROJECT}
    ).json() == {"error": "IP_NOT_ALLOWED"}
