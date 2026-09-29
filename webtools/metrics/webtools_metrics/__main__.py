"""Starting the server.

In the background: `./webtools_metrics.sh --start` (from webtools/metrics).
In the foreground, for debugging, with the variables of
webtools/configurator/bootstrap.env in the environment:
`uv run python -m webtools_metrics`.

Everything comes from the configuration in anagraphics (see settings.py). If
anything is missing the server does not start.
"""

import sys

import uvicorn

from webtools_metrics.commons.configuration_client import ConfigurationError

if __name__ == "__main__":
    try:
        from webtools_metrics.main import app, settings
    except ConfigurationError as error:
        print(f"webtools_metrics is not starting: {error}", file=sys.stderr)
        sys.exit(1)
    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        # The IP pool must see the connection's real IP: no rewriting from
        # X-Forwarded-For / X-Forwarded-Proto.
        proxy_headers=False,
    )
