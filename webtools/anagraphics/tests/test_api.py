import os

from pymongo import MongoClient

# The tests use a separate database, dropped at the end. The variables are those
# of configurator/bootstrap.env, with the test database.
TEST_ENV = {
    "WEBTOOLS_ANAGRAPHICS_URL": "http://127.0.0.1:9100",
    "WEBTOOLS_CONFIGURATION_TIMEOUT_MS": "5000",
    "WEBTOOLS_MONGO_URI": "mongodb://localhost:27017",
    "WEBTOOLS_MONGO_DB": "webtools_test",
}
os.environ.update(TEST_ENV)

# Anagraphics reads its own configuration when main is imported: it must be there first.
ANAGRAPHICS_CONFIGURATION = {
    "subsystem": "anagraphics",
    "access": {"allowed_ips": ["127.0.0.1", "::1"]},
    "mongo": {"server_selection_timeout_ms": 5000},
}
MongoClient(TEST_ENV["WEBTOOLS_MONGO_URI"])[TEST_ENV["WEBTOOLS_MONGO_DB"]]["configuration"].replace_one(
    {"subsystem": "anagraphics"}, ANAGRAPHICS_CONFIGURATION, upsert=True
)

import pytest
from fastapi.testclient import TestClient
from pymongo.errors import ServerSelectionTimeoutError

from webtools_anagraphics import db, settings
from webtools_anagraphics.main import app, database

LOCALHOST = ("127.0.0.1", 50000)
OUTSIDER = ("10.0.0.1", 50000)

DRIVER_UID = "7633be3d-e701-42ca-9fea-6c6d1bb4b7d1"
DRIVER = {
    "uid": DRIVER_UID,
    "username": "dome.santoro@gmail.com",
    "screen_name": "Dome",
    "enabled": True,
}
# A driver who exists but has no discounts: the list must be empty, not a 404.
DRIVER_WITHOUT_DISCOUNTS_UID = "639718a3-ea41-4533-bdb8-73ac58b3b1b2"
DRIVER_WITHOUT_DISCOUNTS = {
    "uid": DRIVER_WITHOUT_DISCOUNTS_UID,
    "username": "driver.prova@example.com",
    "screen_name": "Prova",
    "enabled": False,
}
# The driver list does not expose `username`, but says whether the driver is enabled.
DRIVER_SUMMARY = {"uid": DRIVER_UID, "screen_name": "Dome", "enabled": True}
DRIVER_WITHOUT_DISCOUNTS_SUMMARY = {
    "uid": DRIVER_WITHOUT_DISCOUNTS_UID,
    "screen_name": "Prova",
    "enabled": False,
}
DISCOUNT_CODE = "e8013cf2-34eb-4bc3-8a34-b08fb24a1bf3"
DISCOUNT = {
    "discount_code": DISCOUNT_CODE,
    "driver": {"uid": DRIVER_UID, "screen_name": "Dome"},
    "percentage": 5,
}

USER_UID = "8ff93901-673e-44ba-b05b-56011395dcba"
USERNAME = "dome.santoro@gmail.com"
CREDENTIAL = {
    "algorithm": "scrypt",
    "params": {"n": 16384, "r": 8, "p": 1, "dklen": 32},
    "salt": "c2FsdC1kaS1wcm92YQ==",
    "hash": "aGFzaC1kaS1wcm92YQ==",
}
USER = {
    "uid": USER_UID,
    "username": USERNAME,
    "screen_name": "Dome",
    "active": True,
    "driver_uid": DRIVER_UID,
}
# A user with no password set: they exist, but cannot authenticate.
USER_WITHOUT_CREDENTIAL = {
    "uid": "214912a9-2cc4-4205-87b7-93ea71f6be72",
    "username": "driver.prova@example.com",
    "screen_name": "Prova",
    "active": True,
    "driver_uid": DRIVER_WITHOUT_DISCOUNTS_UID,
}


