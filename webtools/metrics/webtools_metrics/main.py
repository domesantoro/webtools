"""The metrics API: one route to measure, and one route per question.

What arrives is a **measurement**, not an event: it is folded into the day's
bucket and into the project's accumulator, and nothing is kept per occurrence. See
`contesto/06. metrics.md` for why, and `vocabulary.py` for what may be sent.

Nothing here is on anybody's critical path: whoever sends a measurement does not
wait for the answer. That is what makes it acceptable for a measurement to be
lost, and it is why the funnel asks anagraphics how many projects really exist.
"""

import logging
from datetime import datetime, timezone

from fastapi import FastAPI, Query, Request
from pydantic import BaseModel, Field

from webtools_metrics import anagraphics, db, errors, reads
from webtools_metrics.settings import load_settings
from webtools_metrics.vocabulary import METRICS, SUBSYSTEMS, VALUE_FIELDS

logger = logging.getLogger("webtools_metrics")

# The refusals that are the vocabulary turning something away, and therefore say
# something about the sender. The list is `measurement.refused`'s own closed
# dimension, read from it so the two cannot drift apart: a body that is not a body,
# a period asked for backwards or an IP outside the pool are not this.
REFUSALS_COUNTED = METRICS["measurement.refused"].required["code"]

settings = load_settings()
database = db.connect(settings)
db.ensure_indexes(database, settings)

app = FastAPI(title="metrics", version="0.1.0")
errors.install_error_handlers(app)


@app.middleware("http")
async def allow_only_known_ips(request: Request, call_next):
    # Only the connection's IP is used. It must be started with
    # `python -m webtools_metrics` (proxy_headers=False), otherwise uvicorn
    # rewrites client.host from X-Forwarded-For for requests from localhost.
    host = request.client.host if request.client else None
    if host not in settings.allowed_ips:
        return errors.error_response(403, errors.IP_NOT_ALLOWED)
    if _too_large(request):
        return errors.error_response(413, errors.BODY_TOO_LARGE)
    return await call_next(request)


def _too_large(request: Request) -> bool:
    declared = request.headers.get("content-length")
    if declared is None or not declared.isdigit():
        return False
    return int(declared) > settings.body_max_bytes


class Measurement(BaseModel):
    """One thing that happened, said in numbers.

    `count` is how many occurrences this measurement stands for, and it is 1 when
    it is not said: one call, one request, one turn. It is not a default value in
    the sense the configuration forbids — it is the meaning of sending a
    measurement at all.
    """

    subsystem: str
    metric: str
    dims: dict[str, str] = Field(default_factory=dict)
    count: int = Field(default=1, gt=0)
    duration_ms: int | None = Field(default=None, ge=0)
    tokens: dict[str, int] | None = None
    # Fractions between 0 and 1: a score per axis, and how sure of itself the answer
    # was. Summed like the rest; `count` is the denominator.
    scores: dict[str, float] | None = None
    confidence: float | None = None
    # Quantities of the thing measured. Zero is allowed and is an answer.
    amounts: dict[str, int] | None = None
    bytes: int | None = Field(default=None, ge=0)
    project_id: str | None = None
    # When it really happened, if that is not now. The receiving server's clock is
    # what the day is decided by when this is absent: a caller's clock is not ours.
    occurred_at: datetime | None = None


@app.post("/measurements", status_code=202)
def receive(measurement: Measurement) -> dict:
    """Folds one measurement. `202`, not `201`: nothing was created — a number that
    was already there is larger now."""
    try:
        checked = _checked(measurement)
    except errors.ApiError as refused:
        _refusal_counted(measurement, refused)
        raise
    at = measurement.occurred_at or datetime.now(timezone.utc)
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    folded = db.fold(database, settings, checked, at)
    return {"folded": True, "day": folded["day"], "metric": checked["metric"]}


def _refusal_counted(measurement: Measurement, refused: errors.ApiError) -> None:
    """A measurement the vocabulary turned away, counted as a measurement of ours.

    **It is folded here and not sent over HTTP.** Every other subsystem measures by
    calling this API; this one is the API, and a request to itself would be a second
    thing that can fail at exactly the moment something is already failing. It writes
    the bucket the way the route would have written it.

    Nothing is raised out of here. This runs while an error is already on its way to
    the caller, and a metrics that broke while recording that it had refused
    something would turn a `400` into a `500` — the sender would then be told its
    measurement was our fault, which is the one answer that is certainly wrong.
    """
    if refused.code not in REFUSALS_COUNTED:
        return
    try:
        db.fold(
            database,
            settings,
            {
                "subsystem": "metrics",
                "metric": "measurement.refused",
                # Who sent it, unless what was refused was that very name: there is
                # then nothing about the sender worth recording, and absent is absent.
                "dims": dict(
                    sorted(
                        {
                            "code": refused.code,
                            **(
                                {}
                                if refused.code == errors.UNKNOWN_SUBSYSTEM
                                else {"sender": measurement.subsystem}
                            ),
                        }.items()
                    )
                ),
                "count": 1,
            },
            datetime.now(timezone.utc),
        )
    except Exception:  # noqa: BLE001 - see the docstring
        logger.exception("the refusal of a measurement could not be recorded")


