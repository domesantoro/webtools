"""Accesso a MongoDB: collection e indici."""

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

# Nelle risposte non esponiamo l'_id interno di Mongo.
PUBLIC = {"_id": 0}

# La lista dei driver espone solo ciò che serve a identificarli e mostrarli:
# `username` esce solo dalla lettura di un singolo driver.
DRIVER_SUMMARY = {"_id": 0, "uid": 1, "screen_name": 1, "enabled": 1}

# L'utente senza il blocco delle credenziali: è la lettura normale.
USER_PUBLIC = {"_id": 0, "credential": 0}

# Il blocco delle credenziali, da solo: lo legge il sso per verificare una
# password. Qui non si verifica niente, si restituisce il dato conservato.
USER_CREDENTIAL = {"_id": 0, "username": 1, "credential": 1}


def connect(settings: Settings) -> Database:
    # tz_aware: le date delle sessioni tornano con il fuso (UTC), non nude.
    client = MongoClient(
        settings.mongo_uri,
        tz_aware=True,
        serverSelectionTimeoutMS=settings.mongo_server_selection_timeout_ms,
    )
    return client[settings.mongo_db]


def ensure_indexes(db: Database) -> None:
    db[CONFIGURATION].create_index("subsystem", unique=True)
    db[PROJECTS].create_index("project_id", unique=True)
    # L'id dell'invio del form: lo stesso invio ripetuto (doppio clic, pagina
    # ricaricata) non deve creare un secondo progetto. Sparse perché un progetto
    # può nascere anche per altre strade, senza un form alle spalle.
    db[PROJECTS].create_index("submission_id", unique=True, sparse=True)
    db[DRIVERS].create_index("uid", unique=True)
    db[DISCOUNTS].create_index("discount_code", unique=True)
    # Il driver è ridondato dentro lo sconto: serve l'indice per cercarli per driver.
    db[DISCOUNTS].create_index("driver.uid")
    # L'utente si cerca per username (è quello che si digita al login), ma l'uid
    # resta l'identificativo stabile: unico anche quello.
    db[USERS].create_index("username", unique=True)
    db[USERS].create_index("uid", unique=True)
    db[SESSIONS].create_index("token", unique=True)
    # Tutte le sessioni di un utente: serve per chiuderle in blocco.
    db[SESSIONS].create_index("uid")
    # Indice TTL: Mongo cancella la sessione quando `expires_at` è passato.
    # È solo pulizia dell'archivio, e passa ogni ~60 s: chi legge una sessione
    # deve controllare la scadenza da sé, senza fidarsi della cancellazione.
    db[SESSIONS].create_index("expires_at", expireAfterSeconds=0)
    db[TICKETS].create_index("ticket", unique=True)
    # Come per le sessioni: il TTL è pulizia. Un biglietto vive un minuto, ma
    # chi lo consuma controlla comunque la scadenza da sé.
    db[TICKETS].create_index("expires_at", expireAfterSeconds=0)


def find_configuration(db: Database, subsystem: str) -> dict | None:
    return db[CONFIGURATION].find_one({"subsystem": subsystem}, PUBLIC)


def find_project(db: Database, project_id: str) -> dict | None:
    return db[PROJECTS].find_one({"project_id": project_id}, PUBLIC)


def find_project_by_submission(db: Database, submission_id: str) -> dict | None:
    return db[PROJECTS].find_one({"submission_id": submission_id}, PUBLIC)


def insert_project(db: Database, project: dict) -> None:
    # Copia: insert_one aggiunge `_id` al dizionario che riceve.
    db[PROJECTS].insert_one(dict(project))


def append_pipeline_step(db: Database, project_id: str, step: dict, state: str) -> dict | None:
    """Accoda un passo alla pipeline del progetto e ne porta avanti lo stato.

    Una sola scrittura: `$push` e `$set` insieme, così non esiste un momento in
    cui il passo c'è e lo stato è ancora quello di prima. Restituisce il
    progetto aggiornato, oppure `None` se non esiste.
    """
    return db[PROJECTS].find_one_and_update(
        {"project_id": project_id},
        {"$push": {"pipeline.steps": step}, "$set": {"pipeline.state": state}},
        projection=PUBLIC,
        return_document=ReturnDocument.AFTER,
    )


def delete_project(db: Database, project_id: str) -> bool:
    return db[PROJECTS].delete_one({"project_id": project_id}).deleted_count == 1


def find_driver(db: Database, uid: str) -> dict | None:
    return db[DRIVERS].find_one({"uid": uid}, PUBLIC)


def list_drivers(db: Database) -> list[dict]:
    # Senza paginazione: i driver sono pochi. Ordine stabile per uid.
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
    # La lingua preferita dell'utente: il sso la rimette nella sessione al login.
    return db[USERS].find_one_and_update(
        {"username": username},
        {"$set": {"locale": locale}},
        projection=USER_PUBLIC,
        return_document=ReturnDocument.AFTER,
    )


def find_session(db: Database, token: str) -> dict | None:
    return db[SESSIONS].find_one({"token": token}, PUBLIC)


def insert_session(db: Database, session: dict) -> None:
    # Il documento arriva già fatto dal sso: qui non si genera né si valuta niente.
    # Un token ripetuto viola l'indice unico e risale come DuplicateKeyError.
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
    # Legge e cancella in un colpo solo: due richieste con lo stesso biglietto
    # non possono riuscire tutte e due, nemmeno se arrivano insieme. È l'unica
    # cosa che rende il biglietto davvero usa-e-getta.
    return db[TICKETS].find_one_and_delete({"ticket": ticket}, PUBLIC)