def a_session(token: str, uid: str = USER_UID) -> dict:
    return {
        "token": token,
        "uid": uid,
        "username": USERNAME,
        "issued_at": "2026-09-21T10:00:00Z",
        "expires_at": "2026-09-21T18:00:00Z",
    }


@pytest.fixture(scope="module", autouse=True)
def seeded_database():
    db.ensure_indexes(database)
    database[db.CONFIGURATION].insert_one({"subsystem": "front-gate"})
    database[db.PROJECTS].insert_one({"project_id": "1f251606-bdba-40c4-bbee-bfedc6e57f70"})
    database[db.DRIVERS].insert_many([dict(DRIVER), dict(DRIVER_WITHOUT_DISCOUNTS)])
    database[db.DISCOUNTS].insert_one(dict(DISCOUNT))
    database[db.USERS].insert_many(
        [
            {**USER, "credential": dict(CREDENTIAL)},
            {**USER_WITHOUT_CREDENTIAL, "credential": None},
        ]
    )
    yield
    database.client.drop_database(database.name)


@pytest.fixture
def client():
    return TestClient(app, client=LOCALHOST)


def test_configuration_found(client):
    response = client.get("/configuration/front-gate")
    assert response.status_code == 200
    assert response.json() == {"subsystem": "front-gate"}


def test_configuration_not_found(client):
    response = client.get("/configuration/unknown")
    assert response.status_code == 404
    assert response.json() == {"error": "CONFIGURATION_NOT_FOUND", "subsystem": "unknown"}


def test_project_found(client):
    response = client.get("/projects/1f251606-bdba-40c4-bbee-bfedc6e57f70")
    assert response.status_code == 200
    assert response.json() == {"project_id": "1f251606-bdba-40c4-bbee-bfedc6e57f70"}


def test_project_not_found(client):
    response = client.get("/projects/unknown")
    assert response.status_code == 404
    assert response.json() == {"error": "PROJECT_NOT_FOUND", "project_id": "unknown"}


OWNER_UID = "8ff93901-673e-44ba-b05b-56011395dcba"


def a_project(submission_id: str, owner_uid: str = OWNER_UID) -> dict:
    return {
        "owner_uid": owner_uid,
        "submission_id": submission_id,
        "review": {"driver_uid": DRIVER_UID, "preset": True},
        "billing": {"discount_code": DISCOUNT_CODE},
    }


def test_create_project(client):
    response = client.post("/projects", json=a_project("invio-000000000000001"))
    assert response.status_code == 201
    project = response.json()
    # The id is generated by anagraphics: a UUID v4 in canonical form.
    assert len(project["project_id"]) == 36 and project["project_id"][14] == "4"
    assert project["owner_uid"] == OWNER_UID
    assert project["pipeline"] == {"state": "PREANALYSIS", "steps": []}
    assert "state" not in project
    assert project["review"] == {"driver_uid": DRIVER_UID, "preset": True}
    assert project["billing"] == {
        "discount_code": DISCOUNT_CODE,
        "autonomous_work": False,
        "ambassador_uid": None,
    }
    assert "referral" not in project
    assert project["created_at"]

    stored = client.get(f"/projects/{project['project_id']}")
    assert stored.status_code == 200
    assert stored.json()["submission_id"] == "invio-000000000000001"


def test_create_project_twice_returns_the_same(client):
    first = client.post("/projects", json=a_project("invio-000000000000002"))
    second = client.post("/projects", json=a_project("invio-000000000000002"))
    assert first.status_code == 201
    assert second.status_code == 200
    assert second.json()["project_id"] == first.json()["project_id"]
    assert database[db.PROJECTS].count_documents({"submission_id": "invio-000000000000002"}) == 1


def test_create_project_with_submission_of_another_user(client):
    client.post("/projects", json=a_project("invio-000000000000003"))
    response = client.post("/projects", json=a_project("invio-000000000000003", "un-altro"))
    assert response.status_code == 409
    assert response.json() == {"error": "SUBMISSION_EXISTS"}


