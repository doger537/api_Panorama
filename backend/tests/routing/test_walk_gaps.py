from __future__ import annotations

from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from backend.app.auth import create_organizer
from backend.app.config import settings
from backend.app.db import database, initialize_database
from backend.app.main import create_app


@pytest.fixture()
def client(tmp_path: Path):
    db_file = tmp_path / "walk_test.sqlite"
    media_dir = tmp_path / "media"
    orig_db, orig_media, orig_origin = settings.database_path, settings.media_path, settings.app_origin
    object.__setattr__(settings, "database_path", db_file)
    object.__setattr__(settings, "media_path", media_dir)
    object.__setattr__(settings, "app_origin", "http://testserver")
    try:
        initialize_database(db_file)
        media_dir.mkdir(parents=True, exist_ok=True)
        with TestClient(create_app()) as c:
            yield c
    finally:
        object.__setattr__(settings, "database_path", orig_db)
        object.__setattr__(settings, "media_path", orig_media)
        object.__setattr__(settings, "app_origin", orig_origin)


def test_walk_gaps_missing_panorama(client: TestClient):
    """Walk with missing panorama on a node must report gap."""
    user_id = create_organizer("org@example.test", "password-123")
    origin = {"Origin": "http://testserver"}
    login = client.post("/api/v1/auth/login", json={"email": "org@example.test", "password": "password-123"}, headers=origin)
    csrf = login.json()["csrf_token"]
    headers = {**origin, "X-CSRF-Token": csrf}

    created = client.post(
        "/api/v1/maps",
        json={"title": "Walk Gap", "description": "", "width_units": 200, "height_units": 200, "scale_m_per_unit": 0.1, "max_walk_gap_units": 50},
        headers=headers,
    )
    map_id = created.json()["snapshot"]["id"]
    slug = created.json()["snapshot"]["slug"]
    etag = created.headers["ETag"]

    # Create panorama assets
    with database() as conn:
        asset1 = "00000000-0000-4000-8000-000000000101"
        conn.execute(
            "INSERT INTO assets(id,map_id,kind,source,width_px,height_px,projection,haov_deg,vaov_deg,v_offset_deg,preview_key,mobile_key,full_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (asset1, map_id, "panorama", "upload", 4096, 2048, "equirectangular", 360, 180, 0, f"{asset1}/p", f"{asset1}/m", f"{asset1}/f")
        )

    # 3 nodes, but only panorama on node 1 (missing on node 2)
    doc = {
        "title": "Walk Gap", "description": "", "is_published": True, "scale_m_per_unit": 0.1, "max_walk_gap_units": 50,
        "background_asset_id": None, "shapes": [],
        "nodes": [
            {"id": "00000000-0000-4000-8000-000000000001", "x": 10, "y": 10},
            {"id": "00000000-0000-4000-8000-000000000002", "x": 50, "y": 10},
            {"id": "00000000-0000-4000-8000-000000000003", "x": 90, "y": 10},
        ],
        "edges": [
            {"id": "00000000-0000-4000-8000-000000000011", "a": "00000000-0000-4000-8000-000000000001", "b": "00000000-0000-4000-8000-000000000002"},
            {"id": "00000000-0000-4000-8000-000000000012", "a": "00000000-0000-4000-8000-000000000002", "b": "00000000-0000-4000-8000-000000000003"},
        ],
        "pois": [{"id": "00000000-0000-4000-8000-000000000021", "title": "POI", "category": "wifi", "category_label": None, "description": "", "x": 10, "y": 10, "nav_node_id": None}],
        "panoramas": [
            {"id": "00000000-0000-4000-8000-000000000031", "asset_id": asset1, "title": "Pano1", "x": 10, "y": 10, "nav_node_id": "00000000-0000-4000-8000-000000000001", "heading_offset_deg": 0},
        ],
        "hotspots": [],
    }
    res = client.put(f"/api/v1/maps/{map_id}/document", json=doc, headers={**headers, "If-Match": etag})
    revision = res.json()["snapshot"]["revision"]

    # Route from node 1 to node 3 (missing panorama on node 2)
    route_res = client.post(
        f"/api/v1/public/maps/{slug}/route",
        json={"revision": revision, "from_node_id": "00000000-0000-4000-8000-000000000001", "to_node_id": "00000000-0000-4000-8000-000000000003"},
    )
    assert route_res.status_code == 200
    walk = route_res.json()["walk"]
    assert walk["available"] is False
    assert len(walk["gaps"]) > 0
    assert any(g["reason"] == "missing_panorama" for g in walk["gaps"])


