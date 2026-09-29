import os
from datetime import datetime, timedelta, timezone

# The tests use a separate database, dropped at the end. The variables are those
# of configurator/bootstrap.env, with the test database. Anagraphics is pointed at
# a port nothing listens on: the reconciliation of the funnel must be readable
# when it cannot be done, and here it never can be unless a test says otherwise.
TEST_ENV = {
    "WEBTOOLS_ANAGRAPHICS_URL": "http://127.0.0.1:9199",
    "WEBTOOLS_CONFIGURATION_TIMEOUT_MS": "500",
    "WEBTOOLS_MONGO_URI": "mongodb://localhost:27017",
    "WEBTOOLS_MONGO_DB": "webtools_metrics_test",
}
os.environ.update(TEST_ENV)

# The configuration metrics would read from anagraphics. Given here, so the tests
# do not need anagraphics running: it is the same document, from the same seed.
CONFIGURATION = {
    "subsystem": "metrics",
    "listen": {"host": "127.0.0.1", "port": 9600},
    "access": {"allowed_ips": ["127.0.0.1", "::1"]},
    "mongo": {"server_selection_timeout_ms": 5000},
    "limits": {
        "retention_days": 0,
        "body_max_bytes": 8192,
        "max_rows": 500,
        "duration_buckets_ms": [1000, 5000, 15000, 30000, 60000, 120000, 300000],
    },
    "subsystems_infos": {"anagraphics": {"timeout_ms": 500}},
    "providers": {
        # What a provider counts is **its** list, declared here: nothing in the
        # code contains one.
        "anthropic": {"token_kinds": ["input", "output", "cache_write", "cache_read"]},
        # A provider that counts something else entirely: it is counted all the
        # same, and no list in the code had to be told about it.
        "somebody-else": {"token_kinds": ["seconds", "images"]},
    },
}

import webtools_metrics.settings as settings_module
from webtools_metrics.commons.configuration_client import Configuration

settings_module.read_configuration = lambda subsystem, bootstrap: Configuration(subsystem, CONFIGURATION)

import pytest
from fastapi.testclient import TestClient

from webtools_metrics import anagraphics, db
from webtools_metrics.anagraphics import ProjectCount
from webtools_metrics.main import app, database, settings

LOCALHOST = ("127.0.0.1", 50000)
OUTSIDER = ("10.0.0.1", 50000)

TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")
PROJECT = "1f251606-bdba-40c4-bbee-bfedc6e57f70"


@pytest.fixture(autouse=True)
def empty_database():
    database[db.DAILY].delete_many({})
    database[db.PROJECTS].delete_many({})
    yield


@pytest.fixture(scope="module", autouse=True)
def drop_database():
    yield
    database.client.drop_database(database.name)


@pytest.fixture
def client():
    return TestClient(app, client=LOCALHOST)


def a_turn(**changes) -> dict:
    measurement = {
        "subsystem": "preanalyst",
        "metric": "preanalysis.turn",
        "dims": {"provider": "anthropic", "model": "claude-opus-5", "outcome": "answered"},
        "duration_ms": 137204,
        "tokens": {"input": 1841, "output": 612, "cache_read": 26548, "cache_write": 0},
        "project_id": PROJECT,
    }
    measurement.update(changes)
    return measurement


def today(client, route: str, **params) -> dict:
    response = client.get(route, params={"from": TODAY, "to": TODAY, **params})
    assert response.status_code == 200, response.json()
    return response.json()


# ------------------------------------------------------------------ the folding


def test_a_measurement_is_folded_and_not_stored(client):
    for _ in range(3):
        response = client.post("/measurements", json=a_turn())
        assert response.status_code == 202
        assert response.json()["folded"] is True

    # Three turns, one document: it is the number of kinds of thing measured that
    # decides how many documents there are, not the traffic.
    assert database[db.DAILY].count_documents({}) == 1
    bucket = database[db.DAILY].find_one({"metric": "preanalysis.turn"})
    assert bucket["count"] == 3
    assert bucket["tokens"] == {"input": 3 * 1841, "output": 3 * 612, "cache_read": 3 * 26548, "cache_write": 0}
    assert bucket["dims"] == {"provider": "anthropic", "model": "claude-opus-5", "outcome": "answered"}
    assert bucket["day"] == TODAY


