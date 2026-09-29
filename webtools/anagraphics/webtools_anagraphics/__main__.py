"""Starting the server.

In the background: `./webtools_anagraphics.sh --start` (from webtools/anagraphics).
In the foreground, for debugging, with the variables of
webtools/configurator/bootstrap.env in the environment:
`uv run python -m webtools_anagraphics`.

Host and port come from WEBTOOLS_ANAGRAPHICS_URL, everything else from the
configuration in Mongo (see settings.py). If anything is missing the server does
not start.
"""

import sys

import uvicorn

from webtools_anagraphics.settings import ConfigurationError

if __name__ == "__main__":
    try:
        from webtools_anagraphics.main import app, settings
    except ConfigurationError as error:
        print(f"webtools_anagraphics is not starting: {error}", file=sys.stderr)
        sys.exit(1)
    # It started: the configuration was there and was whole. The other two outcomes
    # the vocabulary allows cannot be sent from here — a subsystem that could not read
    # its configuration has no metrics client to say so with, because the client is
    # built out of that same configuration.
    settings.metrics.measure("process.started", dims={"outcome": "ok"})
    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        # The IP pool must see the connection's real IP: no rewriting from
        # X-Forwarded-For / X-Forwarded-Proto.
        proxy_headers=False,
    )
