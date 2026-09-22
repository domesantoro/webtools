"""Impostazioni, lette all'avvio. Niente valori di default: se manca qualcosa il
server non parte.

Dall'ambiente arriva solo quello che serve a raggiungere la configurazione
(webtools/configurator/bootstrap.env):

    WEBTOOLS_ANAGRAPHICS_URL            il nostro indirizzo: ci si mette in ascolto lì
    WEBTOOLS_CONFIGURATION_TIMEOUT_MS   quanto aspettare Mongo per leggere la configurazione
    WEBTOOLS_MONGO_URI, WEBTOOLS_MONGO_DB

Il resto è il documento `anagraphics` della collection `configuration`, lo
stesso posto da cui gli altri sottosistemi leggono la loro: anagraphics lo legge
direttamente da Mongo, perché è lui a servirlo.
"""

import os
from dataclasses import dataclass
from urllib.parse import urlsplit

from pymongo import MongoClient
from pymongo.errors import PyMongoError

SUBSYSTEM = "anagraphics"


class ConfigurationError(Exception):
    """Configurazione assente o sbagliata: il server non deve partire."""


@dataclass(frozen=True)
class Settings:
    host: str
    port: int
    mongo_uri: str
    mongo_db: str
    mongo_server_selection_timeout_ms: int
    allowed_ips: frozenset[str]


def _env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise ConfigurationError(f"variabile d'ambiente {name} mancante")
    return value


def _positive_int(name: str, value: object) -> int:
    # bool è un int per Python: `true` nel JSON non deve passare per 1.
    if isinstance(value, int) and not isinstance(value, bool) and value > 0:
        return value
    raise ConfigurationError(f"{name} deve essere un intero positivo, trovato {value!r}")


def _field(document: dict, path: str) -> object:
    value: object = document
    for key in path.split("."):
        value = value.get(key) if isinstance(value, dict) else None
    if value is None:
        raise ConfigurationError(f"configurazione di {SUBSYSTEM}: {path} mancante")
    return value


def _listen_address(url: str) -> tuple[str, int]:
    parts = urlsplit(url)
    if parts.scheme != "http" or not parts.hostname or not parts.port:
        raise ConfigurationError(
            f"WEBTOOLS_ANAGRAPHICS_URL deve essere http://host:porta, trovato {url!r}"
        )
    return parts.hostname, parts.port


def read_configuration(mongo_uri: str, mongo_db: str, timeout_ms: int) -> dict:
    client = MongoClient(mongo_uri, serverSelectionTimeoutMS=timeout_ms)
    try:
        document = client[mongo_db]["configuration"].find_one({"subsystem": SUBSYSTEM}, {"_id": 0})
    except PyMongoError as error:
        raise ConfigurationError(f"MongoDB non risponde ({mongo_uri}): {error}") from error
    finally:
        client.close()
    if document is None:
        raise ConfigurationError(
            f"nessuna configurazione '{SUBSYSTEM}' in {mongo_db}.configuration: "
            "lancia webtools/configurator/load_configuration.sh"
        )
    return document


def mongo_target() -> tuple[str, str]:
    """(uri, database) dall'ambiente: serve anche agli script, che non leggono la configurazione."""
    return _env("WEBTOOLS_MONGO_URI"), _env("WEBTOOLS_MONGO_DB")


def load_settings() -> Settings:
    host, port = _listen_address(_env("WEBTOOLS_ANAGRAPHICS_URL"))
    mongo_uri, mongo_db = mongo_target()
    timeout_raw = _env("WEBTOOLS_CONFIGURATION_TIMEOUT_MS")
    if not timeout_raw.isdigit():
        raise ConfigurationError(
            f"WEBTOOLS_CONFIGURATION_TIMEOUT_MS deve essere un intero positivo, trovato {timeout_raw!r}"
        )
    timeout_ms = _positive_int("WEBTOOLS_CONFIGURATION_TIMEOUT_MS", int(timeout_raw))

    document = read_configuration(mongo_uri, mongo_db, timeout_ms)

    allowed_ips = _field(document, "access.allowed_ips")
    if (
        not isinstance(allowed_ips, list)
        or not allowed_ips
        or not all(isinstance(ip, str) and ip for ip in allowed_ips)
    ):
        raise ConfigurationError(
            f"configurazione di {SUBSYSTEM}: access.allowed_ips deve essere un elenco "
            f"non vuoto di stringhe, trovato {allowed_ips!r}"
        )

    return Settings(
        host=host,
        port=port,
        mongo_uri=mongo_uri,
        mongo_db=mongo_db,
        mongo_server_selection_timeout_ms=_positive_int(
            "mongo.server_selection_timeout_ms",
            _field(document, "mongo.server_selection_timeout_ms"),
        ),
        allowed_ips=frozenset(allowed_ips),
    )
