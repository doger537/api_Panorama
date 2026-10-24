from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from backend.app.auth import clear_login_failures, create_organizer, create_session
from backend.app.config import settings
from backend.app.db import database, initialize_database
from backend.app.main import create_app


@pytest.fixture()
def client(tmp_path: Path):
    db_file = tmp_path / "auth_expiry.sqlite"
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


def test_expired_session_rejected(client: TestClient):
    """Expired sessions must return 401."""
    user_id = create_organizer("org@example.test", "password-123")
    token, csrf_token, expires_at = create_session(user_id)

    # Manually expire the session
    past_time = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat().replace("+00:00", "Z")
    with database() as conn:
        conn.execute("UPDATE sessions SET expires_at=? WHERE user_id=?", (past_time, user_id))

    # Set the cookie and try to access protected endpoint
    client.cookies.set("ttk_session", token)
    response = client.get("/api/v1/auth/session")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"


def test_logout_revokes_session_immediately(client: TestClient):
    """After logout, the session must not work even if not expired."""
    create_organizer("org@example.test", "password-123")
    origin = {"Origin": "http://testserver"}

    login_res = client.post("/api/v1/auth/login", json={"email": "org@example.test", "password": "password-123"}, headers=origin)
    assert login_res.status_code == 200
    csrf = login_res.json()["csrf_token"]

    # Verify session works
    assert client.get("/api/v1/auth/session").status_code == 200

    # Logout
    logout_res = client.post("/api/v1/auth/logout", headers={**origin, "X-CSRF-Token": csrf})
    assert logout_res.status_code == 204

    # Session must be revoked
    assert client.get("/api/v1/auth/session").status_code == 401
