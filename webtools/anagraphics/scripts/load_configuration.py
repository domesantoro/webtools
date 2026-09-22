"""Carica nella collection `configuration` i file JSON di una cartella.

    python -m scripts.load_configuration <cartella>   (dalla cartella anagraphics)

Un file per sottosistema: `sso.json` diventa il documento con `subsystem: "sso"`.
I file sono la fonte: ogni documento viene sostituito per intero (un campo tolto
dal file sparisce anche da Mongo) e i sottosistemi senza più un file vengono
cancellati. Non si carica niente se anche un solo file non è JSON valido.

Di solito non si lancia a mano: lo fa webtools/configurator/load_configuration.sh.
"""

import json
import sys
from pathlib import Path

from pymongo import MongoClient

from webtools_anagraphics import db
from webtools_anagraphics.settings import ConfigurationError, mongo_target


def read_documents(folder: Path) -> dict[str, dict]:
    documents = {}
    for file in sorted(folder.glob("*.json")):
        try:
            content = json.loads(file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ConfigurationError(f"{file}: {error}") from error
        if not isinstance(content, dict):
            raise ConfigurationError(f"{file}: deve contenere un oggetto JSON")
        if "subsystem" in content:
            raise ConfigurationError(f"{file}: `subsystem` non va scritto, lo dà il nome del file")
        documents[file.stem] = {"subsystem": file.stem, **content}
    if not documents:
        raise ConfigurationError(f"nessun file .json in {folder}")
    return documents


def main() -> int:
    if len(sys.argv) != 2:
        print("Uso: python -m scripts.load_configuration <cartella>", file=sys.stderr)
        return 2
    try:
        documents = read_documents(Path(sys.argv[1]))
        mongo_uri, mongo_db = mongo_target()
    except ConfigurationError as error:
        print(f"Configurazione non caricata: {error}", file=sys.stderr)
        return 1

    client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
    database = client[mongo_db]
    database[db.CONFIGURATION].create_index("subsystem", unique=True)
    for subsystem, document in documents.items():
        database[db.CONFIGURATION].replace_one({"subsystem": subsystem}, document, upsert=True)
    removed = database[db.CONFIGURATION].delete_many(
        {"subsystem": {"$nin": list(documents)}}
    ).deleted_count

    print(
        f"Configurazione caricata in '{mongo_db}': {', '.join(documents)}"
        + (f" ({removed} documenti senza file cancellati)" if removed else "")
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