def _checked(measurement: Measurement) -> dict:
    """The measurement against the vocabulary. Everything refused is refused with
    the name of what was wrong: whoever sent it has to be able to fix it without
    reading our log."""
    if measurement.subsystem not in SUBSYSTEMS:
        raise errors.ApiError(400, errors.UNKNOWN_SUBSYSTEM, subsystem=measurement.subsystem)
    metric = METRICS.get(measurement.metric)
    if metric is None:
        raise errors.ApiError(400, errors.UNKNOWN_METRIC, metric=measurement.metric)

    dims = measurement.dims
    for name in metric.required:
        if name not in dims:
            raise errors.ApiError(
                400, errors.MISSING_DIMENSION, metric=measurement.metric, dimension=name
            )
    allowed = {**metric.required, **metric.optional}
    for name, value in dims.items():
        if name not in allowed:
            raise errors.ApiError(
                400, errors.UNKNOWN_DIMENSION, metric=measurement.metric, dimension=name
            )
        values = allowed[name]
        if values is not None and value not in values:
            raise errors.ApiError(
                400,
                errors.UNKNOWN_DIMENSION_VALUE,
                metric=measurement.metric,
                dimension=name,
                value=value,
            )

    checked: dict = {
        "subsystem": measurement.subsystem,
        "metric": measurement.metric,
        "dims": dict(sorted(dims.items())),
        "count": measurement.count,
    }
    for field in VALUE_FIELDS:
        value = getattr(measurement, field)
        if value is None:
            continue
        if field not in metric.values:
            raise errors.ApiError(
                400, errors.UNEXPECTED_VALUE, metric=measurement.metric, value=field
            )
        checked[field] = value
    if measurement.tokens is not None:
        # Tokens belong to a provider, and it is the configuration — not this file
        # — that says which kinds that provider counts. A provider nobody
        # configured is refused by name: adding it is one line of configuration,
        # while accepting kinds nobody declared is how a typo becomes a sum that
        # grows in a corner and is never read.
        provider = dims.get("provider")
        if not settings.providers.knows(provider):
            raise errors.ApiError(
                400, errors.UNKNOWN_PROVIDER, metric=measurement.metric, provider=provider or "none"
            )
        unknown = set(measurement.tokens) - settings.providers.token_kinds(provider)
        if unknown:
            raise errors.ApiError(
                400,
                errors.UNKNOWN_TOKEN_KIND,
                provider=provider,
                kind=sorted(unknown)[0],
            )
        if any(amount < 0 for amount in measurement.tokens.values()):
            raise errors.ApiError(400, errors.INVALID_BODY)

    # A score outside the scale is not a score. Refused rather than stored, because a
    # `1.4` summed into a daily bucket is an average nobody can tell is wrong.
    fractions = list((measurement.scores or {}).values())
    if measurement.confidence is not None:
        fractions.append(measurement.confidence)
    if any(not 0 <= value <= 1 for value in fractions):
        raise errors.ApiError(400, errors.INVALID_BODY)

    # A quantity is a whole number of things and cannot be negative. Zero is fine.
    if any(amount < 0 for amount in (measurement.amounts or {}).values()):
        raise errors.ApiError(400, errors.INVALID_BODY)

    if measurement.project_id:
        if not metric.project:
            raise errors.ApiError(
                400, errors.UNEXPECTED_VALUE, metric=measurement.metric, value="project_id"
            )
        checked["project_id"] = measurement.project_id
    return checked


# ------------------------------------------------------------------- the questions


def _period(first_day: str, last_day: str) -> tuple[str, str]:
    for value in (first_day, last_day):
        try:
            datetime.strptime(value, "%Y-%m-%d")
        except ValueError:
            raise errors.ApiError(400, errors.INVALID_RANGE, day=value) from None
    if first_day > last_day:
        raise errors.ApiError(400, errors.INVALID_RANGE, day=first_day)
    return first_day, last_day


def _rows(metrics: tuple[str, ...], first_day: str, last_day: str) -> tuple[list[dict], bool]:
    """The buckets, and whether they ran out. The limit is the configuration's, and
    the answer says when it was reached: half an answer that says so is usable, one
    that does not is not."""
    found = db.rows(database, metrics, first_day, last_day, settings.max_rows + 1)
    return found[: settings.max_rows], len(found) > settings.max_rows


def _answer(payload: dict, first_day: str, last_day: str, truncated: bool) -> dict:
    return {
        "from": first_day,
        "to": last_day,
        "days": db.days_between(first_day, last_day),
        "truncated": truncated,
        **payload,
    }