def test_the_kinds_a_provider_counts_are_its_own(client):
    # This provider counts neither input nor output: it counts seconds and images,
    # and they are folded under those names because the configuration says it
    # counts them. No list in the code has to have heard of them.
    client.post(
        "/measurements",
        json=a_turn(
            dims={"provider": "somebody-else", "model": "something", "outcome": "answered"},
            tokens={"seconds": 12, "images": 3},
        ),
    )
    bucket = database[db.DAILY].find_one({"dims.provider": "somebody-else"})
    assert bucket["tokens"] == {"seconds": 12, "images": 3}


def test_tokens_of_a_provider_nobody_declared_are_refused(client):
    response = client.post(
        "/measurements",
        json=a_turn(dims={"provider": "nobody", "model": "claude-opus-5", "outcome": "answered"}),
    )
    assert response.status_code == 400
    assert response.json() == {
        "error": "UNKNOWN_PROVIDER",
        "metric": "preanalysis.turn",
        "provider": "nobody",
    }
    assert database[db.DAILY].count_documents({"metric": "preanalysis.turn"}) == 0


def test_a_kind_the_provider_does_not_count_is_refused(client):
    # Accepting a kind nobody declared is how a typo becomes a sum that grows in a
    # corner and is never read.
    response = client.post("/measurements", json=a_turn(tokens={"input": 10, "reasoning": 5}))
    assert response.status_code == 400
    assert response.json() == {
        "error": "UNKNOWN_TOKEN_KIND",
        "provider": "anthropic",
        "kind": "reasoning",
    }
    assert database[db.DAILY].count_documents({"metric": "preanalysis.turn"}) == 0


def test_durations_land_in_buckets_and_keep_their_extremes(client):
    client.post("/measurements", json=a_turn(duration_ms=900))
    client.post("/measurements", json=a_turn(duration_ms=137204))
    client.post("/measurements", json=a_turn(duration_ms=400000))
    bucket = database[db.DAILY].find_one({"metric": "preanalysis.turn"})
    assert bucket["duration_ms"]["min"] == 900
    assert bucket["duration_ms"]["max"] == 400000
    assert bucket["duration_ms"]["sum"] == 900 + 137204 + 400000
    assert bucket["duration_ms"]["buckets"] == {"1000": 1, "300000": 1, "inf": 1}


def test_the_percentile_says_it_is_an_estimate(client):
    for _ in range(9):
        client.post("/measurements", json=a_turn(duration_ms=900))
    client.post("/measurements", json=a_turn(duration_ms=400000))
    answer = today(client, "/metrics/preanalysis")
    duration = answer["turns"]["duration"]
    # The percentile is the upper edge of the bucket it falls in, and the name
    # says so: nine turns under a second put the median in the first bucket.
    assert duration["p50_at_most_ms"] == 1000
    # The 95th falls in the bucket above the last edge, which has no upper bound:
    # there is nothing exact to say about it, so it is null — and `max_ms`, which
    # is exact, is right there beside it.
    assert duration["p95_at_most_ms"] is None
    assert duration["max_ms"] == 400000
    assert duration["estimated_from"] == "histogram buckets"


def test_the_day_is_the_one_the_measurement_belongs_to(client):
    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).replace(hour=12)
    client.post("/measurements", json=a_turn(occurred_at=yesterday.isoformat()))
    assert database[db.DAILY].find_one({})["day"] == yesterday.strftime("%Y-%m-%d")


# -------------------------------------------------------------- the vocabulary


def a_judgement(**overrides) -> dict:
    """What the analyst sends when it has judged a project."""
    return {
        "subsystem": "analyst",
        "metric": "analysis.judged",
        "dims": {"verdict": "refuse", "asked_for": "take_on", "weakest": "integrations"},
        "scores": {"people": 0.9, "integrations": 0.2, "constraints": 1.0},
        "confidence": 0.7,
        "project_id": PROJECT,
    } | overrides