def test_walk_gaps_missing_transition(client: TestClient):
    """Walk with missing transition hotspot must report gap."""
    user_id = create_organizer("org@example.test", "password-123")
    origin = {"Origin": "http://testserver"}
    login = client.post("/api/v1/auth/login", json={"email": "org@example.test", "password": "password-123"}, headers=origin)
    csrf = login.json()["csrf_token"]
    headers = {**origin, "X-CSRF-Token": csrf}

    created = client.post(
        "/api/v1/maps",
        json={"title": "Missing Transition", "description": "", "width_units": 200, "height_units": 200, "scale_m_per_unit": 0.1, "max_walk_gap_units": 50},
        headers=headers,
    )
    map_id = created.json()["snapshot"]["id"]
    slug = created.json()["snapshot"]["slug"]
    etag = created.headers["ETag"]

    # Create panorama assets
    with database() as conn:
        for i in range(2):
            asset_id = f"0000000{i}-0000-4000-8000-000000000101"
            conn.execute(
                "INSERT INTO assets(id,map_id,kind,source,width_px,height_px,projection,haov_deg,vaov_deg,v_offset_deg,preview_key,mobile_key,full_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (asset_id, map_id, "panorama", "upload", 4096, 2048, "equirectangular", 360, 180, 0, f"{asset_id}/p", f"{asset_id}/m", f"{asset_id}/f")
            )

    # 2 nodes with panoramas, but no transition hotspot between them
    doc = {
        "title": "Missing Transition", "description": "", "is_published": True, "scale_m_per_unit": 0.1, "max_walk_gap_units": 50,
        "background_asset_id": None, "shapes": [],
        "nodes": [
            {"id": "00000000-0000-4000-8000-000000000001", "x": 10, "y": 10},
            {"id": "00000000-0000-4000-8000-000000000002", "x": 50, "y": 10},
        ],
        "edges": [
            {"id": "00000000-0000-4000-8000-000000000011", "a": "00000000-0000-4000-8000-000000000001", "b": "00000000-0000-4000-8000-000000000002"},
        ],
        "pois": [{"id": "00000000-0000-4000-8000-000000000021", "title": "POI", "category": "wifi", "category_label": None, "description": "", "x": 10, "y": 10, "nav_node_id": None}],
        "panoramas": [
            {"id": "00000000-0000-4000-8000-000000000031", "asset_id": "00000000-0000-4000-8000-000000000101", "title": "Pano1", "x": 10, "y": 10, "nav_node_id": "00000000-0000-4000-8000-000000000001", "heading_offset_deg": 0},
            {"id": "00000000-0000-4000-8000-000000000032", "asset_id": "00000001-0000-4000-8000-000000000101", "title": "Pano2", "x": 50, "y": 10, "nav_node_id": "00000000-0000-4000-8000-000000000002", "heading_offset_deg": 0},
        ],
        "hotspots": [],  # No transitions
    }
    res = client.put(f"/api/v1/maps/{map_id}/document", json=doc, headers={**headers, "If-Match": etag})
    revision = res.json()["snapshot"]["revision"]

    # Route between nodes with missing transition
    route_res = client.post(
        f"/api/v1/public/maps/{slug}/route",
        json={"revision": revision, "from_node_id": "00000000-0000-4000-8000-000000000001", "to_node_id": "00000000-0000-4000-8000-000000000002"},
    )
    assert route_res.status_code == 200
    walk = route_res.json()["walk"]
    assert walk["available"] is False
    assert len(walk["gaps"]) > 0
    assert any(g["reason"] == "missing_transition" for g in walk["gaps"])


def test_walk_gaps_too_large_distance(client: TestClient):
    """Walk with edge > max_walk_gap_units must report gap."""
    user_id = create_organizer("org@example.test", "password-123")
    origin = {"Origin": "http://testserver"}
    login = client.post("/api/v1/auth/login", json={"email": "org@example.test", "password": "password-123"}, headers=origin)
    csrf = login.json()["csrf_token"]
    headers = {**origin, "X-CSRF-Token": csrf}

    created = client.post(
        "/api/v1/maps",
        json={"title": "Large Gap", "description": "", "width_units": 500, "height_units": 200, "scale_m_per_unit": 0.1, "max_walk_gap_units": 50},
        headers=headers,
    )
    map_id = created.json()["snapshot"]["id"]
    slug = created.json()["snapshot"]["slug"]
    etag = created.headers["ETag"]

    # Create panorama assets
    with database() as conn:
        for i in range(2):
            asset_id = f"0000000{i}-0000-4000-8000-000000000101"
            conn.execute(
                "INSERT INTO assets(id,map_id,kind,source,width_px,height_px,projection,haov_deg,vaov_deg,v_offset_deg,preview_key,mobile_key,full_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (asset_id, map_id, "panorama", "upload", 4096, 2048, "equirectangular", 360, 180, 0, f"{asset_id}/p", f"{asset_id}/m", f"{asset_id}/f")
            )

    # 2 nodes far apart (distance > max_walk_gap_units=50)
    doc = {
        "title": "Large Gap", "description": "", "is_published": True, "scale_m_per_unit": 0.1, "max_walk_gap_units": 50,
        "background_asset_id": None, "shapes": [],
        "nodes": [
            {"id": "00000000-0000-4000-8000-000000000001", "x": 10, "y": 10},
            {"id": "00000000-0000-4000-8000-000000000002", "x": 200, "y": 10},  # 190 units apart > 50
        ],
        "edges": [
            {"id": "00000000-0000-4000-8000-000000000011", "a": "00000000-0000-4000-8000-000000000001", "b": "00000000-0000-4000-8000-000000000002"},
        ],
        "pois": [{"id": "00000000-0000-4000-8000-000000000021", "title": "POI", "category": "wifi", "category_label": None, "description": "", "x": 10, "y": 10, "nav_node_id": None}],
        "panoramas": [
            {"id": "00000000-0000-4000-8000-000000000031", "asset_id": "00000000-0000-4000-8000-000000000101", "title": "Pano1", "x": 10, "y": 10, "nav_node_id": "00000000-0000-4000-8000-000000000001", "heading_offset_deg": 0},
            {"id": "00000000-0000-4000-8000-000000000032", "asset_id": "00000001-0000-4000-8000-000000000101", "title": "Pano2", "x": 200, "y": 10, "nav_node_id": "00000000-0000-4000-8000-000000000002", "heading_offset_deg": 0},
        ],
        "hotspots": [
            {"id": "00000000-0000-4000-8000-000000000041", "panorama_id": "00000000-0000-4000-8000-000000000031", "kind": "transition", "yaw_deg": 0, "pitch_deg": 0, "poi_id": None, "target_panorama_id": "00000000-0000-4000-8000-000000000032"},
        ],
    }
    res = client.put(f"/api/v1/maps/{map_id}/document", json=doc, headers={**headers, "If-Match": etag})
    revision = res.json()["snapshot"]["revision"]

    # Route with large gap
    route_res = client.post(
        f"/api/v1/public/maps/{slug}/route",
        json={"revision": revision, "from_node_id": "00000000-0000-4000-8000-000000000001", "to_node_id": "00000000-0000-4000-8000-000000000002"},
    )
    assert route_res.status_code == 200
    walk = route_res.json()["walk"]
    assert walk["available"] is False
    assert len(walk["gaps"]) > 0
    assert any(g["reason"] == "gap_too_large" for g in walk["gaps"])


