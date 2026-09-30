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

# Level 1 upwards may supervise; level 0 may not. `active` is the person's, and a
# person who cannot log in cannot supervise whatever their level says.
SUPERVISING = {"uid": "aaaa", "screen_name": "Dome", "level": 1, "active": True}
ALSO_SUPERVISING = {"uid": "bbbb", "screen_name": "Test", "level": 1, "active": True}
TOO_LOW = {"uid": "cccc", "screen_name": "New", "level": 0, "active": True}
DEACTIVATED = {"uid": "dddd", "screen_name": "Gone", "level": 1, "active": False}
# A prj-admin. Nothing in this subsystem knows what that means beyond the number: it is
# above the threshold, so the pool may hand them a project.
PRJ_ADMIN = {"uid": "eeee", "screen_name": "Admin", "level": 2, "active": True}


@pytest.fixture
def client():
    return TestClient(main.app, client=LOCALHOST)


def drivers_are(monkeypatch, answer: Answer) -> None:
    monkeypatch.setattr(main.anagraphics, "list_drivers", lambda settings: answer)


def choose(client) -> dict:
    return client.post("/drivers/choice", json={"project_id": PROJECT})


def test_a_driver_is_chosen_among_those_who_may_supervise(monkeypatch, client):
    drivers_are(monkeypatch, Answer(ok=True, data=[SUPERVISING, ALSO_SUPERVISING]))
    response = choose(client)
    assert response.status_code == 200
    assert response.json()["driver_uid"] in {"aaaa", "bbbb"}


def test_a_level_below_the_threshold_is_never_chosen(monkeypatch, client):
    """Only a driver from level 1 upwards supervises a client's project. It is a rule of
    the service, not of this file, so handing back somebody who has not been interviewed
    would be wrong now and not later."""
    drivers_are(monkeypatch, Answer(ok=True, data=[TOO_LOW, SUPERVISING]))
    for _ in range(20):
        assert choose(client).json()["driver_uid"] == "aaaa"


def test_a_deactivated_driver_is_never_chosen(monkeypatch, client):
    """Their level says they may, and they cannot log in: a project handed to them would
    sit still with nobody noticing."""
    drivers_are(monkeypatch, Answer(ok=True, data=[DEACTIVATED, SUPERVISING]))
    for _ in range(20):
        assert choose(client).json()["driver_uid"] == "aaaa"


def test_a_level_above_the_threshold_may_be_chosen(monkeypatch, client):
    """This subsystem reads the number and not what a level is called: a level it has
    never heard of, above the threshold, supervises."""
    drivers_are(monkeypatch, Answer(ok=True, data=[PRJ_ADMIN]))
    assert choose(client).json()["driver_uid"] == "eeee"


def test_a_level_that_is_not_a_number_is_not_a_level(monkeypatch, client):
    """In Python a bool is an int. `level: true` is a broken document, not level 1, and
    it must not get a project."""
    broken = [
        {"uid": "ffff", "screen_name": "Bool", "level": True, "active": True},
        {"uid": "gggg", "screen_name": "String", "level": "1", "active": True},
        {"uid": "hhhh", "screen_name": "Missing", "active": True},
    ]
    drivers_are(monkeypatch, Answer(ok=True, data=broken))
    assert choose(client).status_code == 409


def test_nobody_who_may_supervise_is_a_state_of_the_system_and_not_a_failure(monkeypatch, client):
    """The caller has to be able to tell it from anagraphics being down: in one case
    asking again in a minute may work, in the other it never will."""
    drivers_are(monkeypatch, Answer(ok=True, data=[TOO_LOW]))
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


def test_the_choice_is_spread_over_those_who_may_supervise(monkeypatch, client):
    """Not a test of randomness, which cannot be tested: a test that the second driver
    is reachable at all. A pool that always returned the first one would pass every
    other test here."""
    drivers_are(monkeypatch, Answer(ok=True, data=[SUPERVISING, ALSO_SUPERVISING]))
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
