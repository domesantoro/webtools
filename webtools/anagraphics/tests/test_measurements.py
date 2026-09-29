"""What anagraphics counts about itself.

Nothing here talks to metrics: the client is replaced by one that writes down what
it was given, which is all these tests are about.

    uv run pytest
"""

import pytest

from webtools_anagraphics.db import MEASURED, _MeasuredDatabase


class Measurements(list):
    def measure(self, metric, **fields):
        self.append({"metric": metric, **fields})

    def timer(self):
        return lambda: 7

    def of(self, metric):
        return [one for one in self if one["metric"] == metric]


class Collection:
    """A collection that answers, or raises, and remembers how it was called."""

    def __init__(self, raises=None):
        self.raises = raises
        self.calls = []

    def find_one(self, *args, **keywords):
        self.calls.append(("find_one", args, keywords))
        if self.raises:
            raise self.raises
        return {"found": True}

    def find(self, *args):
        self.calls.append(("find", args, {}))
        return iter([{"one": 1}])

    @property
    def name(self):
        return "not an operation"


class Database(dict):
    def __getitem__(self, name):
        return super().__getitem__(name)


def measured(collection, metrics):
    return _MeasuredDatabase(Database({"projects": collection}), metrics)


def test_an_operation_is_counted_where_it_is_made_and_not_where_it_is_written():
    """No function in db.py mentions metrics: a query written tomorrow is counted
    the day it is written, the same arrangement as the middleware that counts the
    requests."""
    metrics = Measurements()
    collection = Collection()
    answer = measured(collection, metrics)["projects"].find_one({"project_id": "x"})

    assert answer == {"found": True}
    assert collection.calls == [("find_one", ({"project_id": "x"},), {})]
    assert metrics.of("mongo.operation") == [
        {
            "metric": "mongo.operation",
            "dims": {"collection": "projects", "operation": "find_one", "outcome": "ok"},
            "duration_ms": 7,
        }
    ]


def test_a_failure_goes_on_to_the_caller_exactly_as_it_would_have():
    """A failure that changed into something else because we were counting it would
    be a worse fault than not counting it."""
    metrics = Measurements()
    broken = RuntimeError("Mongo said no")
    with pytest.raises(RuntimeError, match="Mongo said no"):
        measured(Collection(raises=broken), metrics)["projects"].find_one({})
    assert metrics.of("mongo.operation")[0]["dims"]["outcome"] == "failed"


def test_a_cursor_is_not_an_operation_with_a_duration():
    """`find` hands back a cursor and the work happens while the caller walks it, so
    a duration taken around the call would be the time it took to decide to ask."""
    metrics = Measurements()
    assert list(measured(Collection(), metrics)["projects"].find({})) == [{"one": 1}]
    assert metrics.of("mongo.operation") == []
    assert "find" not in MEASURED


def test_what_is_not_an_operation_is_handed_back_as_it_is():
    assert measured(Collection(), Measurements())["projects"].name == "not an operation"
