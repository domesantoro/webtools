"""Settings, read at startup. No default values: if anything is missing the server
does not start.

Only what is needed to reach the configuration comes from the environment
(webtools/configurator/bootstrap.env):

    WEBTOOLS_ANAGRAPHICS_URL            our address: this is where we listen
    WEBTOOLS_CONFIGURATION_TIMEOUT_MS   how long to wait for Mongo when reading the configuration
    WEBTOOLS_MONGO_URI, WEBTOOLS_MONGO_DB

The rest is the `anagraphics` document of the `configuration` collection, the very
place the other subsystems read theirs from: anagraphics reads it straight from
Mongo, because it is the one serving it.
"""

import os
from dataclasses import dataclass
from urllib.parse import urlsplit

from pymongo import MongoClient
from pymongo.errors import PyMongoError

SUBSYSTEM = "anagraphics"


class ConfigurationError(Exception):
    """Configuration missing or wrong: the server must not start."""


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
        raise ConfigurationError(f"environment variable {name} is missing")
    return value


def _positive_int(name: str, value: object) -> int:
    # bool is an int for Python: `true` in the JSON must not pass as 1.
    if isinstance(value, int) and not isinstance(value, bool) and value > 0:
        return value
    raise ConfigurationError(f"{name} must be a positive integer, found {value!r}")


def _field(document: dict, path: str) -> object:
    value: object = document
    for key in path.split("."):
        value = value.get(key) if isinstance(value, dict) else None
    if value is None:
        raise ConfigurationError(f"configuration of {SUBSYSTEM}: {path} is missing")
    return value


def _listen_address(url: str) -> tuple[str, int]:
    parts = urlsplit(url)
    if parts.scheme != "http" or not parts.hostname or not parts.port:
        raise ConfigurationError(
            f"WEBTOOLS_ANAGRAPHICS_URL must be http://host:port, found {url!r}"
        )
    return parts.hostname, parts.port


def read_configuration(mongo_uri: str, mongo_db: str, timeout_ms: int) -> dict:
    client = MongoClient(mongo_uri, serverSelectionTimeoutMS=timeout_ms)
    try:
        document = client[mongo_db]["configuration"].find_one({"subsystem": SUBSYSTEM}, {"_id": 0})
    except PyMongoError as error:
        raise ConfigurationError(f"MongoDB does not answer ({mongo_uri}): {error}") from error
    finally:
        client.close()
    if document is None:
        raise ConfigurationError(
            f"no '{SUBSYSTEM}' configuration in {mongo_db}.configuration: "
            "run webtools/configurator/load_configuration.sh"
        )
    return document


def mongo_target() -> tuple[str, str]:
    """(uri, database) from the environment: the scripts need it too, and they do not read the configuration."""
    return _env("WEBTOOLS_MONGO_URI"), _env("WEBTOOLS_MONGO_DB")


def load_settings() -> Settings:
    host, port = _listen_address(_env("WEBTOOLS_ANAGRAPHICS_URL"))
    mongo_uri, mongo_db = mongo_target()
    timeout_raw = _env("WEBTOOLS_CONFIGURATION_TIMEOUT_MS")
    if not timeout_raw.isdigit():
        raise ConfigurationError(
            f"WEBTOOLS_CONFIGURATION_TIMEOUT_MS must be a positive integer, found {timeout_raw!r}"
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
            f"configuration of {SUBSYSTEM}: access.allowed_ips must be a non-empty "
            f"list of strings, found {allowed_ips!r}"
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
