import os

# I test usano un database separato, cancellato alla fine.
os.environ["MONGO_DB"] = "webtools_test"
os.environ["ALLOWED_IPS"] = "127.0.0.1,::1"

import pytest
from fastapi.testclient import TestClient
from pymongo.errors import ServerSelectionTimeoutError

from webtools_anagraphics import db
from webtools_anagraphics.main import app, database

LOCALHOST = ("127.0.0.1", 50000)
OUTSIDER = ("10.0.0.1", 50000)

DRIVER_UID = "7633be3d-e701-42ca-9fea-6c6d1bb4b7d1"
DRIVER = {"uid": DRIVER_UID, "username": "dome.santoro@gmail.com", "screen_name": "Dome"}
# Driver esistente ma senza sconti: la lista deve essere vuota, non un 404.
DRIVER_WITHOUT_DISCOUNTS_UID = "639718a3-ea41-4533-bdb8-73ac58b3b1b2"
DRIVER_WITHOUT_DISCOUNTS = {
    "uid": DRIVER_WITHOUT_DISCOUNTS_UID,
    "username": "driver.prova@example.com",
    "screen_name": "Prova",
}
# La lista dei driver non espone `username`.
DRIVER_SUMMARY = {"uid": DRIVER_UID, "screen_name": "Dome"}
DRIVER_WITHOUT_DISCOUNTS_SUMMARY = {
    "uid": DRIVER_WITHOUT_DISCOUNTS_UID,
    "screen_name": "Prova",
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
# Utente senza password impostata: esiste, ma non si può autenticare.
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
    database[db.ANAGRAPHICS].insert_one({"project_id": "1f251606-bdba-40c4-bbee-bfedc6e57f70"})
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
    response = client.get("/anagraphics/1f251606-bdba-40c4-bbee-bfedc6e57f70")
    assert response.status_code == 200
    assert response.json() == {"project_id": "1f251606-bdba-40c4-bbee-bfedc6e57f70"}


def test_project_not_found(client):
    response = client.get("/anagraphics/unknown")
    assert response.status_code == 404
    assert response.json() == {"error": "PROJECT_NOT_FOUND", "project_id": "unknown"}


def test_driver_found(client):
    response = client.get(f"/drivers/{DRIVER_UID}")
    assert response.status_code == 200
    assert response.json() == DRIVER


def test_drivers_list(client):
    response = client.get("/drivers")
    assert response.status_code == 200
    # Ordinati per uid: 639718a3… viene prima di 7633be3d…
    # Solo uid e screen_name: `username` non deve comparire nella lista.
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
    # La lettura normale non contiene il blocco delle credenziali.
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
    # Cancellare due volte non è la stessa cosa che aver cancellato: chi chiama
    # deve poter distinguere il token sconosciuto.
    assert client.delete(f"/sessions/{token}").json() == {"error": "SESSION_NOT_FOUND"}


def test_session_keeps_free_data(client):
    token = "token-di-prova-0000000000000002"
    payload = {**a_session(token), "data": {"subsystem": "preanalyst", "role": "driver"}}
    created = client.post("/sessions", json=payload)
    assert created.status_code == 201
    assert created.json()["data"] == {"subsystem": "preanalyst", "role": "driver"}
    client.delete(f"/sessions/{token}")


def test_session_expired_is_still_returned(client):
    # La scadenza la giudica il sso: qui la sessione si restituisce comunque,
    # finché il TTL di Mongo non l'ha rimossa.
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
    # Token troppo corto, campi mancanti, data non leggibile: un codice solo.
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
    # Sessione di un altro utente: non deve essere toccata.
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
        "service": "http://127.0.0.1:8200",
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
        "service": "http://127.0.0.1:8200",
        "issued_at": "2026-09-21T10:00:00Z",
        "expires_at": "2026-09-21T10:01:00Z",
    }

    consumed = client.delete(f"/tickets/{ticket}")
    assert consumed.status_code == 200
    assert consumed.json() == created.json()

    # Il secondo tentativo non deve riuscire: è quello che rende il biglietto
    # usa-e-getta anche se qualcuno lo ha letto da un log.
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
        "/anagraphics/1f251606-bdba-40c4-bbee-bfedc6e57f70",
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

    # Anche le scritture: il pool di IP sta prima di tutto il resto.
    for response in (
        outsider.post("/sessions", json=a_session("token-da-fuori-000000000000001")),
        outsider.delete("/sessions/qualsiasi"),
    ):
        assert response.status_code == 403
        assert response.json() == {"error": "IP_NOT_ALLOWED"}


def test_unknown_route(client):
    response = client.get("/nope")
    assert response.status_code == 404
    assert response.json() == {"error": "ROUTE_NOT_FOUND"}


def test_method_not_allowed(client):
    response = client.post("/anagraphics/1f251606-bdba-40c4-bbee-bfedc6e57f70")
    assert response.status_code == 405
    assert response.json() == {"error": "METHOD_NOT_ALLOWED"}


def test_database_unavailable(client, monkeypatch):
    def unreachable(*args):
        raise ServerSelectionTimeoutError("localhost:27017: connection refused")

    monkeypatch.setattr(db, "find_project", unreachable)
    response = client.get("/anagraphics/1f251606-bdba-40c4-bbee-bfedc6e57f70")
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
