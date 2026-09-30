"""What a communication has to carry, and what is refused without it.

    uv run pytest
"""

import logging
import os

os.environ.update(
    {
        "WEBTOOLS_ANAGRAPHICS_URL": "http://127.0.0.1:9199",
        "WEBTOOLS_CONFIGURATION_TIMEOUT_MS": "500",
    }
)

CONFIGURATION = {
    "subsystem": "comm-center",
    "listen": {"host": "127.0.0.1", "port": 9002},
    "access": {"allowed_ips": ["127.0.0.1", "::1"]},
    "limits": {"body_max_bytes": 8192},
    "subsystems_infos": {
        "anagraphics": {"timeout_ms": 500},
        "metrics": {"url": "http://127.0.0.1:9600", "timeout_ms": 500},
    },
    "metrics": {"log_failures": False, "pending_max": 100},
}

import webtools_comm_center.settings as settings_module  # noqa: E402
from webtools_comm_center.commons.configuration_client import Configuration  # noqa: E402

settings_module.read_configuration = lambda subsystem, bootstrap: Configuration(
    subsystem, CONFIGURATION
)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from webtools_comm_center import main  # noqa: E402

LOCALHOST = ("127.0.0.1", 50000)
OUTSIDER = ("10.0.0.1", 50000)
PROJECT = "1f251606-bdba-40c4-bbee-bfedc6e57f70"
DRIVER = {"uid": "aaaa", "screen_name": "Dome", "username": "dome@example.test"}

ROUTE = "/communications/analysis-ready"


@pytest.fixture
def client():
    return TestClient(main.app, client=LOCALHOST)


def test_a_communication_is_taken_and_not_delivered(client):
    """`202`, because nothing is delivered: there is no channel in this repository
    yet, and the route exists to fix the shape of the call, not to send."""
    response = client.post(ROUTE, json={"project_id": PROJECT, "driver": DRIVER})
    assert response.status_code == 202
    assert response.json() == {"taken": True}


def test_it_says_who_it_is_for_and_what_it_is_about(client, caplog):
    with caplog.at_level(logging.INFO, logger="webtools_comm_center"):
        client.post(ROUTE, json={"project_id": PROJECT, "driver": DRIVER})
    written = caplog.text
    assert DRIVER["screen_name"] in written
    assert DRIVER["username"] in written
    assert PROJECT in written


@pytest.mark.parametrize(
    "incomplete",
    [
        {"project_id": PROJECT},
        {"driver": DRIVER},
        {"project_id": PROJECT, "driver": {"uid": "aaaa", "screen_name": "Dome"}},
        {"project_id": PROJECT, "driver": {"uid": "aaaa", "username": "d@e.test"}},
        {"project_id": "", "driver": DRIVER},
    ],
)
def test_a_communication_missing_something_is_refused_not_half_sent(client, incomplete):
    """This is what one route per form of communication buys. A single route with a
    `kind` field could not refuse these: what has to arrive would depend on the kind,
    and nothing would be checking."""
    response = client.post(ROUTE, json=incomplete)
    assert response.status_code == 400
    assert response.json() == {"error": "INVALID_BODY"}


def test_nothing_is_looked_up_to_send_it(client):
    """Anagraphics is pointed at a port nothing listens on. The call goes through, so
    nothing was fetched: the caller carries who the driver is, which is why the
    project keeps a copy of them."""
    assert client.post(ROUTE, json={"project_id": PROJECT, "driver": DRIVER}).status_code == 202


def test_an_address_outside_the_pool_gets_the_contract_s_error():
    response = TestClient(main.app, client=OUTSIDER).post(
        ROUTE, json={"project_id": PROJECT, "driver": DRIVER}
    )
    assert response.status_code == 403
    assert response.json() == {"error": "IP_NOT_ALLOWED"}


def test_the_logger_is_actually_switched_on():
    """`caplog` captures whatever the logger is asked to write, handlers or not: the
    first real call answered 202 and wrote nothing, and every test here still passed.
    This one asks the question the tests above cannot."""
    assert logging.getLogger("webtools_comm_center").isEnabledFor(logging.INFO)


