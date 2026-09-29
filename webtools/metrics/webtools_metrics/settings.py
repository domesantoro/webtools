"""Settings, read at startup. No default values: if anything is missing the server
does not start.

Where they come from:

- the environment (webtools/configurator/bootstrap.env): where anagraphics is, how
  long to wait for it, and this subsystem's own Mongo;
- everything else: the `metrics` document of the `configuration` collection, served
  by anagraphics (`GET /configuration/metrics`), seeded from
  `webtools/configurator/configuration/metrics.json`.

The address of anagraphics is **not** in the configuration: it is the one thing
that has to be known before the configuration can be read, so there is one copy of
it and it is in the bootstrap. The timeout for the calls we make to anagraphics
afterwards is configuration, because it is a different question from "how long do
we wait at startup".
"""

from dataclasses import dataclass

from webtools_metrics.commons.configuration_client import (
    Bootstrap,
    Configuration,
    ConfigurationError,
    environment_variable,
    read_bootstrap,
    read_configuration,
)
from webtools_metrics.providers import Providers, read_providers

SUBSYSTEM = "metrics"


@dataclass(frozen=True)
class Storage:
    """This subsystem's own Mongo.

    It is read here and not by the shared configuration client, because a database
    is not what reaches the configuration: a subsystem can be correct and have no
    storage at all, and the client must be able to start it.
    """

    uri: str
    db: str


def read_storage() -> Storage:
    return Storage(
        uri=environment_variable("WEBTOOLS_MONGO_URI"),
        db=environment_variable("WEBTOOLS_MONGO_DB"),
    )


@dataclass(frozen=True)
class Settings:
    host: str
    port: int
    allowed_ips: frozenset[str]
    mongo_uri: str
    mongo_db: str
    mongo_server_selection_timeout_ms: int
    # How long a measurement's body may be. A measurement is a handful of numbers:
    # anything larger is a mistake, and it is refused rather than stored.
    body_max_bytes: int
    # The most rows a read may return. The reads are aggregates, but an aggregate
    # over a wide dimension (routes, models) can still be long.
    max_rows: int
    # The edges of the duration histogram, in milliseconds, from which the
    # percentiles are estimated. Ordered, and the last bucket is everything above
    # the last edge.
    duration_buckets_ms: tuple[int, ...]
    # 0 means keep for ever, and creates no TTL index.
    retention_days: int
    anagraphics_url: str
    anagraphics_timeout_ms: int
    # Which kinds of token each provider counts. It is the closed vocabulary a
    # measurement's tokens are checked against.
    providers: Providers


def settings_from(document: dict, bootstrap: Bootstrap, storage: Storage) -> Settings:
    """The settings from a configuration document already in hand.

    Kept apart from the reading so that whoever has the document — a test, a
    script — does not need anagraphics to be running to build the settings.
    """
    configuration = Configuration(SUBSYSTEM, document)
    buckets = configuration.integer_list("limits.duration_buckets_ms")
    if sorted(buckets) != buckets or len(set(buckets)) != len(buckets):
        raise ConfigurationError(
            f"configuration of {SUBSYSTEM}: limits.duration_buckets_ms must be ordered and "
            f"without repetitions, found {buckets!r}"
        )
    return Settings(
        host=configuration.string("listen.host"),
        port=configuration.port("listen.port"),
        allowed_ips=frozenset(configuration.string_list("access.allowed_ips")),
        mongo_uri=storage.uri,
        mongo_db=storage.db,
        mongo_server_selection_timeout_ms=configuration.integer("mongo.server_selection_timeout_ms"),
        body_max_bytes=configuration.integer("limits.body_max_bytes"),
        max_rows=configuration.integer("limits.max_rows"),
        duration_buckets_ms=tuple(buckets),
        retention_days=configuration.integer_from_zero("limits.retention_days"),
        anagraphics_url=bootstrap.anagraphics_url,
        anagraphics_timeout_ms=configuration.integer("subsystems_infos.anagraphics.timeout_ms"),
        providers=read_providers(configuration),
    )


def load_settings() -> Settings:
    bootstrap = read_bootstrap()
    return settings_from(
        read_configuration(SUBSYSTEM, bootstrap).document, bootstrap, read_storage()
    )
