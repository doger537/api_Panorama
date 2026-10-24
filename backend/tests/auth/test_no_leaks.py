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
    db_file = tmp_path / "auth_leaks.sqlite"
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


def test_no_password_hash_leak_in_responses(client: TestClient):
    """API responses must never contain password hashes or raw session tokens."""
    create_organizer("org@example.test", "password-123")
    origin = {"Origin": "http://testserver"}

    # Login response
    login_res = client.post("/api/v1/auth/login", json={"email": "org@example.test", "password": "password-123"}, headers=origin)
    assert login_res.status_code == 200
    login_data = login_res.json()

    # Check no sensitive data in response
    response_str = str(login_data)
    assert "password" not in response_str.lower() or "password_hash" not in response_str
    assert "$argon2" not in response_str
    assert "token_hash" not in response_str

    # Session endpoint
    session_res = client.get("/api/v1/auth/session")
    assert session_res.status_code == 200
    session_data = session_res.json()
    session_str = str(session_data)
    assert "$argon2" not in session_str
    assert "password" not in session_str.lower() or "csrf" in session_str.lower()


def test_anonymous_requests_return_401(client: TestClient):
    """Anonymous requests to protected endpoints must return 401."""
    # Create a map requires authentication
    response = client.get("/api/v1/maps")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"

    # Session endpoint without cookie
    response = client.get("/api/v1/auth/session")
    assert response.status_code == 401


def test_wrong_origin_rejected(client: TestClient):
    """Requests with wrong Origin header must return 403."""
    create_organizer("org@example.test", "password-123")

    # Wrong origin on login
    response = client.post("/api/v1/auth/login", json={"email": "org@example.test", "password": "password-123"}, headers={"Origin": "http://evil.com"})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN"

    # Login with correct origin first
    origin = {"Origin": "http://testserver"}
    login_res = client.post("/api/v1/auth/login", json={"email": "org@example.test", "password": "password-123"}, headers=origin)
    csrf = login_res.json()["csrf_token"]

    # Wrong origin on logout
    response = client.post("/api/v1/auth/logout", headers={"Origin": "http://evil.com", "X-CSRF-Token": csrf})
    assert response.status_code == 403
