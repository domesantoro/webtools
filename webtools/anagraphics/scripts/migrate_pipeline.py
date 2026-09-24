"""Migrazione: `state` piatto → oggetto `pipeline` sui progetti.

    set -a; source ../configurator/bootstrap.env; set +a
    .venv/bin/python -m scripts.migrate_pipeline [--dry-run]

(dalla cartella anagraphics: Mongo lo dicono le variabili del bootstrap, come per
load_configuration.sh)

Prima il progetto aveva un solo campo `state` ("PREANALYSIS") e nessuna traccia di
che cosa gli fosse successo. Adesso ha:

    pipeline: { state: "<lo stesso valore>", steps: [] }

`steps` nasce vuota: dei progetti già esistenti non sappiamo quali passi abbiano
attraversato, e inventarli sarebbe peggio che non averli.

Idempotente: i progetti che hanno già `pipeline` non si toccano.
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

    da_migrare = list(projects.find({"pipeline": {"$exists": False}}, {"_id": 0}))
    if not da_migrare:
        print(f"Niente da migrare in '{mongo_db}': tutti i progetti hanno già `pipeline`.")
        return 0

    for progetto in da_migrare:
        # Un progetto senza `state` non dovrebbe esistere; se c'è, parte dall'inizio.
        stato = progetto.get("state") or "PREANALYSIS"
        print(f"  {progetto['project_id']}: state={stato!r} → pipeline.state")
        if not dry_run:
            projects.update_one(
                {"project_id": progetto["project_id"]},
                {"$set": {"pipeline": {"state": stato, "steps": []}}, "$unset": {"state": ""}},
            )

    verbo = "da migrare" if dry_run else "migrati"
    print(f"{len(da_migrare)} progetti {verbo} in '{mongo_db}'.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
