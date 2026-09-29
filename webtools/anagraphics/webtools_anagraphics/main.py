"""The internal API: subsystem configurations, projects, drivers and their
discount codes, users and sessions.

Sessions, tickets, projects and the language of users and sessions are written
here. They are stored and returned here: the token, the expiry and the decision
about who is authenticated belong to the sso. Anagraphics does not verify
passwords and does not judge whether a session is still valid.
"""

from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import FastAPI, Query, Request, Response
from pydantic import BaseModel, Field, field_validator
from pymongo.errors import DuplicateKeyError

from webtools_anagraphics import db, errors, provider_pricing
from webtools_anagraphics.settings import load_settings

settings = load_settings()
database = db.connect(settings)

app = FastAPI(title="anagraphics", version="0.9.0")
errors.install_error_handlers(app)


@app.middleware("http")
async def guarded_and_measured(request: Request, call_next):
    """The IP pool, and one measurement per request.

    Counting here and nowhere else means no route has to remember to count itself,
    and a route written tomorrow is counted the day it is written. This subsystem was
    the last one with no measurements at all, which made `/metrics/http` a picture of
    every surface except the one every other subsystem goes through: when a
    `dependency.call` towards anagraphics came back slow, nothing on this side could
    say whether it was anagraphics or Mongo.
    """
    elapsed = settings.metrics.timer()
    response = await _answer(request, call_next)
    settings.metrics.measure(
        "http.request",
        dims={
            "route": _route_of(request),
            "method": request.method,
            "status": str(response.status_code),
        },
        duration_ms=elapsed(),
    )
    code = getattr(request.state, "error_code", None)
    if code:
        # A status says how it went; the code says what it was, and only one of the
        # two can be acted on.
        settings.metrics.measure("http.error", dims={"code": code})
    return response


async def _answer(request: Request, call_next):
    # Only the connection's IP is used. It must be started with
    # `python -m webtools_anagraphics` (proxy_headers=False), otherwise uvicorn
    # rewrites client.host from X-Forwarded-For for requests from localhost.
    host = request.client.host if request.client else None
    if host not in settings.allowed_ips:
        # Somebody knocking, or a subsystem started with the wrong configuration.
        # In a log it is a line nobody reads; here it is a number that grows.
        settings.metrics.measure("http.refused_ip")
        return errors.error_response(403, errors.IP_NOT_ALLOWED, request)
    return await call_next(request)


def _route_of(request: Request) -> str:
    """The route as it is written, not as it was called.

    `/projects/{project_id}` and never `/projects/1f251606-…`: a path here carries
    project ids, usernames and session tokens, and a bucket per identifier would make
    the number of documents grow with the traffic instead of with the number of kinds
    of thing measured. It is read from the route that matched, so nothing here has to
    keep a list of the paths in step with the routing. A request that matched none is
    counted as `(other)`.
    """
    return getattr(request.scope.get("route"), "path", None) or "(other)"


@app.get("/configuration")
def get_configurations() -> dict:
    """Every subsystem's configuration, as it is in Mongo.

    Whoever has to look at the whole configuration — the configurator's front end
    — cannot ask for it subsystem by subsystem: the list of the subsystems that
    exist is here, not in whoever is asking.
    """
    return {"configurations": db.list_configurations(database)}


@app.get("/configuration/{subsystem}")
def get_configuration(subsystem: str) -> dict:
    document = db.find_configuration(database, subsystem)
    if document is None:
        raise errors.ApiError(404, errors.CONFIGURATION_NOT_FOUND, subsystem=subsystem)
    return document


class PricingToStore(BaseModel):
    """What a provider object's price is made of.

    `cents_per_million_tokens` is one amount **per kind of token**, under the
    names the kinds arrived with. The kinds are not listed here and are not
    checked against a list: which kinds a provider counts is the provider's
    business, declared in the configuration, and a name this file had never
    heard of is a price like any other. What is checked is that an amount is a
    whole number of hundredths and is not negative.

    The amounts are hundredths of the unit of `currency` — hundredths of a
    dollar for USD — per million tokens. The currency is checked by its shape
    (ISO 4217: three capital letters) and not against a list of currencies: the
    list of the ones that may be chosen belongs to whoever offers the choice,
    and a second copy of it here would be a second thing to keep up to date.

    `updated_at` is not taken from the body: it is written here, at the moment
    the write happens. A date the caller chooses would be a claim about when
    something was done, not a record of it.
    """

    provider_path: str = Field(min_length=1)
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    cents_per_million_tokens: dict[str, Annotated[int, Field(ge=0)]]

    @field_validator("provider_path")
    @classmethod
    def _keys_that_mongo_can_hold(cls, path: str) -> str:
        keys = path.split(".")
        if not all(key and not key.startswith("$") for key in keys):
            raise ValueError("every key of the path must be non-empty and must not start with '$'")
        return path

    @field_validator("cents_per_million_tokens")
    @classmethod
    def _at_least_one_kind(cls, kinds: dict[str, int]) -> dict[str, int]:
        # An empty price is not a price. Removing one is another operation, and
        # this route does not do it: it writes what it is given.
        if not kinds:
            raise ValueError("at least one kind of token must be priced")
        if not all(kind and "." not in kind and not kind.startswith("$") for kind in kinds):
            raise ValueError("a kind of token must be non-empty, without '.' and not starting with '$'")
        return kinds


