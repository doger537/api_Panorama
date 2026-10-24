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
    db_file = tmp_path / "media_test.sqlite"
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


def test_media_upload_validation_and_access_control(client: TestClient):
    create_organizer("org@example.test", "valid-password-123")
    origin = {"Origin": "http://testserver"}
    login = client.post("/api/v1/auth/login", json={"email": "org@example.test", "password": "valid-password-123"}, headers=origin)
    headers = {**origin, "X-CSRF-Token": login.json()["csrf_token"]}
    created = client.post("/api/v1/maps", json={"title": "M", "description": "", "width_units": 500, "height_units": 500, "scale_m_per_unit": None, "max_walk_gap_units": 100}, headers=headers)
    map_id = created.json()["snapshot"]["id"]

    # Reject spoofed SVG as 415
    svg_res = client.post(f"/api/v1/maps/{map_id}/assets", files={"kind": (None, "plan"), "file": ("plan.png", b"<svg></svg>", "image/png")}, headers=headers)
    assert svg_res.status_code == 415

    # Upload valid plan PNG
    plan_res = client.post(f"/api/v1/maps/{map_id}/assets", files={"kind": (None, "plan"), "file": ("plan.png", make_png_bytes(400, 300), "image/png")}, headers=headers)
    assert plan_res.status_code == 201
    asset_id = plan_res.json()["id"]

    # Owner can fetch media, guest cannot fetch unattached media
    assert client.get(f"/api/v1/media/{asset_id}/preview").status_code == 200
    client.post("/api/v1/auth/logout", headers=headers)
    assert client.get(f"/api/v1/media/{asset_id}/preview").status_code == 404


def test_upload_size_limits_413(client: TestClient):
    """Test 413 error for files exceeding size limits."""
    create_organizer("org2@example.test", "valid-password-456")
    origin = {"Origin": "http://testserver"}
    login = client.post("/api/v1/auth/login", json={"email": "org2@example.test", "password": "valid-password-456"}, headers=origin)
    headers = {**origin, "X-CSRF-Token": login.json()["csrf_token"]}
    created = client.post("/api/v1/maps", json={"title": "M", "description": "", "width_units": 500, "height_units": 500, "scale_m_per_unit": None, "max_walk_gap_units": 100}, headers=headers)
    map_id = created.json()["snapshot"]["id"]

    # Create oversized plan (>15 MiB)
    oversized_plan = b"\x89PNG\r\n\x1a\n" + (b"\x00" * (16 * 1024 * 1024))
    res = client.post(f"/api/v1/maps/{map_id}/assets", files={"kind": (None, "plan"), "file": ("big.png", oversized_plan, "image/png")}, headers=headers)
    assert res.status_code == 413
    if res.status_code == 413 and res.content:
        data = res.json()
        if "code" in data:
            assert "MEDIA_TOO_LARGE" in data["code"]


def test_unsupported_format_415(client: TestClient):
    """Test 415 error for unsupported file formats like PDF."""
    create_organizer("org3@example.test", "valid-password-789")
    origin = {"Origin": "http://testserver"}
    login = client.post("/api/v1/auth/login", json={"email": "org3@example.test", "password": "valid-password-789"}, headers=origin)
    headers = {**origin, "X-CSRF-Token": login.json()["csrf_token"]}
    created = client.post("/api/v1/maps", json={"title": "M", "description": "", "width_units": 500, "height_units": 500, "scale_m_per_unit": None, "max_walk_gap_units": 100}, headers=headers)
    map_id = created.json()["snapshot"]["id"]

    pdf_header = b"%PDF-1.4\n"
    res = client.post(f"/api/v1/maps/{map_id}/assets", files={"kind": (None, "plan"), "file": ("doc.pdf", pdf_header, "application/pdf")}, headers=headers)
    assert res.status_code == 415


