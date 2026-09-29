"""Turns `review.driver_uid` into `review.driver`, the copy of the driver.

A project used to name its driver and nothing else. It now keeps a copy of them —
`uid`, `screen_name` and the address they are reached at — so that whoever reads a
project to write to its driver does not have to fetch the driver separately.

    cd webtools/anagraphics
    set -a; source ../configurator/bootstrap.env; set +a
    uv run python -m scripts.migrate_project_driver --dry-run
    uv run python -m scripts.migrate_project_driver

Idempotent: a project already carrying `review.driver` is left alone. A project whose
`driver_uid` names a driver that no longer exists is **not** guessed at — it is
reported and left as it is, because inventing a copy is worse than a project the
migration says it could not move.
"""

import sys

import os

from pymongo import MongoClient

DRIVERS = "drivers"
PROJECTS = "projects"


def main(argv: list[str]) -> int:
    dry_run = "--dry-run" in argv
    # Straight from the environment: anagraphics is the one serving the
    # configuration, so it has no configuration client to read it with.
    database = MongoClient(os.environ["WEBTOOLS_MONGO_URI"])[os.environ["WEBTOOLS_MONGO_DB"]]

    todo = list(database[PROJECTS].find({"review.driver_uid": {"$exists": True}}))
    print(f"{len(todo)} projects still carry review.driver_uid")

    moved = emptied = missing = 0
    for project in todo:
        uid = project["review"].get("driver_uid")
        copy = None
        if uid is not None:
            driver = database[DRIVERS].find_one({"uid": uid})
            if driver is None:
                print(f"  ! {project['project_id']}: driver {uid} no longer exists — left as it is")
                missing += 1
                continue
            copy = {
                "uid": driver["uid"],
                "screen_name": driver["screen_name"],
                "username": driver["username"],
            }
            moved += 1
        else:
            emptied += 1
        if not dry_run:
            database[PROJECTS].update_one(
                {"project_id": project["project_id"]},
                {"$set": {"review.driver": copy}, "$unset": {"review.driver_uid": ""}},
            )

    print(f"  with a driver : {moved}")
    print(f"  without one   : {emptied}")
    print(f"  not moved     : {missing}")
    if dry_run:
        print("Dry run: nothing was written.")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
