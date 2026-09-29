"""The door: the question, and which provider is asked it.

Everything about this door that is not a provider's business lives here — which
provider is in use, how long we wait, how many times we ask again — and everything
that is a provider's business lives in its adapter, which is the only file allowed to
name it.

The registry is a list written out, not a module loaded by name from the
configuration: a configuration that could name any file on disk is a different thing
from a configuration that chooses between the providers this door has. And it is
**this door's** registry: adding a provider here does not add it to the technical
analysis' door, which is the point of contracts not being shared. The judgement may
well end up on a different model from the analysis it judges — a second opinion from
the same model is a weaker second opinion — and that has to be a line of
configuration, not a piece of work.
"""

from dataclasses import dataclass

from webtools_analyst.analysis_sustainability_ai import contract
from webtools_analyst.analysis_sustainability_ai.providers import anthropic
from webtools_analyst.commons.configuration_client import ConfigurationError

PROVIDERS = {anthropic.NAME: anthropic}


@dataclass(frozen=True)
class Door:
    provider: str
    # How long we wait for one attempt. Shared by every provider, because it is not a
    # fact about the provider: it is how long we are prepared to wait.
    timeout_ms: int
    # How many times we ask again, at most. Ours and not the SDK's, so that the
    # number of attempts is a fact we can report.
    max_attempts: int
    # The fields only the chosen provider understands, read only by its adapter.
    configuration: dict


def load_analysis_sustainability_ai(configuration, base: str) -> Door:
    """The door's settings, from the branch of the configuration it was pointed at.

    `base` is said by the caller and never assumed here: the same door could be
    configured twice under two names, and a module that guessed its own branch would
    make that impossible.
    """
    provider = configuration.string(f"{base}.provider")
    if provider not in PROVIDERS:
        raise ConfigurationError(
            f"configuration of {configuration.subsystem}: {base}.provider must be one of "
            f"{', '.join(sorted(PROVIDERS))}, found {provider!r}"
        )
    return Door(
        provider=provider,
        timeout_ms=configuration.integer(f"{base}.timeout_ms"),
        max_attempts=configuration.integer(f"{base}.max_attempts"),
        # Only the chosen provider's section is read. A section belonging to a
        # provider that is not in use is never looked at, so it can be incomplete, or
        # half-written, without stopping the subsystem.
        configuration=PROVIDERS[provider].read_configuration(configuration, base),
    )


def judge(ai: Door, *, instructions: str, material, analysis: str, request: str, schema: dict) -> dict:
    """Ask this door's question, and check the answer against the contract.

    `check` runs here rather than at the call sites: an adapter that drifts is caught
    at the boundary, once, instead of three files downstream.
    """
    module = PROVIDERS.get(ai.provider)
    if module is None:
        # The configuration was checked at startup, so this is a provider removed
        # from the registry while the subsystem was running. It is still an answer in
        # the contract's words, not an exception thrown at whoever asked.
        return contract.no_answer(provider=ai.provider, failure="unknown_provider")
    return contract.check(
        module.judge(
            ai,
            instructions=instructions,
            material=material,
            analysis=analysis,
            request=request,
            schema=schema,
        )
    )