def test_panorama_aspect_ratio_validation(client: TestClient):
    """Test panorama 2:1 aspect ratio requirement."""
    create_organizer("org4@example.test", "valid-password-abc")
    origin = {"Origin": "http://testserver"}
    login = client.post("/api/v1/auth/login", json={"email": "org4@example.test", "password": "valid-password-abc"}, headers=origin)
    headers = {**origin, "X-CSRF-Token": login.json()["csrf_token"]}
    created = client.post("/api/v1/maps", json={"title": "M", "description": "", "width_units": 500, "height_units": 500, "scale_m_per_unit": None, "max_walk_gap_units": 100}, headers=headers)
    map_id = created.json()["snapshot"]["id"]

    # Valid 2:1 panorama
    valid_pano = make_png_bytes(2000, 1000)
    res = client.post(f"/api/v1/maps/{map_id}/assets", files={"kind": (None, "panorama"), "file": ("pano.png", valid_pano, "image/png")}, headers=headers)
    assert res.status_code == 201
    data = res.json()
    assert data["projection"] == "equirectangular"
    assert data["haov_deg"] == 360

    # Invalid aspect ratio
    invalid_pano = make_png_bytes(2000, 1100)
    res = client.post(f"/api/v1/maps/{map_id}/assets", files={"kind": (None, "panorama"), "file": ("bad.png", invalid_pano, "image/png")}, headers=headers)
    assert res.status_code == 422


def test_etag_and_304_not_modified(client: TestClient):
    """Test ETag support and 304 Not Modified response."""
    create_organizer("org5@example.test", "valid-password-def")
    origin = {"Origin": "http://testserver"}
    login = client.post("/api/v1/auth/login", json={"email": "org5@example.test", "password": "valid-password-def"}, headers=origin)
    headers = {**origin, "X-CSRF-Token": login.json()["csrf_token"]}
    created = client.post("/api/v1/maps", json={"title": "M", "description": "", "width_units": 500, "height_units": 500, "scale_m_per_unit": None, "max_walk_gap_units": 100}, headers=headers)
    map_id = created.json()["snapshot"]["id"]

    upload_res = client.post(f"/api/v1/maps/{map_id}/assets", files={"kind": (None, "plan"), "file": ("plan.png", make_png_bytes(400, 300), "image/png")}, headers=headers)
    asset_id = upload_res.json()["id"]

    # First request
    res1 = client.get(f"/api/v1/media/{asset_id}/preview")
    assert res1.status_code == 200
    etag = res1.headers.get("etag")
    assert etag is not None

    # Second request with If-None-Match
    res2 = client.get(f"/api/v1/media/{asset_id}/preview", headers={"If-None-Match": etag})
    assert res2.status_code == 304


def test_media_variants_are_webp(client: TestClient):
    """Test that all variants (preview, mobile, full) are generated as WebP."""
    create_organizer("org6@example.test", "valid-password-ghi")
    origin = {"Origin": "http://testserver"}
    login = client.post("/api/v1/auth/login", json={"email": "org6@example.test", "password": "valid-password-ghi"}, headers=origin)
    headers = {**origin, "X-CSRF-Token": login.json()["csrf_token"]}
    created = client.post("/api/v1/maps", json={"title": "M", "description": "", "width_units": 500, "height_units": 500, "scale_m_per_unit": None, "max_walk_gap_units": 100}, headers=headers)
    map_id = created.json()["snapshot"]["id"]

    upload_res = client.post(f"/api/v1/maps/{map_id}/assets", files={"kind": (None, "plan"), "file": ("plan.png", make_png_bytes(1200, 900), "image/png")}, headers=headers)
    asset_id = upload_res.json()["id"]

    for variant in ["preview", "mobile", "full"]:
        res = client.get(f"/api/v1/media/{asset_id}/{variant}")
        assert res.status_code == 200
        assert res.headers["content-type"] == "image/webp"
        assert res.content[:4] == b"RIFF" and res.content[8:12] == b"WEBP"
