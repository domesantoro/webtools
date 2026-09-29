"""What the loading touches and what it leaves alone.

The configuration that lives is in Mongo: the files are the seed. These two
functions decide what survives a restart, so they are the part worth covering —
the rest of the script is I/O.

    uv run pytest
"""

from scripts.load_configuration import add_missing, merge


def test_it_adds_only_what_is_missing():
    stored = {"prevalidation": {"reject_threshold": 0.8}}
    seed = {"prevalidation": {"reject_threshold": 0.6, "max_underspecified_attempts": 100}}

    document, added = add_missing(stored, seed)

    # The value that is running stays the one that is running, not the file's.
    assert document["prevalidation"]["reject_threshold"] == 0.8
    # The new field arrives by itself: a piece of work introducing it needs no
    # manual intervention for the subsystem to start again.
    assert document["prevalidation"]["max_underspecified_attempts"] == 100
    assert added == ["prevalidation.max_underspecified_attempts"]


def test_a_field_that_is_there_is_never_touched():
    stored = {"limits": {"zero": 0, "false": False, "null": None, "empty": ""}}
    seed = {"limits": {"zero": 99, "false": True, "null": "something", "empty": "text"}}

    document, added = add_missing(stored, seed)

    # `0`, `false`, `null` and the empty string are values, not absences: anyone
    # looking at the truthiness of the value instead of the presence of the key
    # would overwrite every one of them.
    assert document["limits"] == {"zero": 0, "false": False, "null": None, "empty": ""}
    assert added == []


def test_it_descends_only_where_both_are_objects():
    # In Mongo the branch has become something else: that is the choice of whoever
    # changed it, and it is not overturned by opening the file's branch.
    stored = {"ai": "off"}
    seed = {"ai": {"provider": "anthropic", "timeout_ms": 20000}}

    document, added = add_missing(stored, seed)

    assert document["ai"] == "off"
    assert added == []


def test_nested_paths_are_reported_in_full():
    stored = {"ai": {"provider": "anthropic", "providers": {"anthropic": {"model": "haiku"}}}}
    seed = {
        "ai": {
            "provider": "anthropic",
            "timeout_ms": 20000,
            "providers": {"anthropic": {"model": "haiku", "max_tokens": 512}},
        }
    }

    document, added = add_missing(stored, seed)

    assert document["ai"]["timeout_ms"] == 20000
    assert document["ai"]["providers"]["anthropic"] == {"model": "haiku", "max_tokens": 512}
    assert sorted(added) == ["ai.providers.anthropic.max_tokens", "ai.timeout_ms"]


def test_a_document_with_nothing_to_add_stays_identical():
    stored = {"subsystem": "sso", "listen": {"host": "127.0.0.1", "port": 9300}}

    document, added = add_missing(stored, {"listen": {"host": "0.0.0.0", "port": 1}})

    assert document == stored
    assert added == []


def test_the_secret_always_replaces():
    # A rotated key must count: the secrets file is the only place anybody writes
    # it, and nobody changes it from the system.
    stored = {"ai": {"providers": {"anthropic": {"model": "haiku", "api_key": "old-key"}}}}
    secret = {"ai": {"providers": {"anthropic": {"api_key": "new-key"}}}}

    document = merge(stored, secret)

    assert document["ai"]["providers"]["anthropic"]["api_key"] == "new-key"
    # And it does not carry away the neighbouring branches.
    assert document["ai"]["providers"]["anthropic"]["model"] == "haiku"