@app.put("/configuration/{subsystem}/pricing")
def set_provider_pricing(subsystem: str, body: PricingToStore) -> dict:
    """The price of what a provider object's model consumes.

    It writes **one key** — `pricing` — inside the object `provider_path` names,
    and only if that path names a provider object (`<anything>.providers.<name>`,
    see `provider_pricing.py`). Everything else in the document is left as it is:
    this is not a route that writes the configuration, it is the route that
    writes a price.

    The configuration that lives is in Mongo, so this is where a price is
    changed. The seed files do not carry prices: a new environment is born
    without them, which is what it is — nobody has said what a token costs yet.
    """
    document = db.find_configuration(database, subsystem)
    if document is None:
        raise errors.ApiError(404, errors.CONFIGURATION_NOT_FOUND, subsystem=subsystem)

    outcome, _ = provider_pricing.locate(document, body.provider_path)
    if outcome == provider_pricing.NOT_FOUND:
        raise errors.ApiError(404, errors.PROVIDER_NOT_FOUND, path=body.provider_path)
    if outcome == provider_pricing.NOT_A_PROVIDER_OBJECT:
        raise errors.ApiError(400, errors.NOT_A_PROVIDER_OBJECT, path=body.provider_path)

    pricing = {
        "currency": body.currency,
        "cents_per_million_tokens": body.cents_per_million_tokens,
        # The moment the price and the currency were last written, in UTC. Whole
        # seconds: it says when, and a configuration is not changed twice in the
        # same second by a human.
        "updated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    }
    # The document was read a moment ago and it is there. If it has been removed
    # in between, nothing was written, and that is said rather than assumed.
    if not db.set_configuration_field(database, subsystem, f"{body.provider_path}.pricing", pricing):
        raise errors.ApiError(404, errors.CONFIGURATION_NOT_FOUND, subsystem=subsystem)

    # A configured value changed while the system was running, which is the moment
    # **after which every other figure means something else**. A cost per demo that
    # steps up in the middle of a month, read without this, is a mystery; read with
    # it, it is a price that was changed on the Tuesday. Counted only once it was
    # really written: a change the configuration does not carry is not a change.
    #
    # `section` and not the path or the value: what the price became is in the
    # configuration, which is the thing that is true, and a copy of it here would be
    # a second answer to the same question that can disagree with the first.
    settings.metrics.measure(
        "configuration.changed", dims={"subsystem": subsystem, "section": "pricing"}
    )
    return {"pricing": pricing}


@app.get("/projects/count")
def count_projects(
    first_day: str = Query(alias="from"), last_day: str = Query(alias="to")
) -> dict:
    """How many projects were created between two days, both included.

    Declared **before** `/projects/{project_id}`: routes are matched in the order
    they are declared, and `count` would otherwise be read as a project id.

    It exists for metrics, which counts the projects it was told about and needs
    to know how many there really were: the difference is what its funnel lost.
    The days are UTC, like everything stored here.
    """
    first = _day(first_day)
    last = _day(last_day)
    if first > last:
        raise errors.ApiError(400, errors.INVALID_RANGE, day=first_day)
    return {
        "from": first_day,
        "to": last_day,
        "projects": db.count_projects_created_between(database, first, last + timedelta(days=1)),
    }


def _day(value: str) -> datetime:
    try:
        return datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        raise errors.ApiError(400, errors.INVALID_RANGE, day=value) from None


@app.get("/projects/{project_id}")
def get_project(project_id: str) -> dict:
    document = db.find_project(database, project_id)
    if document is None:
        raise errors.ApiError(404, errors.PROJECT_NOT_FOUND, project_id=project_id)
    return document


class DriverOnProject(BaseModel):
    """The driver's own data, copied onto the project.

    A copy, and not a reference, because this is not a relational database: whoever
    reads a project to write to its driver — the communications centre, a page
    listing what a driver supervises — would otherwise have to fetch the driver
    separately, and a second call is a second thing that can fail while the first
    one succeeded.

    **`enabled` is deliberately not copied.** It is a state of the driver and not of
    this assignment: a driver disabled tomorrow would go on looking enabled on every
    project that copied them, which is the one field where a stale copy misleads
    rather than merely ages.

    The copy is made **here** and never by a caller. Drivers live in this subsystem,
    so a caller building its own copy would be a second place deciding what a
    driver's data is, with nothing checking that the two agree.

    What does not exist, and is known not to: nothing propagates a change. A driver
    who changes their `screen_name` or their address leaves this copy as it was, on
    every project they supervise. The same is already true of the copy inside the
    discounts (`docs/subsystems/anagraphics/README.md` §13); this makes two.
    """

    uid: str
    screen_name: str
    # Where they are reached. It is the driver's `username`, which is their address.
    username: str


class Review(BaseModel):
    """Who supervises the project.

    `preset` tells the preset driver (the one who arrived with a driver's link, or
    the driver themselves in autonomous work) from the one assigned by the system.
    At creation there is a driver only if it is preset.
    """

    driver: DriverOnProject | None = None
    preset: bool = False


class ReviewToCreate(BaseModel):
    """What a caller may say about the driver: a name, never a copy.

    The copy is this subsystem's to make, so what arrives is a uid and the answer to
    whether that driver was preset.
    """

    driver_uid: str | None = None
    preset: bool = False


class DriverToAssign(BaseModel):
    """The driver the drivers' pool chose."""

    driver_uid: str = Field(min_length=1)


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
    review: ReviewToCreate = Field(default_factory=ReviewToCreate)
    billing: Billing = Field(default_factory=Billing)


# The pipeline states and its steps. They are a contract: whoever writes them and
# whoever reads them must call them the same way, and an invented name must not be
# able to get into the database. The path is that of the main flow (see
# `contesto/02. current_context.md`); REJECTED is the terminus of every gate.
PipelineState = Literal[
    # Where a project is born, and where it stays for the whole pre-analysis: the
    # form, the prevalidation that passes, and the rounds of questions that follow.
    # There is no earlier state to have, and the rounds are the pre-analysis, so one
    # name covers both instead of two names covering the same stretch. Which of the
    # two moments a project is at is read off the steps, where the prevalidation
    # either has decided or has not.
    "PREANALYSIS",
    "PREVALIDATION",
    # The request has gone back to the user: it cannot be judged, more detail is
    # needed. It is not a refusal, and from here one starts again by rewriting.
    "UNDERSPECIFIED",
    # The analysis is being written. It begins when the client says the rounds of
    # questions are over and ends when the proposal is on the step: a stretch in
    # which several model calls are running and nothing has been decided yet, which
    # no other name here covers.
    "ANALYSIS",
    "DRIVER_VALIDATION",
    "CLIENT_VALIDATION",
    "DEVELOPMENT",
    "ALPHA_TEST",
    "DEMO",
    "PAID",
    "REJECTED",
    # A run that did not get to the end. It is not a refusal — nobody decided
    # anything about the request — and it is not a place a project passes through
    # either: it is where one is left when the work that was supposed to move it
    # stopped. It is kept apart from `REJECTED` because what has to be done about it
    # is the opposite: a refusal is over, a failure is looked at.
    "FAILED",
    # The analysis is written and there is nobody to hand it to: the pool has nobody
    # enabled, or it kept naming drivers who are no longer there. Its own name and
    # not `FAILED`, because the work was done and paid for and what is missing is a
    # person — the project is finished as far as the machine goes.
    "FAILED_NO_DRIVERS",
]

PipelineStepName = Literal[
    "prevalidation",
    "preanalysis",
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
    and lasts. It is the case of the rounds of questions, which open when the
    prevalidation passes and grow with every turn. While it is open its
    `data` can be updated (`PATCH .../steps/{step}`); when it closes it takes one of
    the other results and from then on is never touched again, like every other step.
    """

    step: PipelineStepName
    result: Literal["open", "passed", "rejected", "underspecified", "failed"]
    state: PipelineState
    data: dict = Field(default_factory=dict)


def _driver_copy(driver_uid: str | None) -> dict | None:
    """The driver's data as a project keeps it. 404 if there is no such driver.

    One function, used by the creation and by the assignment, so that a project
    cannot end up holding a copy of a shape nobody else writes.
    """
    if driver_uid is None:
        return None
    driver = db.find_driver(database, driver_uid)
    if driver is None:
        raise errors.ApiError(404, errors.DRIVER_NOT_FOUND, uid=driver_uid)
    return DriverOnProject(
        uid=driver["uid"], screen_name=driver["screen_name"], username=driver["username"]
    ).model_dump()


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
        "review": {
            "driver": _driver_copy(project.review.driver_uid),
            "preset": project.review.preset,
        },
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


@app.put("/projects/{project_id}/review/driver")
def assign_driver(project_id: str, assignment: DriverToAssign) -> dict:
    """The driver who will supervise this project, copied onto it.

    `PUT` and not `POST`: assigning the same driver twice leaves the project as it
    already was. It is also how a copy is refreshed — the same call again rereads
    the driver and writes what they are now.

    `preset` is not touched. It says how the driver got there, and a driver arriving
    through this route never got there by being preset: a project created with one
    already has it, and this route is called on the projects that have none.
    """
    driver = _driver_copy(assignment.driver_uid)
    updated = db.set_project_driver(database, project_id, driver)
    if updated is None:
        raise errors.ApiError(404, errors.PROJECT_NOT_FOUND, project_id=project_id)
    return updated


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
    # It goes in `data.locale`, next to the rest of the session data.
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
