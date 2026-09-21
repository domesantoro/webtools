"""Impostazioni lette dalle variabili d'ambiente, con default per lo sviluppo locale."""

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    mongo_uri: str
    mongo_db: str
    allowed_ips: frozenset[str]


def load_settings() -> Settings:
    allowed = os.environ.get("ALLOWED_IPS", "127.0.0.1,::1")
    return Settings(
        mongo_uri=os.environ.get("MONGO_URI", "mongodb://localhost:27017"),
        mongo_db=os.environ.get("MONGO_DB", "webtools"),
        allowed_ips=frozenset(ip.strip() for ip in allowed.split(",") if ip.strip()),
    )
