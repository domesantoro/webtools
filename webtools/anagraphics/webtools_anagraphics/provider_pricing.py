"""Where a price may be written, and what names a provider object.

The configuration holds provider objects in more than one place: each door of a
subsystem has its own — `providers.<name>` under the section that door reads —
and a subsystem may hold one that belongs to no door at all. They have nothing
in common but the branch they hang from, and that branch is the whole rule:

    <anything>.providers.<name>

So a path is a provider object's path when its next-to-last key is `providers`.
Nothing here knows which providers exist, which subsystems have doors, or what a
door is called: those are in the configuration, and a list of them in this file
would be a copy going stale the day a door is added.

**This is what keeps the route narrow.** Whoever writes a price may write the
`pricing` key of an object that hangs from a `providers` branch, and nothing
else: not another key of that object, not another object of the document. A
route able to write any field would be a different route, and would have to be
asked for.

The path's keys are checked against the document itself, key by key: a segment
that resolves is a key that is there, which is also what makes it safe to hand
to Mongo as a dotted field.
"""

PROVIDERS = "providers"

# What `locate` answers with. Three facts, not one: a path nobody holds and a
# path that holds something which is not a provider object are two different
# mistakes, and whoever asked is told which one they made.
OK = "ok"
NOT_FOUND = "not_found"
NOT_A_PROVIDER_OBJECT = "not_a_provider_object"


def is_provider_path(provider_path: str) -> bool:
    """Whether the path names a provider object: `<anything>.providers.<name>`."""
    keys = provider_path.split(".")
    return len(keys) >= 2 and keys[-2] == PROVIDERS


def locate(document: dict, provider_path: str) -> tuple[str, dict | None]:
    """The provider object `provider_path` names inside `document`.

    → (OK, the object) | (NOT_FOUND, None) | (NOT_A_PROVIDER_OBJECT, None)

    The shape of the path is checked before the document is walked, so a path
    that could never name a provider object is refused for what it is, and not
    for being absent from this particular document.
    """
    if not is_provider_path(provider_path):
        return NOT_A_PROVIDER_OBJECT, None

    found = document
    for key in provider_path.split("."):
        if not isinstance(found, dict) or key not in found:
            return NOT_FOUND, None
        found = found[key]
    # A path that lands on a string or a list is there, and is not an object a
    # price can be written into.
    if not isinstance(found, dict):
        return NOT_A_PROVIDER_OBJECT, None
    return OK, found
