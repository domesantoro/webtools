"""HTTP client towards webtools_anagraphics: the project, its steps, its driver.

It raises nothing towards its caller: every call returns either the data or a reason,
because the caller has to know *how* it went wrong and not only that it did.

    reason "not_found"    → the API answered 404 with its own error code
    reason "rejected"     → 400 or 409: the request was wrong, asking again does not help
    reason "unavailable"  → unreachable, timed out, 5xx, 403, broken JSON

Anagraphics' error responses are `{"error": "<CODE>"}`: the code is compared, never the
text.

There is no shared HTTP client in this project, in either language: each dependency
gets one written by hand, and what is shared is the contract, not the code.

**Every call through here is measured**, once, as a `dependency.call`. `operation` is a
stable word each helper gives — never the path, because a path carries identifiers and
a bucket per identifier would make the number of documents grow with the traffic
instead of with the number of kinds of thing measured.
"""

import sys
from dataclasses import dataclass
from datetime import datetime

import httpx


@dataclass(frozen=True)
class Answer:
    """Either the data or a reason. Never both, never an exception."""

    ok: bool
    data: object = None
    reason: str | None = None
    code: str | None = None


def _log(message: str) -> None:
    print(f"[anagraphics] {message}", file=sys.stderr)


def _call(settings, method: str, path: str, *, operation: str, body: dict | None = None) -> Answer:
    url = f"{settings.anagraphics.url}{path}"
    elapsed = settings.metrics.timer()

    def report(outcome: str) -> None:
        settings.metrics.measure(
            "dependency.call",
            dims={"target": "anagraphics", "operation": operation, "outcome": outcome},
            duration_ms=elapsed(),
        )

    try:
        response = httpx.request(
            method,
            url,
            json=body,
            headers={"accept": "application/json"},
            timeout=settings.anagraphics.timeout_ms / 1000,
        )
    except httpx.TimeoutException as error:
        # We gave up waiting, or there was nothing at the other end: two facts, and in
        # a log they look alike.
        _log(f"{method} {path}: {type(error).__name__} {error}")
        report("timed_out")
        return Answer(ok=False, reason="unavailable")
    except httpx.HTTPError as error:
        _log(f"{method} {path}: {type(error).__name__} {error}")
        report("failed")
        return Answer(ok=False, reason="unavailable")

    try:
        payload = response.json()
    except ValueError:
        _log(f"{method} {path}: response is not JSON (HTTP {response.status_code})")
        report("failed")
        return Answer(ok=False, reason="unavailable")

    if response.is_success:
        report("ok")
        return Answer(ok=True, data=payload)

    code = payload.get("error") if isinstance(payload, dict) else None
    if response.status_code == 404:
        # It answered, and what it said is that the thing is not there. Not a failure.
        report("not_found")
        return Answer(ok=False, reason="not_found", code=code)

    report("failed")
    _log(f"{method} {path}: HTTP {response.status_code} {code or '?'}")
    if response.status_code in (400, 409, 422):
        return Answer(ok=False, reason="rejected", code=code)
    return Answer(ok=False, reason="unavailable", code=code)


def find_project(settings, project_id: str) -> Answer:
    """`GET /projects/{id}` → the project, whole: its state, its steps, its driver."""
    return _call(settings, "GET", f"/projects/{project_id}", operation="find_project")


def append_step(
    settings, project_id: str, *, step: str, result: str, state: str, data: dict, reason: str | None = None
) -> Answer:
    """`POST /projects/{id}/pipeline/steps` → the project as it is afterwards.

    One write for two facts: the step is appended and the project moves to the state
    the step says, so there is no moment in which the step is there and the state is
    still the previous one. `decided_at` is anagraphics', not ours: the caller does not
    choose when something happened.

    A step that is still `open` is written through here too — it has decided nothing
    yet and it lasts — and **the step that comes after it is what closes it**. That is
    the convention the pipeline already runs on: the rounds of questions open a step
    that grows turn by turn, and this subsystem's step is the one that ends it.

    **Every decision of this gate passes through here, so it is counted here**: nobody
    has to remember to count a decision, and a step anagraphics refused is not counted
    at all, because a decision the project does not carry is not a decision.
    """
    stored = _call(
        settings,
        "POST",
        f"/projects/{project_id}/pipeline/steps",
        operation="append_step",
        body={"step": step, "result": result, "state": state, "data": data},
    )
    if not stored.ok:
        return stored

    settings.metrics.measure(
        "gate.decided",
        # `reason` is the name of a refusal, and only a decision that refuses has one.
        # It is passed by whoever decided: where the reason lives is that decision's
        # business, not this function's. Absent is absent.
        dims={"gate": step, "outcome": result, **({"reason": reason} if reason else {})},
        project_id=project_id,
    )
    # How long a gate was open, reported by the step that closes it — which is not
    # always a step of that same gate. Nothing is reported when nothing was open:
    # absent is absent, and a zero would be a gate that took no time.
    finished = _gate_that_finished(stored.data)
    if finished is not None:
        gate, waited = finished
        settings.metrics.measure(
            "gate.duration", dims={"gate": gate}, duration_ms=waited, project_id=project_id
        )
    return stored


def _gate_that_finished(project) -> tuple[str, int] | None:
    """Which gate has just finished, and how long it was open.

    **The gate is the one that was open, not the one being written.** A step that is
    `open` has decided nothing and lasts, and the convention the whole pipeline runs
    on is that the step which comes after it is what closes it — and that step may
    belong to another gate entirely. This subsystem's own opening step is what closes
    the rounds of questions, so naming the interval after the step that closes it
    filed the whole conversation under `analysis`, added to the run's own minutes in
    the same bucket: two different things under one name, and the longest wait in the
    pipeline with no bucket of its own.

    When the step before was already decided there is nothing to report: that interval
    is the dead time between two gates, which is real and is a different question.
    """
    steps = (project or {}).get("pipeline", {}).get("steps")
    if not isinstance(steps, list) or len(steps) < 2:
        return None
    opened = steps[-2]
    if not isinstance(opened, dict) or opened.get("result") != "open":
        return None
    closed = _moment(steps[-1])
    since = _moment(opened)
    if closed is None or since is None or closed < since:
        # A clock that stepped back would give a negative duration, which is not a
        # fast gate: it is a wrong number, and it is not reported.
        return None
    gate = opened.get("step")
    return (gate, round((closed - since).total_seconds() * 1000)) if isinstance(gate, str) else None


def _moment(step) -> datetime | None:
    written = (step or {}).get("decided_at")
    if not isinstance(written, str):
        return None
    try:
        # Anagraphics writes UTC with a `Z`, which `fromisoformat` reads from 3.11 on.
        return datetime.fromisoformat(written)
    except ValueError:
        return None


def assign_driver(settings, project_id: str, driver_uid: str) -> Answer:
    """`PUT /projects/{id}/review/driver` → the project with the driver copied onto it.

    `not_found` with `DRIVER_NOT_FOUND` is the interesting outcome: the pool named
    somebody who is no longer there, and that is a reason to ask it again rather than
    to give up on the project.
    """
    return _call(
        settings,
        "PUT",
        f"/projects/{project_id}/review/driver",
        operation="assign_driver",
        body={"driver_uid": driver_uid},
    )
