"""HTTP client towards webtools_workspaces: the project's files.

Same contract as the anagraphics client — the data or a reason, never an exception —
and the same three reasons. What differs is what travels: these calls carry a `.md`,
not JSON, in both directions.

    GET  /projects/{id}/specs/latest          the pre-specification, this run's input
    POST /projects/{id}/documents/{kind}      the analysis and the proposal, its output

The two live in different families on purpose: a specification arrives — the form
rendered it, or the client uploaded it — and a document is written by us. Which is why
storing one takes no headers: there is no origin to declare and no person to name.
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
    print(f"[workspaces] {message}", file=sys.stderr)


def _reporter(settings, operation: str):
    elapsed = settings.metrics.timer()

    def report(outcome: str) -> None:
        settings.metrics.measure(
            "dependency.call",
            dims={"target": "workspaces", "operation": operation, "outcome": outcome},
            duration_ms=elapsed(),
        )

    return report


def latest_spec(settings, project_id: str) -> Answer:
    """The last version of the pre-specification, as text.

    `not_found` is an answer and not a failure: a project with no specification at all
    is a project this run has nothing to read, and the run says so rather than asking
    a model to analyse an empty page.
    """
    path = f"/projects/{project_id}/specs/latest"
    report = _reporter(settings, "latest_spec")
    try:
        response = httpx.get(
            f"{settings.workspaces.url}{path}",
            headers={"accept": "text/markdown"},
            timeout=settings.workspaces.timeout_ms / 1000,
        )
    except httpx.TimeoutException as error:
        _log(f"GET {path}: {type(error).__name__} {error}")
        report("timed_out")
        return Answer(ok=False, reason="unavailable")
    except httpx.HTTPError as error:
        _log(f"GET {path}: {type(error).__name__} {error}")
        report("failed")
        return Answer(ok=False, reason="unavailable")

    if response.status_code == 404:
        report("not_found")
        return Answer(ok=False, reason="not_found")
    if not response.is_success:
        _log(f"GET {path}: HTTP {response.status_code}")
        report("failed")
        return Answer(ok=False, reason="unavailable")
    report("ok")
    return Answer(ok=True, data=response.text)


def store_document(settings, project_id: str, kind: str, text: str) -> Answer:
    """A document of ours, stored as a new version of its kind.

    `rejected` means the file is no good — an unknown kind, a broken front matter, a
    document over the limit — and asking again with the same bytes buys the same
    answer. It is ours to fix, and it is never a reason to retry.
    """
    path = f"/projects/{project_id}/documents/{kind}"
    report = _reporter(settings, "store_document")
    try:
        response = httpx.post(
            f"{settings.workspaces.url}{path}",
            content=text.encode("utf-8"),
            headers={"content-type": "text/markdown; charset=utf-8", "accept": "application/json"},
            timeout=settings.workspaces.timeout_ms / 1000,
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

    if response.is_success:
        report("ok")
        return Answer(ok=True, data=payload)

    code = payload.get("error") if isinstance(payload, dict) else None
    report("failed")
    _log(f"POST {path}: HTTP {response.status_code} {code or '?'}")
    if response.status_code in (400, 413):
        return Answer(ok=False, reason="rejected", code=code)
    return Answer(ok=False, reason="unavailable", code=code)
