from __future__ import annotations

from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from backend.app.auth import clear_login_failures, create_organizer
from backend.app.config import settings
from backend.app.db import initialize_database
from backend.app.main import create_app


@pytest.fixture()
def client(tmp_path: Path):
    db_file = tmp_path / "auth_ownership.sqlite"
    media_dir = tmp_path / "media"
    orig_db, orig_media, orig_origin = settings.database_path, settings.media_path, settings.app_origin
    object.__setattr__(settings, "database_path", db_file)
    object.__setattr__(settings, "media_path", media_dir)
    object.__setattr__(settings, "app_origin", "http://testserver")
    try:
        clear_login_failures()
        initialize_database(db_file)
        media_dir.mkdir(parents=True, exist_ok=True)
        with TestClient(create_app()) as c:
            yield c
    finally:
        object.__setattr__(settings, "database_path", orig_db)
        object.__setattr__(settings, "media_path", orig_media)
        object.__setattr__(settings, "app_origin", orig_origin)


def test_owner_check_on_nested_resources(client: TestClient):
    """Organizer A cannot access organizer B's map or nested resources."""
    create_organizer("org1@example.test", "password-123")
    create_organizer("org2@example.test", "password-456")
    origin = {"Origin": "http://testserver"}

    # Org1 creates a map
    login1 = client.post("/api/v1/auth/login", json={"email": "org1@example.test", "password": "password-123"}, headers=origin)
    csrf1 = login1.json()["csrf_token"]

    map_res = client.post(
        "/api/v1/maps",
        json={"title": "Org1 Map", "description": "", "width_units": 500, "height_units": 500, "scale_m_per_unit": None, "max_walk_gap_units": 100},
        headers={**origin, "X-CSRF-Token": csrf1},
    )
    assert map_res.status_code == 201
    map_id = map_res.json()["snapshot"]["id"]

    # Org2 logs in and tries to access org1's map
    login2 = client.post("/api/v1/auth/login", json={"email": "org2@example.test", "password": "password-456"}, headers=origin)
    assert login2.status_code == 200
    csrf2 = login2.json()["csrf_token"]

    # GET map -> 404 (not revealing existence)
    response = client.get(f"/api/v1/maps/{map_id}")
    assert response.status_code == 404

    # List maps should not show org1's map
    maps = client.get("/api/v1/maps")
    assert maps.status_code == 200
    assert len(maps.json()) == 0
    assert not any(m["id"] == map_id for m in maps.json())


def test_two_organizers_isolated(client: TestClient):
    """Two organizers have completely isolated map lists."""
    create_organizer("org1@example.test", "password-123")
    create_organizer("org2@example.test", "password-456")
    origin = {"Origin": "http://testserver"}

    # Org1 creates a map
    login1 = client.post("/api/v1/auth/login", json={"email": "org1@example.test", "password": "password-123"}, headers=origin)
    csrf1 = login1.json()["csrf_token"]
    client.post(
        "/api/v1/maps",
        json={"title": "Org1 Map", "description": "", "width_units": 500, "height_units": 500, "scale_m_per_unit": None, "max_walk_gap_units": 100},
        headers={**origin, "X-CSRF-Token": csrf1},
    )

    # Org1 sees 1 map
    maps1 = client.get("/api/v1/maps")
    assert maps1.status_code == 200
    assert len(maps1.json()) == 1

    # Org2 logs in
    login2 = client.post("/api/v1/auth/login", json={"email": "org2@example.test", "password": "password-456"}, headers=origin)
    csrf2 = login2.json()["csrf_token"]

    # Org2 sees 0 maps
    maps2 = client.get("/api/v1/maps")
    assert maps2.status_code == 200
    assert len(maps2.json()) == 0

    # Org2 creates their own map
    client.post(
        "/api/v1/maps",
        json={"title": "Org2 Map", "description": "", "width_units": 300, "height_units": 300, "scale_m_per_unit": None, "max_walk_gap_units": 50},
        headers={**origin, "X-CSRF-Token": csrf2},
    )

    # Org2 sees 1 map (their own)
    maps2_after = client.get("/api/v1/maps")
    assert maps2_after.status_code == 200
    assert len(maps2_after.json()) == 1
    assert maps2_after.json()[0]["title"] == "Org2 Map"
