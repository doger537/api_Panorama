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
    db_file = tmp_path / "auth.sqlite"
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


def test_login_logout_csrf_origin_and_rate_limit(client: TestClient):
    create_organizer("org1@example.test", "valid-password-123")
    create_organizer("org2@example.test", "valid-password-456")
    origin = {"Origin": "http://testserver"}

    # Missing/wrong origin -> 403
    assert client.post("/api/v1/auth/login", json={"email": "org1@example.test", "password": "valid-password-123"}).status_code == 403
    assert client.post("/api/v1/auth/login", json={"email": "org1@example.test", "password": "valid-password-123"}, headers={"Origin": "http://evil.com"}).status_code == 403

    # Identical error on wrong email vs wrong password
    r1 = client.post("/api/v1/auth/login", json={"email": "unknown@example.test", "password": "valid-password-123"}, headers=origin)
    r2 = client.post("/api/v1/auth/login", json={"email": "org1@example.test", "password": "wrong-password-123"}, headers=origin)
    assert r1.status_code == 401 and r2.status_code == 401
    assert r1.json()["error"]["code"] == "INVALID_CREDENTIALS"
    assert r1.json()["error"]["message"] == r2.json()["error"]["message"]

    # Login org1 and create a map
    clear_login_failures()
    login1 = client.post("/api/v1/auth/login", json={"email": "org1@example.test", "password": "valid-password-123"}, headers=origin)
    assert login1.status_code == 200
    csrf1 = login1.json()["csrf_token"]
    session_data = login1.json()
    assert "password" not in str(session_data)
    assert "token" not in str(session_data) or "csrf_token" in str(session_data)

    map_res = client.post(
        "/api/v1/maps",
        json={"title": "Org1 Map", "description": "", "width_units": 500, "height_units": 500, "scale_m_per_unit": None, "max_walk_gap_units": 100},
        headers={**origin, "X-CSRF-Token": csrf1},
    )
    assert map_res.status_code == 201
    map_id = map_res.json()["snapshot"]["id"]

    # Missing CSRF -> 403
    assert client.post("/api/v1/auth/logout", headers=origin).status_code == 403

    # Wrong CSRF -> 403
    assert client.post("/api/v1/auth/logout", headers={**origin, "X-CSRF-Token": "wrong-token"}).status_code == 403

    # Login org2 -> cannot access org1's map (404)
    login2 = client.post("/api/v1/auth/login", json={"email": "org2@example.test", "password": "valid-password-456"}, headers=origin)
    assert login2.status_code == 200
    csrf2 = login2.json()["csrf_token"]
    assert client.get(f"/api/v1/maps/{map_id}").status_code == 404

    # Logout revokes session
    assert client.post("/api/v1/auth/logout", headers={**origin, "X-CSRF-Token": csrf2}).status_code == 204
    assert client.get("/api/v1/auth/session").status_code == 401

    # Rate limit after 5 failures by email
    clear_login_failures()
    for _ in range(5):
        res = client.post("/api/v1/auth/login", json={"email": "org1@example.test", "password": "wrong-password-123"}, headers=origin)
        assert res.status_code == 401
    blocked = client.post("/api/v1/auth/login", json={"email": "org1@example.test", "password": "valid-password-123"}, headers=origin)
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "RATE_LIMITED"

    # Rate limit by IP affects all accounts
    clear_login_failures()
    for _ in range(5):
        res = client.post("/api/v1/auth/login", json={"email": "org1@example.test", "password": "wrong-password-123"}, headers=origin)
        assert res.status_code == 401
    blocked_other = client.post("/api/v1/auth/login", json={"email": "org2@example.test", "password": "valid-password-456"}, headers=origin)
    assert blocked_other.status_code == 429
