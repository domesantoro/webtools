"""What the subsystem answers: the trigger, and the shape of a refusal.

A caller here is another subsystem, so a refusal has to be something a program can
branch on. What the build itself writes is in `test_run.py` and `test_build.py`; here
they are replaced, because what is being checked is the route.

    uv run pytest
"""

import os

# The variables of configurator/bootstrap.env. Anagraphics is pointed at a port nothing
# listens on: these tests never read the configuration over HTTP, and if a change ever
# made them try, the failure should be a refused connection and not a silent read of the
# real environment's configuration.
os.environ.update(
    {
        "WEBTOOLS_ANAGRAPHICS_URL": "http://127.0.0.1:9199",
        "WEBTOOLS_CONFIGURATION_TIMEOUT_MS": "500",
    }
)

from tests.test_settings import CONFIGURATION  # noqa: E402

import webtools_developer.settings as settings_module  # noqa: E402
from webtools_developer.commons.configuration_client import Configuration  # noqa: E402

# The document the developer would have read from anagraphics, handed over instead, so
# the tests do not need it running: it is the same document, from the same seed.
settings_module.read_configuration = lambda subsystem, bootstrap: Configuration(
    subsystem, CONFIGURATION
)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import webtools_developer.main as main  # noqa: E402
from webtools_developer.main import app  # noqa: E402
from webtools_developer.run import NotStarted  # noqa: E402

PROJECT = "1f251606-bdba-40c4-bbee-bfedc6e57f70"
ROUTE = f"/projects/{PROJECT}/development"

LOCALHOST = ("127.0.0.1", 50000)
OUTSIDER = ("10.0.0.1", 50000)


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main.run, "start", lambda settings, project_id: {"project_id": project_id})
    monkeypatch.setattr(main.run, "perform", lambda settings, project: None)
    return TestClient(app, client=LOCALHOST)


def test_the_trigger_answers_at_once(client):
    """`202`: taken, not done. A build is hundreds of calls over minutes or hours, and
    nobody waits in front of it."""
    answered = client.post(ROUTE)
    assert answered.status_code == 202
    assert answered.json() == {"project_id": PROJECT, "started": True}


@pytest.mark.parametrize(
    "code,status",
    [
        ("PROJECT_NOT_FOUND", 404),
        ("PROJECT_NOT_READY", 409),
        ("DEVELOPMENT_ALREADY_STARTED", 409),
        ("PROJECT_REJECTED", 409),
        ("ANAGRAPHICS_UNAVAILABLE", 503),
    ],
)
def test_a_refusal_is_a_status_and_a_stable_code(client, monkeypatch, code, status):
    monkeypatch.setattr(
        main.run,
        "start",
        lambda settings, project_id: (_ for _ in ()).throw(NotStarted(code, status)),
    )
    answered = client.post(ROUTE)
    assert answered.status_code == status
    assert answered.json() == {"error": code}


def test_a_caller_from_outside_the_pool_is_refused(monkeypatch):
    monkeypatch.setattr(main.run, "start", lambda settings, project_id: {"project_id": project_id})
    outsider = TestClient(app, client=OUTSIDER)
    answered = outsider.post(ROUTE)
    assert answered.status_code == 403
    assert answered.json() == {"error": "IP_NOT_ALLOWED"}


def test_a_route_that_does_not_exist(client):
    answered = client.post("/builds")
    assert answered.status_code == 404
    assert answered.json() == {"error": "ROUTE_NOT_FOUND"}


def test_a_method_that_is_not_allowed(client):
    answered = client.get(ROUTE)
    assert answered.status_code == 405
    assert answered.json() == {"error": "METHOD_NOT_ALLOWED"}


def test_a_body_larger_than_the_limit_is_not_read(client):
    """What reaches this subsystem is a trigger naming a project, not a document."""
    answered = client.post(ROUTE, content=b"x" * (CONFIGURATION["limits"]["body_max_bytes"] + 1))
    assert answered.status_code == 413
    assert answered.json() == {"error": "BODY_TOO_LARGE"}


def test_every_request_is_counted_under_the_route_as_written(client):
    """`/projects/{project_id}/development` and never `/projects/1f251606-…`: a bucket
    per identifier would make the number of documents grow with the traffic."""
    counted = []
    main.settings.metrics.measure = lambda metric, **fields: counted.append({"metric": metric, **fields})
    client.post(ROUTE)
    requests = [one for one in counted if one["metric"] == "http.request"]
    assert requests[0]["dims"]["route"] == "/projects/{project_id}/development"
    assert requests[0]["dims"]["status"] == "202"