def test_the_axes_of_a_judgement_are_summed_and_the_count_is_their_denominator(client):
    """A day's average on an axis is its sum divided by `count`. Every axis of one
    judgement arrives in the same measurement, so one denominator serves them all."""
    for integrations in (0.2, 0.4):
        assert client.post("/measurements", json=a_judgement(
            scores={"people": 0.9, "integrations": integrations, "constraints": 1.0},
        )).status_code == 202

    bucket = database[db.DAILY].find_one({"metric": "analysis.judged"})
    assert bucket["count"] == 2
    assert bucket["scores"]["integrations"] == pytest.approx(0.6)
    assert bucket["scores"]["integrations"] / bucket["count"] == pytest.approx(0.3)
    assert bucket["confidence"]["sum"] == pytest.approx(1.4)


def test_the_axes_are_not_a_list_this_subsystem_keeps(client):
    """Which axes exist belongs to the analyst. An axis added there is counted here
    without a line being changed — the same way a provider's token kinds are."""
    assert client.post("/measurements", json=a_judgement(
        scores={"an_axis_nobody_here_has_heard_of": 0.5},
    )).status_code == 202
    bucket = database[db.DAILY].find_one({"metric": "analysis.judged"})
    assert bucket["scores"]["an_axis_nobody_here_has_heard_of"] == pytest.approx(0.5)


@pytest.mark.parametrize("wrong", [{"scores": {"people": 1.4}}, {"confidence": -0.1}])
def test_a_fraction_outside_the_scale_is_refused_rather_than_stored(client, wrong):
    """A `1.4` summed into a bucket is an average nobody can tell is wrong."""
    assert client.post("/measurements", json=a_judgement(**wrong)).status_code == 400


def test_a_judgement_carries_no_tokens(client):
    """What the call cost is on `ai.call`. The same tokens under a second name would
    be counted twice by whoever adds up the consumption."""
    response = client.post("/measurements", json=a_judgement(tokens={"input": 10}))
    assert response.status_code == 400
    assert response.json()["error"] == "UNEXPECTED_VALUE"


def test_what_we_concluded_and_what_the_model_asked_for_are_two_dimensions(client):
    """The interesting case is when they differ: the model wanted the work taken on
    and its own numbers did not let it. One dimension would hide exactly that."""
    assert client.post("/measurements", json=a_judgement()).status_code == 202
    bucket = database[db.DAILY].find_one({"metric": "analysis.judged"})
    assert bucket["dims"]["verdict"] == "refuse"
    assert bucket["dims"]["asked_for"] == "take_on"


def test_an_invented_metric_is_refused(client):
    response = client.post("/measurements", json=a_turn(metric="preanalysis.turns"))
    assert response.status_code == 400
    assert response.json() == {"error": "UNKNOWN_METRIC", "metric": "preanalysis.turns"}
    assert database[db.DAILY].count_documents({"metric": "preanalysis.turns"}) == 0


def test_a_refusal_is_itself_a_measurement(client):
    # The one failure the closed list exists in order to create was the only one
    # nobody could see: the sender counted it privately and nothing read that
    # counter, and metrics answered 400 and forgot. A subsystem quietly sending a
    # name that is refused looked exactly like a subsystem with nothing to say.
    client.post("/measurements", json=a_turn(metric="preanalysis.turns"))
    bucket = database[db.DAILY].find_one({"metric": "measurement.refused"})
    assert bucket["subsystem"] == "metrics"
    assert bucket["count"] == 1
    # The code, and who sent it. Never the refused name: an invented name in an open
    # dimension would make a bucket per typo, which is what the closed list is for.
    assert bucket["dims"] == {"code": "UNKNOWN_METRIC", "sender": "preanalyst"}


def test_a_refused_sender_is_counted_without_a_sender(client):
    # What was refused is the sender's own name, so there is nothing about the
    # sender worth recording. Absent is absent, and nothing is put in its place.
    client.post("/measurements", json=a_turn(subsystem="nobody"))
    bucket = database[db.DAILY].find_one({"metric": "measurement.refused"})
    assert bucket["dims"] == {"code": "UNKNOWN_SUBSYSTEM"}


def test_a_body_that_is_not_a_body_is_not_a_refused_measurement(client):
    # `measurement.refused` is the vocabulary turning something away, which says
    # something about the sender. A body that cannot even be read is not that, and
    # counting it here would put two different faults in one number.
    client.post("/measurements", json={"subsystem": "preanalyst"})
    assert database[db.DAILY].count_documents({"metric": "measurement.refused"}) == 0


