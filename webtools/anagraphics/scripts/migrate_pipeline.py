"""Migration: flat `state` → the `pipeline` object on projects.

    set -a; source ../configurator/bootstrap.env; set +a
    .venv/bin/python -m scripts.migrate_pipeline [--dry-run]

(from the anagraphics directory: Mongo is named by the bootstrap variables, as for
load_configuration.sh)

Before, a project had a single `state` field ("PREANALYSIS") and no trace of what
had happened to it. Now it has:

    pipeline: { state: "<the same value>", steps: [] }

`steps` is born empty: of the projects that already exist we do not know which
steps they went through, and inventing them would be worse than not having them.

Idempotent: projects that already have `pipeline` are left alone.
"""

import sys

from pymongo import MongoClient

from webtools_anagraphics import db
from webtools_anagraphics.settings import mongo_target


def main() -> int:
    dry_run = "--dry-run" in sys.argv[1:]

    mongo_uri, mongo_db = mongo_target()
    client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
    projects = client[mongo_db][db.PROJECTS]

    to_migrate = list(projects.find({"pipeline": {"$exists": False}}, {"_id": 0}))
    if not to_migrate:
        print(f"Nothing to migrate in '{mongo_db}': every project already has `pipeline`.")
        return 0

    for project in to_migrate:
        # A project without `state` should not exist; if there is one, it starts from the beginning.
        state = project.get("state") or "PREANALYSIS"
        print(f"  {project['project_id']}: state={state!r} → pipeline.state")
        if not dry_run:
            projects.update_one(
                {"project_id": project["project_id"]},
                {"$set": {"pipeline": {"state": state, "steps": []}}, "$unset": {"state": ""}},
            )

    verb = "to migrate" if dry_run else "migrated"
    print(f"{len(to_migrate)} projects {verb} in '{mongo_db}'.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
