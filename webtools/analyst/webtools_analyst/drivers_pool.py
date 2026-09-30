"""HTTP client towards webtools_drivers_pool: who supervises this project.

Same contract as the other clients. One outcome of this one is worth naming, because
it is the whole reason the pool answers instead of the analyst choosing: **`rejected`
with `NO_DRIVER_AVAILABLE` is an answer**, not a failure. It says there is nobody who
may supervise — a real state of the system — and it has to be told apart from the pool
being down, which is `unavailable`. What the run does about it differs: there is no point
asking again for somebody who does not exist.

The pool writes nothing. Putting the chosen driver onto the project is ours, because
we are the ones who know whether the rest of this run succeeded.
"""

import sys
from dataclasses import dataclass

import httpx


@dataclass(frozen=True)
class Answer:
    ok: bool
    data: object = None
    reason: str | None = None
    code: str | None = None


def _log(message: str) -> None:
    print(f"[drivers-pool] {message}", file=sys.stderr)


def choose_driver(settings, project_id: str) -> Answer:
    """`POST /drivers/choice` → `{"driver_uid": …}`, the driver to hand the project to."""
    path = "/drivers/choice"
    elapsed = settings.metrics.timer()

    def report(outcome: str) -> None:
        settings.metrics.measure(
            "dependency.call",
            dims={"target": "drivers-pool", "operation": "choose_driver", "outcome": outcome},
            duration_ms=elapsed(),
        )

    try:
        response = httpx.post(
            f"{settings.drivers_pool.url}{path}",
            json={"project_id": project_id},
            headers={"accept": "application/json"},
            timeout=settings.drivers_pool.timeout_ms / 1000,
        )
    except httpx.TimeoutException as error:
        _log(f"POST {path}: {type(error).__name__} {error}")
        report("timed_out")
        return Answer(ok=False, reason="unavailable")
    except httpx.HTTPError as error:
        _log(f"POST {path}: {type(error).__name__} {error}")
        report("failed")
        return Answer(ok=False, reason="unavailable")

    try:
        payload = response.json()
    except ValueError:
        _log(f"POST {path}: response is not JSON (HTTP {response.status_code})")
        report("failed")
        return Answer(ok=False, reason="unavailable")

    code = payload.get("error") if isinstance(payload, dict) else None
    if response.is_success:
        driver_uid = payload.get("driver_uid") if isinstance(payload, dict) else None
        if not isinstance(driver_uid, str) or not driver_uid:
            _log(f"POST {path}: the answer does not name a driver")
            report("failed")
            return Answer(ok=False, reason="unavailable")
        report("ok")
        return Answer(ok=True, data=driver_uid)

    _log(f"POST {path}: HTTP {response.status_code} {code or '?'}")
    if response.status_code == 409:
        # Nobody may supervise. The pool answered; it is we who have nobody to give the
        # project to.
        report("ok")
        return Answer(ok=False, reason="rejected", code=code)
    report("failed")
    if response.status_code == 400:
        return Answer(ok=False, reason="rejected", code=code)
    return Answer(ok=False, reason="unavailable", code=code)