def test_an_invented_dimension_is_refused(client):
    response = client.post(
        "/measurements",
        json=a_turn(dims={"provider": "anthropic", "model": "claude-opus-5", "outcome": "answered", "colour": "blue"}),
    )
    assert response.status_code == 400
    assert response.json()["error"] == "UNKNOWN_DIMENSION"
    assert response.json()["dimension"] == "colour"


def test_a_value_a_closed_dimension_does_not_allow_is_refused(client):
    response = client.post(
        "/measurements", json=a_turn(dims={"provider": "anthropic", "model": "claude-opus-5", "outcome": "fine"})
    )
    assert response.status_code == 400
    assert response.json()["error"] == "UNKNOWN_DIMENSION_VALUE"
    assert response.json()["value"] == "fine"


def test_a_missing_required_dimension_is_refused(client):
    # Without `outcome` the measurement would be counted in a bucket that means
    # something else: it is refused, not folded into a bucket of its own.
    response = client.post("/measurements", json=a_turn(dims={"provider": "anthropic", "model": "claude-opus-5"}))
    assert response.status_code == 400
    assert response.json() == {
        "error": "MISSING_DIMENSION",
        "metric": "preanalysis.turn",
        "dimension": "outcome",
    }


def test_a_value_the_metric_does_not_carry_is_refused(client):
    response = client.post(
        "/measurements",
        json={"subsystem": "preanalyst", "metric": "form.opened", "duration_ms": 10},
    )
    assert response.status_code == 400
    assert response.json() == {
        "error": "UNEXPECTED_VALUE",
        "metric": "form.opened",
        "value": "duration_ms",
    }


def test_an_unknown_subsystem_is_refused(client):
    response = client.post("/measurements", json=a_turn(subsystem="somebody-else"))
    assert response.status_code == 400
    assert response.json() == {"error": "UNKNOWN_SUBSYSTEM", "subsystem": "somebody-else"}


def test_a_project_on_a_metric_that_has_none_is_refused(client):
    response = client.post(
        "/measurements",
        json={"subsystem": "preanalyst", "metric": "form.opened", "project_id": PROJECT},
    )
    assert response.status_code == 400
    assert response.json()["value"] == "project_id"


def test_the_vocabulary_can_be_read(client):
    answer = client.get("/vocabulary").json()
    assert "preanalysis.turn" in answer["metrics"]
    assert answer["metrics"]["preanalysis.turn"]["required"]["outcome"] == ["answered", "failed"]
    assert answer["metrics"]["preanalysis.turn"]["required"]["provider"] is None
    # Optional, and the failed turns are why: a call refused before a model was
    # chosen has none to name.
    assert answer["metrics"]["preanalysis.turn"]["optional"]["model"] is None


# ---------------------------------------------------------------- the projects


def test_a_project_accumulates_its_own_totals(client):
    client.post("/measurements", json=a_turn())
    client.post("/measurements", json=a_turn())
    client.post(
        "/measurements",
        json={
            "subsystem": "preanalyst",
            "metric": "gate.decided",
            "dims": {"gate": "prevalidation", "outcome": "passed"},
            "project_id": PROJECT,
        },
    )
    answer = client.get(f"/metrics/projects/{PROJECT}").json()
    assert answer["metrics"]["preanalysis_turn"]["count"] == 2
    assert answer["gates"] == {"passed": 1}
    assert answer["tokens"]["input"] == 2 * 1841
    assert answer["tokens"]["cache_read"] == 2 * 26548
    assert database[db.PROJECTS].count_documents({}) == 1


def test_a_project_nobody_measured_is_not_invented(client):
    response = client.get("/metrics/projects/none-of-ours")
    assert response.status_code == 404
    assert response.json() == {"error": "PROJECT_NOT_FOUND", "project_id": "none-of-ours"}