ALPHA_TEST = "/communications/alpha-test-ready"


def test_a_built_webtool_waiting_to_be_tried_is_taken(client):
    """Its own form and not one of `analysis-ready`: what is waiting is a tool that
    runs, not a document to read."""
    response = client.post(
        ALPHA_TEST, json={"project_id": PROJECT, "driver": DRIVER, "documented": True}
    )
    assert response.status_code == 202
    assert response.json() == {"taken": True}


def test_the_driver_is_told_when_a_build_came_without_its_readme(client, caplog):
    """A build is not thrown away over a README that did not come back, and the driver
    is the one person who can ask for it before the demo."""
    with caplog.at_level(logging.INFO, logger="webtools_comm_center"):
        client.post(
            ALPHA_TEST, json={"project_id": PROJECT, "driver": DRIVER, "documented": False}
        )
    assert "with no README" in caplog.text


@pytest.mark.parametrize(
    "incomplete",
    [
        {"project_id": PROJECT, "driver": DRIVER},
        {"project_id": PROJECT, "documented": True},
        {"driver": DRIVER, "documented": True},
    ],
)
def test_a_built_webtool_communication_missing_something_is_refused(client, incomplete):
    response = client.post(ALPHA_TEST, json=incomplete)
    assert response.status_code == 400
    assert response.json() == {"error": "INVALID_BODY"}


CLIENT = {"uid": "bbbb", "screen_name": "Anna", "username": "anna@example.test"}

STOPPED = "/communications/project-stopped"
REFUSED = "/communications/analysis-refused"
LOST = "/communications/turns-lost"

REASON = "The request is a shop, and that is not a webtool."


def test_a_stopped_project_is_taken(client):
    response = client.post(STOPPED, json={"project_id": PROJECT, "client": CLIENT})
    assert response.status_code == 202
    assert response.json() == {"taken": True}


def test_a_stopped_project_says_who_it_is_for_and_which_project(client, caplog):
    with caplog.at_level(logging.INFO, logger="webtools_comm_center"):
        client.post(STOPPED, json={"project_id": PROJECT, "client": CLIENT})
    written = caplog.text
    assert CLIENT["screen_name"] in written
    assert CLIENT["username"] in written
    assert PROJECT in written


def test_a_refusal_carries_the_motivation(client, caplog):
    """The motivation is the whole of what the client is owed at that gate: a refusal
    that arrived without it would be this communication sent empty."""
    with caplog.at_level(logging.INFO, logger="webtools_comm_center"):
        response = client.post(
            REFUSED, json={"project_id": PROJECT, "client": CLIENT, "reason": REASON}
        )
    assert response.status_code == 202
    assert REASON in caplog.text


def test_lost_turns_say_how_many(client, caplog):
    with caplog.at_level(logging.INFO, logger="webtools_comm_center"):
        response = client.post(
            LOST, json={"project_id": PROJECT, "client": CLIENT, "turns": 3}
        )
    assert response.status_code == 202
    assert "3 turn" in caplog.text
    assert CLIENT["username"] in caplog.text


@pytest.mark.parametrize(
    ("route", "incomplete"),
    [
        (STOPPED, {"project_id": PROJECT}),
        (STOPPED, {"client": CLIENT}),
        (STOPPED, {"project_id": PROJECT, "client": {"uid": "bbbb", "screen_name": "Anna"}}),
        (REFUSED, {"project_id": PROJECT, "client": CLIENT}),
        (REFUSED, {"project_id": PROJECT, "client": CLIENT, "reason": ""}),
        (LOST, {"project_id": PROJECT, "client": CLIENT}),
        (LOST, {"project_id": PROJECT, "client": CLIENT, "turns": 0}),
        (LOST, {"project_id": PROJECT, "client": CLIENT, "turns": -2}),
    ],
)
def test_each_form_refuses_what_it_cannot_say(client, route, incomplete):
    response = client.post(route, json=incomplete)
    assert response.status_code == 400
    assert response.json() == {"error": "INVALID_BODY"}