def test_deterministic_tie_break(client: TestClient):
    """Dijkstra with equal-weight paths must choose deterministically."""
    user_id = create_organizer("org@example.test", "password-123")
    origin = {"Origin": "http://testserver"}
    login = client.post("/api/v1/auth/login", json={"email": "org@example.test", "password": "password-123"}, headers=origin)
    csrf = login.json()["csrf_token"]
    headers = {**origin, "X-CSRF-Token": csrf}

    created = client.post(
        "/api/v1/maps",
        json={"title": "Diamond", "description": "", "width_units": 200, "height_units": 200, "scale_m_per_unit": 0.1, "max_walk_gap_units": 50},
        headers=headers,
    )
    map_id = created.json()["snapshot"]["id"]
    slug = created.json()["snapshot"]["slug"]
    etag = created.headers["ETag"]

    # Diamond graph: A -> B,C -> D (two equal paths)
    doc = {
        "title": "Diamond", "description": "", "is_published": True, "scale_m_per_unit": 0.1, "max_walk_gap_units": 50,
        "background_asset_id": None, "shapes": [], "panoramas": [], "hotspots": [],
        "nodes": [
            {"id": "00000000-0000-4000-8000-000000000001", "x": 50, "y": 10},   # A
            {"id": "00000000-0000-4000-8000-000000000002", "x": 10, "y": 50},   # B
            {"id": "00000000-0000-4000-8000-000000000003", "x": 90, "y": 50},   # C
            {"id": "00000000-0000-4000-8000-000000000004", "x": 50, "y": 90},   # D
        ],
        "edges": [
            {"id": "00000000-0000-4000-8000-000000000011", "a": "00000000-0000-4000-8000-000000000001", "b": "00000000-0000-4000-8000-000000000002"},
            {"id": "00000000-0000-4000-8000-000000000012", "a": "00000000-0000-4000-8000-000000000001", "b": "00000000-0000-4000-8000-000000000003"},
            {"id": "00000000-0000-4000-8000-000000000013", "a": "00000000-0000-4000-8000-000000000002", "b": "00000000-0000-4000-8000-000000000004"},
            {"id": "00000000-0000-4000-8000-000000000014", "a": "00000000-0000-4000-8000-000000000003", "b": "00000000-0000-4000-8000-000000000004"},
        ],
        "pois": [{"id": "00000000-0000-4000-8000-000000000021", "title": "POI", "category": "wifi", "category_label": None, "description": "", "x": 50, "y": 50, "nav_node_id": None}],
    }
    res = client.put(f"/api/v1/maps/{map_id}/document", json=doc, headers={**headers, "If-Match": etag})
    revision = res.json()["snapshot"]["revision"]

    # Route from A to D multiple times - should be deterministic
    routes = []
    for _ in range(3):
        route_res = client.post(
            f"/api/v1/public/maps/{slug}/route",
            json={"revision": revision, "from_node_id": "00000000-0000-4000-8000-000000000001", "to_node_id": "00000000-0000-4000-8000-000000000004"},
        )
        assert route_res.status_code == 200
        routes.append(route_res.json()["node_ids"])

    # All routes should be identical (deterministic tie-break)
    assert routes[0] == routes[1] == routes[2]