def test_the_consumption_per_project_is_a_distribution_and_not_only_a_mean(client):
    for project, turns in (("a", 1), ("b", 2), ("c", 10)):
        for _ in range(turns):
            client.post("/measurements", json=a_turn(project_id=project))
    answer = today(client, "/metrics/cost")["per_project"]
    assert answer["projects"] == 3
    # One distribution per kind, and no total of the kinds together: weighing an
    # output token against a token read from a cache would be a price.
    assert sorted(answer["by_kind"]) == ["cache_read", "cache_write", "input", "output"]
    assert answer["by_kind"]["input"]["total"] == 13 * 1841
    assert answer["by_kind"]["input"]["max"] == 10 * 1841
    assert answer["by_kind"]["input"]["max"] > answer["by_kind"]["input"]["p50"]
    # A kind nobody spent is a zero in the distribution, not a gap in it.
    assert answer["by_kind"]["cache_write"]["total"] == 0


# ------------------------------------------------------------------- the reads


def test_the_funnel_says_when_it_could_not_be_reconciled(client):
    client.post("/measurements", json={"subsystem": "preanalyst", "metric": "form.opened"})
    answer = today(client, "/metrics/funnel")
    assert answer["stages"]["form.opened"]["count"] == 1
    # Anagraphics is not there: the funnel is still a funnel, and it says so
    # instead of passing itself off as exact.
    assert answer["reconciliation"] == {
        "available": False,
        "reason": "unreachable",
        "projects_measured": 0,
    }


def test_the_funnel_counts_what_it_lost(client, monkeypatch):
    monkeypatch.setattr(anagraphics, "count_projects", lambda *_: ProjectCount(5))
    for _ in range(3):
        client.post(
            "/measurements",
            json={
                "subsystem": "preanalyst",
                "metric": "project.created",
                "dims": {"autonomous_work": "no", "has_discount": "no", "has_ambassador": "no"},
            },
        )
    answer = today(client, "/metrics/funnel")["reconciliation"]
    assert answer == {"available": True, "projects": 5, "projects_measured": 3, "lost": 2}


def test_the_gates_are_split_by_outcome_and_by_reason(client):
    for outcome, reason in (("passed", None), ("rejected", "non_sequitur"), ("rejected", "run_out_certain")):
        dims = {"gate": "prevalidation", "outcome": outcome}
        if reason:
            dims["reason"] = reason
        client.post(
            "/measurements",
            json={"subsystem": "preanalyst", "metric": "gate.decided", "dims": dims},
        )
    stages = today(client, "/metrics/funnel")["stages"]
    assert stages["gate.prevalidation.passed"]["count"] == 1
    assert stages["gate.prevalidation.rejected.non_sequitur"]["count"] == 1
    assert stages["gate.prevalidation.rejected.run_out_certain"]["count"] == 1


def test_the_turns_of_a_preanalysis_are_counted_per_preanalysis(client):
    for project, turns in (("a", 4), ("b", 12)):
        for _ in range(turns):
            client.post("/measurements", json=a_turn(project_id=project))
    answer = today(client, "/metrics/preanalysis")["turns_per_preanalysis"]
    assert answer == {"preanalyses": 2, "mean": 8, "min": 4, "p50": 12, "p95": 12, "max": 12}


def test_a_failure_and_a_refusal_are_not_the_same_number(client):
    client.post(
        "/measurements",
        json={
            "subsystem": "preanalyst",
            "metric": "ai.call",
            "dims": {
                "phase": "preanalysis_turn",
                "model": "claude-opus-5",
                "provider": "anthropic",
                "outcome": "complete",
                "fell_back": "no",
            },
        },
    )
    client.post(
        "/measurements",
        json={
            "subsystem": "preanalyst",
            "metric": "ai.failed",
            "dims": {"phase": "preanalysis_turn", "provider": "anthropic", "reason": "unreachable"},
        },
    )
    answer = today(client, "/metrics/providers")
    assert answer["by_outcome"]["complete"]["count"] == 1
    assert answer["failures"]["unreachable"]["count"] == 1
    # A rate that says what it is made of: one failure out of two calls.
    assert answer["failure_rate"] == {"of": 2, "count": 1, "per_thousand": 500}


def test_the_http_surface_is_read_by_route(client):
    for status in ("200", "200", "503"):
        client.post(
            "/measurements",
            json={
                "subsystem": "sso",
                "metric": "http.request",
                "dims": {"route": "/login", "method": "POST", "status": status},
                "duration_ms": 40,
            },
        )
    answer = today(client, "/metrics/http")
    assert answer["by_route"]["sso /login"]["count"] == 3
    assert answer["by_status"]["503"]["count"] == 1


