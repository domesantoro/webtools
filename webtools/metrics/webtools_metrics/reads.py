"""The questions, computed from the buckets.

The aggregation is done **here**, in Python, over the buckets Mongo returns, and
not in an aggregation pipeline. At the volumes this subsystem is built for — one
document per day per kind of thing measured, a few thousand a year — the two cost
the same, and this way the arithmetic of every answer is readable in one place,
next to the words that say what the answer means. `limits.max_rows` is what keeps
the promise finite; when it is reached the answer says so, rather than quietly
telling half the truth.

What every figure carries, because without it it cannot be used: `truncated`,
whether the rows ran out before the period did.

**Tokens are counted, never converted.** A number of tokens of a kind is what a
call consumed, and nothing here turns it into a currency: what a token is worth is
not this subsystem's to say, and a figure in money would be a claim about a price
nobody configured here. For the same reason kinds are never added together: an
output token and a token read from a cache are not the same thing, and a sum of
the two is a rate of one against the other that nobody decided.

The percentiles are **estimates read off a histogram**: the answer gives the upper
edge of the bucket the percentile falls in, under a name that says so
(`p95_at_most_ms`), and `null` when the bucket has no upper bound. Keeping every
duration to compute an exact percentile is the log this subsystem is not.
"""

from collections import defaultdict
from typing import Callable, Iterable


def _empty() -> dict:
    return {
        "count": 0,
        # Whatever kinds turn up: the four of one provider are not the four of the
        # next one, and this file does not decide which exist.
        "tokens": defaultdict(int),
        "bytes": 0,
        "duration": {"sum": 0, "min": None, "max": None, "buckets": defaultdict(int), "count": 0},
    }


def add(total: dict, row: dict) -> dict:
    """One bucket into an accumulator."""
    total["count"] += row.get("count", 0)
    for kind, value in (row.get("tokens") or {}).items():
        total["tokens"][kind] += value
    total["bytes"] += row.get("bytes", 0)

    duration = row.get("duration_ms")
    if duration:
        into = total["duration"]
        into["sum"] += duration.get("sum", 0)
        low, high = duration.get("min"), duration.get("max")
        if low is not None:
            into["min"] = low if into["min"] is None else min(into["min"], low)
        if high is not None:
            into["max"] = high if into["max"] is None else max(into["max"], high)
        for edge, hits in (duration.get("buckets") or {}).items():
            into["buckets"][edge] += hits
            into["count"] += hits
    return total


def group(rows: Iterable[dict], key_of: Callable[[dict], tuple]) -> dict[tuple, dict]:
    grouped: dict[tuple, dict] = {}
    for row in rows:
        key = key_of(row)
        add(grouped.setdefault(key, _empty()), row)
    return grouped


def summarise(total: dict) -> dict:
    """An accumulator as it is answered: the counts, and the durations' estimates."""
    answer: dict = {"count": total["count"]}
    if any(total["tokens"].values()):
        answer["tokens"] = dict(total["tokens"])
    if total["bytes"]:
        answer["bytes"] = total["bytes"]
    if total["duration"]["count"]:
        answer["duration"] = _durations(total["duration"])
    return answer


def _durations(duration: dict) -> dict:
    count = duration["count"]
    return {
        "count": count,
        "mean_ms": duration["sum"] // count,
        "min_ms": duration["min"],
        "max_ms": duration["max"],
        "p50_at_most_ms": _percentile(duration, 0.50),
        "p95_at_most_ms": _percentile(duration, 0.95),
        "estimated_from": "histogram buckets",
    }


def _percentile(duration: dict, share: float) -> int | None:
    """The upper edge of the bucket the percentile falls in, or `null` when that
    bucket is the one with no upper bound — in which case `max_ms` is the only
    exact thing that can be said about the tail, and it is right there."""
    wanted = duration["count"] * share
    seen = 0
    for edge in sorted((e for e in duration["buckets"] if e != "inf"), key=int):
        seen += duration["buckets"][edge]
        if seen >= wanted:
            return int(edge)
    return None


def _tokens_of(rows: Iterable[dict]) -> dict[str, int]:
    """The tokens of those rows, kind by kind. The kinds are whatever turns up."""
    total: dict[str, int] = defaultdict(int)
    for row in rows:
        for kind, value in (row.get("tokens") or {}).items():
            total[kind] += value
    return dict(total)


# ---------------------------------------------------------------- the questions


def funnel(rows: list[dict]) -> dict:
    """How many arrived at each stage and where they left."""
    stages: dict[str, dict] = {}
    for row in rows:
        metric = row["metric"]
        if metric == "gate.decided":
            dims = row.get("dims", {})
            name = f"gate.{dims.get('gate', '?')}.{dims.get('outcome', '?')}"
            if dims.get("reason"):
                name += f".{dims['reason']}"
        else:
            name = metric
            dims = row.get("dims", {})
            if dims.get("outcome"):
                name += f".{dims['outcome']}"
        add(stages.setdefault(name, _empty()), row)
    return {stage: summarise(total) for stage, total in sorted(stages.items())}


