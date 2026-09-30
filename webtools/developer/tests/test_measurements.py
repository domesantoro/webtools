"""Everything this subsystem measures, against the vocabulary that has to accept it.

The vocabulary is a closed list so that a typo cannot invent a counter nobody reads
(`webtools/metrics/webtools_metrics/vocabulary.py`). Metrics enforces it at its own
door, with a `400` — and a `400` from there is a measurement lost silently, because the
client does not wait, does not retry and does not log unless it was told to. So the
check has to happen here, where a test can fail.

It is the sibling subsystem's file, read by path. Where it is not there these tests skip
rather than pass: they would be asserting nothing.

Two things are checked, and they catch different mistakes:

- **every name this subsystem can send exists**, found by reading its own source. That
  catches a `measure("build.finised")` that no test happens to exercise;
- **every measurement a real build produces is one metrics would accept**: the required
  dimensions are there, no dimension is invented, a closed dimension gets one of its
  values, and no value field is carried that the metric does not declare.

    uv run pytest
"""

import ast
import importlib.util
from pathlib import Path

import pytest

from tests.test_build import BROKEN, FIXED, a_file, a_plan, envelope, settings_with
from webtools_developer import build

PACKAGE = Path(__file__).resolve().parent.parent / "webtools_developer"
VOCABULARY = PACKAGE.parent.parent / "metrics" / "webtools_metrics" / "vocabulary.py"


def _vocabulary():
    if not VOCABULARY.exists():
        pytest.skip("the metrics vocabulary is not here")
    specification = importlib.util.spec_from_file_location("a_vocabulary", VOCABULARY)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def vocabulary():
    return _vocabulary()


def _names_in_the_source() -> set[str]:
    """Every metric this subsystem names, read off its own code.

    Only the literal ones. A name built at runtime would not be findable here, which is
    a reason not to build one: the vocabulary is closed so that names are a list
    somebody can read.
    """
    names = set()
    for source in PACKAGE.rglob("*.py"):
        tree = ast.parse(source.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "measure"
                and node.args
                and isinstance(node.args[0], ast.Constant)
                and isinstance(node.args[0].value, str)
            ):
                names.add(node.args[0].value)
    return names


def test_the_subsystem_is_one_metrics_knows(vocabulary):
    """A measurement from a sender it does not know is refused by name, all of them."""
    assert "developer" in vocabulary.SUBSYSTEMS


def test_every_door_has_a_phase_of_its_own(vocabulary):
    """One per door: a build that spends everything on repairs and one that got every
    file right first time would be the same number under a single name."""
    from webtools_developer import measured_ai

    for phase in (
        measured_ai.DEVELOPMENT_PLAN,
        measured_ai.DEVELOPMENT_FILE,
        measured_ai.DEVELOPMENT_REPAIR,
        measured_ai.DEVELOPMENT_README,
    ):
        assert phase in vocabulary.PHASES


def test_every_name_this_subsystem_can_send_exists(vocabulary):
    unknown = sorted(_names_in_the_source() - set(vocabulary.METRICS))
    assert unknown == [], f"metrics would refuse these by name: {unknown}"


def test_the_source_names_the_metrics_this_subsystem_is_for():
    """A guard on the test above: if the reading of the source found nothing, it would
    pass while checking nothing at all."""
    found = _names_in_the_source()
    assert "build.finished" in found
    assert "ai.call" in found
    assert len(found) > 8


def _refusal(vocabulary, measurement: dict) -> str | None:
    """Why metrics would refuse this measurement, or `None`.

    The same reading its own door does (`webtools_metrics/main.py`, `_checked`), written
    here against the same vocabulary: what is being tested is this subsystem's
    measurements, so the reading of them has to be somewhere a failure is visible.
    """
    metric = vocabulary.METRICS.get(measurement["metric"])
    if metric is None:
        return f"unknown metric {measurement['metric']}"
    dims = measurement.get("dims") or {}
    for name in metric.required:
        if name not in dims:
            return f"{measurement['metric']} is missing the dimension {name}"
    allowed = {**metric.required, **metric.optional}
    for name, value in dims.items():
        if name not in allowed:
            return f"{measurement['metric']} has no dimension {name}"
        values = allowed[name]
        if values is not None and value not in values:
            return f"{measurement['metric']}.{name} does not allow {value!r}"
    for field in vocabulary.VALUE_FIELDS:
        if field in measurement and field not in metric.values:
            return f"{measurement['metric']} does not carry {field}"
    return None


@pytest.fixture
def measured(tmp_path, monkeypatch):
    """Everything a build that goes all the way through measures.

    The fake is put on the **adapters**, not on the modules that use them, which is
    lower than the other tests put it: `plan.py` and `readme.py` measure what they read
    out of an answer, so a test that replaced them would be a test of the build loop and
    would quietly stop checking two of the metrics.
    """
    from webtools_developer import files as files_module, plan as plan_module, readme as readme_module

    settings = settings_with(tmp_path)
    contents = iter([BROKEN, "body {}\n"])

    monkeypatch.setattr(
        plan_module,
        "ask",
        lambda ai, **asked: a_plan(
            "web",
            [
                {"path": "src/a.txt", "purpose": "the server", "kind": "source"},
                # A kind this stack has no check for: `build.unchecked`.
                {"path": "style.css", "purpose": "the look", "kind": "css"},
            ],
        ),
    )
    monkeypatch.setattr(files_module, "ask_write", lambda ai, **asked: a_file(next(contents)))
    # The first file does not parse, so the repair door is asked and `build.repaired` is
    # measured too.
    monkeypatch.setattr(files_module, "ask_repair", lambda ai, **asked: a_file(FIXED))
    monkeypatch.setattr(
        readme_module, "ask", lambda ai, **asked: envelope({"readme": "# Il registro\n"})
    )

    recorded = []
    result = build.run(
        settings,
        project_id="1f251606-bdba-40c4-bbee-bfedc6e57f70",
        analysis="# A register",
        points=["Una riga per partita."],
        language="it",
        record=lambda **changes: recorded.append(changes),
    )
    assert result.outcome == "built", result.stopped_by
    return settings.metrics


def test_a_whole_build_measures_what_it_is_expected_to(measured):
    sent = {one["metric"] for one in measured}
    assert {
        "build.planned",
        "build.file_written",
        "build.verified",
        "build.unchecked",
        "build.repaired",
        "build.prepared",
        "readme.written",
    } <= sent


def test_every_measurement_a_build_sends_would_be_accepted(vocabulary, measured):
    refused = [why for one in measured if (why := _refusal(vocabulary, one))]
    assert refused == []


def test_only_the_call_itself_carries_the_tokens(measured):
    """One consumption is reported once. Whoever adds up the consumption adds up
    everything that carries tokens, and cannot tell one report of a call from two."""
    carrying = {one["metric"] for one in measured if "tokens" in one}
    assert carrying <= {"ai.call"}
