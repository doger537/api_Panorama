from __future__ import annotations

from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from backend.app.auth import clear_login_failures, create_organizer
from backend.app.config import settings
from backend.app.db import initialize_database
from backend.app.main import create_app
from scripts.seed_demo import make_png_bytes


@pytest.fixture()
def client(tmp_path: Path):
    db_file = tmp_path / "capture_test.sqlite"
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


def test_capture_idempotent_upload_stitch_and_cancel(client: TestClient):
    create_organizer("org@example.test", "valid-password-123")
    origin = {"Origin": "http://testserver"}
    login = client.post("/api/v1/auth/login", json={"email": "org@example.test", "password": "valid-password-123"}, headers=origin)
    headers = {**origin, "X-CSRF-Token": login.json()["csrf_token"]}
    created = client.post("/api/v1/maps", json={"title": "M", "description": "", "width_units": 500, "height_units": 500, "scale_m_per_unit": None, "max_walk_gap_units": 100}, headers=headers)
    map_id = created.json()["snapshot"]["id"]

    cap = client.post(f"/api/v1/maps/{map_id}/captures", json={"title": "Cap", "x": 100, "y": 100, "hfov_hint_deg": 60}, headers=headers).json()
    cap_id = cap["id"]

    # Incomplete stitch rejected with 422
    assert client.post(f"/api/v1/maps/{map_id}/captures/{cap_id}/stitch", headers=headers).status_code == 422

    # Upload all 16 frames
    for idx in range(16):
        img = make_png_bytes(200, 300, (idx * 10, 100, 150))
        res = client.put(f"/api/v1/maps/{map_id}/captures/{cap_id}/frames/{idx}", files={"file": (f"f{idx}.png", img, "image/png")}, headers=headers)
        assert res.status_code == 200

    # Submit stitch -> 202 queued
    st = client.post(f"/api/v1/maps/{map_id}/captures/{cap_id}/stitch", headers=headers)
    assert st.status_code == 202
    assert st.json()["state"] == "queued"
    assert st.json()["attempt"] == 1
