"""The door: the question, and which provider is asked it.

Everything about this door that is not a provider's business lives here — which
provider is in use, how long we wait, how many times we ask again — and everything that
is a provider's business lives in its adapter, which is the only file allowed to name
it.

The registry is a list written out, not a module loaded by name from the configuration:
a configuration that could name any file on disk is a different thing from a
configuration that chooses between the providers this door has. And it is **this
door's** registry, separate from the other three: this is the door that decides what gets built at all, and it is asked once
per build. A model that plans well and writes indifferently, or the other way round, is a
reason to move this one and leave the others where they are.
"""

from dataclasses import dataclass

from webtools_developer.commons.configuration_client import ConfigurationError
from webtools_developer.build_plan_ai import contract
from webtools_developer.build_plan_ai.providers import anthropic

PROVIDERS = {anthropic.NAME: anthropic}


@dataclass(frozen=True)
class Door:
    provider: str
    # How long we wait for one attempt. Shared by every provider, because it is not a
    # fact about the provider: it is how long we are prepared to wait.
    timeout_ms: int
    # How many times we ask again, at most. Ours and not the SDK's, so that the number
    # of attempts is a fact we can report.
    max_attempts: int
    # The fields only the chosen provider understands, read only by its adapter.
    configuration: dict


def load_build_plan_ai(configuration, base: str) -> Door:
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
        # Only the chosen provider's section is read. A section belonging to a provider
        # that is not in use is never looked at, so it can be incomplete, or
        # half-written, without stopping the subsystem.
        configuration=PROVIDERS[provider].read_configuration(configuration, base),
    )


def plan(ai: Door, **asked) -> dict:
    """Ask this door's question, and check the answer against the contract.

    `check` runs here rather than at the call sites: an adapter that drifts is caught at
    the boundary, once, instead of three files downstream.

    The arguments are passed through as they come, because what this door sends is the
    contract's business and not this function's: a list written out here would be a
    second copy of the contract, and the two would disagree the first time one of them
    changed.
    """
    module = PROVIDERS.get(ai.provider)
    if module is None:
        # The configuration was checked at startup, so this is a provider removed from
        # the registry while the subsystem was running. It is still an answer in the
        # contract's words, not an exception thrown at whoever asked.
        return contract.no_answer(provider=ai.provider, failure="unknown_provider")
    return contract.check(module.plan(ai, **asked))
