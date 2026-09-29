"""Which kinds of token each provider counts.

**Nothing here knows who the provider is.** Two providers do not count the same
kinds: one has a cache it writes and a cache it reads, another has not, another
counts reasoning apart, another an image. So the configuration says, per provider,
which kinds that provider reports:

    "providers": {
      "<provider>": { "token_kinds": ["input", "output", …] }
    }

The kinds are **not** a list in this file. A kind of token this code has never
heard of is counted all the same, and the day a provider reports one, the answer
is a line of configuration, not a release.

What the declaration is for: a measurement may carry these kinds and no others. A
kind nobody declared would be a sum that grows in a corner and is never read,
which is how a typo becomes data.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Providers:
    """The providers as the configuration describes them: a name, and what it
    counts."""

    kinds: dict[str, frozenset[str]]

    def knows(self, provider: str | None) -> bool:
        return provider in self.kinds

    def token_kinds(self, provider: str | None) -> frozenset[str]:
        return self.kinds.get(provider, frozenset())


def read_providers(configuration) -> Providers:
    """The declaration from the configuration.

    An empty declaration is legitimate: no provider is counted yet, and the first
    measurement carrying tokens is refused by name until one is declared. What is
    refused here is a declaration that is there and is not one: those are
    mistakes, not silences, and they must not start the server.
    """
    declared: dict[str, frozenset[str]] = {}
    for name, described in configuration.mapping("providers").items():
        if not isinstance(described, dict):
            raise _error(f"providers.{name} is not an object: {described!r}")
        kinds = described.get("token_kinds")
        if (
            not isinstance(kinds, list)
            or not kinds
            or not all(isinstance(kind, str) and kind for kind in kinds)
        ):
            raise _error(
                f"providers.{name}.token_kinds is not a non-empty list of names: {kinds!r}"
            )
        declared[name] = frozenset(kinds)
    return Providers(kinds=declared)


def _error(message: str):
    from webtools_metrics.commons.configuration_client import ConfigurationError

    return ConfigurationError(f"configuration of metrics: {message}")
