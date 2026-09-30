import os
from datetime import datetime, timezone

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
    # Metrics is not running in the tests and is not meant to be: the client does not
    # wait and does not throw, so what it cannot send is lost, which is exactly what
    # is wanted here. The fields have to be there all the same — a subsystem whose
    # configuration is missing one does not start, and that is the rule being obeyed.
    "subsystems_infos": {"metrics": {"url": "http://127.0.0.1:9699", "timeout_ms": 200}},
    "metrics": {"log_failures": False, "pending_max": 100},
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

# A driver is a user carrying a `driver` object; these are the uids of the role, not
# of the person. The published views below are what the driver routes answer with.
DRIVER_UID = "7633be3d-e701-42ca-9fea-6c6d1bb4b7d1"
DRIVER = {
    "uid": DRIVER_UID,
    "username": "dome.santoro@gmail.com",
    "screen_name": "Dome",
    "level": 1,
    "active": True,
}
# A driver who exists but has no discounts: the list must be empty, not a 404. They
# are also at level 0, so they may not supervise a client's project.
DRIVER_WITHOUT_DISCOUNTS_UID = "639718a3-ea41-4533-bdb8-73ac58b3b1b2"
DRIVER_WITHOUT_DISCOUNTS = {
    "uid": DRIVER_WITHOUT_DISCOUNTS_UID,
    "username": "driver.test@example.com",
    "screen_name": "Test",
    "level": 0,
    "active": True,
}
# The driver list does not expose `username`; the rest is the same view.
DRIVER_SUMMARY = {key: value for key, value in DRIVER.items() if key != "username"}
DRIVER_WITHOUT_DISCOUNTS_SUMMARY = {
    key: value for key, value in DRIVER_WITHOUT_DISCOUNTS.items() if key != "username"
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
    "driver": {"driver_uid": DRIVER_UID, "level": 1},
}
# A user with no password set: they exist, but cannot authenticate.
USER_WITHOUT_CREDENTIAL = {
    "uid": "214912a9-2cc4-4205-87b7-93ea71f6be72",
    "username": "driver.test@example.com",
    "screen_name": "Test",
    "active": True,
    "driver": {"driver_uid": DRIVER_WITHOUT_DISCOUNTS_UID, "level": 0},
}
# A user who is not a driver at all: `driver` is null, not absent. They must not show
# up anywhere a driver is asked for.
CLIENT = {
    "uid": "adf36d8c-7ee7-4cd8-9c87-73cb4c81ec07",
    "username": "client@example.com",
    "screen_name": "Client",
    "active": True,
    "driver": None,
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
    database[db.DISCOUNTS].insert_one(dict(DISCOUNT))
    database[db.USERS].insert_many(
        [
            {**USER, "credential": dict(CREDENTIAL)},
            {**USER_WITHOUT_CREDENTIAL, "credential": None},
            {**CLIENT, "credential": None},
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


def test_configurations_listed(client):
    # Both the documents in the database: the one of anagraphics, written before
    # the import, and front-gate's. In order by subsystem.
    response = client.get("/configuration")
    assert response.status_code == 200
    assert response.json() == {
        "configurations": [ANAGRAPHICS_CONFIGURATION, {"subsystem": "front-gate"}]
    }


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
    response = client.post("/projects", json=a_project("submission-000000000000001"))
    assert response.status_code == 201
    project = response.json()
    # The id is generated by anagraphics: a UUID v4 in canonical form.
    assert len(project["project_id"]) == 36 and project["project_id"][14] == "4"
    assert project["owner_uid"] == OWNER_UID
    assert project["pipeline"] == {"state": "PREANALYSIS", "steps": []}
    assert "state" not in project
    # The driver is **copied** onto the project, not named: the caller sent a uid
    # and anagraphics, which owns the drivers, wrote what one is.
    assert project["review"] == {
        "driver": {"uid": DRIVER_UID, "screen_name": "Dome", "username": USERNAME},
        "preset": True,
    }
    assert project["billing"] == {
        "discount_code": DISCOUNT_CODE,
        "autonomous_work": False,
        "ambassador_uid": None,
    }
    assert "referral" not in project
    assert project["created_at"]

    stored = client.get(f"/projects/{project['project_id']}")
    assert stored.status_code == 200
    assert stored.json()["submission_id"] == "submission-000000000000001"


def test_create_project_twice_returns_the_same(client):
    first = client.post("/projects", json=a_project("submission-000000000000002"))
    second = client.post("/projects", json=a_project("submission-000000000000002"))
    assert first.status_code == 201
    assert second.status_code == 200
    assert second.json()["project_id"] == first.json()["project_id"]
    assert database[db.PROJECTS].count_documents({"submission_id": "submission-000000000000002"}) == 1


def test_create_project_with_submission_of_another_user(client):
    client.post("/projects", json=a_project("submission-000000000000003"))
    response = client.post("/projects", json=a_project("submission-000000000000003", "another"))
    assert response.status_code == 409
    assert response.json() == {"error": "SUBMISSION_EXISTS"}


def test_a_driver_is_assigned_to_a_project_that_had_none(client):
    """What the analyst does once it has judged: the pool chose, and the project is
    given a copy of that driver."""
    project = client.post("/projects", json={
        "owner_uid": OWNER_UID, "submission_id": "submission-000000000000101",
    }).json()
    assert project["review"]["driver"] is None

    response = client.put(
        f"/projects/{project['project_id']}/review/driver", json={"driver_uid": DRIVER_UID}
    )
    assert response.status_code == 200
    assert response.json()["review"] == {
        "driver": {"uid": DRIVER_UID, "screen_name": "Dome", "username": USERNAME},
        # Untouched: it says how the driver got there, and one arriving through this
        # route did not get there by being preset.
        "preset": False,
    }


def test_assigning_the_same_driver_again_leaves_the_project_as_it_was(client):
    """`PUT`, so it is also how a stale copy is refreshed: the same call rereads the
    driver and writes what they are now."""
    project = client.post("/projects", json={
        "owner_uid": OWNER_UID, "submission_id": "submission-000000000000102",
    }).json()
    path = f"/projects/{project['project_id']}/review/driver"
    first = client.put(path, json={"driver_uid": DRIVER_UID}).json()
    again = client.put(path, json={"driver_uid": DRIVER_UID}).json()
    assert first["review"] == again["review"]


def test_a_driver_who_does_not_exist_is_not_copied_onto_anything(client):
    """Inventing a copy would put a name on a project that no driver answers to."""
    project = client.post("/projects", json={
        "owner_uid": OWNER_UID, "submission_id": "submission-000000000000103",
    }).json()
    response = client.put(
        f"/projects/{project['project_id']}/review/driver",
        json={"driver_uid": "11111111-2222-3333-4444-555555555555"},
    )
    assert response.status_code == 404
    assert response.json()["error"] == "DRIVER_NOT_FOUND"
    assert client.get(f"/projects/{project['project_id']}").json()["review"]["driver"] is None


def test_assigning_a_driver_to_a_project_that_is_not_there(client):
    response = client.put(
        "/projects/99999999-8888-7777-6666-555555555555/review/driver",
        json={"driver_uid": DRIVER_UID},
    )
    assert response.status_code == 404
    assert response.json()["error"] == "PROJECT_NOT_FOUND"


def test_a_review_that_predates_the_field_is_completed_and_not_half_written(client):
    """A project stored before `review` existed has no `preset`. Writing only the
    driver onto it would leave a review missing a field every review has."""
    project = client.post("/projects", json={
        "owner_uid": OWNER_UID, "submission_id": "submission-000000000000105",
    }).json()
    database[db.PROJECTS].update_one(
        {"project_id": project["project_id"]}, {"$unset": {"review": ""}}
    )
    assigned = client.put(
        f"/projects/{project['project_id']}/review/driver", json={"driver_uid": DRIVER_UID}
    ).json()
    assert assigned["review"]["preset"] is False
    assert assigned["review"]["driver"]["uid"] == DRIVER_UID


def test_a_project_never_copies_its_driver_s_level(client):
    """It is a state of the driver, not of the assignment: a driver lowered tomorrow
    would go on looking as they were on every project that copied them. The same for
    `active`, and the person's own uid has no business being there at all."""
    project = client.post("/projects", json={
        "owner_uid": OWNER_UID, "submission_id": "submission-000000000000104",
    }).json()
    assigned = client.put(
        f"/projects/{project['project_id']}/review/driver", json={"driver_uid": DRIVER_UID}
    ).json()
    assert set(assigned["review"]["driver"]) == {"uid", "screen_name", "username"}


def test_create_project_without_review_and_billing(client):
    body = {"owner_uid": OWNER_UID, "submission_id": "submission-000000000000006"}
    project = client.post("/projects", json=body).json()
    assert project["review"] == {"driver": None, "preset": False}
    assert project["billing"]["discount_code"] is None
    assert project["billing"]["ambassador_uid"] is None


def test_create_project_with_ambassador(client):
    body = a_project("submission-000000000000007")
    body["billing"] = {"ambassador_uid": DRIVER_UID}
    project = client.post("/projects", json=body).json()
    assert project["billing"]["ambassador_uid"] == DRIVER_UID


def test_create_project_invalid_body(client):
    response = client.post("/projects", json={"owner_uid": OWNER_UID})
    assert response.status_code == 400
    assert response.json() == {"error": "INVALID_BODY"}


def test_create_project_ignores_chosen_id(client):
    body = {**a_project("submission-000000000000004"), "project_id": "chosen-from-outside"}
    response = client.post("/projects", json=body)
    assert response.status_code == 201
    assert response.json()["project_id"] != "chosen-from-outside"


def test_count_projects_created(client):
    # Whatever the other tests have created, they were all created today: the
    # count of today is the count of the projects that have a `created_at`.
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    created = database[db.PROJECTS].count_documents({"created_at": {"$exists": True}})
    response = client.get("/projects/count", params={"from": today, "to": today})
    assert response.status_code == 200
    assert response.json() == {"from": today, "to": today, "projects": created}


def test_count_projects_of_a_day_with_none(client):
    response = client.get("/projects/count", params={"from": "2020-01-01", "to": "2020-01-31"})
    assert response.status_code == 200
    assert response.json()["projects"] == 0


def test_count_projects_refuses_a_period_that_is_not_one(client):
    backwards = client.get("/projects/count", params={"from": "2026-02-02", "to": "2026-01-01"})
    assert backwards.status_code == 400
    assert backwards.json() == {"error": "INVALID_RANGE", "day": "2026-02-02"}

    not_a_day = client.get("/projects/count", params={"from": "yesterday", "to": "2026-01-01"})
    assert not_a_day.status_code == 400
    assert not_a_day.json() == {"error": "INVALID_RANGE", "day": "yesterday"}


def test_count_is_a_route_and_not_a_project_id(client):
    # `/projects/count` is declared before `/projects/{project_id}`: were it not,
    # the count would be read as the id of a project called "count".
    response = client.get("/projects/count", params={"from": "2026-01-01", "to": "2026-01-01"})
    assert response.status_code == 200
    assert "project_id" not in response.json()


def a_prevalidation_step(result="passed", state="PREANALYSIS"):
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
    project_id = client.post("/projects", json=a_project("submission-000000000000010")).json()["project_id"]

    response = client.post(f"/projects/{project_id}/pipeline/steps", json=a_prevalidation_step())
    assert response.status_code == 201
    pipeline = response.json()["pipeline"]
    assert pipeline["state"] == "PREANALYSIS"
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
    project_id = client.post("/projects", json=a_project("submission-000000000000011")).json()["project_id"]

    client.post(f"/projects/{project_id}/pipeline/steps", json=a_prevalidation_step(result="failed"))
    client.post(f"/projects/{project_id}/pipeline/steps", json=a_prevalidation_step())

    steps = client.get(f"/projects/{project_id}").json()["pipeline"]["steps"]
    assert [step["result"] for step in steps] == ["failed", "passed"]


def test_add_pipeline_step_rejecting(client):
    project_id = client.post("/projects", json=a_project("submission-000000000000012")).json()["project_id"]

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
    project_id = client.post("/projects", json=a_project("submission-000000000000014")).json()["project_id"]
    back = a_prevalidation_step(result="underspecified", state="UNDERSPECIFIED")

    client.post(f"/projects/{project_id}/pipeline/steps", json=back)
    response = client.post(f"/projects/{project_id}/pipeline/steps", json=back)

    pipeline = response.json()["pipeline"]
    assert pipeline["state"] == "UNDERSPECIFIED"
    assert [step["result"] for step in pipeline["steps"]] == ["underspecified", "underspecified"]

    # The project is not closed: rewritten, the request passes.
    response = client.post(f"/projects/{project_id}/pipeline/steps", json=a_prevalidation_step())
    assert response.json()["pipeline"]["state"] == "PREANALYSIS"


def test_add_pipeline_step_of_unknown_project(client):
    response = client.post("/projects/does-not-exist/pipeline/steps", json=a_prevalidation_step())
    assert response.status_code == 404
    assert response.json() == {"error": "PROJECT_NOT_FOUND", "project_id": "does-not-exist"}


def test_add_pipeline_step_with_invented_names(client):
    project_id = client.post("/projects", json=a_project("submission-000000000000013")).json()["project_id"]

    for field, value in (("step", "invented"), ("state", "NONSENSE"), ("result", "maybe")):
        body = {**a_prevalidation_step(), field: value}
        response = client.post(f"/projects/{project_id}/pipeline/steps", json=body)
        assert response.status_code == 400, field
        assert response.json() == {"error": "INVALID_BODY"}

    # None of the attempts left a trace.
    assert client.get(f"/projects/{project_id}").json()["pipeline"]["steps"] == []


def test_delete_project(client):
    project_id = client.post("/projects", json=a_project("submission-000000000000005")).json()["project_id"]
    assert client.delete(f"/projects/{project_id}").status_code == 204
    assert client.get(f"/projects/{project_id}").status_code == 404
    response = client.delete(f"/projects/{project_id}")
    assert response.status_code == 404
    assert response.json() == {"error": "PROJECT_NOT_FOUND", "project_id": project_id}


# ------------------------------------------------------------ listing projects
#
# These projects are inserted straight into Mongo rather than through the API: the
# list is asked about a driver, an owner and a state, and the tests above create
# projects of their own along the way. Their own owner, their own driver and states no
# other test uses make every assertion below about exactly these three documents.
LISTED_OWNER = "5c0e7e08-0f4e-4f6f-8f1c-0b3f4a2d9e11"
LISTED_DRIVER = "b0b0f3d2-9a2e-4c1f-9f0a-1d2c3b4a5e60"


# Three moments of today, in order. Today because the count of the day counts every
# project that has a `created_at`, and a project dated last week would make that count
# disagree with its own premise. The day is taken from the clock and not written down,
# or these tests would start failing on their own tomorrow.
def today_at(hour: int) -> datetime:
    return datetime.now(timezone.utc).replace(hour=hour, minute=0, second=0, microsecond=0)


def a_step(name: str, result: str, data: dict | None = None) -> dict:
    return {
        "step": name,
        "result": result,
        "data": data or {},
        "decided_at": datetime(2026, 9, 20, 12, 0, tzinfo=timezone.utc),
    }


LISTED_PROJECTS = [
    # Two steps, so the slice has something to leave out, and the last one says why
    # the run failed — which is what a list has to be able to show.
    {
        "project_id": "aa000000-0000-4000-8000-000000000001",
        "owner_uid": LISTED_OWNER,
        "created_at": today_at(10),
        "description": "Tracks the team's attendance at training.",
        "pipeline": {
            "state": "DEMO",
            "steps": [a_step("preanalysis", "open"), a_step("analysis", "failed", {"failed_at": "technical"})],
        },
        "review": {"driver": {"uid": LISTED_DRIVER, "screen_name": "Dome"}, "preset": True},
        "billing": {},
    },
    {
        "project_id": "aa000000-0000-4000-8000-000000000002",
        "owner_uid": LISTED_OWNER,
        "created_at": today_at(11),
        "pipeline": {"state": "PAID", "steps": [a_step("payment", "passed")]},
        "review": {"driver": None, "preset": False},
        "billing": {},
    },
    {
        "project_id": "aa000000-0000-4000-8000-000000000003",
        "owner_uid": "another-owner-entirely",
        "created_at": today_at(12),
        "pipeline": {"state": "ALPHA_TEST", "steps": [a_step("alpha_test", "open")]},
        "review": {"driver": {"uid": LISTED_DRIVER, "screen_name": "Dome"}, "preset": False},
        "billing": {},
    },
]


@pytest.fixture(scope="module", autouse=True)
def listed_projects(seeded_database):
    database[db.PROJECTS].insert_many([dict(project) for project in LISTED_PROJECTS])
    yield
    database[db.PROJECTS].delete_many(
        {"project_id": {"$in": [project["project_id"] for project in LISTED_PROJECTS]}}
    )


def ids_of(response) -> list[str]:
    return [project["project_id"] for project in response.json()["projects"]]


def test_projects_of_an_owner_newest_first(client):
    response = client.get("/projects", params={"owner_uid": LISTED_OWNER})
    assert response.status_code == 200
    assert ids_of(response) == [
        "aa000000-0000-4000-8000-000000000002",
        "aa000000-0000-4000-8000-000000000001",
    ]


def test_projects_of_a_driver(client):
    response = client.get("/projects", params={"driver_uid": LISTED_DRIVER})
    assert response.status_code == 200
    assert ids_of(response) == [
        "aa000000-0000-4000-8000-000000000003",
        "aa000000-0000-4000-8000-000000000001",
    ]


def test_projects_nobody_supervises(client):
    # The state narrows it to this test's own project: the tests above leave projects
    # with no driver behind them, and they are all in states this one does not ask for.
    response = client.get("/projects", params={"without_driver": "true", "state": "PAID"})
    assert response.status_code == 200
    assert ids_of(response) == ["aa000000-0000-4000-8000-000000000002"]


def test_a_state_may_be_repeated_and_means_any_of_them(client):
    response = client.get(
        "/projects", params=[("driver_uid", LISTED_DRIVER), ("state", "DEMO"), ("state", "ALPHA_TEST")]
    )
    assert response.status_code == 200
    assert ids_of(response) == [
        "aa000000-0000-4000-8000-000000000003",
        "aa000000-0000-4000-8000-000000000001",
    ]


def test_a_state_no_project_is_in_is_an_empty_list(client):
    response = client.get("/projects", params={"driver_uid": LISTED_DRIVER, "state": "REJECTED"})
    assert response.status_code == 200
    assert response.json() == {"projects": []}


def test_an_owner_with_no_projects_is_an_empty_list(client):
    response = client.get("/projects", params={"owner_uid": "nobody-at-all"})
    assert response.status_code == 200
    assert response.json() == {"projects": []}


def test_a_listed_project_carries_only_its_last_step(client):
    response = client.get("/projects", params={"owner_uid": LISTED_OWNER})
    listed = next(
        project
        for project in response.json()["projects"]
        if project["project_id"] == "aa000000-0000-4000-8000-000000000001"
    )
    steps = listed["pipeline"]["steps"]
    assert len(steps) == 1
    # The last one, and it is the one that says why the run stopped.
    assert steps[0]["step"] == "analysis"
    assert steps[0]["data"] == {"failed_at": "technical"}
    # The rest of the project is whole: the slice takes away steps, not fields.
    assert listed["description"] == "Tracks the team's attendance at training."
    assert listed["pipeline"]["state"] == "DEMO"


def test_projects_with_two_filters_at_once(client):
    response = client.get("/projects", params={"owner_uid": LISTED_OWNER, "driver_uid": LISTED_DRIVER})
    assert response.status_code == 400
    assert response.json() == {"error": "INVALID_QUERY"}


def test_projects_with_no_filter(client):
    response = client.get("/projects")
    assert response.status_code == 400
    assert response.json() == {"error": "INVALID_QUERY"}


def test_without_driver_false_names_no_filter(client):
    response = client.get("/projects", params={"without_driver": "false"})
    assert response.status_code == 400
    assert response.json() == {"error": "INVALID_QUERY"}


def test_a_state_that_does_not_exist(client):
    for state in ("NONSENSE", ""):
        response = client.get("/projects", params={"owner_uid": LISTED_OWNER, "state": state})
        assert response.status_code == 400, state
        assert response.json() == {"error": "INVALID_QUERY"}, state


# --------------------------------------------------------- the description


def test_description_is_written_onto_the_project(client):
    project_id = client.post("/projects", json=a_project("submission-000000000000010")).json()["project_id"]
    response = client.put(f"/projects/{project_id}/description", json={"description": "  A scoreboard for the league.  "})
    assert response.status_code == 200
    # Written, and with the spaces taken off.
    assert response.json()["description"] == "A scoreboard for the league."
    assert client.get(f"/projects/{project_id}").json()["description"] == "A scoreboard for the league."


def test_description_is_rewritten(client):
    project_id = client.post("/projects", json=a_project("submission-000000000000011")).json()["project_id"]
    client.put(f"/projects/{project_id}/description", json={"description": "The first one."})
    response = client.put(f"/projects/{project_id}/description", json={"description": "The second one."})
    assert response.status_code == 200
    assert response.json()["description"] == "The second one."


def test_description_of_a_project_that_is_not_there(client):
    response = client.put("/projects/unknown/description", json={"description": "Anything."})
    assert response.status_code == 404
    assert response.json() == {"error": "PROJECT_NOT_FOUND", "project_id": "unknown"}


def test_an_empty_description_is_not_a_description(client):
    project_id = client.post("/projects", json=a_project("submission-000000000000012")).json()["project_id"]
    for body in ({"description": ""}, {"description": "   "}, {}):
        response = client.put(f"/projects/{project_id}/description", json=body)
        assert response.status_code == 400, body
        assert response.json() == {"error": "INVALID_BODY"}, body
    assert "description" not in client.get(f"/projects/{project_id}").json()


def test_driver_found(client):
    response = client.get(f"/drivers/{DRIVER_UID}")
    assert response.status_code == 200
    assert response.json() == DRIVER


def test_drivers_list(client):
    response = client.get("/drivers")
    assert response.status_code == 200
    # Sorted by the driver's uid: 639718a3… comes before 7633be3d…
    # `username` must not appear in the list.
    assert response.json() == {"drivers": [DRIVER_WITHOUT_DISCOUNTS_SUMMARY, DRIVER_SUMMARY]}


def test_a_user_who_is_not_a_driver_is_not_in_the_list(client):
    uids = [driver["uid"] for driver in client.get("/drivers").json()["drivers"]]
    assert CLIENT["uid"] not in uids
    # And their own uid is not a driver's uid either: asking for it is a 404.
    assert client.get(f"/drivers/{CLIENT['uid']}").status_code == 404


def test_a_driver_route_does_not_let_the_person_out(client):
    """The driver is read out of a user document, which also holds the password."""
    body = client.get(f"/drivers/{DRIVER_UID}").json()
    for field in ("credential", "billing", "locale"):
        assert field not in body, field
    # The uid published is the driver's, never the person's.
    assert body["uid"] == DRIVER_UID
    assert body["uid"] != USER_UID


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


def test_a_discount_is_created_for_a_driver(client):
    response = client.post(f"/drivers/{DRIVER_UID}/discounts", json={"percentage": 3})
    assert response.status_code == 201
    created = response.json()
    # The code is generated here: the caller does not choose it.
    assert len(created["discount_code"]) == 36
    assert created["percentage"] == 3
    # The driver's name is copied out of the user who is that driver.
    assert created["driver"] == {"uid": DRIVER_UID, "screen_name": "Dome"}
    # And it can be read back, both on its own and in the driver's list.
    assert client.get(f"/discounts/{created['discount_code']}").json() == created
    codes = [
        discount["discount_code"]
        for discount in client.get(f"/drivers/{DRIVER_UID}/discounts").json()["discounts"]
    ]
    assert created["discount_code"] in codes


def test_two_discounts_at_the_same_percentage_are_two_codes(client):
    # Nothing here refuses a second code at a percentage that already has one: whether
    # to reuse one is the caller's rule, and this route stores what it is asked for.
    first = client.post(f"/drivers/{DRIVER_UID}/discounts", json={"percentage": 4}).json()
    second = client.post(f"/drivers/{DRIVER_UID}/discounts", json={"percentage": 4}).json()
    assert first["discount_code"] != second["discount_code"]


def test_a_discount_for_a_driver_who_does_not_exist(client):
    response = client.post("/drivers/unknown/discounts", json={"percentage": 3})
    assert response.status_code == 404
    assert response.json() == {"error": "DRIVER_NOT_FOUND", "uid": "unknown"}


def test_a_discount_for_the_person_and_not_the_driver(client):
    # The person's uid is not the driver's: a code points at the driver, and this is
    # the one mistake a caller can make that would otherwise write a code nobody owns.
    response = client.post(f"/drivers/{USER_UID}/discounts", json={"percentage": 3})
    assert response.status_code == 404
    assert response.json() == {"error": "DRIVER_NOT_FOUND", "uid": USER_UID}


def test_a_percentage_that_is_not_one(client):
    for percentage in (0, -5, 101, 1.5, "three", None):
        response = client.post(f"/drivers/{DRIVER_UID}/discounts", json={"percentage": percentage})
        assert response.status_code == 400, percentage
        assert response.json() == {"error": "INVALID_BODY"}, percentage


def test_user_found(client):
    response = client.get(f"/users/{USERNAME}")
    assert response.status_code == 200
    # The ordinary read does not contain the credential block.
    assert response.json() == USER


def test_user_not_found(client):
    response = client.get("/users/nobody@example.com")
    assert response.status_code == 404
    assert response.json() == {"error": "USER_NOT_FOUND", "username": "nobody@example.com"}


def test_user_found_by_uid(client):
    """The read whoever has to say something to a client does: the project keeps the
    uid, and the address is here."""
    response = client.get("/users", params={"uid": USER["uid"]})
    assert response.status_code == 200
    assert response.json() == USER


def test_user_not_found_by_uid(client):
    response = client.get("/users", params={"uid": "no-such-uid"})
    assert response.status_code == 404
    assert response.json() == {"error": "USER_NOT_FOUND", "uid": "no-such-uid"}


def test_a_user_asked_for_without_a_uid(client):
    response = client.get("/users")
    assert response.status_code == 400
    assert response.json() == {"error": "INVALID_BODY"}


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
    response = client.get("/users/nobody@example.com/credential")
    assert response.status_code == 404
    assert response.json() == {"error": "USER_NOT_FOUND", "username": "nobody@example.com"}


def test_session_lifecycle(client):
    token = "token-for-test-0000000000000001"
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
    token = "token-for-test-0000000000000002"
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
    response = client.put("/users/nobody@example.com/locale", json={"locale": "it"})
    assert response.status_code == 404
    assert response.json()["error"] == "USER_NOT_FOUND"


def test_locale_must_be_a_language_code(client):
    for body in ({"locale": "Italian"}, {"locale": ""}, {}):
        response = client.put(f"/users/{USERNAME}/locale", json=body)
        assert response.status_code == 400
        assert response.json() == {"error": "INVALID_BODY"}


def test_session_locale(client):
    token = "token-for-test-0000000000000009"
    payload = {**a_session(token), "data": {"screen_name": "Dome"}}
    assert client.post("/sessions", json=payload).status_code == 201
    response = client.put(f"/sessions/{token}/locale", json={"locale": "en"})
    assert response.status_code == 200
    # The other session data stays.
    assert response.json()["data"] == {"screen_name": "Dome", "locale": "en"}
    client.delete(f"/sessions/{token}")


def test_session_locale_of_unknown_session(client):
    response = client.put("/sessions/token-unknown-0000000000000/locale", json={"locale": "en"})
    assert response.status_code == 404
    assert response.json() == {"error": "SESSION_NOT_FOUND"}


def test_session_expired_is_still_returned(client):
    # The expiry is judged by the sso: here the session is returned anyway, until
    # Mongo's TTL has removed it.
    token = "token-for-test-0000000000000003"
    expired = {**a_session(token), "expires_at": "2020-01-01T00:00:00Z"}
    assert client.post("/sessions", json=expired).status_code == 201
    read = client.get(f"/sessions/{token}")
    assert read.status_code == 200
    assert read.json()["expires_at"] == "2020-01-01T00:00:00Z"
    client.delete(f"/sessions/{token}")


def test_session_duplicate_token(client):
    token = "token-for-test-0000000000000004"
    assert client.post("/sessions", json=a_session(token)).status_code == 201
    duplicate = client.post("/sessions", json=a_session(token))
    assert duplicate.status_code == 409
    assert duplicate.json() == {"error": "SESSION_EXISTS", "token": token}
    client.delete(f"/sessions/{token}")


def test_session_invalid_body(client):
    # Token too short, missing fields, unreadable date: one code only.
    for payload in (
        {},
        {**a_session("short"), "token": "short"},
        {**a_session("token-for-test-0000000000000005"), "expires_at": "tomorrow"},
    ):
        response = client.post("/sessions", json=payload)
        assert response.status_code == 400
        assert response.json() == {"error": "INVALID_BODY"}


def test_session_not_found(client):
    response = client.get("/sessions/does-not-exist")
    assert response.status_code == 404
    assert response.json() == {"error": "SESSION_NOT_FOUND"}


def test_delete_sessions_of_user(client):
    tokens = ["token-for-test-0000000000000006", "token-for-test-0000000000000007"]
    for token in tokens:
        client.post("/sessions", json=a_session(token))
    # Another user's session: it must not be touched.
    other = "token-for-test-0000000000000008"
    client.post("/sessions", json=a_session(other, uid="other-uid"))

    response = client.delete(f"/sessions?uid={USER_UID}")
    assert response.status_code == 200
    assert response.json() == {"uid": USER_UID, "deleted": 2}
    assert client.get(f"/sessions/{other}").status_code == 200
    client.delete(f"/sessions/{other}")


def a_ticket(ticket: str, token: str = "token-for-test-0000000000000100") -> dict:
    return {
        "ticket": ticket,
        "token": token,
        "service": "http://127.0.0.1:9200",
        "issued_at": "2026-09-21T10:00:00Z",
        "expires_at": "2026-09-21T10:01:00Z",
    }


def test_ticket_is_consumed_once(client):
    ticket = "ticket-for-test-000000000001"
    created = client.post("/tickets", json=a_ticket(ticket))
    assert created.status_code == 201
    assert created.json() == {
        "ticket": ticket,
        "token": "token-for-test-0000000000000100",
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
    ticket = "ticket-for-test-000000000002"
    assert client.post("/tickets", json=a_ticket(ticket)).status_code == 201
    duplicate = client.post("/tickets", json=a_ticket(ticket))
    assert duplicate.status_code == 409
    assert duplicate.json() == {"error": "TICKET_EXISTS"}
    client.delete(f"/tickets/{ticket}")


def test_ticket_invalid_body(client):
    for payload in ({}, {**a_ticket("short"), "ticket": "short"}):
        response = client.post("/tickets", json=payload)
        assert response.status_code == 400
        assert response.json() == {"error": "INVALID_BODY"}


def test_delete_sessions_of_user_without_sessions(client):
    response = client.delete("/sessions?uid=nobody")
    assert response.status_code == 200
    assert response.json() == {"uid": "nobody", "deleted": 0}


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
        "/sessions/anything",
        "/nope",
    )
    for path in paths:
        response = outsider.get(path)
        assert response.status_code == 403
        assert response.json() == {"error": "IP_NOT_ALLOWED"}

    # Writes too: the IP pool comes before everything else.
    for response in (
        outsider.post("/sessions", json=a_session("token-from-outside-000000000000001")),
        outsider.delete("/sessions/anything"),
        outsider.post("/projects", json=a_project("submission-from-outside-0000001")),
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


def an_open_preanalysis_step(turns: int = 5) -> dict:
    return {
        "step": "preanalysis",
        "result": "open",
        "state": "PREANALYSIS",
        "data": {"turns_left": turns, "chat": []},
    }


def test_open_step_can_be_updated(client):
    project_id = client.post("/projects", json=a_project("submission-000000000000030")).json()["project_id"]
    client.post(f"/projects/{project_id}/pipeline/steps", json=an_open_preanalysis_step())

    response = client.patch(
        f"/projects/{project_id}/pipeline/steps/preanalysis",
        json={"set": {"turns_left": 4}, "push": {"chat": [{"role": "client", "text": "hello"}]}},
    )
    assert response.status_code == 200
    step = response.json()["pipeline"]["steps"][-1]
    assert step["data"]["turns_left"] == 4
    assert [m["text"] for m in step["data"]["chat"]] == ["hello"]


def test_open_step_push_appends_in_order(client):
    project_id = client.post("/projects", json=a_project("submission-000000000000031")).json()["project_id"]
    client.post(f"/projects/{project_id}/pipeline/steps", json=an_open_preanalysis_step())

    client.patch(f"/projects/{project_id}/pipeline/steps/preanalysis", json={"push": {"chat": [{"text": "one"}]}})
    response = client.patch(
        f"/projects/{project_id}/pipeline/steps/preanalysis",
        json={"push": {"chat": [{"text": "two"}, {"text": "three"}]}},
    )
    assert [m["text"] for m in response.json()["pipeline"]["steps"][-1]["data"]["chat"]] == ["one", "two", "three"]


def test_closed_step_is_not_updated(client):
    """A step that has decided something is not rewritten: it is the register of decisions."""
    project_id = client.post("/projects", json=a_project("submission-000000000000032")).json()["project_id"]
    client.post(f"/projects/{project_id}/pipeline/steps", json=a_prevalidation_step())

    response = client.patch(
        f"/projects/{project_id}/pipeline/steps/prevalidation", json={"set": {"outcome": "ultrasafe"}}
    )
    assert response.status_code == 404
    assert response.json()["error"] == "OPEN_STEP_NOT_FOUND"


def test_update_step_without_project(client):
    response = client.patch(
        "/projects/00000000-0000-0000-0000-000000000000/pipeline/steps/preanalysis", json={"set": {"turns_left": 1}}
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
    response = client.post("/users/nobody/billing/turns/spend", json={"turns": 1})
    assert response.status_code == 404
    assert response.json()["error"] == "USER_NOT_FOUND"


def test_turns_must_be_positive(client):
    """The direction is said by the route: a zero or a negative is not a way of saying the other one."""
    assert client.post(f"/users/{OWNER_UID}/billing/turns/spend", json={"turns": 0}).status_code == 400
    assert client.post(f"/users/{OWNER_UID}/billing/turns/grant", json={"turns": -3}).status_code == 400


# --- the price of what a provider consumes -----------------------------------
#
# The document is made up: the route must write into any provider object, not
# into the ones the system happens to have today. It is inserted and removed by
# the test, so the other tests see the collection they expect.

DOORS_CONFIGURATION = {
    "subsystem": "doors",
    # A door: a provider object under the section that door reads.
    "prevalidation": {
        "providers": {"example": {"model": "example-small", "max_tokens": 512}},
        "timeout_ms": 20000,
    },
    # A provider object belonging to no door: it is one all the same.
    "providers": {"example": {"token_kinds": ["input", "output"]}},
    "listen": {"host": "127.0.0.1", "port": 9999},
}

DOOR = "prevalidation.providers.example"


@pytest.fixture
def doors():
    database[db.CONFIGURATION].replace_one(
        {"subsystem": "doors"}, dict(DOORS_CONFIGURATION), upsert=True
    )
    yield
    database[db.CONFIGURATION].delete_one({"subsystem": "doors"})


def stored(subsystem="doors"):
    return database[db.CONFIGURATION].find_one({"subsystem": subsystem}, {"_id": 0})


def test_pricing_written_into_a_door(client, doors):
    response = client.put(
        "/configuration/doors/pricing",
        json={
            "provider_path": DOOR,
            "currency": "USD",
            "cents_per_million_tokens": {"input": 1500, "output": 7500},
        },
    )
    assert response.status_code == 200
    pricing = response.json()["pricing"]
    assert pricing["currency"] == "USD"
    assert pricing["cents_per_million_tokens"] == {"input": 1500, "output": 7500}
    # The date is written here, not taken from the body.
    assert pricing["updated_at"].endswith("Z")
    assert stored()["prevalidation"]["providers"]["example"]["pricing"] == pricing


def test_pricing_leaves_the_rest_of_the_document_alone(client, doors):
    client.put(
        "/configuration/doors/pricing",
        json={"provider_path": DOOR, "currency": "USD", "cents_per_million_tokens": {"input": 1}},
    )
    document = stored()
    provider = document["prevalidation"]["providers"]["example"]
    # The fields of the provider object, and everything around it.
    assert provider["model"] == "example-small"
    assert provider["max_tokens"] == 512
    assert document["prevalidation"]["timeout_ms"] == 20000
    assert document["listen"] == {"host": "127.0.0.1", "port": 9999}
    assert document["providers"]["example"] == {"token_kinds": ["input", "output"]}


def test_pricing_written_again_replaces_it_whole(client, doors):
    client.put(
        "/configuration/doors/pricing",
        json={
            "provider_path": DOOR,
            "currency": "USD",
            "cents_per_million_tokens": {"input": 1500, "output": 7500},
        },
    )
    second = client.put(
        "/configuration/doors/pricing",
        json={"provider_path": DOOR, "currency": "EUR", "cents_per_million_tokens": {"input": 1400}},
    )
    assert second.status_code == 200
    # A kind that is no longer priced is gone, not kept from the write before:
    # what is stored is the price that was given, whole.
    assert stored()["prevalidation"]["providers"]["example"]["pricing"] == {
        "currency": "EUR",
        "cents_per_million_tokens": {"input": 1400},
        "updated_at": second.json()["pricing"]["updated_at"],
    }


def test_pricing_of_a_provider_object_outside_a_door(client, doors):
    response = client.put(
        "/configuration/doors/pricing",
        json={
            "provider_path": "providers.example",
            "currency": "USD",
            "cents_per_million_tokens": {"input": 10},
        },
    )
    assert response.status_code == 200
    assert stored()["providers"]["example"]["pricing"]["cents_per_million_tokens"] == {"input": 10}


def test_pricing_of_a_kind_nobody_here_has_heard_of(client, doors):
    """No list of kinds exists in this subsystem: a provider names its own."""
    response = client.put(
        "/configuration/doors/pricing",
        json={
            "provider_path": DOOR,
            "currency": "USD",
            "cents_per_million_tokens": {"moonbeams": 3, "cache_write": 1875},
        },
    )
    assert response.status_code == 200
    assert response.json()["pricing"]["cents_per_million_tokens"] == {
        "moonbeams": 3,
        "cache_write": 1875,
    }


def test_pricing_of_a_subsystem_that_is_not_there(client):
    response = client.put(
        "/configuration/unknown/pricing",
        json={"provider_path": DOOR, "currency": "USD", "cents_per_million_tokens": {"input": 1}},
    )
    assert response.status_code == 404
    assert response.json() == {"error": "CONFIGURATION_NOT_FOUND", "subsystem": "unknown"}


def test_pricing_of_a_path_the_document_does_not_hold(client, doors):
    response = client.put(
        "/configuration/doors/pricing",
        json={
            "provider_path": "analysis.providers.example",
            "currency": "USD",
            "cents_per_million_tokens": {"input": 1},
        },
    )
    assert response.status_code == 404
    assert response.json() == {"error": "PROVIDER_NOT_FOUND", "path": "analysis.providers.example"}


def test_pricing_of_something_that_is_not_a_provider_object(client, doors):
    """A field that is there, and is not a provider object: two different mistakes."""
    for path in ("listen", "prevalidation.providers.example.model", "prevalidation.timeout_ms"):
        response = client.put(
            "/configuration/doors/pricing",
            json={"provider_path": path, "currency": "USD", "cents_per_million_tokens": {"input": 1}},
        )
        assert response.status_code == 400, path
        assert response.json() == {"error": "NOT_A_PROVIDER_OBJECT", "path": path}
    # Nothing was written anywhere.
    assert "pricing" not in stored()["listen"]


def test_pricing_bodies_that_are_not_a_price(client, doors):
    bodies = [
        # Not a whole number of hundredths, and not a positive one.
        {"provider_path": DOOR, "currency": "USD", "cents_per_million_tokens": {"input": -1}},
        {"provider_path": DOOR, "currency": "USD", "cents_per_million_tokens": {"input": 1.5}},
        # A price with nothing priced in it.
        {"provider_path": DOOR, "currency": "USD", "cents_per_million_tokens": {}},
        # A currency that is not written as a currency is.
        {"provider_path": DOOR, "currency": "dollars", "cents_per_million_tokens": {"input": 1}},
        {"provider_path": DOOR, "currency": "usd", "cents_per_million_tokens": {"input": 1}},
        # A kind that Mongo could not hold as a field.
        {"provider_path": DOOR, "currency": "USD", "cents_per_million_tokens": {"in.put": 1}},
        {"provider_path": DOOR, "currency": "USD", "cents_per_million_tokens": {"$input": 1}},
        # A path whose keys are not keys.
        {"provider_path": "a..providers.b", "currency": "USD", "cents_per_million_tokens": {"input": 1}},
        {"provider_path": "", "currency": "USD", "cents_per_million_tokens": {"input": 1}},
    ]
    for body in bodies:
        response = client.put("/configuration/doors/pricing", json=body)
        assert response.status_code == 400, body
        assert response.json() == {"error": "INVALID_BODY"}, body
    assert "pricing" not in stored()["prevalidation"]["providers"]["example"]
