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
    db_file = tmp_path / "validation.sqlite"
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


def _create_map_and_login(client: TestClient):
    create_organizer("org@example.test", "password-123")
    origin = {"Origin": "http://testserver"}
    login = client.post("/api/v1/auth/login", json={"email": "org@example.test", "password": "password-123"}, headers=origin)
    csrf = login.json()["csrf_token"]
    headers = {**origin, "X-CSRF-Token": csrf}

    created = client.post(
        "/api/v1/maps",
        json={"title": "Test Map", "description": "", "width_units": 100, "height_units": 100, "scale_m_per_unit": 1.0, "max_walk_gap_units": 50},
        headers=headers,
    )
    map_id = created.json()["snapshot"]["id"]
    etag = created.headers["ETag"]
    return map_id, etag, headers


def test_bounds_validation(client: TestClient):
    """POI, nodes, shapes must be within map bounds."""
    map_id, etag, headers = _create_map_and_login(client)

    # POI outside bounds
    doc = {
        "title": "Test", "description": "", "is_published": False, "scale_m_per_unit": 1.0, "max_walk_gap_units": 50,
        "background_asset_id": None, "shapes": [], "nodes": [], "edges": [],
        "pois": [{"id": "00000000-0000-4000-8000-000000000001", "title": "POI", "category": "wifi", "category_label": None, "description": "", "x": 150, "y": 50, "nav_node_id": None}],
        "panoramas": [], "hotspots": [],
    }
    res = client.put(f"/api/v1/maps/{map_id}/document", json=doc, headers={**headers, "If-Match": etag})
    assert res.status_code == 422
    assert "outside map bounds" in res.json()["error"]["message"].lower() or "issues" in res.json()["error"]

    # Revision must stay at 1 after failed validation
    current = client.get(f"/api/v1/maps/{map_id}").json()
    assert current["snapshot"]["revision"] == 1


def test_geometry_validation(client: TestClient):
    """Shapes must have valid geometry: non-zero area, no self-intersection."""
    map_id, etag, headers = _create_map_and_login(client)

    # Zero-area polygon
    doc = {
        "title": "Test", "description": "", "is_published": False, "scale_m_per_unit": 1.0, "max_walk_gap_units": 50,
        "background_asset_id": None, "nodes": [], "edges": [], "pois": [], "panoramas": [], "hotspots": [],
        "shapes": [{
            "id": "00000000-0000-4000-8000-000000000001",
            "kind": "room",
            "label": "Degenerate",
            "points": [{"x": 10, "y": 10}, {"x": 10, "y": 10}, {"x": 10, "y": 10}]
        }],
    }
    res = client.put(f"/api/v1/maps/{map_id}/document", json=doc, headers={**headers, "If-Match": etag})
    assert res.status_code == 422

    # Zero-length wall segment
    doc["shapes"] = [{
        "id": "00000000-0000-4000-8000-000000000002",
        "kind": "wall",
        "label": "Wall",
        "points": [{"x": 10, "y": 10}, {"x": 10, "y": 10}]
    }]
    res = client.put(f"/api/v1/maps/{map_id}/document", json=doc, headers={**headers, "If-Match": etag})
    assert res.status_code == 422


def test_foreign_references_validation(client: TestClient):
    """POI/panorama nav_node_id must reference existing nodes."""
    map_id, etag, headers = _create_map_and_login(client)

    # POI references non-existent node
    doc = {
        "title": "Test", "description": "", "is_published": False, "scale_m_per_unit": 1.0, "max_walk_gap_units": 50,
        "background_asset_id": None, "shapes": [], "edges": [], "panoramas": [], "hotspots": [],
        "nodes": [{"id": "00000000-0000-4000-8000-000000000001", "x": 50, "y": 50}],
        "pois": [{
            "id": "00000000-0000-4000-8000-000000000002",
            "title": "POI",
            "category": "wifi",
            "category_label": None,
            "description": "",
            "x": 50,
            "y": 50,
            "nav_node_id": "00000000-0000-4000-8000-999999999999"  # Non-existent
        }],
    }
    res = client.put(f"/api/v1/maps/{map_id}/document", json=doc, headers={**headers, "If-Match": etag})
    assert res.status_code == 422


def test_asset_type_validation(client: TestClient):
    """Background must be 'plan' asset, panoramas must be 'panorama' assets."""
    map_id, etag, headers = _create_map_and_login(client)

    # Create a plan asset
    with database() as conn:
        asset_id = "00000000-0000-4000-8000-000000000001"
        conn.execute(
            "INSERT INTO assets(id,map_id,kind,source,width_px,height_px,preview_key,mobile_key,full_key) VALUES(?,?,?,?,?,?,?,?,?)",
            (asset_id, map_id, "plan", "upload", 1000, 800, f"{asset_id}/preview", f"{asset_id}/mobile", f"{asset_id}/full")
        )

    # Try to use plan asset as panorama
    doc = {
        "title": "Test", "description": "", "is_published": False, "scale_m_per_unit": 1.0, "max_walk_gap_units": 50,
        "background_asset_id": None, "shapes": [], "nodes": [], "edges": [], "pois": [], "hotspots": [],
        "panoramas": [{
            "id": "00000000-0000-4000-8000-000000000002",
            "asset_id": asset_id,  # Wrong type
            "title": "Pano",
            "x": 50,
            "y": 50,
            "nav_node_id": None,
            "heading_offset_deg": 0
        }],
    }
    res = client.put(f"/api/v1/maps/{map_id}/document", json=doc, headers={**headers, "If-Match": etag})
    assert res.status_code == 422
