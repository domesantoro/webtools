"""Avvio del server.

In background: `./webtools_anagraphics.sh --start` (dalla cartella webtools/anagraphics).
In primo piano, per debug, con le variabili di webtools/configurator/bootstrap.env
nell'ambiente: `uv run python -m webtools_anagraphics`.

Indirizzo e porta vengono da WEBTOOLS_ANAGRAPHICS_URL, il resto dalla
configurazione in Mongo (vedi settings.py). Se manca qualcosa il server non parte.
"""

import sys

import uvicorn

from webtools_anagraphics.settings import ConfigurationError

if __name__ == "__main__":
    try:
        from webtools_anagraphics.main import app, settings
    except ConfigurationError as error:
        print(f"webtools_anagraphics non parte: {error}", file=sys.stderr)
        sys.exit(1)
    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        # Il pool di IP deve vedere l'IP reale della connessione:
        # niente riscrittura da X-Forwarded-For / X-Forwarded-Proto.
        proxy_headers=False,
    )
