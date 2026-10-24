from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    app_origin: str
    database_path: Path
    media_path: Path
    cookie_secure: bool
    session_ttl_seconds: int

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            app_origin=os.getenv("APP_ORIGIN", "http://127.0.0.1:8000").rstrip("/"),
            database_path=Path(os.getenv("DATABASE_PATH", "data/ttkmap.sqlite")).resolve(),
            media_path=Path(os.getenv("MEDIA_PATH", "data/media")).resolve(),
            cookie_secure=os.getenv("COOKIE_SECURE", "false").lower() in {"1", "true", "yes"},
            session_ttl_seconds=int(os.getenv("SESSION_TTL_SECONDS", "43200")),
        )


settings = Settings.from_env()
