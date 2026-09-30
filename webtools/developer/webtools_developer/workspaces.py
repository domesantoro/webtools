"""HTTP client towards webtools_workspaces: the analysis this build is made from.

One call, and it only reads:

    GET /projects/{id}/documents/analysis/latest    the document the tool is built from

**Nothing is stored back.** What a build produces is a tree of source files that has to
be executed, and workspaces keeps versioned `.md` documents with a ceiling on the size
of each: a source tree is not one of those, and a store reached over HTTP cannot be the
directory a command runs in. So the files live under the builds root, and the only thing
this client is for is fetching the input.

Same contract as the anagraphics client — the data or a reason, never an exception —
and the same three reasons. What differs is what travels: this call carries a `.md` and
not JSON.
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


def latest_analysis(settings, project_id: str) -> Answer:
    """The last version of the technical analysis, as text.

    `not_found` is an answer and not a failure: a project with no analysis stored is a
    project this build has nothing to read, and it says so rather than asking a model to
    build from an empty page. It is also not a case anybody should reach — a project in
    `CLIENT_VALIDATION` has been through the analyst — so when it happens the fault is
    upstream and the build stops where it can be seen.
    """
    path = f"/projects/{project_id}/documents/analysis/latest"
    report = _reporter(settings, "latest_analysis")
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
