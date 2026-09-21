"""Avvio del server.

In background: `./anagraphics.sh start` (dalla cartella webtools/anagraphics).
In primo piano, per debug: `uv run python -m webtools_anagraphics`.
"""

import os

import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "webtools_anagraphics.main:app",
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "8100")),
        # Il pool di IP deve vedere l'IP reale della connessione:
        # niente riscrittura da X-Forwarded-For / X-Forwarded-Proto.
        proxy_headers=False,
    )
