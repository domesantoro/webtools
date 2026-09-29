"""The one thing this subsystem asks of another.

Metrics is generally passive — it is told things and it answers questions — but the
funnel has a hole it cannot close on its own: a measurement may be lost, because
nobody waits for it, and a lost `project.created` is indistinguishable from a
client who left. For projects the truth exists elsewhere, in anagraphics, so we
ask it and put the difference in the answer.

Every outcome is a real answer, not an exception to be caught somewhere else: the
count, or the reason there is none. A funnel that cannot be reconciled says so and
is still a funnel; one that pretends to be exact because a call failed is worse
than one that admits the hole.
"""

from dataclasses import dataclass

import httpx


@dataclass(frozen=True)
class ProjectCount:
    projects: int | None
    # Why there is no number: `unreachable`, `no_route` (an anagraphics that does
    # not offer the count yet), `refused`, `unusable`.
    reason: str | None = None

    def as_answer(self) -> dict:
        if self.projects is None:
            return {"available": False, "reason": self.reason}
        return {"available": True, "projects": self.projects}


def count_projects(settings, first_day: str, last_day: str) -> ProjectCount:
    url = f"{settings.anagraphics_url}/projects/count"
    try:
        response = httpx.get(
            url,
            params={"from": first_day, "to": last_day},
            headers={"accept": "application/json"},
            timeout=settings.anagraphics_timeout_ms / 1000,
        )
    except httpx.HTTPError:
        return ProjectCount(None, "unreachable")

    if response.status_code == 404:
        # An anagraphics that does not have the route: told apart from one that is
        # down, because the two call for different things to be done.
        return ProjectCount(None, "no_route")
    if response.status_code != 200:
        return ProjectCount(None, "refused")
    try:
        body = response.json()
    except ValueError:
        return ProjectCount(None, "unusable")
    projects = body.get("projects") if isinstance(body, dict) else None
    if not isinstance(projects, int) or isinstance(projects, bool):
        return ProjectCount(None, "unusable")
    return ProjectCount(projects)
