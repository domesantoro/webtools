"""Settings, read at startup. No default values: if anything is missing the server
does not start.

Where they come from:

- the environment (webtools/configurator/bootstrap.env): where anagraphics is and how
  long to wait for it while reading the configuration. Nothing else — this subsystem
  has no storage of its own;
- everything else: the `comm-center` document of the `configuration` collection,
  served by anagraphics (`GET /configuration/comm-center`), seeded from
  `webtools/configurator/configuration/comm-center.json`.

It reads anagraphics' address and timeout although it calls nothing there yet: every
communication arrives carrying who it is for and how to reach them, which is why the
driver's data is copied onto the project in the first place. The dependency is
declared because the day a communication needs something the caller does not carry,
this is where it will be fetched from, and a subsystem that discovers its
configuration at that moment discovers it in production.
"""

from dataclasses import dataclass

from webtools_comm_center.commons.configuration_client import (
    Bootstrap,
    Configuration,
    read_bootstrap,
    read_configuration,
)
from webtools_comm_center.commons.webtools_metrics_client import Metrics, load_metrics

SUBSYSTEM = "comm-center"


@dataclass(frozen=True)
class Dependency:
    url: str
    timeout_ms: int


@dataclass(frozen=True)
class Settings:
    host: str
    port: int
    allowed_ips: frozenset[str]
    # What reaches this subsystem is who to tell and what about: a handful of fields.
    body_max_bytes: int
    anagraphics: Dependency
    metrics: Metrics


def settings_from(document: dict, bootstrap: Bootstrap) -> Settings:
    """The settings from a configuration document already in hand.

    Kept apart from the reading so that whoever has the document — a test, a script —
    does not need anagraphics to be running to build the settings.
    """
    configuration = Configuration(SUBSYSTEM, document)
    return Settings(
        host=configuration.string("listen.host"),
        port=configuration.port("listen.port"),
        allowed_ips=frozenset(configuration.string_list("access.allowed_ips")),
        body_max_bytes=configuration.integer("limits.body_max_bytes"),
        anagraphics=Dependency(
            # Where anagraphics is comes from the bootstrap: it had to be known before
            # this document could be fetched at all.
            url=bootstrap.anagraphics_url,
            timeout_ms=configuration.integer("subsystems_infos.anagraphics.timeout_ms"),
        ),
        metrics=load_metrics(configuration),
    )


def load_settings() -> Settings:
    bootstrap = read_bootstrap()
    return settings_from(read_configuration(SUBSYSTEM, bootstrap).document, bootstrap)
