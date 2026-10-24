from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from backend.app.db import SCHEMA_PATH, connect


@pytest.fixture()
def database_path(tmp_path: Path) -> Path:
    path = tmp_path / "ttkmap.sqlite"
    connection = connect(path)
    connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    connection.close()
    return path


@pytest.fixture()
def db(database_path: Path):
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    yield connection
    connection.close()