def test_create_project_without_review_and_billing(client):
    body = {"owner_uid": OWNER_UID, "submission_id": "invio-000000000000006"}
    project = client.post("/projects", json=body).json()
    assert project["review"] == {"driver_uid": None, "preset": False}
    assert project["billing"]["discount_code"] is None
    assert project["billing"]["ambassador_uid"] is None


def test_create_project_with_ambassador(client):
    body = a_project("invio-000000000000007")
    body["billing"] = {"ambassador_uid": DRIVER_UID}
    project = client.post("/projects", json=body).json()
    assert project["billing"]["ambassador_uid"] == DRIVER_UID


def test_create_project_invalid_body(client):
    response = client.post("/projects", json={"owner_uid": OWNER_UID})
    assert response.status_code == 400
    assert response.json() == {"error": "INVALID_BODY"}


def test_create_project_ignores_chosen_id(client):
    body = {**a_project("invio-000000000000004"), "project_id": "scelto-da-fuori"}
    response = client.post("/projects", json=body)
    assert response.status_code == 201
    assert response.json()["project_id"] != "scelto-da-fuori"


def a_prevalidation_step(result="passed", state="ANALYSIS"):
    return {
        "step": "prevalidation",
        "result": result,
        "state": state,
        "data": {
            "outcome": "safe",
            "distribution": {
                "non_sequitur": 0.02,
                "run_out_certain": 0.05,
                "run_out_likely": 0.15,
                "underspecified": 0.05,
                "safe": 0.53,
                "ultrasafe": 0.2,
            },
            "off_domain": {"flag": False, "reason": ""},
            "policy": "scope-v1",
            "provider": "anthropic",
            "model": "claude-haiku-4-5",
            "usage": {"input_tokens": 2100, "output_tokens": 140},
        },
    }


def test_add_pipeline_step(client):
    project_id = client.post("/projects", json=a_project("invio-000000000000010")).json()["project_id"]

    response = client.post(f"/projects/{project_id}/pipeline/steps", json=a_prevalidation_step())
    assert response.status_code == 201
    pipeline = response.json()["pipeline"]
    assert pipeline["state"] == "ANALYSIS"
    assert len(pipeline["steps"]) == 1
    step = pipeline["steps"][0]
    assert step["step"] == "prevalidation"
    assert step["result"] == "passed"
    assert step["data"]["usage"]["input_tokens"] == 2100
    # When the step happened is decided by anagraphics, not by the caller.
    assert step["decided_at"]
    # `state` is where the step leads, not a field of the step.
    assert "state" not in step


def test_add_pipeline_step_appends_in_order(client):
    project_id = client.post("/projects", json=a_project("invio-000000000000011")).json()["project_id"]

    client.post(f"/projects/{project_id}/pipeline/steps", json=a_prevalidation_step(result="failed"))
    client.post(f"/projects/{project_id}/pipeline/steps", json=a_prevalidation_step())

    steps = client.get(f"/projects/{project_id}").json()["pipeline"]["steps"]
    assert [step["result"] for step in steps] == ["failed", "passed"]


def test_add_pipeline_step_rejecting(client):
    project_id = client.post("/projects", json=a_project("invio-000000000000012")).json()["project_id"]

    response = client.post(
        f"/projects/{project_id}/pipeline/steps",
        json=a_prevalidation_step(result="rejected", state="REJECTED"),
    )
    assert response.json()["pipeline"]["state"] == "REJECTED"


