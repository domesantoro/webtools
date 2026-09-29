"""The analyst: it turns a finished pre-analysis into what the rest of the flow
needs — an analysis for whoever builds the tool, a list of functional points for the
client to agree to, and a judgement on whether to propose taking the work on.

What it is for, what it receives and what it produces is in
`contesto/analyst_considerations.md`. Nobody waits in front of this subsystem: a run
is several model calls over minutes, so the trigger answers at once and the pipeline
advances by what is written in anagraphics.

One route: the trigger. It answers `202` as soon as the run is recorded on the
project, and the work goes on behind it — several model calls over minutes are not a
request anybody waits on.
"""

from fastapi import BackgroundTasks, FastAPI, Request

from webtools_analyst import errors, run
from webtools_analyst.settings import load_settings

settings = load_settings()

app = FastAPI(title="analyst", version="0.1.0")
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
    # `python -m webtools_analyst` (proxy_headers=False), otherwise uvicorn
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


@app.post("/projects/{project_id}/analysis", status_code=202)
def start_analysis(project_id: str, later: BackgroundTasks) -> dict:
    """Starts a run over one project.

    `202`: taken, not done. What is already true when this answers is that the project
    carries an open `analysis` step and sits in `ANALYSIS`, which is what refuses a
    second trigger; the rest — the three doors, the two documents, the decision, the
    driver — happens behind it and is read off the project.

    The refusal is decided on the **state**, never on whether an open step is there: a
    project that has been through a phase has no open step for it, so absence cannot be
    the test. It is the mistake the audit found one step earlier, where a finished
    conversation is reopened and hands out its turns again.
    """
    try:
        project = run.start(settings, project_id)
    except run.NotStarted as refused:
        raise errors.ApiError(refused.status_code, refused.code) from None
    # After the answer has gone, in a worker thread: the doors are calls that wait, and
    # waiting inside the loop that serves the requests would hold up everything else.
    later.add_task(run.perform, settings, project)
    return {"project_id": project_id, "started": True}
