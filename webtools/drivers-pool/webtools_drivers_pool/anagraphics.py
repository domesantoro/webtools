"""HTTP client towards webtools_anagraphics.

It raises nothing towards its caller: every call returns either the data or a reason,
because the caller has to know *how* it went wrong and not only that it did.

    reason "not_found"    → the API answered 404 with its own error code
    reason "rejected"     → 400 or 409: the request was wrong, asking again does not help
    reason "unavailable"  → unreachable, timed out, 5xx, 403, broken JSON

Anagraphics' error responses are `{"error": "<CODE>"}`: the code is compared, never the
text.

There is no shared HTTP client in this project, in either language: each dependency
gets one written by hand, and what is shared is the contract, not the code. This one is
the twin of `webtools/preanalyst/src/anagraphics.js`.

**Every call through here is measured**, once, as a `dependency.call`. `operation` is a
stable word each helper gives — never the path, because a path carries identifiers and
a bucket per identifier would make the number of documents grow with the traffic
instead of with the number of kinds of thing measured.
"""

import sys
from dataclasses import dataclass

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


def _read_json(settings, path: str, *, operation: str) -> Answer:
    url = f"{settings.anagraphics.url}{path}"
    elapsed = settings.metrics.timer()

    def report(outcome: str) -> None:
        settings.metrics.measure(
            "dependency.call",
            dims={"target": "anagraphics", "operation": operation, "outcome": outcome},
            duration_ms=elapsed(),
        )

    try:
        response = httpx.get(
            url,
            headers={"accept": "application/json"},
            timeout=settings.anagraphics.timeout_ms / 1000,
        )
    except httpx.TimeoutException as error:
        # We gave up waiting, or there was nothing at the other end: two facts, and in
        # a log they look alike.
        _log(f"GET {path}: {type(error).__name__} {error}")
        report("timed_out")
        return Answer(ok=False, reason="unavailable")
    except httpx.HTTPError as error:
        _log(f"GET {path}: {type(error).__name__} {error}")
        report("failed")
        return Answer(ok=False, reason="unavailable")

    try:
        payload = response.json()
    except ValueError:
        _log(f"GET {path}: response is not JSON (HTTP {response.status_code})")
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
    _log(f"GET {path}: HTTP {response.status_code} {code or '?'}")
    if response.status_code in (400, 409):
        return Answer(ok=False, reason="rejected", code=code)
    return Answer(ok=False, reason="unavailable", code=code)


def list_drivers(settings) -> Answer:
    """`GET /drivers` → the drivers, without their addresses.

    The list carries `uid`, `screen_name` and `enabled`. That last one is what this
    subsystem is here to read.
    """
    answer = _read_json(settings, "/drivers", operation="list_drivers")
    if not answer.ok:
        return answer
    drivers = answer.data.get("drivers") if isinstance(answer.data, dict) else None
    if not isinstance(drivers, list):
        _log("GET /drivers: the answer does not carry a list of drivers")
        return Answer(ok=False, reason="unavailable")
    return Answer(ok=True, data=drivers)
