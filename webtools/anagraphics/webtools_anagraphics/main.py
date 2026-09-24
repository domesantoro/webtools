"""The internal API: subsystem configurations, projects, drivers and their
discount codes, users and sessions.

Sessions, tickets, projects and the language of users and sessions are written
here. They are stored and returned here: the token, the expiry and the decision
about who is authenticated belong to the sso. Anagraphics does not verify
passwords and does not judge whether a session is still valid.
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
    # Only the connection's IP is used. It must be started with
    # `python -m webtools_anagraphics` (proxy_headers=False), otherwise uvicorn
    # rewrites client.host from X-Forwarded-For for requests from localhost.
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
    """Who supervises the project.

    `preset` tells the preset driver (the one who arrived with a driver's link, or
    the driver themselves in autonomous work) from the one assigned by the system.
    At creation there is a driver only if it is preset.
    """

    driver_uid: str | None = None
    preset: bool = False


class Billing(BaseModel):
    """The project's economic data, as the form saw it.

    They are only stored: the price is not worked out here.
    """

    # The discount code of a driver's link, if there was one.
    discount_code: str | None = None
    # Autonomous work: the driver brings the project for themselves.
    autonomous_work: bool = False
    # The driver who invited the user to work with us, if there was one.
    ambassador_uid: str | None = None


class ProjectToCreate(BaseModel):
    owner_uid: str = Field(min_length=1)
    # The form submission id: if it arrives twice, there is still one project.
    submission_id: str = Field(min_length=16)
    review: Review = Field(default_factory=Review)
    billing: Billing = Field(default_factory=Billing)


# The pipeline states and its steps. They are a contract: whoever writes them and
# whoever reads them must call them the same way, and an invented name must not be
# able to get into the database. The path is that of the main flow (see
# `contesto/02. contesto_aggiornato.md`); REJECTED is the terminus of every gate.
PipelineState = Literal[
    "PREANALYSIS",
    "PREVALIDATION",
    # The request has gone back to the user: it cannot be judged, more detail is
    # needed. It is not a refusal, and from here one starts again by rewriting.
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
    """A step taken on the project's pipeline.

    `result` says how the step went, `state` where it takes the pipeline: two
    different things, because the same outcome can lead to different places
    depending on the gate. `data` is what the step produced, and its shape is
    decided by whoever takes the step: here it is stored, not interpreted.

    `underspecified` is a step taken that sends the request back without closing
    anything: it sits between `passed` and `rejected`, and it is counted — whoever
    decides how many times one may go back looks at how many there already are.

    `open` is the only one that has **not** decided anything: the step has begun
    and lasts. It is the case of the analysis chat, which opens when the project
    reaches `ANALYSIS` and grows with every turn. While it is open its `data` can
    be updated (`PATCH .../steps/{step}`); when it closes it takes one of the other
    results and from then on is never touched again, like every other step.
    """

    step: PipelineStepName
    result: Literal["open", "passed", "rejected", "underspecified", "failed"]
    state: PipelineState
    data: dict = Field(default_factory=dict)


@app.post("/projects", status_code=201)
def create_project(project: ProjectToCreate, response: Response) -> dict:
    # The project id is born here, where the project is stored: the caller cannot
    # choose it, so it cannot collide with one that already exists.
    document = {
        "project_id": str(uuid4()),
        "owner_uid": project.owner_uid,
        "submission_id": project.submission_id,
        "created_at": datetime.now(timezone.utc),
        # Where the project is along the flow, and what has happened to it so far.
        # `steps` is an ordered list, not a map: a step can repeat, and the list is
        # the register of the decisions taken on the project.
        "pipeline": {"state": "PREANALYSIS", "steps": []},
        "review": project.review.model_dump(),
        "billing": project.billing.model_dump(),
    }
    try:
        db.insert_project(database, document)
    except DuplicateKeyError:
        # The same submission again: the project already born is returned.
        # 200 and not 201, because this time nothing was created.
        existing = db.find_project_by_submission(database, project.submission_id)
        if existing is None or existing.get("owner_uid") != project.owner_uid:
            # A submission_id already used by somebody else: their project is not revealed.
            raise errors.ApiError(409, errors.SUBMISSION_EXISTS)
        response.status_code = 200
        return existing
    return document


@app.post("/projects/{project_id}/pipeline/steps", status_code=201)
def add_pipeline_step(project_id: str, step: PipelineStep) -> dict:
    """Appends a step to the pipeline and moves the project to the state the step says.

    `decided_at` is set here, where the step is stored: the caller does not choose
    when it happened. Returns the updated project.
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


class StepDataToUpdate(BaseModel):
    """The fields of `data` to update on an open step.

    `set` rewrites a field, `push` appends to a list. They can be used together:
    the chat appends two messages and rewrites the remaining turns at the same
    moment, and they are the same thing seen from two sides.
    """

    set: dict = Field(default_factory=dict)
    push: dict[str, list] = Field(default_factory=dict)


@app.patch("/projects/{project_id}/pipeline/steps/{step_name}")
def update_pipeline_step(project_id: str, step_name: PipelineStepName, body: StepDataToUpdate) -> dict:
    """Updates the data of the **last open step** with that name.

    `open` only: a step that has decided something is not rewritten, because the
    list of steps is the register of those decisions. If there is no open step with
    that name the answer is `404`, and nothing is created: the step is opened by
    whoever runs that phase, not by whoever writes inside it.
    """
    document = None
    if body.set:
        document = db.update_open_step(database, project_id, step_name, body.set)
        if document is None:
            raise errors.ApiError(404, errors.OPEN_STEP_NOT_FOUND, project_id=project_id, step=step_name)
    for field, values in body.push.items():
        document = db.push_to_open_step(database, project_id, step_name, field, values)
        if document is None:
            raise errors.ApiError(404, errors.OPEN_STEP_NOT_FOUND, project_id=project_id, step=step_name)
    if document is None:
        # Neither `set` nor `push`: there is nothing to do, but the project must be
        # returned as it is, or the caller would not know what they are holding.
        document = db.find_project(database, project_id)
        if document is None:
            raise errors.ApiError(404, errors.PROJECT_NOT_FOUND, project_id=project_id)
    return document


