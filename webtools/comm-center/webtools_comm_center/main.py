"""The communications centre: everything the system says to a person.

**One route per form of communication**, and not one route with a `kind` field. A
single generic route makes what has to arrive depend on which kind was named, and
nothing checks that the right fields came with the right kind: a notification would go
out half empty and look like a notification. A route per form puts the data it needs
inside its own contract, so a call that is missing something is refused instead of
producing something nobody can read.

**Every communication arrives carrying who it is for and how to reach them.** Nothing
here is looked up: the caller has the driver's data because the project keeps a copy of
it, and a second call to fetch what the caller already had is a second thing that can
fail.

**It only writes to the log today.** No mail, no queue, no webhook: there is no channel
in this repository, and inventing one here would be inventing the wrong one. What is
being built now is the shape of the calls, which is the part the rest of the flow has
to agree with; how the message leaves the building is a piece of work of its own.
"""

import logging

from fastapi import FastAPI, Request
from pydantic import BaseModel, Field

from webtools_comm_center import errors
from webtools_comm_center.settings import load_settings

settings = load_settings()

# The log is where a communication goes today, so it is not a debugging aid here: it
# is the delivery. Python's own starting level throws away anything below `warning`,
# and uvicorn configures only its own loggers, so without these two lines this
# subsystem answers `202` and writes nothing — which is what the first real call did.
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("webtools_comm_center")
logger.setLevel(logging.INFO)

app = FastAPI(title="comm-center", version="0.1.0")
errors.install_error_handlers(app)


@app.middleware("http")
async def guarded_and_measured(request: Request, call_next):
    """The IP pool, the size of the body, and one measurement per request.

    Counting here and nowhere else means no route has to remember to count itself,
    and a route written tomorrow is counted the day it is written.
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
    # `python -m webtools_comm_center` (proxy_headers=False), otherwise uvicorn
    # rewrites client.host from X-Forwarded-For for requests from localhost.
    host = request.client.host if request.client else None
    if host not in settings.allowed_ips:
        settings.metrics.measure("http.refused_ip")
        return errors.error_response(403, errors.IP_NOT_ALLOWED, request)
    if _too_large(request):
        return errors.error_response(413, errors.BODY_TOO_LARGE, request)
    return await call_next(request)


def _route_of(request: Request) -> str:
    """The route as it is written, not as it was called.

    `/projects/{project_id}` and never `/projects/1f251606-…`: a path carries
    identifiers, and a bucket per identifier would make the number of documents grow
    with the traffic instead of with the number of kinds of thing measured. It is read
    from the route that matched, so nothing here has to keep a list of the paths in
    step with the routing. A request that matched none is counted as `(other)`.
    """
    return getattr(request.scope.get("route"), "path", None) or "(other)"


def _too_large(request: Request) -> bool:
    declared = request.headers.get("content-length")
    if declared is None or not declared.isdigit():
        return False
    return int(declared) > settings.body_max_bytes


class Driver(BaseModel):
    """The driver as a project keeps them: a copy, made by anagraphics."""

    uid: str = Field(min_length=1)
    screen_name: str = Field(min_length=1)
    # Where they are reached.
    username: str = Field(min_length=1)


class AnalysisReady(BaseModel):
    """A project's analysis is written and a driver has it to validate."""

    project_id: str = Field(min_length=1)
    driver: Driver


@app.post("/communications/analysis-ready", status_code=202)
def analysis_ready(communication: AnalysisReady) -> dict:
    """`202`: it has been taken, not delivered. Nothing is delivered yet."""
    logger.info(
        "analysis-ready → %s <%s> about project %s",
        communication.driver.screen_name,
        communication.driver.username,
        communication.project_id,
    )
    settings.metrics.measure(
        "communication.sent",
        dims={"kind": "analysis_ready", "channel": "log"},
        project_id=communication.project_id,
    )
    return {"taken": True}
