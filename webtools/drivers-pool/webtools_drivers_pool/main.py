"""The drivers' pool: which driver supervises a project.

It is asked for one driver and answers with one driver. It writes nothing: putting the
chosen driver onto the project is the caller's, because the caller is the one that
knows whether the rest of its own work succeeded.

**How it chooses today: at random, among the enabled ones.** That is a placeholder and
it is said out loud — the rules that will decide (how many projects somebody already
has, whether they are available, which language the client writes in) are not written
anywhere yet, and a rule invented here would be one nobody agreed to.

**Among the enabled ones is not a placeholder.** Only enabled drivers supervise
clients' projects, which is a rule of the service and not of this file; a pool that
could hand back somebody who has not been interviewed would be wrong now, not later.
"""

import secrets

from fastapi import FastAPI, Request
from pydantic import BaseModel, Field

from webtools_drivers_pool import anagraphics, errors
from webtools_drivers_pool.settings import load_settings

settings = load_settings()

app = FastAPI(title="drivers-pool", version="0.1.0")
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
    # `python -m webtools_drivers_pool` (proxy_headers=False), otherwise uvicorn
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


class ChoiceToMake(BaseModel):
    """Which project a driver is being chosen for.

    Nothing reads it yet: the choice is at random. It is asked for all the same,
    because a driver is chosen **for a project** and every rule that will replace the
    randomness needs to know which one — so the route's contract is the one it will
    keep, and the day the rules arrive no caller has to change.
    """

    project_id: str = Field(min_length=1)


@app.post("/drivers/choice")
def choose(choice: ChoiceToMake) -> dict:
    answer = anagraphics.list_drivers(settings)
    if not answer.ok:
        # Anagraphics is where the drivers are: without it there is no choice to make,
        # and saying so is better than answering with one we made up.
        raise errors.ApiError(503, errors.ANAGRAPHICS_UNAVAILABLE)

    enabled = [driver for driver in answer.data if driver.get("enabled") is True]
    if not enabled:
        # A real state of the system, not a failure: nobody has been enabled yet.
        # The caller has to be able to tell it from anagraphics being down.
        raise errors.ApiError(409, errors.NO_DRIVER_AVAILABLE)

    # `secrets` and not `random`: which driver gets a project is worth money to them,
    # and a sequence somebody could predict is a sequence somebody could wait for.
    chosen = enabled[secrets.randbelow(len(enabled))]
    settings.metrics.measure(
        "driver.chosen",
        dims={"rule": "random"},
        # How many there were to choose from, and how many there were at all. A pool
        # that has quietly come down to one person looks the same from outside as one
        # that has twenty — and one enabled out of one is not the same problem as one
        # enabled out of twenty: the first needs drivers, the second needs interviews.
        amounts={"enabled": len(enabled), "registered": len(answer.data)},
        project_id=choice.project_id,
    )
    return {"driver_uid": chosen["uid"]}
