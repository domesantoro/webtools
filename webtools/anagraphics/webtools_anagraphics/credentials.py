"""Formato del blocco `credential` di un utente.

Qui la password si **costruisce**, non si verifica: chi verifica è il sso. Questo
modulo esiste perché il formato conservato nel database sia scritto in un posto
solo, e perché lo script che imposta una password non se lo inventi ogni volta.

Il blocco conservato in `users.credential`:

    {
      "algorithm": "scrypt",
      "params": {"n": 16384, "r": 8, "p": 1, "dklen": 32},
      "salt": "<base64>",
      "hash": "<base64>",
      "updated_at": <data>
    }

I parametri sono dentro il documento, non impliciti nel codice: il giorno che si
alzano, le password vecchie restano verificabili con i propri.

`scrypt` sta nella libreria standard di Python e in quella di Node (`crypto`):
nessuna dipendenza in più né qui né nel sso, e lo stesso identico calcolo dalle
due parti.
"""

import base64
import hashlib
import os
from datetime import datetime, timezone

ALGORITHM = "scrypt"
PARAMS = {"n": 16384, "r": 8, "p": 1, "dklen": 32}
# 128 * n * r = 16 MB: il limite va alzato sopra il default di OpenSSL.
MAXMEM = 64 * 1024 * 1024
SALT_BYTES = 16


def build_credential(password: str) -> dict:
    salt = os.urandom(SALT_BYTES)
    digest = hashlib.scrypt(
        password.encode("utf-8"), salt=salt, maxmem=MAXMEM, **PARAMS
    )
    return {
        "algorithm": ALGORITHM,
        "params": dict(PARAMS),
        "salt": base64.b64encode(salt).decode("ascii"),
        "hash": base64.b64encode(digest).decode("ascii"),
        "updated_at": datetime.now(timezone.utc),
    }