def by_dimension(rows: list[dict], metrics: tuple[str, ...], dimension: str) -> dict:
    """Those metrics, split by one of their dimensions. A row that does not carry
    the dimension is counted under `none`, and is not thrown away: a measurement
    that is there is part of the total even when it cannot be split."""
    chosen = [row for row in rows if row["metric"] in metrics]
    grouped = group(chosen, lambda row: (row.get("dims", {}).get(dimension, "none"),))
    return {key[0]: summarise(total) for key, total in sorted(grouped.items())}


def totals(rows: list[dict], metrics: tuple[str, ...]) -> dict:
    """Those metrics, added up, for the ones that have nothing to split by."""
    total = _empty()
    for row in rows:
        if row["metric"] in metrics:
            add(total, row)
    return summarise(total)


def cost(rows: list[dict], projects: list[dict]) -> dict:
    """What it consumes: by phase, by model, by kind of token, and per project."""
    # Whatever carries tokens is what consumes: the metric names are not listed
    # here, so a new metric that carries tokens is counted the day it is added.
    spending = [row for row in rows if row.get("tokens")]
    spending_metrics = tuple({row["metric"] for row in spending})
    total = _empty()
    for row in spending:
        add(total, row)
    return {
        "total": summarise(total),
        "by_phase": by_dimension(spending, spending_metrics, "phase"),
        "by_model": by_dimension(spending, spending_metrics, "model"),
        "by_subsystem": {
            key[0]: summarise(acc)
            for key, acc in sorted(group(spending, lambda row: (row["subsystem"],)).items())
        },
        "per_project": _distribution(projects),
    }


def _distribution(projects: list[dict]) -> dict:
    """The distribution over projects, which is what "what a webtool consumes" is.
    Exact, not estimated: there is one accumulator per project, so the quantiles
    are read off the real values.

    One distribution **per kind of token**, and no total of the kinds together: a
    single number would have to weigh an output token against a token read from a
    cache, and that weight is a price. A project that never spent a kind spent
    none of it, which is a zero in that kind's distribution and not a gap in it.
    """
    if not projects:
        return {"projects": 0}
    kinds = sorted({kind for project in projects for kind in (project.get("tokens") or {})})
    by_kind = {}
    for kind in kinds:
        spent = sorted((project.get("tokens") or {}).get(kind, 0) for project in projects)
        by_kind[kind] = {"total": sum(spent), **_spread(spent)}
    return {"projects": len(projects), "by_kind": by_kind}


def preanalysis(rows: list[dict], projects: list[dict]) -> dict:
    """The turns a pre-analysis really takes, and how the rounds of questions end."""
    turns_per_project = sorted(
        project.get("metrics", {}).get("preanalysis_turn", {}).get("count", 0)
        for project in projects
        if project.get("metrics", {}).get("preanalysis_turn")
    )
    closings = by_dimension(rows, ("preanalysis.closed",), "outcome")
    validations = by_dimension(rows, ("preanalysis.validation",), "outcome")
    turn_rows = [row for row in rows if row["metric"] == "preanalysis.turn"]
    turns = _empty()
    for row in turn_rows:
        add(turns, row)
    return {
        "turns": summarise(turns),
        "turns_per_preanalysis": (
            {"preanalyses": len(turns_per_project), **_spread(turns_per_project)}
            if turns_per_project
            else {"preanalyses": 0}
        ),
        "closed": closings,
        "validation": validations,
    }


def _spread(sorted_values: list[int]) -> dict:
    """Mean and quantiles of values already sorted. It does not say how many there
    are or what they are of: that is the caller's, who knows."""
    def at(share: float) -> int:
        return sorted_values[min(len(sorted_values) - 1, int(len(sorted_values) * share))]

    return {
        "mean": sum(sorted_values) // len(sorted_values),
        "min": sorted_values[0],
        "p50": at(0.50),
        "p95": at(0.95),
        "max": sorted_values[-1],
    }


def providers(rows: list[dict]) -> dict:
    """Calls, failures and latency. A refusal and a service that is down are two
    different metrics here, which is the whole point of measuring them."""
    calls = [row for row in rows if row["metric"] == "ai.call"]
    failures = [row for row in rows if row["metric"] == "ai.failed"]
    retries = [row for row in rows if row["metric"] == "ai.retry"]
    called = sum(row.get("count", 0) for row in calls)
    failed = sum(row.get("count", 0) for row in failures)
    return {
        "calls": {
            key[0]: summarise(acc)
            for key, acc in sorted(group(calls, lambda row: (row.get("dims", {}).get("model", "—"),)).items())
        },
        "by_outcome": by_dimension(calls, ("ai.call",), "outcome"),
        "failures": by_dimension(failures, ("ai.failed",), "reason"),
        "retries": by_dimension(retries, ("ai.retry",), "phase"),
        "failure_rate": _rate(failed, called + failed),
    }


