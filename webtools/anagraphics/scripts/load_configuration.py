"""Porta nella collection `configuration` quello che ai sottosistemi manca.

    python -m scripts.load_configuration <cartella> [<cartella dei segreti>] [--reset [sottosistema …]]
    (dalla cartella anagraphics)

Un file per sottosistema: `sso.json` diventa il documento con `subsystem: "sso"`.

**La configurazione che vive sta in Mongo, non nei file.** I file sono il seme —
i valori con cui nasce un ambiente nuovo — e la forma attesa: dicono quali campi
esistono. Quello che gira può divergere da loro, ed è normale: un limite alzato
in esercizio, una soglia corretta, un prezzo cambiato restano dove sono.

Quindi, quando il documento del sottosistema c'è già, si aggiungono **solo i
campi che mancano**, ramo per ramo. Un campo che c'è non si tocca, qualunque
valore abbia; un campo tolto dal file resta in Mongo; un sottosistema senza più
un file non viene cancellato. Così uno sviluppo che introduce un campo nuovo
parte senza interventi a mano, e niente di quello che è stato cambiato si perde.

`--reset` fa la cosa opposta, ed è l'unico modo per farla: riporta i documenti a
quello che dicono i file, campo per campo, cancellando le modifiche. Senza nomi
vale per tutti i sottosistemi, con dei nomi solo per quelli.

**I segreti sono un'altra cosa.** I file di `configurator/secrets/` (fuori da
git) si fondono in profondità e **sostituiscono sempre** il valore che trovano:
una chiave d'API non è un dato che si modifica dal sistema, e quel file è l'unico
posto dove qualcuno la scrive — se la ruoti, deve valere quella nuova.

Non si carica niente se anche un solo file non è JSON valido.

Di solito non si lancia a mano: lo fa webtools/configurator/load_configuration.sh.
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
        raise ConfigurationError(f"{file}: deve contenere un oggetto JSON")
    if "subsystem" in content:
        raise ConfigurationError(f"{file}: `subsystem` non va scritto, lo dà il nome del file")
    return content


def merge(base: dict, extra: dict) -> dict:
    """`extra` sopra `base`, ramo per ramo: quello che c'è in `extra` vince.

    Due oggetti si fondono; qualunque altra cosa viene sostituita. Serve ai
    segreti, che aggiungono una foglia (`ai.providers.anthropic.api_key`) senza
    portarsi via i rami vicini (`…anthropic.model`), e devono avere l'ultima
    parola sul valore.
    """
    merged = dict(base)
    for key, value in extra.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def add_missing(stored: dict, seed: dict, prefix: str = "") -> tuple[dict, list[str]]:
    """Il seme sotto quello che c'è: si aggiungono solo i campi che mancano.

    Un campo presente non si tocca — nemmeno se il seme dice un altro valore,
    nemmeno se è `null`, `0` o `false`, che sono valori come gli altri. Si scende
    solo dove tutti e due hanno un oggetto: se in Mongo un ramo è diventato
    qualcos'altro, è una scelta di chi l'ha cambiato e non la si ribalta.

    Restituisce il documento aggiornato e i percorsi aggiunti, per poterli dire.
    """
    updated = dict(stored)
    added: list[str] = []
    for key, value in seed.items():
        path = f"{prefix}{key}"
        if key not in updated:
            updated[key] = value
            added.append(path)
        elif isinstance(value, dict) and isinstance(updated[key], dict):
            updated[key], sotto = add_missing(updated[key], value, f"{path}.")
            added.extend(sotto)
    return updated, added


def read_documents(folder: Path, secrets: Path | None = None) -> tuple[dict[str, dict], dict[str, dict]]:
    """I semi e i segreti, letti e controllati, senza ancora fonderli.

    Restano separati perché hanno regole diverse: il seme riempie i buchi, il
    segreto sovrascrive.
    """
    seeds: dict[str, dict] = {}
    for file in sorted(folder.glob("*.json")):
        seeds[file.stem] = {"subsystem": file.stem, **read_json(file)}
    if not seeds:
        raise ConfigurationError(f"nessun file .json in {folder}")

    keys: dict[str, dict] = {}
    if secrets is not None and secrets.is_dir():
        for file in sorted(secrets.glob("*.json")):
            if file.stem not in seeds:
                raise ConfigurationError(
                    f"{file}: nessuna configurazione '{file.stem}' a cui fondere il segreto"
                )
            keys[file.stem] = read_json(file)
    return seeds, keys


def parse_arguments(argv: list[str]) -> tuple[Path, Path | None, list[str] | None]:
    """→ (cartella, cartella dei segreti, sottosistemi da riportare al file).

    L'ultimo è `None` quando non si è chiesto `--reset`, la lista vuota quando lo
    si è chiesto per tutti.
    """
    reset: list[str] | None = None
    if "--reset" in argv:
        taglio = argv.index("--reset")
        reset = argv[taglio + 1 :]
        argv = argv[:taglio]
    if len(argv) not in (1, 2):
        raise ConfigurationError(
            "uso: python -m scripts.load_configuration <cartella> "
            "[<cartella dei segreti>] [--reset [sottosistema …]]"
        )
    return Path(argv[0]), (Path(argv[1]) if len(argv) == 2 else None), reset


def main() -> int:
    try:
        folder, secrets, reset = parse_arguments(sys.argv[1:])
        seeds, keys = read_documents(folder, secrets)
        mongo_uri, mongo_db = mongo_target()
    except ConfigurationError as error:
        print(f"Configurazione non caricata: {error}", file=sys.stderr)
        return 1

    if reset:
        sconosciuti = [nome for nome in reset if nome not in seeds]
        if sconosciuti:
            print(
                f"Configurazione non caricata: nessun file per {', '.join(sconosciuti)}",
                file=sys.stderr,
            )
            return 1

    client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
    collection = client[mongo_db][db.CONFIGURATION]
    collection.create_index("subsystem", unique=True)

    creati: list[str] = []
    aggiornati: dict[str, list[str]] = {}
    ripristinati: list[str] = []

    for subsystem, seed in seeds.items():
        segreto = keys.get(subsystem, {})
        stored = collection.find_one({"subsystem": subsystem}, {"_id": 0})

        if stored is None:
            collection.insert_one(merge(seed, segreto))
            creati.append(subsystem)
            continue

        if reset is not None and (not reset or subsystem in reset):
            collection.replace_one({"subsystem": subsystem}, merge(seed, segreto))
            ripristinati.append(subsystem)
            continue

        documento, aggiunti = add_missing(stored, seed)
        documento = merge(documento, segreto)
        if documento != stored:
            collection.replace_one({"subsystem": subsystem}, documento)
        if aggiunti:
            aggiornati[subsystem] = aggiunti

    orfani = [
        documento["subsystem"]
        for documento in collection.find({"subsystem": {"$nin": list(seeds)}}, {"_id": 0, "subsystem": 1})
    ]

    print(f"Configurazione di '{mongo_db}': {len(seeds)} sottosistemi letti da {folder.name}/")
    if creati:
        print(f"  creati: {', '.join(creati)}")
    for subsystem, aggiunti in aggiornati.items():
        print(f"  {subsystem}: aggiunti {', '.join(aggiunti)}")
    if ripristinati:
        print(f"  riportati al file: {', '.join(ripristinati)}")
    if not creati and not aggiornati and not ripristinati:
        print("  niente da aggiungere: quello che gira resta com'è")
    if orfani:
        print(f"  in Mongo senza un file, lasciati dove sono: {', '.join(orfani)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