def test_add_pipeline_step_underspecified(client):
    """The step that sends the request back: the request stays, and the rounds are counted.

    It is the only place where the number of rounds exists: whoever decides how
    many times one may go back reads this list (preanalyst §16.6).
    """
    project_id = client.post("/projects", json=a_project("invio-000000000000014")).json()["project_id"]
    back = a_prevalidation_step(result="underspecified", state="UNDERSPECIFIED")

    client.post(f"/projects/{project_id}/pipeline/steps", json=back)
    response = client.post(f"/projects/{project_id}/pipeline/steps", json=back)

    pipeline = response.json()["pipeline"]
    assert pipeline["state"] == "UNDERSPECIFIED"
    assert [step["result"] for step in pipeline["steps"]] == ["underspecified", "underspecified"]

    # The project is not closed: rewritten, the request passes.
    response = client.post(f"/projects/{project_id}/pipeline/steps", json=a_prevalidation_step())
    assert response.json()["pipeline"]["state"] == "ANALYSIS"


def test_add_pipeline_step_of_unknown_project(client):
    response = client.post("/projects/non-esiste/pipeline/steps", json=a_prevalidation_step())
    assert response.status_code == 404
    assert response.json() == {"error": "PROJECT_NOT_FOUND", "project_id": "non-esiste"}


def test_add_pipeline_step_with_invented_names(client):
    project_id = client.post("/projects", json=a_project("invio-000000000000013")).json()["project_id"]

    for campo, valore in (("step", "inventato"), ("state", "BOH"), ("result", "forse")):
        body = {**a_prevalidation_step(), campo: valore}
        response = client.post(f"/projects/{project_id}/pipeline/steps", json=body)
        assert response.status_code == 400, campo
        assert response.json() == {"error": "INVALID_BODY"}

    # None of the attempts left a trace.
    assert client.get(f"/projects/{project_id}").json()["pipeline"]["steps"] == []


def test_delete_project(client):
    project_id = client.post("/projects", json=a_project("invio-000000000000005")).json()["project_id"]
    assert client.delete(f"/projects/{project_id}").status_code == 204
    assert client.get(f"/projects/{project_id}").status_code == 404
    response = client.delete(f"/projects/{project_id}")
    assert response.status_code == 404
    assert response.json() == {"error": "PROJECT_NOT_FOUND", "project_id": project_id}


def test_driver_found(client):
    response = client.get(f"/drivers/{DRIVER_UID}")
    assert response.status_code == 200
    assert response.json() == DRIVER


def test_drivers_list(client):
    response = client.get("/drivers")
    assert response.status_code == 200
    # Sorted by uid: 639718a3… comes before 7633be3d…
    # Only uid, screen_name and enabled: `username` must not appear in the list.
    assert response.json() == {"drivers": [DRIVER_WITHOUT_DISCOUNTS_SUMMARY, DRIVER_SUMMARY]}


def test_driver_not_found(client):
    response = client.get("/drivers/unknown")
    assert response.status_code == 404
    assert response.json() == {"error": "DRIVER_NOT_FOUND", "uid": "unknown"}


def test_discount_found(client):
    response = client.get(f"/discounts/{DISCOUNT_CODE}")
    assert response.status_code == 200
    assert response.json() == DISCOUNT


def test_discount_not_found(client):
    response = client.get("/discounts/unknown")
    assert response.status_code == 404
    assert response.json() == {"error": "DISCOUNT_NOT_FOUND", "discount_code": "unknown"}


def test_discounts_of_driver(client):
    response = client.get(f"/drivers/{DRIVER_UID}/discounts")
    assert response.status_code == 200
    assert response.json() == {"uid": DRIVER_UID, "discounts": [DISCOUNT]}


def test_discounts_of_driver_without_discounts(client):
    response = client.get(f"/drivers/{DRIVER_WITHOUT_DISCOUNTS_UID}/discounts")
    assert response.status_code == 200
    assert response.json() == {"uid": DRIVER_WITHOUT_DISCOUNTS_UID, "discounts": []}


def test_discounts_of_unknown_driver(client):
    response = client.get("/drivers/unknown/discounts")
    assert response.status_code == 404
    assert response.json() == {"error": "DRIVER_NOT_FOUND", "uid": "unknown"}


def test_user_found(client):
    response = client.get(f"/users/{USERNAME}")
    assert response.status_code == 200
    # The ordinary read does not contain the credential block.
    assert response.json() == USER


