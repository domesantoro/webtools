"""Mongo: two collections, and nothing written per occurrence.

`metrics_daily` — one document per day × subsystem × metric × dimensions. A
measurement that arrives is an `$inc` on the document that is already there,
created by upsert the first time. Ten clients or ten thousand make the same number
of documents: it is the number of **kinds** of thing measured that decides it, not
the traffic.

`metrics_projects` — one document per project. A per-project figure cannot come out
of the daily buckets: "what a webtool consumes" is a distribution **over projects**,
and a daily sum has already thrown the projects away.

Two details that are easy to get wrong and are decided here:

- **the dimensions are identified by a canonical string**, `dims_key`. Mongo
  compares sub-documents including the order of their keys, so `{a, b}` and
  `{b, a}` would be two different buckets for the same thing. The key is built
  sorted, and it is what the unique index is on; `dims` is kept beside it because
  it is what the reads give back;
- **a metric's name has a dot in it**, and a dot in a Mongo field name is legal but
  a nuisance to query. Inside a project's document the name is written with its
  dots turned into underscores, and the read turns them back. The vocabulary is
  closed, so the mapping is checked once, at import.
"""

from datetime import datetime, timedelta, timezone

from pymongo import ASCENDING, MongoClient
from pymongo.database import Database

from webtools_metrics.settings import Settings
from webtools_metrics.vocabulary import METRICS

DAILY = "metrics_daily"
PROJECTS = "metrics_projects"

# Responses never expose Mongo's internal _id.
PUBLIC = {"_id": 0}

TTL_INDEX = "day_at_ttl"


def safe_key(metric: str) -> str:
    """A metric's name as a Mongo field name."""
    return metric.replace(".", "_")


def metric_of(key: str) -> str:
    """The name back from the field name, for the answers."""
    return _NAME_OF_KEY[key]


_NAME_OF_KEY = {safe_key(name): name for name in METRICS}
if len(_NAME_OF_KEY) != len(METRICS):  # pragma: no cover - checked at import
    raise RuntimeError("two metric names collapse onto the same Mongo field name")


def connect(settings: Settings) -> Database:
    client = MongoClient(
        settings.mongo_uri,
        tz_aware=True,
        serverSelectionTimeoutMS=settings.mongo_server_selection_timeout_ms,
    )
    return client[settings.mongo_db]


def ensure_indexes(db: Database, settings: Settings) -> None:
    """The indexes, and the retention.

    The retention is a configured number of days on the daily buckets; `0` means
    keep for ever, and then there is **no** TTL index — not one with a very large
    value, which would be a deletion we had not decided on, only postponed. The
    accumulators of `metrics_projects` are never expired here: they are one
    document per project and they are what a project's consumption is read from.
    """
    db[DAILY].create_index(
        [("day", ASCENDING), ("subsystem", ASCENDING), ("metric", ASCENDING), ("dims_key", ASCENDING)],
        unique=True,
        name="bucket",
    )
    db[DAILY].create_index([("metric", ASCENDING), ("day", ASCENDING)], name="metric_day")
    db[PROJECTS].create_index("project_id", unique=True)
    _apply_retention(db, settings.retention_days)


def _apply_retention(db: Database, retention_days: int) -> None:
    seconds = retention_days * 24 * 60 * 60
    existing = db[DAILY].index_information().get(TTL_INDEX)
    if retention_days == 0:
        if existing is not None:
            db[DAILY].drop_index(TTL_INDEX)
        return
    if existing is None:
        db[DAILY].create_index("day_at", name=TTL_INDEX, expireAfterSeconds=seconds)
        return
    if existing.get("expireAfterSeconds") != seconds:
        # Changed in operation: Mongo can alter a TTL in place, and altering it is
        # not the same as dropping the data.
        db.command({"collMod": DAILY, "index": {"name": TTL_INDEX, "expireAfterSeconds": seconds}})


def day_of(moment: datetime) -> tuple[str, datetime]:
    """The day a measurement belongs to, in UTC: the string the buckets are keyed
    by, and the midnight the TTL counts from."""
    utc = moment.astimezone(timezone.utc)
    return utc.strftime("%Y-%m-%d"), datetime(utc.year, utc.month, utc.day, tzinfo=timezone.utc)


def dims_key_of(dims: dict[str, str]) -> str:
    """The canonical identity of a set of dimensions."""
    return "&".join(f"{key}={dims[key]}" for key in sorted(dims))


def bucket_of(duration_ms: int, edges: tuple[int, ...]) -> str:
    """Which bucket of the histogram a duration falls in. The last one is
    everything above the last edge, and it is called `inf` because that is what it
    is: it has no upper bound to report."""
    for edge in edges:
        if duration_ms <= edge:
            return str(edge)
    return "inf"


