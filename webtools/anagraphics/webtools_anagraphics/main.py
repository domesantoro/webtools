"""API interna: configurazioni dei sottosistemi, anagrafica dei progetti, driver e
loro codici sconto, utenti e sessioni.

Le sessioni sono l'unica parte che si scrive. Qui si conservano e si restituiscono:
il token, la scadenza e la decisione su chi è autenticato appartengono al sso.
Anagraphics non verifica password e non giudica se una sessione è ancora valida.
"""

from datetime import datetime

from fastapi import FastAPI, Request, Response
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from webtools_anagraphics import db, errors
from webtools_anagraphics.settings import load_settings

settings = load_settings()
database = db.connect(settings)

app = FastAPI(title="anagraphics", version="0.4.0")
errors.install_error_handlers(app)


@app.middleware("http")
async def allow_only_known_ips(request: Request, call_next):
    # Si usa solo l'IP della connessione. Va avviato con `python -m webtools_anagraphics`
    # (proxy_headers=False), altrimenti uvicorn riscrive client.host
    # a partire da X-Forwarded-For per le richieste da localhost.
    host = request.client.host if request.client else None
    if host not in settings.allowed_ips:
        return errors.error_response(403, errors.IP_NOT_ALLOWED)
    return await call_next(request)


@app.get("/configuration/{subsystem}")
def get_configuration(subsystem: str) -> dict:
    document = db.find_configuration(database, subsystem)
    if document is None:
        raise errors.ApiError(404, errors.CONFIGURATION_NOT_FOUND, subsystem=subsystem)
    return document


@app.get("/anagraphics/{project_id}")
def get_project(project_id: str) -> dict:
    document = db.find_project(database, project_id)
    if document is None:
        raise errors.ApiError(404, errors.PROJECT_NOT_FOUND, project_id=project_id)
    return document


@app.get("/drivers")
def get_drivers() -> dict:
    return {"drivers": db.list_drivers(database)}


@app.get("/drivers/{uid}")
def get_driver(uid: str) -> dict:
    document = db.find_driver(database, uid)
    if document is None:
        raise errors.ApiError(404, errors.DRIVER_NOT_FOUND, uid=uid)
    return document


@app.get("/drivers/{uid}/discounts")
def get_discounts_of_driver(uid: str) -> dict:
    # Un driver esistente senza sconti risponde 200 con lista vuota;
    # un driver inesistente risponde 404, non una lista vuota.
    if db.find_driver(database, uid) is None:
        raise errors.ApiError(404, errors.DRIVER_NOT_FOUND, uid=uid)
    return {"uid": uid, "discounts": db.find_discounts_of_driver(database, uid)}


@app.get("/discounts/{discount_code}")
def get_discount(discount_code: str) -> dict:
    document = db.find_discount(database, discount_code)
    if document is None:
        raise errors.ApiError(404, errors.DISCOUNT_NOT_FOUND, discount_code=discount_code)
    return document


@app.get("/users/{username}")
def get_user(username: str) -> dict:
    # L'utente senza il blocco `credential`: questa è la lettura normale,
    # quella che possono fare tutti i sottosistemi del pool.
    document = db.find_user(database, username)
    if document is None:
        raise errors.ApiError(404, errors.USER_NOT_FOUND, username=username)
    return document


@app.get("/users/{username}/credential")
def get_user_credential(username: str) -> dict:
    # La sola lettura che tira fuori algoritmo, salt e hash. Serve al sso per
    # verificare una password: il confronto lo fa lui, qui non si decide niente.
    # Non c'è nessun elenco degli utenti: le credenziali si leggono una per una.
    document = db.find_user_credential(database, username)
    if document is None:
        raise errors.ApiError(404, errors.USER_NOT_FOUND, username=username)
    if not document.get("credential"):
        # Utente senza password impostata: esiste, ma non si può autenticare.
        raise errors.ApiError(404, errors.CREDENTIAL_NOT_SET, username=username)
    return document


class SessionToStore(BaseModel):
    """Il documento di sessione, costruito dal sso.

    I campi obbligatori sono quelli che servono a ritrovare la sessione e a
    sapere di chi è e fino a quando vale. Tutto il resto sta in `data`, che
    resta libero: i dati di sessione dei sottosistemi cambieranno, il contratto
    di questa API no.
    """

    token: str = Field(min_length=16)
    uid: str
    username: str
    issued_at: datetime
    expires_at: datetime
    data: dict = Field(default_factory=dict)


@app.post("/sessions", status_code=201)
def create_session(session: SessionToStore) -> dict:
    document = session.model_dump()
    try:
        db.insert_session(database, document)
    except DuplicateKeyError:
        # Token già presente: il sso lo genera casuale, quindi o è un doppio
        # invio o è un difetto di chi lo genera. In entrambi i casi non si sovrascrive.
        raise errors.ApiError(409, errors.SESSION_EXISTS, token=session.token)
    return document


@app.get("/sessions/{token}")
def get_session(token: str) -> dict:
    # Restituisce anche una sessione scaduta, finché il TTL non l'ha rimossa:
    # decidere se vale ancora è compito del sso.
    document = db.find_session(database, token)
    if document is None:
        raise errors.ApiError(404, errors.SESSION_NOT_FOUND)
    return document


@app.delete("/sessions/{token}", status_code=204)
def remove_session(token: str) -> Response:
    if not db.delete_session(database, token):
        raise errors.ApiError(404, errors.SESSION_NOT_FOUND)
    return Response(status_code=204)


class TicketToStore(BaseModel):
    """Il biglietto usa-e-getta con cui il sso passa una sessione a un sottosistema.

    Serve perché un cookie non attraversa due indirizzi diversi: il sso non può
    mettere il cookie di preanalyst. Allora manda il browser da preanalyst con un
    biglietto nell'indirizzo, e preanalyst lo scambia da dietro con la sessione.
    Il biglietto vive un minuto e vale una volta sola, quindi finire in un log o
    nella cronologia non fa danno; il token della sessione, che dura ore, non
    passa mai dall'indirizzo.
    """

    ticket: str = Field(min_length=16)
    token: str = Field(min_length=16)
    # A chi è stato dato: serve a non far scambiare a un sottosistema un
    # biglietto emesso per un altro (§ sicurezza, non ancora imposto).
    service: str
    issued_at: datetime
    expires_at: datetime


@app.post("/tickets", status_code=201)
def create_ticket(ticket: TicketToStore) -> dict:
    document = ticket.model_dump()
    try:
        db.insert_ticket(database, document)
    except DuplicateKeyError:
        raise errors.ApiError(409, errors.TICKET_EXISTS)
    return document


@app.delete("/tickets/{ticket}")
def consume_ticket(ticket: str) -> dict:
    # Cancellazione che restituisce quello che ha cancellato: è il consumo del
    # biglietto. Chi arriva secondo trova 404, ed è esattamente quello che deve
    # succedere a un biglietto già usato.
    document = db.consume_ticket(database, ticket)
    if document is None:
        raise errors.ApiError(404, errors.TICKET_NOT_FOUND)
    return document


@app.delete("/sessions")
def remove_sessions_of_user(uid: str) -> dict:
    # `DELETE /sessions?uid=…`: chiude tutte le sessioni di un utente. Non è
    # sotto /users/{username} perché qui si indica l'uid, non lo username.
    # Vale anche per un uid inesistente: la richiesta è "non deve restarne
    # nessuna", e il risultato è quello.
    return {"uid": uid, "deleted": db.delete_sessions_of_user(database, uid)}
