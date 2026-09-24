"""Brings into the `configuration` collection whatever the subsystems are missing.

    python -m scripts.load_configuration <folder> [<secrets folder>] [--reset [subsystem …]]
    (from the anagraphics directory)

One file per subsystem: `sso.json` becomes the document with `subsystem: "sso"`.

**The configuration that lives is in Mongo, not in the files.** The files are the
seed — the values a new environment is born with — and the expected shape: they
say which fields exist. What is running may diverge from them, and that is normal:
a limit raised in operation, a threshold corrected, a price changed stay where
they are.

So, when the subsystem's document is already there, **only the missing fields**
are added, branch by branch. A field that is there is not touched, whatever value
it holds; a field removed from the file stays in Mongo; a subsystem that no longer
has a file is not deleted. That way a piece of work introducing a new field starts
with no manual intervention, and nothing that has been changed is lost.

`--reset` does the opposite, and it is the only way to do it: it takes the
documents back to what the files say, field by field, wiping the changes. Without
names it holds for every subsystem, with names only for those.

**Secrets are another matter.** The files in `configurator/secrets/` (outside git)
are deep-merged and **always replace** the value they find: an API key is not a
value the system changes, and that file is the only place anybody writes it — if
you rotate it, the new one must be the one that counts.

Nothing is loaded if even a single file is not valid JSON.

It is not usually run by hand: webtools/configurator/load_configuration.sh does it.
"""

import json
import sys
from pathlib import Path

from pymongo import MongoClient

from webtools_anagraphics import db
from webtools_anagraphics.settings import ConfigurationError, mongo_target


def read_json(file: Path) -> dict:
    try:
        content = json.loads(file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ConfigurationError(f"{file}: {error}") from error
    if not isinstance(content, dict):
        raise ConfigurationError(f"{file}: must contain a JSON object")
    if "subsystem" in content:
        raise ConfigurationError(f"{file}: `subsystem` is not written, the file name gives it")
    return content


def merge(base: dict, extra: dict) -> dict:
    """`extra` on top of `base`, branch by branch: what is in `extra` wins.

    Two objects are merged; anything else is replaced. The secrets need it: they
    add one leaf (`ai.providers.anthropic.api_key`) without carrying away the
    neighbouring branches (`…anthropic.model`), and they must have the last word on
    the value.
    """
    merged = dict(base)
    for key, value in extra.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def add_missing(stored: dict, seed: dict, prefix: str = "") -> tuple[dict, list[str]]:
    """The seed underneath what is there: only the missing fields are added.

    A field that is present is not touched — not even if the seed says another
    value, not even if it is `null`, `0` or `false`, which are values like any
    other. We descend only where both have an object: if a branch in Mongo has
    become something else, that is the choice of whoever changed it and it is not
    overturned.

    Returns the updated document and the paths added, so they can be reported.
    """
    updated = dict(stored)
    added: list[str] = []
    for key, value in seed.items():
        path = f"{prefix}{key}"
        if key not in updated:
            updated[key] = value
            added.append(path)
        elif isinstance(value, dict) and isinstance(updated[key], dict):
            updated[key], below = add_missing(updated[key], value, f"{path}.")
            added.extend(below)
    return updated, added


def read_documents(folder: Path, secrets: Path | None = None) -> tuple[dict[str, dict], dict[str, dict]]:
    """The seeds and the secrets, read and checked, not yet merged.

    They stay apart because they follow different rules: the seed fills the holes,
    the secret overwrites.
    """
    seeds: dict[str, dict] = {}
    for file in sorted(folder.glob("*.json")):
        seeds[file.stem] = {"subsystem": file.stem, **read_json(file)}
    if not seeds:
        raise ConfigurationError(f"no .json file in {folder}")

    keys: dict[str, dict] = {}
    if secrets is not None and secrets.is_dir():
        for file in sorted(secrets.glob("*.json")):
            if file.stem not in seeds:
                raise ConfigurationError(
                    f"{file}: no '{file.stem}' configuration to merge the secret into"
                )
            keys[file.stem] = read_json(file)
    return seeds, keys


def parse_arguments(argv: list[str]) -> tuple[Path, Path | None, list[str] | None]:
    """→ (folder, secrets folder, subsystems to take back to the file).

    The last one is `None` when `--reset` was not asked for, and the empty list
    when it was asked for all of them.
    """
    reset: list[str] | None = None
    if "--reset" in argv:
        cut = argv.index("--reset")
        reset = argv[cut + 1 :]
        argv = argv[:cut]
    if len(argv) not in (1, 2):
        raise ConfigurationError(
            "usage: python -m scripts.load_configuration <folder> "
            "[<secrets folder>] [--reset [subsystem …]]"
        )
    return Path(argv[0]), (Path(argv[1]) if len(argv) == 2 else None), reset


def main() -> int:
    try:
        folder, secrets, reset = parse_arguments(sys.argv[1:])
        seeds, keys = read_documents(folder, secrets)
        mongo_uri, mongo_db = mongo_target()
    except ConfigurationError as error:
        print(f"Configuration not loaded: {error}", file=sys.stderr)
        return 1

    if reset:
        unknown = [name for name in reset if name not in seeds]
        if unknown:
            print(
                f"Configuration not loaded: no file for {', '.join(unknown)}",
                file=sys.stderr,
            )
            return 1

    client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
    collection = client[mongo_db][db.CONFIGURATION]
    collection.create_index("subsystem", unique=True)

    created: list[str] = []
    updated_fields: dict[str, list[str]] = {}
    restored: list[str] = []

    for subsystem, seed in seeds.items():
        secret = keys.get(subsystem, {})
        stored = collection.find_one({"subsystem": subsystem}, {"_id": 0})

        if stored is None:
            collection.insert_one(merge(seed, secret))
            created.append(subsystem)
            continue

        if reset is not None and (not reset or subsystem in reset):
            collection.replace_one({"subsystem": subsystem}, merge(seed, secret))
            restored.append(subsystem)
            continue

        document, added_paths = add_missing(stored, seed)
        document = merge(document, secret)
        if document != stored:
            collection.replace_one({"subsystem": subsystem}, document)
        if added_paths:
            updated_fields[subsystem] = added_paths

    orphans = [
        document["subsystem"]
        for document in collection.find({"subsystem": {"$nin": list(seeds)}}, {"_id": 0, "subsystem": 1})
    ]

    print(f"Configuration of '{mongo_db}': {len(seeds)} subsystems read from {folder.name}/")
    if created:
        print(f"  created: {', '.join(created)}")
    for subsystem, added_paths in updated_fields.items():
        print(f"  {subsystem}: added {', '.join(added_paths)}")
    if restored:
        print(f"  taken back to the file: {', '.join(restored)}")
    if not created and not updated_fields and not restored:
        print("  nothing to add: what is running stays as it is")
    if orphans:
        print(f"  in Mongo without a file, left where they are: {', '.join(orphans)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
