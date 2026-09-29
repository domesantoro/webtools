"""HTTP client towards webtools_comm_center: telling a driver the analysis is waiting.

Same contract as the other clients. What is different here is what a failure means: a
communication that did not go out leaves the project whole — the analysis is written,
the step says what was decided, the driver is on the project — and only the telling is
missing. So the run records it and carries on, instead of undoing anything.

`202` from that side means taken, not delivered. Nothing is delivered yet: the
comm-center writes the notice in its log, because this repository has no notification
channel at all.
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
    print(f"[comm-center] {message}", file=sys.stderr)


def analysis_ready(settings, project_id: str, driver: dict) -> Answer:
    """`POST /communications/analysis-ready` — a driver has an analysis to validate.

    `driver` is the copy the project carries, as anagraphics made it: uid, screen name
    and where they are reached. It is passed on as it is, because the copy on the
    project is what was decided, and reading the driver again somewhere else would be a
    second answer to the same question.
    """
    path = "/communications/analysis-ready"
    elapsed = settings.metrics.timer()

    def report(outcome: str) -> None:
        settings.metrics.measure(
            "dependency.call",
            dims={"target": "comm-center", "operation": "analysis_ready", "outcome": outcome},
            duration_ms=elapsed(),
        )

    try:
        response = httpx.post(
            f"{settings.comm_center.url}{path}",
            json={
                "project_id": project_id,
                "driver": {
                    "uid": driver.get("uid"),
                    "screen_name": driver.get("screen_name"),
                    "username": driver.get("username"),
                },
            },
            headers={"accept": "application/json"},
            timeout=settings.comm_center.timeout_ms / 1000,
        )
    except httpx.TimeoutException as error:
        _log(f"POST {path}: {type(error).__name__} {error}")
        report("timed_out")
        return Answer(ok=False, reason="unavailable")
    except httpx.HTTPError as error:
        _log(f"POST {path}: {type(error).__name__} {error}")
        report("failed")
        return Answer(ok=False, reason="unavailable")

    if response.is_success:
        report("ok")
        return Answer(ok=True, data=None)

    code = None
    try:
        payload = response.json()
        code = payload.get("error") if isinstance(payload, dict) else None
    except ValueError:
        pass
    _log(f"POST {path}: HTTP {response.status_code} {code or '?'}")
    report("failed")
    if response.status_code in (400, 422):
        return Answer(ok=False, reason="rejected", code=code)
    return Answer(ok=False, reason="unavailable", code=code)