def fold(db: Database, settings: Settings, measurement: dict, at: datetime) -> dict:
    """Folds a measurement into the day's bucket and, when it names one, into the
    project's accumulator. Returns what was folded, for the answer.

    `measurement` is what the API has already checked against the vocabulary:
    `subsystem`, `metric`, `dims`, `count`, and the values the metric declares.
    """
    day, day_at = day_of(at)
    increments = _increments(measurement, settings)
    minima, maxima = _extremes(measurement)

    update: dict = {"$inc": increments, "$setOnInsert": {"day_at": day_at, "dims": measurement["dims"]}}
    if minima:
        update["$min"] = minima
    if maxima:
        update["$max"] = maxima

    db[DAILY].update_one(
        {
            "day": day,
            "subsystem": measurement["subsystem"],
            "metric": measurement["metric"],
            "dims_key": dims_key_of(measurement["dims"]),
        },
        update,
        upsert=True,
    )

    project_id = measurement.get("project_id")
    if project_id:
        _fold_project(db, measurement, increments, minima, maxima, at)
    return {"day": day}


def _increments(measurement: dict, settings: Settings) -> dict[str, float]:
    """Everything that is added to the bucket, `$inc` field by `$inc` field."""
    increments: dict[str, float] = {"count": measurement["count"]}

    tokens = measurement.get("tokens")
    if tokens:
        # The kinds are whatever the provider reports: they are counted as they
        # come, not mapped onto a list this file would have to know.
        for kind, value in tokens.items():
            increments[f"tokens.{kind}"] = value

    amounts = measurement.get("amounts")
    if amounts:
        # One field per name, as they come — the names belong to whoever measures.
        for name, quantity in amounts.items():
            increments[f"amounts.{name}"] = quantity

    scores = measurement.get("scores")
    if scores:
        # One field per axis, as they come. The average over the day is this sum
        # divided by `count`, which is in the same bucket: every axis of a judgement
        # arrives in the same measurement, so one denominator serves them all.
        for axis, value in scores.items():
            increments[f"scores.{axis}"] = value

    confidence = measurement.get("confidence")
    if confidence is not None:
        increments["confidence.sum"] = confidence

    if "bytes" in measurement:
        increments["bytes"] = measurement["bytes"]

    duration = measurement.get("duration_ms")
    if duration is not None:
        increments["duration_ms.sum"] = duration
        increments[f"duration_ms.buckets.{bucket_of(duration, settings.duration_buckets_ms)}"] = 1
    return increments


def _extremes(measurement: dict) -> tuple[dict, dict]:
    duration = measurement.get("duration_ms")
    if duration is None:
        return {}, {}
    # Exact, unlike the percentiles: they cost one field each.
    return {"duration_ms.min": duration}, {"duration_ms.max": duration}


def _fold_project(
    db: Database, measurement: dict, increments: dict, minima: dict, maxima: dict, at: datetime
) -> None:
    """The same numbers again, on the project. Not a second source of truth: what a
    project consumed is on its own pipeline steps in anagraphics (see
    `contesto/06. metrics.md`). This is what makes the distribution over projects
    readable without walking every pipeline."""
    key = safe_key(measurement["metric"])
    phase = measurement["dims"].get("phase")

    project_increments = {f"metrics.{key}.{field}": value for field, value in increments.items()}
    # The project's own totals, so the common question — what did this one consume
    # — does not have to add up every metric.
    for field, value in increments.items():
        if field.startswith("tokens."):
            project_increments[field] = value
    if phase:
        for field, value in increments.items():
            if field == "count" or field.startswith("tokens."):
                project_increments[f"phases.{phase}.{field}"] = value

    # How this project's gates decided, and why. Kept on the project because the
    # question "what did the projects we refused consume" cannot be asked of a
    # daily bucket: a bucket has no project in it.
    if measurement["metric"] == "gate.decided":
        outcome = measurement["dims"]["outcome"]
        project_increments[f"gates.{outcome}"] = measurement["count"]
        reason = measurement["dims"].get("reason")
        if reason:
            project_increments[f"gate_reasons.{reason}"] = measurement["count"]

    update: dict = {
        "$inc": project_increments,
        "$setOnInsert": {"first_at": at},
        "$max": {"last_at": at, **{f"metrics.{key}.{f}": v for f, v in maxima.items()}},
    }
    if minima:
        update["$min"] = {f"metrics.{key}.{field}": value for field, value in minima.items()}
    db[PROJECTS].update_one({"project_id": measurement["project_id"]}, update, upsert=True)


def read_project(db: Database, project_id: str) -> dict | None:
    return db[PROJECTS].find_one({"project_id": project_id}, PUBLIC)


def rows(db: Database, metrics: tuple[str, ...], first_day: str, last_day: str, limit: int) -> list[dict]:
    """The buckets of those metrics in that period, day by day. Everything the
    reads compute is computed from these, and `GET /metrics/daily` gives them back
    unchanged: an aggregate is a claim, and a claim has to be checkable against
    what it was made from."""
    return list(
        db[DAILY]
        .find({"metric": {"$in": list(metrics)}, "day": {"$gte": first_day, "$lte": last_day}}, PUBLIC)
        .sort([("day", ASCENDING), ("metric", ASCENDING), ("dims_key", ASCENDING)])
        .limit(limit)
    )


def project_rows(db: Database, limit: int) -> list[dict]:
    return list(db[PROJECTS].find({}, PUBLIC).limit(limit))


def days_between(first_day: str, last_day: str) -> int:
    first = datetime.strptime(first_day, "%Y-%m-%d")
    last = datetime.strptime(last_day, "%Y-%m-%d")
    return (last - first) // timedelta(days=1) + 1
