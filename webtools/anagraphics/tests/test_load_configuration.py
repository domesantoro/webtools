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

    documento, aggiunti = add_missing(stored, seed)

    # The value that is running stays the one that is running, not the file's.
    assert documento["prevalidation"]["reject_threshold"] == 0.8
    # The new field arrives by itself: a piece of work introducing it needs no
    # manual intervention for the subsystem to start again.
    assert documento["prevalidation"]["max_underspecified_attempts"] == 100
    assert aggiunti == ["prevalidation.max_underspecified_attempts"]


def test_a_field_that_is_there_is_never_touched():
    stored = {"limits": {"zero": 0, "falso": False, "nullo": None, "vuoto": ""}}
    seed = {"limits": {"zero": 99, "falso": True, "nullo": "qualcosa", "vuoto": "testo"}}

    documento, aggiunti = add_missing(stored, seed)

    # `0`, `false`, `null` and the empty string are values, not absences: anyone
    # looking at the truthiness of the value instead of the presence of the key
    # would overwrite every one of them.
    assert documento["limits"] == {"zero": 0, "falso": False, "nullo": None, "vuoto": ""}
    assert aggiunti == []


def test_it_descends_only_where_both_are_objects():
    # In Mongo the branch has become something else: that is the choice of whoever
    # changed it, and it is not overturned by opening the file's branch.
    stored = {"ai": "spento"}
    seed = {"ai": {"provider": "anthropic", "timeout_ms": 20000}}

    documento, aggiunti = add_missing(stored, seed)

    assert documento["ai"] == "spento"
    assert aggiunti == []


def test_nested_paths_are_reported_in_full():
    stored = {"ai": {"provider": "anthropic", "providers": {"anthropic": {"model": "haiku"}}}}
    seed = {
        "ai": {
            "provider": "anthropic",
            "timeout_ms": 20000,
            "providers": {"anthropic": {"model": "haiku", "max_tokens": 512}},
        }
    }

    documento, aggiunti = add_missing(stored, seed)

    assert documento["ai"]["timeout_ms"] == 20000
    assert documento["ai"]["providers"]["anthropic"] == {"model": "haiku", "max_tokens": 512}
    assert sorted(aggiunti) == ["ai.providers.anthropic.max_tokens", "ai.timeout_ms"]


def test_a_document_with_nothing_to_add_stays_identical():
    stored = {"subsystem": "sso", "listen": {"host": "127.0.0.1", "port": 9300}}

    documento, aggiunti = add_missing(stored, {"listen": {"host": "0.0.0.0", "port": 1}})

    assert documento == stored
    assert aggiunti == []


def test_the_secret_always_replaces():
    # A rotated key must count: the secrets file is the only place anybody writes
    # it, and nobody changes it from the system.
    stored = {"ai": {"providers": {"anthropic": {"model": "haiku", "api_key": "vecchia"}}}}
    segreto = {"ai": {"providers": {"anthropic": {"api_key": "nuova"}}}}

    documento = merge(stored, segreto)

    assert documento["ai"]["providers"]["anthropic"]["api_key"] == "nuova"
    # And it does not carry away the neighbouring branches.
    assert documento["ai"]["providers"]["anthropic"]["model"] == "haiku"
