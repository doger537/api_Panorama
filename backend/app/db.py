from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from backend.app.config import settings


SCHEMA_PATH = Path(__file__).resolve().parents[2] / "CONTRACTS" / "db_schema.sql"
SCHEMA_VERSION = 1


def connect(database_path: Path | str | None = None) -> sqlite3.Connection:
    path = Path(database_path) if database_path is not None else settings.database_path
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=5.0, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 5000")
    connection.execute("PRAGMA journal_mode = WAL")
    return connection


@contextmanager
def transaction(connection: sqlite3.Connection, *, immediate: bool = False) -> Iterator[sqlite3.Connection]:
    connection.execute("BEGIN IMMEDIATE" if immediate else "BEGIN")
    try:
        yield connection
    except BaseException:
        connection.rollback()
        raise
    else:
        connection.commit()


def initialize_database(database_path: Path | str | None = None) -> None:
    connection = connect(database_path)
    try:
        version = int(connection.execute("PRAGMA user_version").fetchone()[0])
        existing = connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1"
        ).fetchone()
        if existing:
            if version != SCHEMA_VERSION:
                raise RuntimeError(
                    f"Database already contains tables at schema version {version}; "
                    "back up and run an explicit migration."
                )
            return
        if not SCHEMA_PATH.is_file():
            raise FileNotFoundError(f"TTKMap schema not found: {SCHEMA_PATH}")
        connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    finally:
        connection.close()


@contextmanager
def database(database_path: Path | str | None = None) -> Iterator[sqlite3.Connection]:
    connection = connect(database_path)
    try:
        yield connection
    finally:
        connection.close()
