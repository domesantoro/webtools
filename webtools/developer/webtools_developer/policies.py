"""The policies, read off the copies the deployer put here.

A policy is what a model is asked to do: it is configuration and not code, it lives in
`webtools/configurator/policies/`, and the subsystem gets a generated copy
(`webtools/configurator/documents_deployer/deploy.sh`). Which policy a door uses is
said by that door's configuration, so a policy rewritten or replaced by a new version
costs no code here.

Cached for the life of the process, which is what the subsystems next door do: a policy
changes by being edited in the configurator and redeployed, and a deploy is followed by
a restart. It is also what makes the prefix of every call identical, which is what
makes it worth caching at the provider — a policy read again per call would be the same
bytes, but nothing else about it would change.

The leading HTML comment is stripped: the deployer writes a warning at the top of every
copy saying not to edit it there, and that warning is for whoever opens the file, not
for the model.
"""

import re
from pathlib import Path

POLICIES = Path(__file__).resolve().parent.parent / "policies"

_BANNER = re.compile(r"^\s*<!--[\s\S]*?-->\s*")
_read: dict[str, str] = {}


def read(name: str) -> str:
    if name not in _read:
        text = (POLICIES / f"{name}.md").read_text(encoding="utf-8")
        _read[name] = _BANNER.sub("", text)
    return _read[name]
