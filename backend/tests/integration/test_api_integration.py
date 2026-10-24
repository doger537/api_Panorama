from __future__ import annotations

from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from backend.app.auth import clear_login_failures, create_organizer
from backend.app.config import settings
from backend.app.db import initialize_database
from backend.app.main import create_app
from scripts.seed_demo import make_png_bytes, seed_demo_data


@pytest.fixture()
def api_client(tmp_path: Path):
    db_file = tmp_path / "test_api.sqlite"
    media_dir = tmp_path / "media"
    orig_db = settings.database_path
    orig_media = settings.media_path
    orig_origin = settings.app_origin
    object.__setattr__(settings, "database_path", db_file)
    object.__setattr__(settings, "media_path", media_dir)
    object.__setattr__(settings, "app_origin", "http://testserver")
    try:
        clear_login_failures()
        initialize_database(db_file)
        media_dir.mkdir(parents=True, exist_ok=True)
        app = create_app()
        with TestClient(app) as client:
            yield client
    finally:
        object.__setattr__(settings, "database_path", orig_db)
        object.__setattr__(settings, "media_path", orig_media)
        object.__setattr__(settings, "app_origin", orig_origin)


def test_full_organizer_and_public_lifecycle(api_client: TestClient):
    create_organizer("alexey@ttk.ru", "ttkmap-organizer-2026")
    origin = {"Origin": "http://testserver"}

    # Anonymous access rejected
    assert api_client.get("/api/v1/maps").status_code == 401

    # Wrong origin rejected
    bad_origin = api_client.post("/api/v1/auth/login", json={"email": "alexey@ttk.ru", "password": "ttkmap-organizer-2026"}, headers={"Origin": "https://evil.example"})
    assert bad_origin.status_code == 403

    # Login succeeds
    login_res = api_client.post("/api/v1/auth/login", json={"email": "alexey@ttk.ru", "password": "ttkmap-organizer-2026"}, headers=origin)
    assert login_res.status_code == 200
    csrf = login_res.json()["csrf_token"]
    auth_headers = {**origin, "X-CSRF-Token": csrf}

    # Create map
    create_res = api_client.post(
        "/api/v1/maps",
        json={"title": "ТТК Плаза", "description": "Офис", "width_units": 700, "height_units": 500, "scale_m_per_unit": 0.1, "max_walk_gap_units": 500},
        headers=auth_headers,
    )
    assert create_res.status_code == 201
    etag = create_res.headers["ETag"]
    snap = create_res.json()["snapshot"]
    map_id = snap["id"]
    slug = snap["slug"]

    # Upload panorama asset (2:1 equirectangular)
    png_bytes = make_png_bytes(800, 400)
    asset_res = api_client.post(
        f"/api/v1/maps/{map_id}/assets",
        files={"kind": (None, "panorama"), "file": ("pano.png", png_bytes, "image/png")},
        headers=auth_headers,
    )
    assert asset_res.status_code == 201
    asset_id = asset_res.json()["id"]

    # Save published document with nodes, edge, POIs, panoramas, hotspots
    n1 = "00000000-0000-4000-8000-000000000001"
    n2 = "00000000-0000-4000-8000-000000000002"
    e1 = "00000000-0000-4000-8000-000000000003"
    p1 = "00000000-0000-4000-8000-000000000004"
    p2 = "00000000-0000-4000-8000-000000000005"
    pano1 = "00000000-0000-4000-8000-000000000006"
    pano2 = "00000000-0000-4000-8000-000000000007"
    hs1 = "00000000-0000-4000-8000-000000000008"
    hs2 = "00000000-0000-4000-8000-000000000009"

    doc = {
        "title": "ТТК Плаза",
        "description": "Главный офис",
        "is_published": True,
        "scale_m_per_unit": 0.1,
        "max_walk_gap_units": 500,
        "background_asset_id": None,
        "shapes": [
            {"id": "00000000-0000-4000-8000-000000000010", "kind": "room", "label": "Холл", "points": [{"x": 40, "y": 40}, {"x": 660, "y": 40}, {"x": 660, "y": 460}, {"x": 40, "y": 460}]}
        ],
        "nodes": [{"id": n1, "x": 100, "y": 100}, {"id": n2, "x": 400, "y": 100}],
        "edges": [{"id": e1, "a": n1, "b": n2}],
        "pois": [
            {"id": p1, "title": "Вход", "category": "entrance", "category_label": None, "description": "Главный вход", "x": 100, "y": 100, "nav_node_id": n1},
            {"id": p2, "title": "Переговорная", "category": "hall", "category_label": None, "description": "Зал Альфа", "x": 400, "y": 100, "nav_node_id": n2},
        ],
        "panoramas": [
            {"id": pano1, "asset_id": asset_id, "title": "Панорама 1", "x": 100, "y": 100, "nav_node_id": n1, "heading_offset_deg": 0},
            {"id": pano2, "asset_id": asset_id, "title": "Панорама 2", "x": 400, "y": 100, "nav_node_id": n2, "heading_offset_deg": 0},
        ],
        "hotspots": [
            {"id": hs1, "panorama_id": pano1, "kind": "transition", "yaw_deg": 90, "pitch_deg": 0, "poi_id": None, "target_panorama_id": pano2},
            {"id": hs2, "panorama_id": pano2, "kind": "transition", "yaw_deg": -90, "pitch_deg": 0, "poi_id": None, "target_panorama_id": pano1},
        ],
    }

    put_res = api_client.put(f"/api/v1/maps/{map_id}/document", json=doc, headers={**auth_headers, "If-Match": etag})
    assert put_res.status_code == 200
    assert put_res.json()["snapshot"]["revision"] == 2
    assert put_res.json()["snapshot"]["slug"] == slug

    # Stale ETag rejected with 412
    stale_res = api_client.put(f"/api/v1/maps/{map_id}/document", json=doc, headers={**auth_headers, "If-Match": etag})
    assert stale_res.status_code == 412

    # Public map and route
    pub_res = api_client.get(f"/api/v1/public/maps/{slug}")
    assert pub_res.status_code == 200
    route_res = api_client.post(f"/api/v1/public/maps/{slug}/route", json={"revision": 2, "from_node_id": n1, "to_node_id": n2})
    assert route_res.status_code == 200
    route_data = route_res.json()
    assert route_data["distance_units"] == 300.0
    assert route_data["distance_m"] == 30.0
    assert route_data["walk"]["available"] is True
    assert len(route_data["walk"]["steps"]) == 2

    # Capture session flow
    cap_res = api_client.post(f"/api/v1/maps/{map_id}/captures", json={"title": "Точка 1", "x": 200, "y": 200, "hfov_hint_deg": 65}, headers=auth_headers)
    assert cap_res.status_code == 201
    cap_id = cap_res.json()["id"]
    frame_res = api_client.put(
        f"/api/v1/maps/{map_id}/captures/{cap_id}/frames/0",
        files={"file": ("frame0.png", make_png_bytes(400, 600), "image/png")},
        headers=auth_headers,
    )
    assert frame_res.status_code == 200
    assert len(frame_res.json()["frames"]) == 1

    cancel_res = api_client.post(f"/api/v1/maps/{map_id}/captures/{cap_id}/cancel", headers=auth_headers)
    assert cancel_res.status_code == 200
    assert cancel_res.json()["state"] == "cancelled"


def test_seed_demo_populates_three_spaces(api_client: TestClient):
    seeded = seed_demo_data()
    assert len(seeded) == 3
    for slug in seeded:
        res = api_client.get(f"/api/v1/public/maps/{slug}")
        assert res.status_code == 200
        data = res.json()
        assert data["document"]["is_published"] is True
        assert len(data["document"]["pois"]) >= 2