def _rate(part: int, whole: int) -> dict:
    """A rate that says what it is made of. Not a bare percentage: a 50% failure
    rate out of two calls and out of two thousand are different facts."""
    if whole == 0:
        return {"of": 0}
    return {"of": whole, "count": part, "per_thousand": round(part * 1000 / whole)}


def http(rows: list[dict]) -> dict:
    requests = [row for row in rows if row["metric"] == "http.request"]
    errors = [row for row in rows if row["metric"] == "http.error"]
    refused = [row for row in rows if row["metric"] == "http.refused_ip"]
    by_route = group(requests, lambda row: (row["subsystem"], row.get("dims", {}).get("route", "—")))
    return {
        "by_route": {
            f"{subsystem} {route}": summarise(acc)
            for (subsystem, route), acc in sorted(by_route.items())
        },
        "by_status": by_dimension(requests, ("http.request",), "status"),
        "errors": by_dimension(errors, ("http.error",), "code"),
        "refused_ips": sum(row.get("count", 0) for row in refused),
    }


def economics(rows: list[dict], projects: list[dict]) -> dict:
    """What is granted, what is spent, and the two figures the worst case is built
    on. In turns and in tokens: what they are worth is worked out elsewhere, from
    a rate this subsystem is not told."""
    accepted_demos = sum(
        row.get("count", 0)
        for row in rows
        if row["metric"] == "gate.decided"
        and row.get("dims", {}).get("gate") == "demo"
        and row.get("dims", {}).get("outcome") == "passed"
    )
    consumed = _tokens_of(rows)
    return {
        "turns_granted": by_dimension(rows, ("turns.granted",), "source"),
        "turns_spent": by_dimension(rows, ("turns.spent",), "phase"),
        "tokens_charged_to_drivers": totals(rows, ("tokens.charged",)),
        # What a sale consumed: everything the AI burned in the period, over the
        # demos accepted in it. `04.` builds five pipelines on top of this number.
        # It is `null`, not zero, when no demo was accepted: nothing divided by
        # nothing is not a consumption of nothing.
        "cost_per_accepted_demo": {
            "accepted_demos": accepted_demos,
            "tokens": (
                {kind: spent // accepted_demos for kind, spent in sorted(consumed.items())}
                if accepted_demos
                else None
            ),
            "note": "every token of the period over the demos accepted in it, not a per-project figure",
        },
        # The part of the consumption that produced nothing. It is read from the
        # project accumulators, because a daily bucket has no project in it: each
        # project carries how its gates decided.
        "cost_of_refusals": _cost_of_refusals(projects),
    }


def _cost_of_refusals(projects: list[dict]) -> dict:
    """What we spent on projects a gate refused, by the reason it gave.

    A project is counted as refused when one of its gates decided `rejected`; the
    accumulator keeps those counts, and the reasons beside them. A project still
    running is not a refusal and is not counted, in either the tokens or the
    number.
    """
    refused = [project for project in projects if project.get("gates", {}).get("rejected")]
    by_reason: dict[str, dict] = {}
    for project in refused:
        for reason, count in (project.get("gate_reasons") or {}).items():
            entry = by_reason.setdefault(reason, {"projects": 0, "tokens": defaultdict(int)})
            entry["projects"] += 1 if count else 0
            for kind, spent in (project.get("tokens") or {}).items():
                entry["tokens"][kind] += spent
    return {
        "projects": len(refused),
        "tokens": _tokens_of(refused),
        "by_reason": {
            reason: {"projects": entry["projects"], "tokens": dict(entry["tokens"])}
            for reason, entry in sorted(by_reason.items())
        },
    }


def timing(rows: list[dict]) -> dict:
    return {
        "by_gate": by_dimension(rows, ("gate.duration",), "gate"),
        "lead_time": by_dimension(rows, ("project.lead_time",), "outcome"),
        "form": by_dimension(rows, ("form.submitted",), "outcome"),
    }


def health(rows: list[dict]) -> dict:
    dependency = [row for row in rows if row["metric"] == "dependency.call"]
    failed_dependencies = sum(
        row.get("count", 0) for row in dependency if row.get("dims", {}).get("outcome") != "ok"
    )
    calls = sum(row.get("count", 0) for row in dependency)
    return {
        "starts": by_dimension(rows, ("process.started",), "outcome"),
        "dependencies": {
            f"{row_key[0]} → {row_key[1]}": summarise(acc)
            for row_key, acc in sorted(
                group(dependency, lambda row: (row["subsystem"], row.get("dims", {}).get("target", "—"))).items()
            )
        },
        "dependency_failure_rate": _rate(failed_dependencies, calls),
        "mongo": by_dimension(rows, ("mongo.operation",), "outcome"),
        "logins": by_dimension(rows, ("login.attempt",), "outcome"),
    }
