"""What the subsystem answers: the trigger, and the shape of a refusal.

A caller here is another subsystem, so a refusal has to be something a program can
branch on. What the run itself writes is in `test_run.py`; here it is replaced, because
what is being checked is the route.

    uv run pytest
"""

import os

# The variables of configurator/bootstrap.env. Anagraphics is pointed at a port
# nothing listens on: these tests never read the configuration over HTTP, and if a
# change ever made them try, the failure should be a refused connection and not a
# silent read of the real environment's configuration.
os.environ.update(
    {
        "WEBTOOLS_ANAGRAPHICS_URL": "http://127.0.0.1:9199",
        "WEBTOOLS_CONFIGURATION_TIMEOUT_MS": "500",
    }
)

from tests.test_settings import CONFIGURATION  # noqa: E402

import webtools_analyst.settings as settings_module  # noqa: E402
from webtools_analyst.commons.configuration_client import Configuration  # noqa: E402

# The document the analyst would have read from anagraphics, handed over instead, so
# the tests do not need it running: it is the same document, from the same seed.
settings_module.read_configuration = lambda subsystem, bootstrap: Configuration(
    subsystem, CONFIGURATION
)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import webtools_analyst.main as main  # noqa: E402
from webtools_analyst.main import app  # noqa: E402
from webtools_analyst.run import NotStarted  # noqa: E402

PROJECT = "1f251606-bdba-40c4-bbee-bfedc6e57f70"

LOCALHOST = ("127.0.0.1", 50000)
OUTSIDER = ("10.0.0.1", 50000)


def client(address=LOCALHOST) -> TestClient:
    return TestClient(app, client=address)


def test_an_address_outside_the_pool_gets_the_contract_s_error():
    response = client(OUTSIDER).get("/anything")
    assert response.status_code == 403
    assert response.json() == {"error": "IP_NOT_ALLOWED"}


def test_the_pool_is_checked_before_the_route_exists():
    """An outsider is not told which routes are there and which are not: the pool is
    the first thing, and a 404 would answer a question they may not ask."""
    assert client(OUTSIDER).get("/").status_code == 403


def test_a_route_that_is_not_there_is_a_code_and_not_prose():
    response = client().get("/analysis/1f251606-bdba-40c4-bbee-bfedc6e57f70")
    assert response.status_code == 404
    assert response.json() == {"error": "ROUTE_NOT_FOUND"}


def test_a_body_larger_than_the_limit_is_refused_unread():
    """Refused on the declared length, before the body is read: what reaches this
    subsystem is a trigger naming a project, not a document."""
    oversized = "x" * (CONFIGURATION["limits"]["body_max_bytes"] + 1)
    response = client().post("/anything", content=oversized)
    assert response.status_code == 413
    assert response.json() == {"error": "BODY_TOO_LARGE"}


def test_the_trigger_answers_at_once_and_the_work_goes_on(monkeypatch):
    """`202`: taken, not done. What is already true is that the run is recorded on the
    project; the doors run behind the answer."""
    begun = {}
    monkeypatch.setattr(main.run, "start", lambda _settings, project_id: {"project_id": project_id})
    monkeypatch.setattr(main.run, "perform", lambda _settings, project: begun.update(project))

    response = client().post(f"/projects/{PROJECT}/analysis")

    assert response.status_code == 202
    assert response.json() == {"project_id": PROJECT, "started": True}
    # The work is handed over after the answer, and the test client runs it before it
    # returns: what is checked here is that it was handed the project the trigger
    # wrote, and not the project id to read again.
    assert begun == {"project_id": PROJECT}


@pytest.mark.parametrize(
    ("code", "status"),
    [
        ("ANALYSIS_ALREADY_STARTED", 409),
        ("PROJECT_NOT_READY", 409),
        ("PROJECT_REJECTED", 409),
        ("PROJECT_NOT_FOUND", 404),
        ("ANAGRAPHICS_UNAVAILABLE", 503),
    ],
)
def test_a_run_that_does_not_begin_says_why_in_one_word(monkeypatch, code, status):
    def refuse(_settings, _project_id):
        raise NotStarted(code, status)

    monkeypatch.setattr(main.run, "start", refuse)
    response = client().post(f"/projects/{PROJECT}/analysis")
    assert response.status_code == status
    assert response.json() == {"error": code}
