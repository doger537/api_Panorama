from __future__ import annotations

from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from backend.app.auth import clear_login_failures, create_organizer
from backend.app.config import settings
from backend.app.db import database, initialize_database
from backend.app.main import create_app


@pytest.fixture()
def client(tmp_path: Path):
    db_file = tmp_path / "conflicts.sqlite"
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


def test_poi_hotspot_synchronization(client: TestClient):
    """Hotspots must reference valid POIs and panoramas from the same map."""
    create_organizer("org@example.test", "password-123")
    origin = {"Origin": "http://testserver"}
    login = client.post("/api/v1/auth/login", json={"email": "org@example.test", "password": "password-123"}, headers=origin)
    csrf = login.json()["csrf_token"]
    headers = {**origin, "X-CSRF-Token": csrf}

    created = client.post(
        "/api/v1/maps",
        json={"title": "Test", "description": "", "width_units": 100, "height_units": 100, "scale_m_per_unit": 1.0, "max_walk_gap_units": 50},
        headers=headers,
    )
    map_id = created.json()["snapshot"]["id"]
    etag = created.headers["ETag"]

    # Create assets
    with database() as conn:
        asset_id = "00000000-0000-4000-8000-000000000001"
        conn.execute(
            "INSERT INTO assets(id,map_id,kind,source,width_px,height_px,projection,haov_deg,vaov_deg,v_offset_deg,preview_key,mobile_key,full_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (asset_id, map_id, "panorama", "upload", 4096, 2048, "equirectangular", 360, 180, 0, f"{asset_id}/preview", f"{asset_id}/mobile", f"{asset_id}/full")
        )

    # Hotspot references non-existent POI
    doc = {
        "title": "Test", "description": "", "is_published": False, "scale_m_per_unit": 1.0, "max_walk_gap_units": 50,
        "background_asset_id": None, "shapes": [], "nodes": [], "edges": [],
        "pois": [{"id": "00000000-0000-4000-8000-000000000002", "title": "POI", "category": "wifi", "category_label": None, "description": "", "x": 50, "y": 50, "nav_node_id": None}],
        "panoramas": [{"id": "00000000-0000-4000-8000-000000000003", "asset_id": asset_id, "title": "Pano", "x": 50, "y": 50, "nav_node_id": None, "heading_offset_deg": 0}],
        "hotspots": [{
            "id": "00000000-0000-4000-8000-000000000004",
            "panorama_id": "00000000-0000-4000-8000-000000000003",
            "kind": "poi",
            "yaw_deg": 0,
            "pitch_deg": 0,
            "poi_id": "00000000-0000-4000-8000-999999999999",  # Non-existent
            "target_panorama_id": None
        }],
    }
    res = client.put(f"/api/v1/maps/{map_id}/document", json=doc, headers={**headers, "If-Match": etag})
    assert res.status_code == 422


