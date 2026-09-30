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

# The sso users. `uid` is the person's identity; `driver` is the driver role, `null`
# for whoever is not a driver and `{driver_uid, level}` for whoever is. The two uids
# are deliberately different: the person and the role are two things, and what points
# at a driver — a link, a discount code, a project's copy — points at `driver_uid`.
#
# `level`: 0 not enabled, 1 enabled (after the interview), 2 prj-admin. Only from 1
# upwards may a driver supervise a client's project; a driver at 0 is still a driver
# and can be an ambassador and do autonomous work.
#
# The password is not seeded: it is set separately, building the `credential` block
# with `webtools_anagraphics.credentials.build_credential`.
USERS = [
    {
        "uid": "8ff93901-673e-44ba-b05b-56011395dcba",
        "username": "dome.santoro@gmail.com",
        "screen_name": "Dome",
        "active": True,
        "driver": {"driver_uid": "7633be3d-e701-42ca-9fea-6c6d1bb4b7d1", "level": 1},
    },
    # A test driver: it is there to see more than one driver in the list, and for the
    # "driver with no discount codes" case.
    {
        "uid": "214912a9-2cc4-4205-87b7-93ea71f6be72",
        "username": "driver.test@example.com",
        "screen_name": "Test",
        "active": True,
        "driver": {"driver_uid": "639718a3-ea41-4533-bdb8-73ac58b3b1b2", "level": 1},
    },
    # A test driver at level 0, with a discount code: they are there for the "link of
    # a driver who may not supervise" and "discount of a driver who may not
    # supervise" cases. Before 0.12.0 this driver had no user at all, so the case
    # could not be reached from a login.
    {
        "uid": "c981e204-34af-479c-970a-576a75029d71",
        "username": "driver.notenabled@example.com",
        "screen_name": "Not enabled",
        "active": True,
        "driver": {"driver_uid": "f234b930-e5d0-4e10-8a4f-1a8a13814370", "level": 0},
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
            "screen_name": "Not enabled",
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
        f"{len(DISCOUNTS)} discounts, {len(USERS)} users."
    )


if __name__ == "__main__":
    main()
