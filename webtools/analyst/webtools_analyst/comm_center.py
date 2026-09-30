"""HTTP client towards webtools_comm_center: what this subsystem has to say to a person.

Two forms, and they go opposite ways. A driver is told there is an analysis waiting for
them; a client is told the work on their project stopped. One function each, because
there is one route each — what has to travel is not the same, and a single function
choosing between two bodies would be the generic route this repository refused.

Same contract as the other clients. What is different here is what a failure means: a
communication that did not go out leaves the project as it was — the step is written
and the state says what happened — and only the telling is missing. So the run records
it and carries on, instead of undoing anything.

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


def _tell(settings, path: str, *, operation: str, body: dict) -> Answer:
    """One communication, sent. Every form goes through here and is measured once.

    `operation` is the form's own word and never the path: one name per form of
    communication, the same names the routes are, so that what was said and what could
    not be said are read apart from one another.
    """
    elapsed = settings.metrics.timer()

    def report(outcome: str) -> None:
        settings.metrics.measure(
            "dependency.call",
            dims={"target": "comm-center", "operation": operation, "outcome": outcome},
            duration_ms=elapsed(),
        )

    try:
        response = httpx.post(
            f"{settings.comm_center.url}{path}",
            json=body,
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


def analysis_ready(settings, project_id: str, driver: dict) -> Answer:
    """`POST /communications/analysis-ready` — a driver has an analysis to validate.

    `driver` is the copy the project carries, as anagraphics made it: uid, screen name
    and where they are reached. It is passed on as it is, because the copy on the
    project is what was decided, and reading the driver again somewhere else would be a
    second answer to the same question.
    """
    return _tell(
        settings,
        "/communications/analysis-ready",
        operation="analysis_ready",
        body={
            "project_id": project_id,
            "driver": {
                "uid": driver.get("uid"),
                "screen_name": driver.get("screen_name"),
                "username": driver.get("username"),
            },
        },
    )


def project_stopped(settings, project_id: str, client: dict) -> Answer:
    """`POST /communications/project-stopped` — the work stopped, nothing was decided.

    Both ways a run can end badly come through here: one that broke, and one that was
    finished and could be handed to nobody. They are two facts for us and one for the
    person who asked for the tool — it stopped — and the pages already read them that
    way. Which of the two it was stays on the step, where whoever repairs it looks.

    `client` is the person as anagraphics answered with them: uid, screen name and the
    address, passed on as they came.
    """
    return _tell(
        settings,
        "/communications/project-stopped",
        operation="project_stopped",
        body={
            "project_id": project_id,
            "client": {
                "uid": client.get("uid"),
                "screen_name": client.get("screen_name"),
                "username": client.get("username"),
            },
        },
    )
