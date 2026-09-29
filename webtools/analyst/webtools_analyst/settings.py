"""Settings, read at startup. No default values: if anything is missing the server
does not start.

Where they come from:

- the environment (webtools/configurator/bootstrap.env): where anagraphics is and
  how long to wait for it while reading the configuration. Nothing else. This
  subsystem has no storage of its own — what it decides is written on the project
  in anagraphics, and the documents it produces are stored by workspaces — so the
  Mongo variables are none of its business;
- everything else: the `analyst` document of the `configuration` collection, served
  by anagraphics (`GET /configuration/analyst`), seeded from
  `webtools/configurator/configuration/analyst.json`.

The address of anagraphics is **not** in the configuration: it is the one thing that
has to be known before the configuration can be read, so there is one copy of it and
it is in the bootstrap. The timeout of the calls we make to anagraphics afterwards is
configuration, because it is a different question from "how long do we wait at
startup".
"""

from dataclasses import dataclass

from webtools_analyst.commons.configuration_client import (
    Bootstrap,
    Configuration,
    http_url,
    read_bootstrap,
    read_configuration,
)
from webtools_analyst.analysis_technical_ai.webtools_analysis_technical_ai import (
    Door as TechnicalDoor,
    load_analysis_technical_ai,
)
from webtools_analyst.analysis_sustainability_ai.webtools_analysis_sustainability_ai import (
    Door as JudgementDoor,
    load_analysis_sustainability_ai,
)
from webtools_analyst.commons.i18n.webtools_i18n import Texts, load_i18n
from webtools_analyst.commons.webtools_metrics_client import Metrics, load_metrics
from webtools_analyst.functional_points_ai.webtools_functional_points_ai import (
    Door as PointsDoor,
    load_functional_points_ai,
)

SUBSYSTEM = "analyst"


@dataclass(frozen=True)
class Dependency:
    """Another subsystem this one calls: where it is and how long we wait for it.

    One shape for every dependency, because the two questions are the same
    wherever they are asked, and a client that took its timeout from somewhere
    else would be a second answer to the same question.
    """

    url: str
    timeout_ms: int


@dataclass(frozen=True)
class TechnicalAnalysis:
    """One door: which policy it asks with, and everything about the call itself.

    The policy is here and not inside the door because it is not the provider's
    business: swapping provider does not change what the model is asked to do. The
    preferences are here for the same reason.
    """

    policy: str
    # What we would rather the tools were built with, by kind of tool: a mapping
    # whose keys and whose entries are **not known here**. Which kinds exist and
    # what each one prefers is a line of configuration, so a kind added tomorrow
    # costs no code; what the analysis is to do with them is in the policy. Empty
    # is a legitimate state — nothing preferred, the analysis chooses — and so is a
    # kind that covers nothing this project is.
    stack_preferences: dict
    ai: TechnicalDoor


@dataclass(frozen=True)
class SustainabilityJudgement:
    """The second door. Its own policy, its own provider, its own key.

    It may well end up on a different model from the one that wrote the analysis it
    reads: a second opinion from the same model is a weaker second opinion, and
    which model it is has to be a line of configuration rather than a piece of work.
    """

    policy: str
    # Every axis has to be **above** this for the proposal to be `take_on`. The
    # weakest decides, not the average, so this is a floor and not a mean.
    take_on_threshold: float
    ai: JudgementDoor


@dataclass(frozen=True)
class FunctionalPoints:
    """The third door: the list the client reads and agrees to.

    It runs on every project, whatever the judgement proposed — the driver validates
    every analysis, and a proposal to refuse is not a refusal."""

    policy: str
    ai: PointsDoor


@dataclass(frozen=True)
class Analysis:
    """The analyst's doors. One today; the judgement and the functional points are
    branches of their own, added when they are written — each with its own provider,
    its own key and its own consumption."""

    technical: TechnicalAnalysis
    judgement: SustainabilityJudgement
    points: FunctionalPoints


@dataclass(frozen=True)
class Settings:
    host: str
    port: int
    allowed_ips: frozenset[str]
    # How large a request body may be. What reaches this subsystem is a trigger
    # naming a project, not a document: anything larger is a mistake, and it is
    # refused rather than read.
    body_max_bytes: int
    anagraphics: Dependency
    workspaces: Dependency
    drivers_pool: Dependency
    comm_center: Dependency
    # How many times the pool is asked again when the driver it names no longer
    # exists. It is not a retry against a subsystem that is down — that answer does
    # not change by being asked again — but against a pool that offered somebody who
    # has since gone.
    handover_max_attempts: int
    # The client that sends measurements. It is built here, with everything else,
    # so that a subsystem whose `metrics` block is missing does not start — the
    # same rule as every other field.
    metrics: Metrics
    # The language catalogues. One document this subsystem writes is read by the
    # client, in their language, and the fixed words in it are asked for here: a text
    # a person reads lives in a catalogue and nowhere else.
    texts: Texts
    analysis: Analysis


def settings_from(document: dict, bootstrap: Bootstrap) -> Settings:
    """The settings from a configuration document already in hand.

    Kept apart from the reading so that whoever has the document — a test, a
    script — does not need anagraphics to be running to build the settings.
    """
    configuration = Configuration(SUBSYSTEM, document)
    return Settings(
        host=configuration.string("listen.host"),
        port=configuration.port("listen.port"),
        allowed_ips=frozenset(configuration.string_list("access.allowed_ips")),
        body_max_bytes=configuration.integer("limits.body_max_bytes"),
        anagraphics=Dependency(
            # Where anagraphics is comes from the bootstrap, not from here: it had
            # to be known before this document could be fetched at all.
            url=bootstrap.anagraphics_url,
            timeout_ms=configuration.integer("subsystems_infos.anagraphics.timeout_ms"),
        ),
        workspaces=Dependency(
            url=http_url(configuration, "subsystems_infos.workspaces.url"),
            timeout_ms=configuration.integer("subsystems_infos.workspaces.timeout_ms"),
        ),
        drivers_pool=Dependency(
            url=http_url(configuration, "subsystems_infos.drivers_pool.url"),
            timeout_ms=configuration.integer("subsystems_infos.drivers_pool.timeout_ms"),
        ),
        comm_center=Dependency(
            url=http_url(configuration, "subsystems_infos.comm_center.url"),
            timeout_ms=configuration.integer("subsystems_infos.comm_center.timeout_ms"),
        ),
        handover_max_attempts=configuration.integer("handover.max_attempts"),
        metrics=load_metrics(configuration),
        texts=load_i18n(configuration),
        analysis=Analysis(
            technical=TechnicalAnalysis(
                policy=configuration.string("analysis.technical.policy"),
                stack_preferences=configuration.mapping("analysis.technical.stack_preferences"),
                # The branch is named by the caller: the door does not assume where
                # in the document it lives.
                ai=load_analysis_technical_ai(configuration, "analysis.technical"),
            ),
            judgement=SustainabilityJudgement(
                policy=configuration.string("analysis.judgement.policy"),
                take_on_threshold=configuration.number(
                    "analysis.judgement.take_on_threshold", minimum=0.0, maximum=1.0
                ),
                ai=load_analysis_sustainability_ai(configuration, "analysis.judgement"),
            ),
            points=FunctionalPoints(
                policy=configuration.string("analysis.points.policy"),
                ai=load_functional_points_ai(configuration, "analysis.points"),
            ),
        ),
    )


def load_settings() -> Settings:
    bootstrap = read_bootstrap()
    return settings_from(read_configuration(SUBSYSTEM, bootstrap).document, bootstrap)
