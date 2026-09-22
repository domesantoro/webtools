"""Crea gli indici e inserisce i dati iniziali. Idempotente: si può rilanciare.

La configurazione dei sottosistemi non passa di qui: sta in
webtools/configurator/configuration/ e la carica
webtools/configurator/load_configuration.sh.
"""

from pymongo import MongoClient

from webtools_anagraphics import db
from webtools_anagraphics.settings import mongo_target

PROJECTS = [
    {"project_id": "1f251606-bdba-40c4-bbee-bfedc6e57f70"},
]

# `enabled`: il driver è abilitato a seguire i progetti (dopo il colloquio).
# Uno non abilitato è comunque un driver: può essere ambassador e fare lavoro
# autonomo, ma nessun cliente può averlo come driver.
DRIVERS = [
    {
        "uid": "7633be3d-e701-42ca-9fea-6c6d1bb4b7d1",
        "username": "dome.santoro@gmail.com",
        "screen_name": "Dome",
        "enabled": True,
    },
    # Driver di prova: serve per vedere più di un driver nella lista
    # e per il caso "driver senza codici sconto".
    {
        "uid": "639718a3-ea41-4533-bdb8-73ac58b3b1b2",
        "username": "driver.prova@example.com",
        "screen_name": "Prova",
        "enabled": True,
    },
    # Driver di prova non abilitato, con un codice sconto: serve per i casi
    # "link di un driver non abilitato" e "sconto di un driver non abilitato".
    {
        "uid": "f234b930-e5d0-4e10-8a4f-1a8a13814370",
        "username": "driver.nonabilitato@example.com",
        "screen_name": "Non abilitato",
        "enabled": False,
    },
]

# Utenti del sso. `uid` è l'identità della persona, `driver_uid` la collega al suo
# documento in `drivers` quando è anche un driver.
# La password non si semina: si imposta a parte, costruendo il blocco `credential`
# con `webtools_anagraphics.credentials.build_credential`.
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

# Il driver è ridondato dentro lo sconto: chi legge uno sconto non deve rileggere il driver.
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
        # `credential` solo alla creazione: rilanciare il seed non deve
        # cancellare una password già impostata.
        database[db.USERS].update_one(
            {"username": user["username"]},
            {"$set": user, "$setOnInsert": {"credential": None}},
            upsert=True,
        )

    print(
        f"Seed completato su '{mongo_db}': "
        f"{len(PROJECTS)} progetti, "
        f"{len(DRIVERS)} driver, {len(DISCOUNTS)} sconti, {len(USERS)} utenti."
    )


if __name__ == "__main__":
    main()