def test_version_conflict_412(client: TestClient):
    """Concurrent editors trigger 412 with stale If-Match."""
    create_organizer("org@example.test", "password-123")
    origin = {"Origin": "http://testserver"}
    login = client.post("/api/v1/auth/login", json={"email": "org@example.test", "password": "password-123"}, headers=origin)
    csrf = login.json()["csrf_token"]
    headers = {**origin, "X-CSRF-Token": csrf}

    created = client.post(
        "/api/v1/maps",
        json={"title": "Test", "description": "", "width_units": 100, "height_units": 100, "scale_m_per_unit": 1.0, "max_walk_gap_units": 50},
        headers=headers,
    )
    map_id = created.json()["snapshot"]["id"]
    etag_v1 = created.headers["ETag"]

    # First save
    doc1 = {
        "title": "Update 1", "description": "", "is_published": False, "scale_m_per_unit": 1.0, "max_walk_gap_units": 50,
        "background_asset_id": None, "shapes": [], "nodes": [], "edges": [],
        "pois": [{"id": "00000000-0000-4000-8000-000000000001", "title": "POI1", "category": "wifi", "category_label": None, "description": "", "x": 10, "y": 10, "nav_node_id": None}],
        "panoramas": [], "hotspots": [],
    }
    res1 = client.put(f"/api/v1/maps/{map_id}/document", json=doc1, headers={**headers, "If-Match": etag_v1})
    assert res1.status_code == 200
    assert res1.json()["snapshot"]["revision"] == 2

    # Try to save with stale ETag
    doc2 = {
        "title": "Update 2", "description": "", "is_published": False, "scale_m_per_unit": 1.0, "max_walk_gap_units": 50,
        "background_asset_id": None, "shapes": [], "nodes": [], "edges": [],
        "pois": [{"id": "00000000-0000-4000-8000-000000000002", "title": "POI2", "category": "wifi", "category_label": None, "description": "", "x": 20, "y": 20, "nav_node_id": None}],
        "panoramas": [], "hotspots": [],
    }
    res2 = client.put(f"/api/v1/maps/{map_id}/document", json=doc2, headers={**headers, "If-Match": etag_v1})
    assert res2.status_code == 412
    assert res2.json()["error"]["code"] == "VERSION_CONFLICT"
    assert res2.json()["error"]["current_revision"] == 2


def test_atomic_rollback_on_validation_error(client: TestClient):
    """If validation fails, no rows are changed and revision stays the same."""
    create_organizer("org@example.test", "password-123")
    origin = {"Origin": "http://testserver"}
    login = client.post("/api/v1/auth/login", json={"email": "org@example.test", "password": "password-123"}, headers=origin)
    csrf = login.json()["csrf_token"]
    headers = {**origin, "X-CSRF-Token": csrf}

    created = client.post(
        "/api/v1/maps",
        json={"title": "Test", "description": "", "width_units": 100, "height_units": 100, "scale_m_per_unit": 1.0, "max_walk_gap_units": 50},
        headers=headers,
    )
    map_id = created.json()["snapshot"]["id"]
    etag = created.headers["ETag"]

    # Valid document first
    valid_doc = {
        "title": "Valid", "description": "", "is_published": False, "scale_m_per_unit": 1.0, "max_walk_gap_units": 50,
        "background_asset_id": None, "shapes": [], "nodes": [], "edges": [],
        "pois": [{"id": "00000000-0000-4000-8000-000000000001", "title": "POI", "category": "wifi", "category_label": None, "description": "", "x": 50, "y": 50, "nav_node_id": None}],
        "panoramas": [], "hotspots": [],
    }
    res_valid = client.put(f"/api/v1/maps/{map_id}/document", json=valid_doc, headers={**headers, "If-Match": etag})
    assert res_valid.status_code == 200
    etag_v2 = res_valid.headers["ETag"]

    # Invalid document (out of bounds)
    invalid_doc = {
        "title": "Invalid", "description": "", "is_published": False, "scale_m_per_unit": 1.0, "max_walk_gap_units": 50,
        "background_asset_id": None, "shapes": [], "nodes": [], "edges": [],
        "pois": [{"id": "00000000-0000-4000-8000-000000000002", "title": "Bad", "category": "wifi", "category_label": None, "description": "", "x": 200, "y": 50, "nav_node_id": None}],
        "panoramas": [], "hotspots": [],
    }
    res_invalid = client.put(f"/api/v1/maps/{map_id}/document", json=invalid_doc, headers={**headers, "If-Match": etag_v2})
    assert res_invalid.status_code == 422

    # Verify document unchanged
    current = client.get(f"/api/v1/maps/{map_id}").json()
    assert current["snapshot"]["revision"] == 2
    assert current["snapshot"]["document"]["title"] == "Valid"
    assert len(current["snapshot"]["document"]["pois"]) == 1
    assert current["snapshot"]["document"]["pois"][0]["id"] == "00000000-0000-4000-8000-000000000001"