def test_user_not_found(client):
    response = client.get("/users/nessuno@example.com")
    assert response.status_code == 404
    assert response.json() == {"error": "USER_NOT_FOUND", "username": "nessuno@example.com"}


def test_user_credential(client):
    response = client.get(f"/users/{USERNAME}/credential")
    assert response.status_code == 200
    assert response.json() == {"username": USERNAME, "credential": CREDENTIAL}


def test_user_credential_not_set(client):
    username = USER_WITHOUT_CREDENTIAL["username"]
    response = client.get(f"/users/{username}/credential")
    assert response.status_code == 404
    assert response.json() == {"error": "CREDENTIAL_NOT_SET", "username": username}


def test_user_credential_of_unknown_user(client):
    response = client.get("/users/nessuno@example.com/credential")
    assert response.status_code == 404
    assert response.json() == {"error": "USER_NOT_FOUND", "username": "nessuno@example.com"}


def test_session_lifecycle(client):
    token = "token-di-prova-0000000000000001"
    created = client.post("/sessions", json=a_session(token))
    assert created.status_code == 201
    assert created.json() == {
        "token": token,
        "uid": USER_UID,
        "username": USERNAME,
        "issued_at": "2026-09-21T10:00:00Z",
        "expires_at": "2026-09-21T18:00:00Z",
        "data": {},
    }

    read = client.get(f"/sessions/{token}")
    assert read.status_code == 200
    assert read.json() == created.json()

    removed = client.delete(f"/sessions/{token}")
    assert removed.status_code == 204

    assert client.get(f"/sessions/{token}").status_code == 404
    # Deleting twice is not the same as having deleted: the caller must be able to
    # tell an unknown token apart.
    assert client.delete(f"/sessions/{token}").json() == {"error": "SESSION_NOT_FOUND"}


def test_session_keeps_free_data(client):
    token = "token-di-prova-0000000000000002"
    payload = {**a_session(token), "data": {"subsystem": "preanalyst", "role": "driver"}}
    created = client.post("/sessions", json=payload)
    assert created.status_code == 201
    assert created.json()["data"] == {"subsystem": "preanalyst", "role": "driver"}
    client.delete(f"/sessions/{token}")


def test_user_locale(client):
    response = client.put(f"/users/{USERNAME}/locale", json={"locale": "it"})
    assert response.status_code == 200
    assert response.json()["locale"] == "it"
    assert "credential" not in response.json()
    assert client.get(f"/users/{USERNAME}").json()["locale"] == "it"


def test_user_locale_of_unknown_user(client):
    response = client.put("/users/nessuno@example.com/locale", json={"locale": "it"})
    assert response.status_code == 404
    assert response.json()["error"] == "USER_NOT_FOUND"


def test_locale_must_be_a_language_code(client):
    for body in ({"locale": "Italiano"}, {"locale": ""}, {}):
        response = client.put(f"/users/{USERNAME}/locale", json=body)
        assert response.status_code == 400
        assert response.json() == {"error": "INVALID_BODY"}


def test_session_locale(client):
    token = "token-di-prova-0000000000000009"
    payload = {**a_session(token), "data": {"screen_name": "Dome"}}
    assert client.post("/sessions", json=payload).status_code == 201
    response = client.put(f"/sessions/{token}/locale", json={"locale": "en"})
    assert response.status_code == 200
    # The other session data stays.
    assert response.json()["data"] == {"screen_name": "Dome", "locale": "en"}
    client.delete(f"/sessions/{token}")


def test_session_locale_of_unknown_session(client):
    response = client.put("/sessions/token-sconosciuto-00000000/locale", json={"locale": "en"})
    assert response.status_code == 404
    assert response.json() == {"error": "SESSION_NOT_FOUND"}


