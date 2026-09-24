"""The format of a user's `credential` block.

Here a password is **built**, not verified: the one who verifies is the sso. This
module exists so that the format stored in the database is written in one place
only, and so that the script that sets a password does not invent it each time.

The block stored in `users.credential`:

    {
      "algorithm": "scrypt",
      "params": {"n": 16384, "r": 8, "p": 1, "dklen": 32},
      "salt": "<base64>",
      "hash": "<base64>",
      "updated_at": <data>
    }

The parameters live inside the document, not implicitly in the code: the day they
are raised, old passwords stay verifiable with their own.

`scrypt` is in the standard library of both Python and Node (`crypto`): no extra
dependency either here or in the sso, and exactly the same computation on both
sides.
"""

import base64
import hashlib
import os
from datetime import datetime, timezone

ALGORITHM = "scrypt"
PARAMS = {"n": 16384, "r": 8, "p": 1, "dklen": 32}
# 128 * n * r = 16 MB: the limit has to be raised above the OpenSSL default.
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
