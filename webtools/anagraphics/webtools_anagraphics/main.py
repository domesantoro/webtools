"""API interna: configurazioni dei sottosistemi, progetti, driver e loro codici
sconto, utenti e sessioni.

Si scrivono le sessioni, i biglietti, i progetti e la lingua di utenti e sessioni. Qui si conservano e si restituiscono:
il token, la scadenza e la decisione su chi è autenticato appartengono al sso.
Anagraphics non verifica password e non giudica se una sessione è ancora valida.
"""

from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from fastapi import FastAPI, Request, Response
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from webtools_anagraphics import db, errors
from webtools_anagraphics.settings import load_settings

settings = load_settings()
database = db.connect(settings)

app = FastAPI(title="anagraphics", version="0.9.0")
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


@app.get("/projects/{project_id}")
def get_project(project_id: str) -> dict:
    document = db.find_project(database, project_id)
    if document is None:
        raise errors.ApiError(404, errors.PROJECT_NOT_FOUND, project_id=project_id)
    return document


class Review(BaseModel):
    """Chi supervisiona il progetto.

    `preset` distingue il driver preimpostato (arrivato col link di un driver, o
    il driver stesso in un lavoro autonomo) da quello assegnato dal sistema.
    Alla creazione un driver c'è solo se è preimpostato.
    """

    driver_uid: str | None = None
    preset: bool = False


class Billing(BaseModel):
    """I dati economici del progetto, così come li ha visti il form.

    Si conservano soltanto: il calcolo del prezzo non si fa qui.
    """

    # Il codice sconto del link di un driver, se c'era.
    discount_code: str | None = None
    # Lavoro autonomo: il driver porta il progetto per sé.
    autonomous_work: bool = False
    # Il driver che ha invitato l'utente a lavorare con noi, se c'era.
    ambassador_uid: str | None = None


class ProjectToCreate(BaseModel):
    owner_uid: str = Field(min_length=1)
    # L'id dell'invio del form: se arriva due volte, il progetto resta uno.
    submission_id: str = Field(min_length=16)
    review: Review = Field(default_factory=Review)
    billing: Billing = Field(default_factory=Billing)


# Gli stati della pipeline e i suoi passi. Sono un contratto: chi li scrive e chi
# li legge devono chiamarli allo stesso modo, e un nome inventato non deve poter
# entrare nel database. Il percorso è quello del flusso principale (vedi
# `contesto/02. contesto_aggiornato.md`); REJECTED è il capolinea di ogni cancello.
PipelineState = Literal[
    "PREANALYSIS",
    "PREVALIDATION",
    # La richiesta è tornata all'utente: non si riesce a giudicarla, servono più
    # dettagli. Non è un rifiuto, e da qui si riparte riscrivendo.
    "UNDERSPECIFIED",
    "ANALYSIS",
    "DRIVER_VALIDATION",
    "CLIENT_VALIDATION",
    "DEVELOPMENT",
    "ALPHA_TEST",
    "DEMO",
    "PAID",
    "REJECTED",
]

PipelineStepName = Literal[
    "prevalidation",
    "analysis",
    "driver_validation",
    "client_validation",
    "development",
    "alpha_test",
    "demo",
    "payment",
]


class PipelineStep(BaseModel):
    """Un passo compiuto sulla pipeline del progetto.

    `result` dice com'è andato il passo, `state` dove porta la pipeline: sono due
    cose diverse, perché lo stesso esito può portare in posti diversi a seconda
    del cancello. `data` è quello che il passo ha prodotto, e la sua forma la
    decide chi lo compie: qui si conserva, non si interpreta.

    `underspecified` è un passo compiuto che rimanda indietro senza chiudere
    niente: sta fra `passed` e `rejected`, e si conta — chi decide quante volte
    si può tornare indietro guarda quanti ce ne sono già.
    """

    step: PipelineStepName
    result: Literal["passed", "rejected", "underspecified", "failed"]
    state: PipelineState
    data: dict = Field(default_factory=dict)


@app.post("/projects", status_code=201)
def create_project(project: ProjectToCreate, response: Response) -> dict:
    # L'id del progetto nasce qui, dove il progetto si conserva: chi chiama non
    # può sceglierlo, quindi non può nemmeno scontrarsi con uno che esiste.
    document = {
        "project_id": str(uuid4()),
        "owner_uid": project.owner_uid,
        "submission_id": project.submission_id,
        "created_at": datetime.now(timezone.utc),
        # Dove sta il progetto lungo il flusso, e che cosa gli è successo finora.
        # `steps` è una lista in ordine, non una mappa: un passo può ripetersi, e
        # la lista è il registro delle decisioni prese sul progetto.
        "pipeline": {"state": "PREANALYSIS", "steps": []},
        "review": project.review.model_dump(),
        "billing": project.billing.model_dump(),
    }
    try:
        db.insert_project(database, document)
    except DuplicateKeyError:
        # Lo stesso invio, di nuovo: si restituisce il progetto già nato.
        # 200 e non 201, perché questa volta non si è creato niente.
        existing = db.find_project_by_submission(database, project.submission_id)
        if existing is None or existing.get("owner_uid") != project.owner_uid:
            # Un submission_id già usato da un altro: non si rivela il suo progetto.
            raise errors.ApiError(409, errors.SUBMISSION_EXISTS)
        response.status_code = 200
        return existing
    return document


@app.post("/projects/{project_id}/pipeline/steps", status_code=201)
def add_pipeline_step(project_id: str, step: PipelineStep) -> dict:
    """Accoda un passo alla pipeline e porta il progetto nello stato che il passo dice.

    `decided_at` lo mette qui, dove il passo si conserva: chi chiama non sceglie
    quando è successo. Restituisce il progetto aggiornato.
    """
    document = db.append_pipeline_step(
        database,
        project_id,
        {**step.model_dump(exclude={"state"}), "decided_at": datetime.now(timezone.utc)},
        step.state,
    )
    if document is None:
        raise errors.ApiError(404, errors.PROJECT_NOT_FOUND, project_id=project_id)
    return document


@app.delete("/projects/{project_id}", status_code=204)
def remove_project(project_id: str) -> Response:
    # Serve a chi ha creato un progetto e non è riuscito a completarlo (la
    # pre-specifica non si è potuta scrivere): meglio nessun progetto che uno vuoto.
    if not db.delete_project(database, project_id):
        raise errors.ApiError(404, errors.PROJECT_NOT_FOUND, project_id=project_id)
    return Response(status_code=204)


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


class LocaleToStore(BaseModel):
    """La lingua scelta. Quali lingue esistono lo sa chi chiama (il sso, dalla
    sua configurazione): qui si controlla solo che sia un codice di lingua."""

    locale: str = Field(pattern=r"^[a-z]{2,3}$")


@app.put("/users/{username}/locale")
def set_user_locale(username: str, body: LocaleToStore) -> dict:
    document = db.set_user_locale(database, username, body.locale)
    if document is None:
        raise errors.ApiError(404, errors.USER_NOT_FOUND, username=username)
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


@app.put("/sessions/{token}/locale")
def set_session_locale(token: str, body: LocaleToStore) -> dict:
    # Va in `data.locale`, accanto agli altri dati di sessione.
    document = db.set_session_locale(database, token, body.locale)
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