def test_session_expired_is_still_returned(client):
    # The expiry is judged by the sso: here the session is returned anyway, until
    # Mongo's TTL has removed it.
    token = "token-di-prova-0000000000000003"
    scaduta = {**a_session(token), "expires_at": "2020-01-01T00:00:00Z"}
    assert client.post("/sessions", json=scaduta).status_code == 201
    read = client.get(f"/sessions/{token}")
    assert read.status_code == 200
    assert read.json()["expires_at"] == "2020-01-01T00:00:00Z"
    client.delete(f"/sessions/{token}")


def test_session_duplicate_token(client):
    token = "token-di-prova-0000000000000004"
    assert client.post("/sessions", json=a_session(token)).status_code == 201
    duplicate = client.post("/sessions", json=a_session(token))
    assert duplicate.status_code == 409
    assert duplicate.json() == {"error": "SESSION_EXISTS", "token": token}
    client.delete(f"/sessions/{token}")


def test_session_invalid_body(client):
    # Token too short, missing fields, unreadable date: one code only.
    for payload in (
        {},
        {**a_session("corto"), "token": "corto"},
        {**a_session("token-di-prova-0000000000000005"), "expires_at": "domani"},
    ):
        response = client.post("/sessions", json=payload)
        assert response.status_code == 400
        assert response.json() == {"error": "INVALID_BODY"}


def test_session_not_found(client):
    response = client.get("/sessions/inesistente")
    assert response.status_code == 404
    assert response.json() == {"error": "SESSION_NOT_FOUND"}


def test_delete_sessions_of_user(client):
    tokens = ["token-di-prova-0000000000000006", "token-di-prova-0000000000000007"]
    for token in tokens:
        client.post("/sessions", json=a_session(token))
    # Another user's session: it must not be touched.
    other = "token-di-prova-0000000000000008"
    client.post("/sessions", json=a_session(other, uid="altro-uid"))

    response = client.delete(f"/sessions?uid={USER_UID}")
    assert response.status_code == 200
    assert response.json() == {"uid": USER_UID, "deleted": 2}
    assert client.get(f"/sessions/{other}").status_code == 200
    client.delete(f"/sessions/{other}")


def a_ticket(ticket: str, token: str = "token-di-prova-0000000000000100") -> dict:
    return {
        "ticket": ticket,
        "token": token,
        "service": "http://127.0.0.1:9200",
        "issued_at": "2026-09-21T10:00:00Z",
        "expires_at": "2026-09-21T10:01:00Z",
    }


def test_ticket_is_consumed_once(client):
    ticket = "biglietto-di-prova-000000000001"
    created = client.post("/tickets", json=a_ticket(ticket))
    assert created.status_code == 201
    assert created.json() == {
        "ticket": ticket,
        "token": "token-di-prova-0000000000000100",
        "service": "http://127.0.0.1:9200",
        "issued_at": "2026-09-21T10:00:00Z",
        "expires_at": "2026-09-21T10:01:00Z",
    }

    consumed = client.delete(f"/tickets/{ticket}")
    assert consumed.status_code == 200
    assert consumed.json() == created.json()

    # The second attempt must not succeed: that is what makes the ticket single-use
    # even if somebody has read it from a log.
    again = client.delete(f"/tickets/{ticket}")
    assert again.status_code == 404
    assert again.json() == {"error": "TICKET_NOT_FOUND"}


def test_ticket_duplicate(client):
    ticket = "biglietto-di-prova-000000000002"
    assert client.post("/tickets", json=a_ticket(ticket)).status_code == 201
    duplicate = client.post("/tickets", json=a_ticket(ticket))
    assert duplicate.status_code == 409
    assert duplicate.json() == {"error": "TICKET_EXISTS"}
    client.delete(f"/tickets/{ticket}")


def test_ticket_invalid_body(client):
    for payload in ({}, {**a_ticket("corto"), "ticket": "corto"}):
        response = client.post("/tickets", json=payload)
        assert response.status_code == 400
        assert response.json() == {"error": "INVALID_BODY"}


def test_delete_sessions_of_user_without_sessions(client):
    response = client.delete("/sessions?uid=nessuno")
    assert response.status_code == 200
    assert response.json() == {"uid": "nessuno", "deleted": 0}


