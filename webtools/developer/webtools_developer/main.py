"""The developer: it reads the analysis of a project and builds the webtool from it.

Four doors and a sandbox. The plan says what is built and out of what; one call per
file writes it; a check runs on what was written and a repair door answers what the
check refused; a last door writes the README of the project that now exists. Everything
it executes runs confined, in a directory of its own, with the network closed except
while dependencies are being installed.

Nobody waits in front of this subsystem: a build is hundreds of model calls and a
handful of commands, over minutes or hours, so the trigger answers at once and the
pipeline advances by what is written in anagraphics.

One route: the trigger. It answers `202` as soon as the build is recorded on the
project, and the work goes on behind it.
"""

from fastapi import BackgroundTasks, FastAPI, Request

from webtools_developer import errors, run, sandbox
from webtools_developer.settings import load_settings

settings = load_settings()

# What this machine cannot do to a build, said once at startup. It is not a reason to
# refuse to start — see `sandbox.usable` — but it is what somebody looking at this log
# needs to know before they trigger anything. The sentence carries its own consequence,
# because the two things it can report are not the same news: a wrapper that is not
# there means no build can run at all, and a ceiling the kernel will not apply means
# builds run with one limit fewer.
_cannot = sandbox.usable(settings)
if _cannot:
    print(f"[developer] {_cannot}")

app = FastAPI(title="developer", version="0.1.0")
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
    # `python -m webtools_developer` (proxy_headers=False), otherwise uvicorn
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


@app.post("/projects/{project_id}/development", status_code=202)
def start_development(project_id: str, later: BackgroundTasks) -> dict:
    """Starts a build of one project.

    `202`: taken, not done. What is already true when this answers is that the project
    carries an open `development` step and sits in `DEVELOPMENT`, which is what refuses
    a second trigger; the rest — the plan, the files, the checks, the README, the driver
    — happens behind it and is read off the project as it grows.

    The refusal is decided on the **state**, never on whether an open step is there: a
    project that has been through a phase has no open step for it, so absence cannot be
    the test. And a second build is refused rather than queued: it would be a second
    build of the same project, paid twice, into the same directory.
    """
    try:
        project = run.start(settings, project_id)
    except run.NotStarted as refused:
        raise errors.ApiError(refused.status_code, refused.code) from None
    # After the answer has gone, in a worker thread: the doors are calls that wait and
    # the commands are processes that run, and doing either inside the loop that serves
    # the requests would hold up everything else for as long as a build lasts.
    later.add_task(run.perform, settings, project)
    return {"project_id": project_id, "started": True}
