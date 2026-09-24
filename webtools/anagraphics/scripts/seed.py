"""Creates the indexes and inserts the initial data. Idempotent: it can be re-run.

The subsystems' configuration does not come through here: it lives in
webtools/configurator/configuration/ and is loaded by
webtools/configurator/load_configuration.sh.
"""

from pymongo import MongoClient

from webtools_anagraphics import db
from webtools_anagraphics.settings import mongo_target

PROJECTS = [
    {"project_id": "1f251606-bdba-40c4-bbee-bfedc6e57f70"},
]

# `enabled`: the driver is allowed to supervise projects (after the interview).
# A driver who is not enabled is still a driver: they can be an ambassador and do
# autonomous work, but no client can have them as their driver.
DRIVERS = [
    {
        "uid": "7633be3d-e701-42ca-9fea-6c6d1bb4b7d1",
        "username": "dome.santoro@gmail.com",
        "screen_name": "Dome",
        "enabled": True,
    },
    # A test driver: it is there to see more than one driver in the list, and for
    # the "driver with no discount codes" case.
    {
        "uid": "639718a3-ea41-4533-bdb8-73ac58b3b1b2",
        "username": "driver.prova@example.com",
        "screen_name": "Prova",
        "enabled": True,
    },
    # A test driver who is not enabled, with a discount code: it is there for the
    # "link of a driver who is not enabled" and "discount of a driver who is not
    # enabled" cases.
    {
        "uid": "f234b930-e5d0-4e10-8a4f-1a8a13814370",
        "username": "driver.nonabilitato@example.com",
        "screen_name": "Non abilitato",
        "enabled": False,
    },
]

# The sso users. `uid` is the person's identity, `driver_uid` links them to their
# document in `drivers` when they are also a driver.
# The password is not seeded: it is set separately, building the `credential` block
# with `webtools_anagraphics.credentials.build_credential`.
USERS = [
    {
        "uid": "8ff93901-673e-44ba-b05b-56011395dcba",
        "username": "dome.santoro@gmail.com",
        "screen_name": "Dome",
        "active": True,
        "driver_uid": "7633be3d-e701-42ca-9fea-6c6d1bb4b7d1",
    },
    {
        "uid": "214912a9-2cc4-4205-87b7-93ea71f6be72",
        "username": "driver.prova@example.com",
        "screen_name": "Prova",
        "active": True,
        "driver_uid": "639718a3-ea41-4533-bdb8-73ac58b3b1b2",
    },
]

# The driver is duplicated inside the discount: whoever reads a discount need not read the driver again.
DISCOUNTS = [
    {
        "discount_code": "e8013cf2-34eb-4bc3-8a34-b08fb24a1bf3",
        "driver": {
            "uid": "7633be3d-e701-42ca-9fea-6c6d1bb4b7d1",
            "screen_name": "Dome",
        },
        "percentage": 5,
    },
    {
        "discount_code": "91165eb1-65d6-43a9-ade8-681ec3ebef8d",
        "driver": {
            "uid": "f234b930-e5d0-4e10-8a4f-1a8a13814370",
            "screen_name": "Non abilitato",
        },
        "percentage": 10,
    },
]


def main() -> None:
    mongo_uri, mongo_db = mongo_target()
    database = MongoClient(mongo_uri)[mongo_db]
    db.ensure_indexes(database)

    for project in PROJECTS:
        database[db.PROJECTS].update_one(
            {"project_id": project["project_id"]}, {"$set": project}, upsert=True
        )
    for driver in DRIVERS:
        database[db.DRIVERS].update_one({"uid": driver["uid"]}, {"$set": driver}, upsert=True)
    for discount in DISCOUNTS:
        database[db.DISCOUNTS].update_one(
            {"discount_code": discount["discount_code"]}, {"$set": discount}, upsert=True
        )
    for user in USERS:
        # `credential` only at creation: re-running the seed must not wipe a
        # password that has already been set.
        database[db.USERS].update_one(
            {"username": user["username"]},
            {"$set": user, "$setOnInsert": {"credential": None}},
            upsert=True,
        )

    print(
        f"Seed done on '{mongo_db}': "
        f"{len(PROJECTS)} projects, "
        f"{len(DRIVERS)} drivers, {len(DISCOUNTS)} discounts, {len(USERS)} users."
    )


if __name__ == "__main__":
    main()