def test_the_economics_say_what_a_sale_consumed_and_what_a_refusal_consumed(client):
    client.post("/measurements", json=a_turn(project_id="sold"))
    client.post("/measurements", json=a_turn(project_id="refused"))
    client.post(
        "/measurements",
        json={
            "subsystem": "preanalyst",
            "metric": "gate.decided",
            "dims": {"gate": "demo", "outcome": "passed"},
            "project_id": "sold",
        },
    )
    client.post(
        "/measurements",
        json={
            "subsystem": "preanalyst",
            "metric": "gate.decided",
            "dims": {"gate": "prevalidation", "outcome": "rejected", "reason": "non_sequitur"},
            "project_id": "refused",
        },
    )
    answer = today(client, "/metrics/economics")
    per_demo = answer["cost_per_accepted_demo"]
    assert per_demo["accepted_demos"] == 1
    # Both turns of the period over the one demo accepted in it.
    assert per_demo["tokens"]["input"] == 2 * 1841
    refusals = answer["cost_of_refusals"]
    assert refusals["projects"] == 1
    assert refusals["tokens"]["input"] == 1841
    assert refusals["by_reason"]["non_sequitur"] == {"projects": 1, "tokens": {
        "input": 1841, "output": 612, "cache_read": 26548, "cache_write": 0}}


def test_with_no_accepted_demo_the_unit_consumption_is_not_zero(client):
    client.post("/measurements", json=a_turn())
    answer = today(client, "/metrics/economics")["cost_per_accepted_demo"]
    # Nothing divided by nothing is not a consumption of nothing.
    assert answer == {
        "accepted_demos": 0,
        "tokens": None,
        "note": "every token of the period over the demos accepted in it, not a per-project figure",
    }


def test_the_buckets_can_be_read_back(client):
    client.post("/measurements", json=a_turn())
    answer = today(client, "/metrics/daily", metric="preanalysis.turn")
    assert len(answer["rows"]) == 1
    assert answer["rows"][0]["metric"] == "preanalysis.turn"
    assert answer["truncated"] is False


def test_a_period_that_is_not_one_is_refused(client):
    backwards = client.get("/metrics/funnel", params={"from": "2026-02-01", "to": "2026-01-01"})
    assert backwards.status_code == 400
    assert backwards.json()["error"] == "INVALID_RANGE"

    not_a_day = client.get("/metrics/funnel", params={"from": "today", "to": "2026-01-01"})
    assert not_a_day.status_code == 400


# ------------------------------------------------------------------ the guards


def test_from_outside_the_pool_nothing_is_measured_and_nothing_is_read():
    outsider = TestClient(app, client=OUTSIDER)
    for response in (
        outsider.post("/measurements", json=a_turn()),
        outsider.get("/metrics/funnel", params={"from": TODAY, "to": TODAY}),
    ):
        assert response.status_code == 403
        assert response.json() == {"error": "IP_NOT_ALLOWED"}


def test_a_body_larger_than_the_limit_is_refused(client):
    response = client.post("/measurements", json=a_turn(project_id="x" * 9000))
    assert response.status_code == 413
    assert response.json() == {"error": "BODY_TOO_LARGE"}


# --------------------------------------------------------------- the retention


def test_retention_zero_creates_no_index_and_a_retention_creates_one():
    from dataclasses import replace

    db.ensure_indexes(database, settings)
    assert db.TTL_INDEX not in database[db.DAILY].index_information()

    ninety = replace(settings, retention_days=90)
    db.ensure_indexes(database, ninety)
    index = database[db.DAILY].index_information()[db.TTL_INDEX]
    assert index["expireAfterSeconds"] == 90 * 24 * 3600

    # Changed in operation: altered in place, not dropped and rebuilt.
    thirty = replace(settings, retention_days=30)
    db.ensure_indexes(database, thirty)
    assert database[db.DAILY].index_information()[db.TTL_INDEX]["expireAfterSeconds"] == 30 * 24 * 3600

    # And back to keeping everything: the index goes, the documents stay.
    client = TestClient(app, client=LOCALHOST)
    client.post("/measurements", json=a_turn())
    db.ensure_indexes(database, settings)
    assert db.TTL_INDEX not in database[db.DAILY].index_information()
    assert database[db.DAILY].count_documents({}) == 1
