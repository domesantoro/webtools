"""Migration: the `drivers` collection into `users.driver`, with a level.

    set -a; source ../configurator/bootstrap.env; set +a
    .venv/bin/python -m scripts.migrate_user_driver [--dry-run]

(from the anagraphics directory: Mongo is named by the bootstrap variables, as for
load_configuration.sh)

A driver was a document of their own in `drivers`, with a boolean `enabled`, and a
user pointed at it with a flat `driver_uid`. Now the role lives inside the person:

    driver: null                                   whoever is not a driver
    driver: { driver_uid: <uuid>, level: <int> }    whoever is

`level` replaces `enabled` because the service already has three conditions and will
have more, and a boolean cannot carry the third: `enabled: true` becomes **1**,
anything else **0**. Nothing is promoted by this migration — level 2 (prj-admin) is
given by hand, never guessed from the old data.

The driver's uid is **not** rewritten: it stays the uid the `drivers` document had, so
the discounts, the copies on the projects and `billing.ambassador_uid` go on pointing
at what they always pointed at.

Two things are reported and not repaired, because repairing them means inventing
data:

- a user whose `driver_uid` names a driver that is not there: the level cannot be
  known, so the user is **skipped** and keeps the old field (same rule as
  `migrate_project_driver.py`);
- a driver with no user: they cannot be logged in as, and making up a person for them
  is not a migration's business. `scripts/seed.py` carries the one there is.

The `drivers` collection is **not** dropped here: no migration in this subsystem
deletes anything. Drop it by hand after reading the report — the command is in
`docs/subsystems/anagraphics/README.md` §8.12.

Idempotent: users who already have `driver` are left alone.
"""

import sys

from pymongo import MongoClient

from webtools_anagraphics import db
from webtools_anagraphics.settings import mongo_target

# The collection this migration reads and leaves behind. It is a literal here, and
# not a constant of `db`, because after this migration the name does not exist in the
# subsystem any more: a migration is the one place that still has to speak of it.
DRIVERS = "drivers"


def main() -> int:
    dry_run = "--dry-run" in sys.argv[1:]
    mongo_uri, mongo_db = mongo_target()
    client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
    database = client[mongo_db]
    users = database[db.USERS]
    drivers = database[DRIVERS]

    to_migrate = list(
        users.find(
            {"driver": {"$exists": False}},
            {"_id": 0, "uid": 1, "username": 1, "driver_uid": 1},
        )
    )
    orphans = _orphan_drivers(drivers, users)

    if not to_migrate:
        print(f"Nothing to migrate in '{mongo_db}': every user already has `driver`.")
        _report_orphans(orphans)
        return 0

    migrated = 0
    skipped = 0
    for user in to_migrate:
        driver_uid = user.get("driver_uid")
        name = user.get("username")

        if driver_uid is None:
            print(f"  {name}: driver → null")
            if not dry_run:
                users.update_one({"uid": user["uid"]}, {"$set": {"driver": None}})
            migrated += 1
            continue

        driver = drivers.find_one({"uid": driver_uid}, {"_id": 0, "enabled": 1})
        if driver is None:
            print(f"  {name}: SKIPPED, driver_uid {driver_uid} names no driver")
            skipped += 1
            continue

        level = 1 if driver.get("enabled") is True else 0
        print(f"  {name}: driver → {{driver_uid: {driver_uid}, level: {level}}}")
        if not dry_run:
            users.update_one(
                {"uid": user["uid"]},
                {
                    "$set": {"driver": {"driver_uid": driver_uid, "level": level}},
                    "$unset": {"driver_uid": ""},
                },
            )
        migrated += 1

    verb = "to migrate" if dry_run else "migrated"
    print(f"{migrated} users {verb} in '{mongo_db}'.")
    if skipped:
        print(f"{skipped} users skipped: their driver is not there, so no level can be read.")
    _report_orphans(orphans)
    return 0


def _orphan_drivers(drivers, users) -> list[dict]:
    """The drivers no user points at. They are lost by this migration if nothing is done."""
    taken = {
        user["driver_uid"]
        for user in users.find({"driver_uid": {"$exists": True}}, {"_id": 0, "driver_uid": 1})
    } | {
        user["driver"]["driver_uid"]
        for user in users.find({"driver.driver_uid": {"$exists": True}}, {"_id": 0, "driver": 1})
    }
    return [
        driver
        for driver in drivers.find({}, {"_id": 0, "uid": 1, "screen_name": 1, "enabled": 1})
        if driver.get("uid") not in taken
    ]


def _report_orphans(orphans: list[dict]) -> None:
    if not orphans:
        return
    print(f"{len(orphans)} drivers have no user and are not migrated:")
    for driver in orphans:
        print(f"  {driver.get('uid')} ({driver.get('screen_name')}, enabled={driver.get('enabled')})")
    print("Whatever points at them — a discount code, a project's copy — keeps pointing at a")
    print("driver the API can no longer resolve. Give them a user, or remove what points at them.")


if __name__ == "__main__":
    sys.exit(main())
