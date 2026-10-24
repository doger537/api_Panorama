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
    db_file = tmp_path / "public_test.sqlite"
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


def _create_published_map(client: TestClient, title: str = "Test Map"):
    """Create and publish a map, return slug and map_id."""
    user_id = create_organizer("org@example.test", "password-123")
    origin = {"Origin": "http://testserver"}
    login = client.post("/api/v1/auth/login", json={"email": "org@example.test", "password": "password-123"}, headers=origin)
    csrf = login.json()["csrf_token"]
    headers = {**origin, "X-CSRF-Token": csrf}

    # Create map
    created = client.post(
        "/api/v1/maps",
        json={"title": title, "description": "", "width_units": 200, "height_units": 200, "scale_m_per_unit": 0.1, "max_walk_gap_units": 50},
        headers=headers,
    )
    map_id = created.json()["snapshot"]["id"]
    slug = created.json()["snapshot"]["slug"]
    etag = created.headers["ETag"]

    # Add nodes and edges
    doc = {
        "title": title, "description": "", "is_published": True, "scale_m_per_unit": 0.1, "max_walk_gap_units": 50,
        "background_asset_id": None, "shapes": [], "hotspots": [], "panoramas": [],
        "nodes": [
            {"id": "00000000-0000-4000-8000-000000000001", "x": 10, "y": 10},
            {"id": "00000000-0000-4000-8000-000000000002", "x": 50, "y": 10},
            {"id": "00000000-0000-4000-8000-000000000003", "x": 90, "y": 10},
        ],
        "edges": [
            {"id": "00000000-0000-4000-8000-000000000011", "a": "00000000-0000-4000-8000-000000000001", "b": "00000000-0000-4000-8000-000000000002"},
            {"id": "00000000-0000-4000-8000-000000000012", "a": "00000000-0000-4000-8000-000000000002", "b": "00000000-0000-4000-8000-000000000003"},
        ],
        "pois": [{"id": "00000000-0000-4000-8000-000000000021", "title": "POI1", "category": "wifi", "category_label": None, "description": "", "x": 10, "y": 10, "nav_node_id": None}],
    }
    client.put(f"/api/v1/maps/{map_id}/document", json=doc, headers={**headers, "If-Match": etag})

    return slug, map_id, user_id, headers


def test_public_map_excludes_private_data(client: TestClient):
    """Public snapshot must not contain owner_id, created_at, or other private fields."""
    slug, _, _, _ = _create_published_map(client)

    res = client.get(f"/api/v1/public/maps/{slug}")
    assert res.status_code == 200
    body = res.json()

    # Check no private fields
    assert "owner_id" not in body
    assert "created_at" not in body
    assert "snapshot" not in body  # No wrapper, just the map data

    # Must have public fields
    assert "id" in body
    assert "slug" in body
    assert "revision" in body
    assert "document" in body


def test_unpublished_map_returns_404(client: TestClient):
    """Unpublished maps must return 404, not reveal existence."""
    slug, map_id, user_id, headers = _create_published_map(client)

    # Unpublish
    etag = client.get(f"/api/v1/maps/{map_id}").headers["ETag"]
    doc = client.get(f"/api/v1/maps/{map_id}").json()["snapshot"]["document"]
    doc["is_published"] = False
    client.put(f"/api/v1/maps/{map_id}/document", json=doc, headers={**headers, "If-Match": etag})

    # Public endpoint returns 404
    res = client.get(f"/api/v1/public/maps/{slug}")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "NOT_FOUND"


def test_disconnected_graph_returns_error(client: TestClient):
    """Route between disconnected nodes must return ROUTE_NOT_FOUND."""
    user_id = create_organizer("org@example.test", "password-123")
    origin = {"Origin": "http://testserver"}
    login = client.post("/api/v1/auth/login", json={"email": "org@example.test", "password": "password-123"}, headers=origin)
    csrf = login.json()["csrf_token"]
    headers = {**origin, "X-CSRF-Token": csrf}

    created = client.post(
        "/api/v1/maps",
        json={"title": "Disconnected", "description": "", "width_units": 200, "height_units": 200, "scale_m_per_unit": 0.1, "max_walk_gap_units": 50},
        headers=headers,
    )
    map_id = created.json()["snapshot"]["id"]
    slug = created.json()["snapshot"]["slug"]
    etag = created.headers["ETag"]

    # Two disconnected components
    doc = {
        "title": "Disconnected", "description": "", "is_published": True, "scale_m_per_unit": 0.1, "max_walk_gap_units": 50,
        "background_asset_id": None, "shapes": [], "hotspots": [], "panoramas": [],
        "nodes": [
            {"id": "00000000-0000-4000-8000-000000000001", "x": 10, "y": 10},
            {"id": "00000000-0000-4000-8000-000000000002", "x": 50, "y": 10},
            {"id": "00000000-0000-4000-8000-000000000003", "x": 150, "y": 150},
            {"id": "00000000-0000-4000-8000-000000000004", "x": 190, "y": 150},
        ],
        "edges": [
            {"id": "00000000-0000-4000-8000-000000000011", "a": "00000000-0000-4000-8000-000000000001", "b": "00000000-0000-4000-8000-000000000002"},
            {"id": "00000000-0000-4000-8000-000000000012", "a": "00000000-0000-4000-8000-000000000003", "b": "00000000-0000-4000-8000-000000000004"},
        ],
        "pois": [{"id": "00000000-0000-4000-8000-000000000021", "title": "POI", "category": "wifi", "category_label": None, "description": "", "x": 10, "y": 10, "nav_node_id": None}],
    }
    res = client.put(f"/api/v1/maps/{map_id}/document", json=doc, headers={**headers, "If-Match": etag})
    revision = res.json()["snapshot"]["revision"]

    # Try to route between disconnected components
    route_res = client.post(
        f"/api/v1/public/maps/{slug}/route",
        json={"revision": revision, "from_node_id": "00000000-0000-4000-8000-000000000001", "to_node_id": "00000000-0000-4000-8000-000000000003"},
    )
    assert route_res.status_code == 422
    assert route_res.json()["error"]["code"] == "ROUTE_NOT_FOUND"


def test_stale_revision_returns_409(client: TestClient):
    """Route request with stale revision must return 409 with current_revision."""
    slug, map_id, user_id, headers = _create_published_map(client)

    # Get current revision
    public_map = client.get(f"/api/v1/public/maps/{slug}").json()
    current_revision = public_map["revision"]

    # Try with old revision
    route_res = client.post(
        f"/api/v1/public/maps/{slug}/route",
        json={"revision": current_revision - 1, "from_node_id": "00000000-0000-4000-8000-000000000001", "to_node_id": "00000000-0000-4000-8000-000000000002"},
    )
    assert route_res.status_code == 409
    assert route_res.json()["error"]["code"] == "CONFLICT"
    assert route_res.json()["error"]["current_revision"] == current_revision


def test_etag_and_cache_control(client: TestClient):
    """Public map must have ETag and Cache-Control: no-cache."""
    slug, _, _, _ = _create_published_map(client)

    res = client.get(f"/api/v1/public/maps/{slug}")
    assert res.status_code == 200
    assert "ETag" in res.headers
    assert res.headers["Cache-Control"] == "no-cache"

    # 304 with matching ETag
    etag = res.headers["ETag"]
    res_304 = client.get(f"/api/v1/public/maps/{slug}", headers={"If-None-Match": etag})
    assert res_304.status_code == 304