def test_ip_outside_pool_is_rejected():
    outsider = TestClient(app, client=OUTSIDER)
    paths = (
        "/configuration/front-gate",
        "/projects/1f251606-bdba-40c4-bbee-bfedc6e57f70",
        "/drivers",
        f"/drivers/{DRIVER_UID}",
        f"/drivers/{DRIVER_UID}/discounts",
        f"/discounts/{DISCOUNT_CODE}",
        f"/users/{USERNAME}",
        f"/users/{USERNAME}/credential",
        "/sessions/qualsiasi",
        "/nope",
    )
    for path in paths:
        response = outsider.get(path)
        assert response.status_code == 403
        assert response.json() == {"error": "IP_NOT_ALLOWED"}

    # Writes too: the IP pool comes before everything else.
    for response in (
        outsider.post("/sessions", json=a_session("token-da-fuori-000000000000001")),
        outsider.delete("/sessions/qualsiasi"),
        outsider.post("/projects", json=a_project("invio-da-fuori-0000001")),
        outsider.delete("/projects/1f251606-bdba-40c4-bbee-bfedc6e57f70"),
    ):
        assert response.status_code == 403
        assert response.json() == {"error": "IP_NOT_ALLOWED"}


def test_unknown_route(client):
    response = client.get("/nope")
    assert response.status_code == 404
    assert response.json() == {"error": "ROUTE_NOT_FOUND"}


def test_method_not_allowed(client):
    response = client.post("/projects/1f251606-bdba-40c4-bbee-bfedc6e57f70")
    assert response.status_code == 405
    assert response.json() == {"error": "METHOD_NOT_ALLOWED"}


def test_database_unavailable(client, monkeypatch):
    def unreachable(*args):
        raise ServerSelectionTimeoutError("localhost:27017: connection refused")

    monkeypatch.setattr(db, "find_project", unreachable)
    response = client.get("/projects/1f251606-bdba-40c4-bbee-bfedc6e57f70")
    assert response.status_code == 503
    assert response.json() == {"error": "DATABASE_UNAVAILABLE"}


def test_internal_error(monkeypatch):
    def broken(*args):
        raise RuntimeError("boom")

    monkeypatch.setattr(db, "find_configuration", broken)
    client = TestClient(app, client=LOCALHOST, raise_server_exceptions=False)
    response = client.get("/configuration/front-gate")
    assert response.status_code == 500
    assert response.json() == {"error": "INTERNAL_ERROR"}


# --- configuration at startup: no defaults, if anything is missing we do not start


def test_settings_from_configuration():
    loaded = settings.load_settings()
    assert (loaded.host, loaded.port) == ("127.0.0.1", 9100)
    assert loaded.allowed_ips == frozenset({"127.0.0.1", "::1"})
    assert loaded.mongo_server_selection_timeout_ms == 5000


def test_settings_without_bootstrap_variable(monkeypatch):
    monkeypatch.delenv("WEBTOOLS_MONGO_DB")
    with pytest.raises(settings.ConfigurationError, match="WEBTOOLS_MONGO_DB"):
        settings.load_settings()


def test_settings_without_configuration_document(monkeypatch):
    # A database without the `configuration` collection: nothing is created.
    monkeypatch.setenv("WEBTOOLS_MONGO_DB", "webtools_test_empty")
    with pytest.raises(settings.ConfigurationError, match="no .anagraphics. configuration"):
        settings.load_settings()


def test_settings_with_missing_field():
    database[db.CONFIGURATION].replace_one(
        {"subsystem": "anagraphics"}, {"subsystem": "anagraphics", "access": {}}
    )
    try:
        with pytest.raises(settings.ConfigurationError, match="access.allowed_ips"):
            settings.load_settings()
    finally:
        database[db.CONFIGURATION].replace_one(
            {"subsystem": "anagraphics"}, ANAGRAPHICS_CONFIGURATION
        )


