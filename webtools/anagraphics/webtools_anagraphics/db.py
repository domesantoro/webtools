"""Access to MongoDB: collections and indexes."""

from pymongo import MongoClient, ReturnDocument
from pymongo.database import Database

from webtools_anagraphics.settings import Settings

CONFIGURATION = "configuration"
PROJECTS = "projects"
DRIVERS = "drivers"
DISCOUNTS = "discounts"
USERS = "users"
SESSIONS = "sessions"
TICKETS = "tickets"

# Responses never expose Mongo's internal _id.
PUBLIC = {"_id": 0}

# The driver list exposes only what is needed to identify and show them:
# `username` comes out only when reading a single driver.
DRIVER_SUMMARY = {"_id": 0, "uid": 1, "screen_name": 1, "enabled": 1}

# The user without the credential block: this is the ordinary read.
USER_PUBLIC = {"_id": 0, "credential": 0}

# The credential block on its own: the sso reads it to verify a password. Nothing
# is verified here, the stored data is returned.
USER_CREDENTIAL = {"_id": 0, "username": 1, "credential": 1}


def connect(settings: Settings) -> Database:
    # tz_aware: session dates come back with their zone (UTC), not naked.
    client = MongoClient(
        settings.mongo_uri,
        tz_aware=True,
        serverSelectionTimeoutMS=settings.mongo_server_selection_timeout_ms,
    )
    return client[settings.mongo_db]


def ensure_indexes(db: Database) -> None:
    db[CONFIGURATION].create_index("subsystem", unique=True)
    db[PROJECTS].create_index("project_id", unique=True)
    # The form submission id: the same submission repeated (double click, page
    # reloaded) must not create a second project. Sparse because a project can be
    # born by other routes too, with no form behind it.
    db[PROJECTS].create_index("submission_id", unique=True, sparse=True)
    db[DRIVERS].create_index("uid", unique=True)
    db[DISCOUNTS].create_index("discount_code", unique=True)
    # The driver is duplicated inside the discount: the index is for finding them by driver.
    db[DISCOUNTS].create_index("driver.uid")
    # A user is looked up by username (that is what is typed at login), but the uid
    # stays the stable identifier: unique as well.
    db[USERS].create_index("username", unique=True)
    db[USERS].create_index("uid", unique=True)
    db[SESSIONS].create_index("token", unique=True)
    # All of a user's sessions: needed to close them all at once.
    db[SESSIONS].create_index("uid")
    # TTL index: Mongo deletes the session once `expires_at` has passed. It is
    # only housekeeping, and it runs every ~60 s: whoever reads a session must
    # check the expiry themselves, without relying on the deletion.
    db[SESSIONS].create_index("expires_at", expireAfterSeconds=0)
    db[TICKETS].create_index("ticket", unique=True)
    # As for sessions: the TTL is housekeeping. A ticket lives one minute, but
    # whoever consumes it checks the expiry themselves all the same.
    db[TICKETS].create_index("expires_at", expireAfterSeconds=0)


def find_configuration(db: Database, subsystem: str) -> dict | None:
    return db[CONFIGURATION].find_one({"subsystem": subsystem}, PUBLIC)


def list_configurations(db: Database) -> list[dict]:
    # One document per subsystem: no pagination, a stable order by subsystem.
    # Everything that is there comes out, including a subsystem that no longer has
    # a seed file: the configuration that lives is this one, not the files'.
    return list(db[CONFIGURATION].find({}, PUBLIC).sort("subsystem"))


def find_project(db: Database, project_id: str) -> dict | None:
    return db[PROJECTS].find_one({"project_id": project_id}, PUBLIC)


def find_project_by_submission(db: Database, submission_id: str) -> dict | None:
    return db[PROJECTS].find_one({"submission_id": submission_id}, PUBLIC)


def insert_project(db: Database, project: dict) -> None:
    # A copy: insert_one adds `_id` to the dictionary it receives.
    db[PROJECTS].insert_one(dict(project))


def append_pipeline_step(db: Database, project_id: str, step: dict, state: str) -> dict | None:
    """Appends a step to the project's pipeline and moves its state forward.

    One single write: `$push` and `$set` together, so there is no moment in which
    the step is there and the state is still the previous one. Returns the updated
    project, or `None` if it does not exist.
    """
    return db[PROJECTS].find_one_and_update(
        {"project_id": project_id},
        {"$push": {"pipeline.steps": step}, "$set": {"pipeline.state": state}},
        projection=PUBLIC,
        return_document=ReturnDocument.AFTER,
    )


def update_open_step(db: Database, project_id: str, step_name: str, changes: dict) -> dict | None:
    """Updates the data of the **last** `step_name` step, only while it is open.

    Closed steps are not touched: the list is the register of the decisions taken,
    and a decision taken is not rewritten. An `open` step, on the other hand, is
    work in progress — the analysis chat, the turns still left — and grows until
    another step closes it.

    `changes` are fields of `data`, written one by one: what is not named stays as
    it was. `None` if the project is not there, or has no open step with that name.
    """
    progetto = db[PROJECTS].find_one({"project_id": project_id}, {"pipeline.steps": 1})
    if progetto is None:
        return None

    passi = progetto.get("pipeline", {}).get("steps", [])
    indice = next(
        (
            i
            for i in range(len(passi) - 1, -1, -1)
            if passi[i].get("step") == step_name and passi[i].get("result") == "open"
        ),
        None,
    )
    if indice is None:
        return None

    return db[PROJECTS].find_one_and_update(
        {"project_id": project_id},
        {"$set": {f"pipeline.steps.{indice}.data.{campo}": valore for campo, valore in changes.items()}},
        projection=PUBLIC,
        return_document=ReturnDocument.AFTER,
    )