class TurnsToMove(BaseModel):
    """How many turns are moved. Always positive: the direction is said by the
    route, not by the sign, or a `0` or a `-3` would become a way of saying
    something else."""

    turns: int = Field(gt=0)


@app.post("/users/{uid}/billing/turns/spend")
def spend_turns(uid: str, body: TurnsToMove) -> dict:
    """Draws turns from the user's credit.

    The check that the credit is enough lives **inside** the write, not in an
    earlier read: two requests at once cannot spend the same credit twice. If it is
    not enough, `409`, and nothing was drawn.
    """
    document = db.spend_user_turns(database, uid, body.turns)
    if document is None:
        # Not enough credit, or no such user: for the caller the fact is the same —
        # they did not get the turns — but the two cases are told apart, because one
        # is an answer to the user and the other is a failure.
        if db.find_user_by_uid(database, uid) is None:
            raise errors.ApiError(404, errors.USER_NOT_FOUND, uid=uid)
        raise errors.ApiError(409, errors.NOT_ENOUGH_TURNS, uid=uid)
    return document


@app.post("/users/{uid}/billing/turns/grant")
def grant_turns(uid: str, body: TurnsToMove) -> dict:
    """Adds turns to the user's credit.

    This is where the payment will arrive: today only the preanalyst's fake
    purchase arrives here, granting turns without anybody paying anything.
    """
    document = db.grant_user_turns(database, uid, body.turns)
    if document is None:
        raise errors.ApiError(404, errors.USER_NOT_FOUND, uid=uid)
    return document


@app.delete("/projects/{project_id}", status_code=204)
def remove_project(project_id: str) -> Response:
    # For whoever created a project and could not complete it (the
    # pre-specification could not be written): better no project than an empty one.
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
    # A driver who exists but has no discounts answers 200 with an empty list;
    # a driver who does not exist answers 404, not an empty list.
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
    # The user without the `credential` block: this is the ordinary read, the one
    # every subsystem in the pool may do.
    document = db.find_user(database, username)
    if document is None:
        raise errors.ApiError(404, errors.USER_NOT_FOUND, username=username)
    return document


@app.get("/users/{username}/credential")
def get_user_credential(username: str) -> dict:
    # The only read that brings out algorithm, salt and hash. The sso needs it to
    # verify a password: the comparison is its job, nothing is decided here. There
    # is no list of users: credentials are read one at a time.
    document = db.find_user_credential(database, username)
    if document is None:
        raise errors.ApiError(404, errors.USER_NOT_FOUND, username=username)
    if not document.get("credential"):
        # User with no password set: they exist, but cannot authenticate.
        raise errors.ApiError(404, errors.CREDENTIAL_NOT_SET, username=username)
    return document


class LocaleToStore(BaseModel):
    """The chosen language. Which languages exist is known by the caller (the sso,
    from its own configuration): here we only check that it is a language code."""

    locale: str = Field(pattern=r"^[a-z]{2,3}$")


@app.put("/users/{username}/locale")
def set_user_locale(username: str, body: LocaleToStore) -> dict:
    document = db.set_user_locale(database, username, body.locale)
    if document is None:
        raise errors.ApiError(404, errors.USER_NOT_FOUND, username=username)
    return document


class SessionToStore(BaseModel):
    """The session document, built by the sso.

    The required fields are the ones needed to find the session again and to know
    whose it is and how long it is good for. Everything else lives in `data`, which
    stays free: the subsystems' session data will change, the contract of this API
    will not.
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
        # Token already present: the sso generates it at random, so it is either a
        # double submission or a defect in whoever generates it. In both cases
        # nothing is overwritten.
        raise errors.ApiError(409, errors.SESSION_EXISTS, token=session.token)
    return document


@app.get("/sessions/{token}")
def get_session(token: str) -> dict:
    # It also returns an expired session, until the TTL has removed it: deciding
    # whether it is still good is the sso's job.
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
    """The single-use ticket with which the sso hands a session to a subsystem.

    It is needed because a cookie does not cross two different addresses: the sso
    cannot set the preanalyst's cookie. So it sends the browser to the preanalyst
    with a ticket in the address, and the preanalyst exchanges it from behind for
    the session. The ticket lives one minute and is good once, so ending up in a
    log or in the history does no harm; the session token, which lasts hours, never
    travels through the address.
    """

    ticket: str = Field(min_length=16)
    token: str = Field(min_length=16)
    # Who it was given to: it keeps a subsystem from exchanging a ticket issued
    # for another one (§ security, not enforced yet).
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
    # A delete that returns what it deleted: this is the consumption of the
    # ticket. Whoever comes second gets a 404, which is exactly what must happen to
    # a ticket already used.
    document = db.consume_ticket(database, ticket)
    if document is None:
        raise errors.ApiError(404, errors.TICKET_NOT_FOUND)
    return document


@app.delete("/sessions")
def remove_sessions_of_user(uid: str) -> dict:
    # `DELETE /sessions?uid=…`: closes all of a user's sessions. It is not under
    # /users/{username} because here the uid is given, not the username. It holds
    # for a non-existent uid too: the request is "none must be left", and that is
    # the result.
    return {"uid": uid, "deleted": db.delete_sessions_of_user(database, uid)}