# ------------------------------------------------- the open step and the turns


def an_open_analysis_step(turns: int = 5) -> dict:
    return {
        "step": "analysis",
        "result": "open",
        "state": "ANALYSIS",
        "data": {"turns_left": turns, "chat": []},
    }


def test_open_step_can_be_updated(client):
    project_id = client.post("/projects", json=a_project("invio-000000000000030")).json()["project_id"]
    client.post(f"/projects/{project_id}/pipeline/steps", json=an_open_analysis_step())

    response = client.patch(
        f"/projects/{project_id}/pipeline/steps/analysis",
        json={"set": {"turns_left": 4}, "push": {"chat": [{"role": "client", "text": "ciao"}]}},
    )
    assert response.status_code == 200
    passo = response.json()["pipeline"]["steps"][-1]
    assert passo["data"]["turns_left"] == 4
    assert [m["text"] for m in passo["data"]["chat"]] == ["ciao"]


def test_open_step_push_appends_in_order(client):
    project_id = client.post("/projects", json=a_project("invio-000000000000031")).json()["project_id"]
    client.post(f"/projects/{project_id}/pipeline/steps", json=an_open_analysis_step())

    client.patch(f"/projects/{project_id}/pipeline/steps/analysis", json={"push": {"chat": [{"text": "uno"}]}})
    response = client.patch(
        f"/projects/{project_id}/pipeline/steps/analysis",
        json={"push": {"chat": [{"text": "due"}, {"text": "tre"}]}},
    )
    assert [m["text"] for m in response.json()["pipeline"]["steps"][-1]["data"]["chat"]] == ["uno", "due", "tre"]


def test_closed_step_is_not_updated(client):
    """A step that has decided something is not rewritten: it is the register of decisions."""
    project_id = client.post("/projects", json=a_project("invio-000000000000032")).json()["project_id"]
    client.post(f"/projects/{project_id}/pipeline/steps", json=a_prevalidation_step())

    response = client.patch(
        f"/projects/{project_id}/pipeline/steps/prevalidation", json={"set": {"outcome": "ultrasafe"}}
    )
    assert response.status_code == 404
    assert response.json()["error"] == "OPEN_STEP_NOT_FOUND"


def test_update_step_without_project(client):
    response = client.patch(
        "/projects/00000000-0000-0000-0000-000000000000/pipeline/steps/analysis", json={"set": {"turns_left": 1}}
    )
    assert response.status_code == 404


def test_spend_turns_reduces_the_credit(client):
    client.post(f"/users/{OWNER_UID}/billing/turns/grant", json={"turns": 10})
    response = client.post(f"/users/{OWNER_UID}/billing/turns/spend", json={"turns": 4})
    assert response.status_code == 200
    assert response.json()["billing"]["turns_credit"] == 6


def test_spend_turns_refuses_more_than_the_credit(client):
    """The check is inside the write: if there is not enough, nothing is drawn."""
    balance = client.get(f"/users/{USER['username']}").json()["billing"]["turns_credit"]

    response = client.post(f"/users/{OWNER_UID}/billing/turns/spend", json={"turns": balance + 1})
    assert response.status_code == 409
    assert response.json()["error"] == "NOT_ENOUGH_TURNS"

    after = client.get(f"/users/{USER['username']}").json()
    assert after["billing"]["turns_credit"] == balance


def test_turns_of_an_unknown_user(client):
    response = client.post("/users/nessuno/billing/turns/spend", json={"turns": 1})
    assert response.status_code == 404
    assert response.json()["error"] == "USER_NOT_FOUND"


def test_turns_must_be_positive(client):
    """The direction is said by the route: a zero or a negative is not a way of saying the other one."""
    assert client.post(f"/users/{OWNER_UID}/billing/turns/spend", json={"turns": 0}).status_code == 400
    assert client.post(f"/users/{OWNER_UID}/billing/turns/grant", json={"turns": -3}).status_code == 400