def push_to_open_step(db: Database, project_id: str, step_name: str, field: str, values: list) -> dict | None:
    """Appends values to a list inside the data of the last open step.

    The chat needs it: messages are added at the end, and rewriting the whole list
    every turn would mean sending the entire conversation back just to make it two
    lines longer.
    """
    progetto = db[PROJECTS].find_one({"project_id": project_id}, {"pipeline.steps": 1})
    if progetto is None:
        return None

    passi = progetto.get("pipeline", {}).get("steps", [])
    indice = next(
        (
            i
            for i in range(len(passi) - 1, -1, -1)
            if passi[i].get("step") == step_name and passi[i].get("result") == "open"
        ),
        None,
    )
    if indice is None:
        return None

    return db[PROJECTS].find_one_and_update(
        {"project_id": project_id},
        {"$push": {f"pipeline.steps.{indice}.data.{field}": {"$each": values}}},
        projection=PUBLIC,
        return_document=ReturnDocument.AFTER,
    )


def delete_project(db: Database, project_id: str) -> bool:
    return db[PROJECTS].delete_one({"project_id": project_id}).deleted_count == 1


def find_driver(db: Database, uid: str) -> dict | None:
    return db[DRIVERS].find_one({"uid": uid}, PUBLIC)


def list_drivers(db: Database) -> list[dict]:
    # No pagination: there are few drivers. A stable order by uid.
    # Proiezione ridotta: niente `username` (vedi DRIVER_SUMMARY).
    return list(db[DRIVERS].find({}, DRIVER_SUMMARY).sort("uid"))


def find_discount(db: Database, discount_code: str) -> dict | None:
    return db[DISCOUNTS].find_one({"discount_code": discount_code}, PUBLIC)


def find_discounts_of_driver(db: Database, uid: str) -> list[dict]:
    return list(db[DISCOUNTS].find({"driver.uid": uid}, PUBLIC).sort("discount_code"))


def find_user(db: Database, username: str) -> dict | None:
    return db[USERS].find_one({"username": username}, USER_PUBLIC)


def find_user_credential(db: Database, username: str) -> dict | None:
    return db[USERS].find_one({"username": username}, USER_CREDENTIAL)


def set_user_locale(db: Database, username: str, locale: str) -> dict | None:
    # The user's preferred language: the sso puts it back in the session at login.
    return db[USERS].find_one_and_update(
        {"username": username},
        {"$set": {"locale": locale}},
        projection=USER_PUBLIC,
        return_document=ReturnDocument.AFTER,
    )


def spend_user_turns(db: Database, uid: str, amount: int) -> dict | None:
    """Draws `amount` turns from the user's credit, **only if there are enough**.

    The check lives in the filter, not in an earlier read: two requests at once
    cannot draw on the same credit twice, because the second no longer matches the
    condition. `None` when the credit is not enough — or the user does not exist,
    which for the caller is the same thing: nothing was drawn.
    """
    return db[USERS].find_one_and_update(
        {"uid": uid, "billing.turns_credit": {"$gte": amount}},
        {"$inc": {"billing.turns_credit": -amount}},
        projection=USER_PUBLIC,
        return_document=ReturnDocument.AFTER,
    )


def grant_user_turns(db: Database, uid: str, amount: int) -> dict | None:
    """Adds turns to the user's credit.

    The field is born here if it was not there: `$inc` on a missing field creates
    it starting from zero, and a user with no credit is a user with zero credit.
    """
    return db[USERS].find_one_and_update(
        {"uid": uid},
        {"$inc": {"billing.turns_credit": amount}},
        projection=USER_PUBLIC,
        return_document=ReturnDocument.AFTER,
    )


def find_user_by_uid(db: Database, uid: str) -> dict | None:
    return db[USERS].find_one({"uid": uid}, USER_PUBLIC)


def find_session(db: Database, token: str) -> dict | None:
    return db[SESSIONS].find_one({"token": token}, PUBLIC)


def insert_session(db: Database, session: dict) -> None:
    # The document arrives ready-made from the sso: nothing is generated or judged
    # here. A repeated token violates the unique index and surfaces as a
    # DuplicateKeyError.
    db[SESSIONS].insert_one(dict(session))


def set_session_locale(db: Database, token: str, locale: str) -> dict | None:
    return db[SESSIONS].find_one_and_update(
        {"token": token},
        {"$set": {"data.locale": locale}},
        projection=PUBLIC,
        return_document=ReturnDocument.AFTER,
    )


def delete_session(db: Database, token: str) -> bool:
    return db[SESSIONS].delete_one({"token": token}).deleted_count == 1


def delete_sessions_of_user(db: Database, uid: str) -> int:
    return db[SESSIONS].delete_many({"uid": uid}).deleted_count


def insert_ticket(db: Database, ticket: dict) -> None:
    db[TICKETS].insert_one(dict(ticket))


def consume_ticket(db: Database, ticket: str) -> dict | None:
    # Reads and deletes in one go: two requests with the same ticket cannot both
    # succeed, not even if they arrive together. It is the only thing that makes
    # the ticket genuinely single-use.
    return db[TICKETS].find_one_and_delete({"ticket": ticket}, PUBLIC)
