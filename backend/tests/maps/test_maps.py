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
    db_file = tmp_path / "maps.sqlite"
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


def test_map_domain_validation_and_publish_gate(client: TestClient):
    create_organizer("org@example.test", "valid-password-123")
    origin = {"Origin": "http://testserver"}
    login = client.post("/api/v1/auth/login", json={"email": "org@example.test", "password": "valid-password-123"}, headers=origin)
    csrf = login.json()["csrf_token"]
    headers = {**origin, "X-CSRF-Token": csrf}

    created = client.post(
        "/api/v1/maps",
        json={"title": "Test", "description": "", "width_units": 100, "height_units": 100, "scale_m_per_unit": 1.0, "max_walk_gap_units": 50},
        headers=headers,
    )
    map_id = created.json()["snapshot"]["id"]
    etag = created.headers["ETag"]

    # Publish without POI -> 422 PUBLISH_BLOCKED
    empty_pub = {
        "title": "Test", "description": "", "is_published": True, "scale_m_per_unit": 1.0, "max_walk_gap_units": 50,
        "background_asset_id": None, "shapes": [], "nodes": [], "edges": [], "pois": [], "panoramas": [], "hotspots": [],
    }
    res_pub = client.put(f"/api/v1/maps/{map_id}/document", json=empty_pub, headers={**headers, "If-Match": etag})
    assert res_pub.status_code == 422
    assert res_pub.json()["error"]["code"] == "PUBLISH_BLOCKED"

    # Out of bounds POI -> 422 VALIDATION_ERROR and revision stays 1
    out_of_bounds = {
        **empty_pub,
        "is_published": False,
        "pois": [{"id": "00000000-0000-4000-8000-000000000001", "title": "POI", "category": "wifi", "category_label": None, "description": "", "x": 250, "y": 50, "nav_node_id": None}],
    }
    res_oob = client.put(f"/api/v1/maps/{map_id}/document", json=out_of_bounds, headers={**headers, "If-Match": etag})
    assert res_oob.status_code == 422
    assert res_oob.json()["error"]["code"] == "VALIDATION_ERROR"
    assert client.get(f"/api/v1/maps/{map_id}").json()["snapshot"]["revision"] == 1
