"""Migration: the `billing` block on users, with the turn credit.

    set -a; source ../configurator/bootstrap.env; set +a
    .venv/bin/python -m scripts.migrate_user_billing [--dry-run]

(from the anagraphics directory: Mongo is named by the bootstrap variables, as for
load_configuration.sh)

A user now has a credit of chat turns, spent in the pre-analysis when the turns
included in the project run out:

    billing: { turns_credit: 0 }

It is born at **zero**: nobody has bought anything yet, and granting turns to
people who were already there would be inventing a purchase that never happened.

The field would create itself at the first `$inc` (see `db.grant_user_turns`), but
then it would exist only for those who have bought, and reading "no credit"
instead of "zero credit" is a distinction nobody wants to make.

Idempotent: users who already have `billing.turns_credit` are left alone.
"""

import sys

from pymongo import MongoClient

from webtools_anagraphics import db
from webtools_anagraphics.settings import mongo_target


def main() -> int:
    dry_run = "--dry-run" in sys.argv[1:]
    mongo_uri, mongo_db = mongo_target()
    client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
    users = client[mongo_db][db.USERS]

    to_migrate = list(users.find({"billing.turns_credit": {"$exists": False}}, {"_id": 0, "username": 1, "uid": 1}))
    if not to_migrate:
        print(f"Nothing to migrate in '{mongo_db}': every user already has `billing.turns_credit`.")
        return 0

    for user in to_migrate:
        print(f"  {user.get('username')}: billing.turns_credit → 0")
        if not dry_run:
            users.update_one({"uid": user["uid"]}, {"$set": {"billing.turns_credit": 0}})

    verb = "to migrate" if dry_run else "migrated"
    print(f"{len(to_migrate)} users {verb} in '{mongo_db}'.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