@app.get("/metrics/funnel")
def funnel(first_day: str = Query(alias="from"), last_day: str = Query(alias="to")) -> dict:
    """Who arrived, who left, and where — reconciled with the projects that really
    exist, so the answer says how much of itself was lost."""
    first_day, last_day = _period(first_day, last_day)
    rows, truncated = _rows(("form.opened", "form.submitted", "project.created", "gate.decided"), first_day, last_day)
    measured = sum(row.get("count", 0) for row in rows if row["metric"] == "project.created")
    count = anagraphics.count_projects(settings, first_day, last_day)
    reconciliation = count.as_answer() | {"projects_measured": measured}
    if count.projects is not None:
        reconciliation["lost"] = max(0, count.projects - measured)
    return _answer(
        {"stages": reads.funnel(rows), "reconciliation": reconciliation},
        first_day,
        last_day,
        truncated,
    )


@app.get("/metrics/cost")
def cost(first_day: str = Query(alias="from"), last_day: str = Query(alias="to")) -> dict:
    first_day, last_day = _period(first_day, last_day)
    rows, truncated = _rows(tuple(METRICS), first_day, last_day)
    projects = db.project_rows(database, settings.max_rows)
    return _answer(reads.cost(rows, projects), first_day, last_day, truncated)


@app.get("/metrics/preanalysis")
def preanalysis(first_day: str = Query(alias="from"), last_day: str = Query(alias="to")) -> dict:
    first_day, last_day = _period(first_day, last_day)
    rows, truncated = _rows(
        ("preanalysis.turn", "preanalysis.closed", "preanalysis.validation"),
        first_day,
        last_day,
    )
    projects = db.project_rows(database, settings.max_rows)
    return _answer(reads.preanalysis(rows, projects), first_day, last_day, truncated)


@app.get("/metrics/providers")
def providers(first_day: str = Query(alias="from"), last_day: str = Query(alias="to")) -> dict:
    first_day, last_day = _period(first_day, last_day)
    rows, truncated = _rows(("ai.call", "ai.failed", "ai.retry"), first_day, last_day)
    return _answer(reads.providers(rows), first_day, last_day, truncated)


@app.get("/metrics/http")
def http(first_day: str = Query(alias="from"), last_day: str = Query(alias="to")) -> dict:
    first_day, last_day = _period(first_day, last_day)
    rows, truncated = _rows(("http.request", "http.error", "http.refused_ip"), first_day, last_day)
    return _answer(reads.http(rows), first_day, last_day, truncated)


@app.get("/metrics/economics")
def economics(first_day: str = Query(alias="from"), last_day: str = Query(alias="to")) -> dict:
    first_day, last_day = _period(first_day, last_day)
    rows, truncated = _rows(tuple(METRICS), first_day, last_day)
    projects = db.project_rows(database, settings.max_rows)
    return _answer(reads.economics(rows, projects), first_day, last_day, truncated)


@app.get("/metrics/timing")
def timing(first_day: str = Query(alias="from"), last_day: str = Query(alias="to")) -> dict:
    first_day, last_day = _period(first_day, last_day)
    rows, truncated = _rows(
        ("gate.duration", "project.lead_time", "form.submitted"), first_day, last_day
    )
    return _answer(reads.timing(rows), first_day, last_day, truncated)


@app.get("/metrics/health")
def health(first_day: str = Query(alias="from"), last_day: str = Query(alias="to")) -> dict:
    first_day, last_day = _period(first_day, last_day)
    rows, truncated = _rows(
        ("process.started", "dependency.call", "mongo.operation", "login.attempt"),
        first_day,
        last_day,
    )
    return _answer(reads.health(rows), first_day, last_day, truncated)


@app.get("/metrics/daily")
def daily(
    first_day: str = Query(alias="from"),
    last_day: str = Query(alias="to"),
    metric: str | None = None,
) -> dict:
    """The buckets themselves. Every aggregate above is a claim, and a claim has to
    be checkable against what it was computed from."""
    first_day, last_day = _period(first_day, last_day)
    if metric is not None and metric not in METRICS:
        raise errors.ApiError(400, errors.UNKNOWN_METRIC, metric=metric)
    metrics = (metric,) if metric else tuple(METRICS)
    rows, truncated = _rows(metrics, first_day, last_day)
    return _answer({"rows": rows}, first_day, last_day, truncated)


@app.get("/metrics/projects/{project_id}")
def project(project_id: str) -> dict:
    document = db.read_project(database, project_id)
    if document is None:
        raise errors.ApiError(404, errors.PROJECT_NOT_FOUND, project_id=project_id)
    return document


@app.get("/vocabulary")
def vocabulary() -> dict:
    """What may be sent. A closed list is only fair if it can be read."""
    return {
        "subsystems": sorted(SUBSYSTEMS),
        "metrics": {
            name: {
                "required": {key: sorted(values) if values else None for key, values in metric.required.items()},
                "optional": {key: sorted(values) if values else None for key, values in metric.optional.items()},
                "values": sorted(metric.values),
                "project": metric.project,
            }
            for name, metric in sorted(METRICS.items())
        },
    }
