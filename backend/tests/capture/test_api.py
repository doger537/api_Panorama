import hashlib
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.app.auth import create_organizer
from backend.app.config import settings
from backend.app.db import database, transaction
from backend.app.main import create_app
from backend.app.modules.capture import service
from backend.app.modules.media.storage import FRAME_MAX_BYTES
from backend.app.modules.media.storage import AssetStore
from backend.tests.capture.conftest import frame_bytes


def assert_error(response, status, code):
    assert response.status_code == status, response.text
    assert response.json()["error"]["code"] == code
    assert response.headers["cache-control"] == "no-store"


def test_session_list_get_limits_and_cancel(capture_api):
    api = capture_api
    result = api.client.get(api.url).json()
    assert UUID(result["id"]).version == 4
    assert result["state"] == "collecting" and result["attempt"] == 0
    assert result["frames"] == [] and result["result_asset_id"] is None
    collection = api.url.rsplit("/", 1)[0]
    assert api.client.get(collection).json() == [result]
    payload = {"title": "Second", "x": 500, "y": 0, "hfov_hint_deg": 40}
    assert api.client.post(collection, headers=api.headers, json=payload).status_code == 201
    assert_error(api.client.post(collection, headers=api.headers, json=payload), 409, "CONFLICT")
    cancelled = api.post("cancel")
    assert cancelled.json()["finished_at"] and cancelled.json()["state"] == "cancelled"
    assert api.post("cancel").json() == cancelled.json()
    assert api.client.post(collection, headers=api.headers, json=payload).status_code == 201
    assert_error(api.post("stitch"), 409, "CONFLICT")
    assert_error(api.upload(), 409, "CONFLICT")


@pytest.mark.parametrize("field,value", [("x", -1), ("x", 501), ("y", 501), ("hfov_hint_deg", 39), ("hfov_hint_deg", 86), ("title", "")])
def test_invalid_capture(capture_api, field, value):
    payload = {"title": "C", "x": 0, "y": 0, "hfov_hint_deg": 60, field: value}
    response = capture_api.client.post(capture_api.url.rsplit("/", 1)[0], headers=capture_api.headers, json=payload)
    assert_error(response, 422, "VALIDATION_ERROR")


@pytest.mark.parametrize("fmt", ["JPEG", "PNG", "WEBP"])
def test_slot_content_idempotency_replacement_and_private_storage(capture_api, fmt):
    api = capture_api
    raw = frame_bytes(fmt=fmt)
    first = api.upload(raw=raw)
    assert first.status_code == 200
    assert api.upload(raw=raw).json() == first.json()
    assert first.json()["frames"][0]["sha256"] == hashlib.sha256(raw).hexdigest()
    replaced = api.upload(raw=frame_bytes("blue", fmt))
    assert len(replaced.json()["frames"]) == 1
    assert replaced.json()["frames"] != first.json()["frames"]
    assert "storage_key" not in str(replaced.json())
    with database() as db:
        row = db.execute("SELECT * FROM capture_frames WHERE capture_id=?", (api.capture_id,)).fetchone()
    with Image.open(settings.media_path / row["storage_key"]) as image:
        assert image.format == "JPEG" and not image.getexif()
    assert api.client.get(f"/api/v1/media/{api.capture_id}/full").status_code == 404
    raw_response = api.client.get(f"/media/{row['storage_key']}")
    # With a built frontend the SPA fallback serves index.html for unknown
    # paths; neither that response nor a 404 may expose the private frame.
    assert raw_response.status_code == 404 or raw_response.headers["content-type"].startswith("text/html")
    assert raw_response.content != (settings.media_path / row["storage_key"]).read_bytes()


@pytest.mark.parametrize("index", [-1, 16])
def test_slot_bounds(capture_api, index):
    assert_error(capture_api.upload(index), 422, "VALIDATION_ERROR")


@pytest.mark.parametrize("raw", [b"<svg/>", b"not an image", frame_bytes(size=(1601, 1)), frame_bytes(fmt="GIF")])
def test_invalid_frame_content(capture_api, raw):
    assert_error(capture_api.upload(raw=raw), 415, "UNSUPPORTED_MEDIA_TYPE")
    assert capture_api.client.get(capture_api.url).json()["frames"] == []


def test_raw_limit_including_valid_small_image_with_trailing_bytes(capture_api):
    raw = frame_bytes()
    # Body remains below the parser's multipart-overhead allowance.
    raw += b"x" * (FRAME_MAX_BYTES + 1 - len(raw))
    assert_error(capture_api.upload(raw=raw), 413, "MEDIA_TOO_LARGE")
    assert capture_api.client.get(capture_api.url).json()["frames"] == []


def test_missing_file(capture_api):
    response = capture_api.client.put(capture_api.url + "/frames/0", headers=capture_api.headers,
                                      files={"other": ("x.png", frame_bytes(), "image/png")})
    assert_error(response, 422, "VALIDATION_ERROR")


def test_submit_seals_frames_and_retry_is_idempotent(capture_api):
    api = capture_api
    assert_error(api.post("stitch"), 422, "VALIDATION_ERROR")
    api.fill()
    submitted = api.post("stitch")
    assert submitted.status_code == 202
    assert submitted.json()["state"] == "queued" and submitted.json()["attempt"] == 1
    assert api.post("stitch").json() == submitted.json()
    assert api.upload(0, frame_bytes((0, 40, 90))).json() == submitted.json()
    assert_error(api.upload(0, frame_bytes("blue")), 409, "CONFLICT")
    with database() as db:
        service.claim_next_capture(db)
    running = api.post("stitch")
    assert running.status_code == 202 and running.json()["attempt"] == 1
    assert running.json()["state"] == "running"
    cancelled = api.post("cancel").json()
    assert cancelled["state"] == "cancelled" and cancelled["result_asset_id"] is None
    assert api.post("cancel").json() == cancelled
    with database() as db:
        row = db.execute("SELECT * FROM captures WHERE id=?", (api.capture_id,)).fetchone()
        assert row["lease_token"] is None and row["lease_expires_at"] is None
        assert service.claim_next_capture(db) is None


def test_queue_and_session_survive_new_app_instance(capture_api):
    api = capture_api
    api.fill()
    queued = api.post("stitch").json()
    with TestClient(create_app()) as restarted:
        restarted.cookies.update(api.client.cookies)
        assert restarted.get(api.url).json() == queued
        assert restarted.post(api.url + "/stitch", headers=api.headers).json() == queued
    with database() as db:
        job = service.claim_next_capture(db)
        assert job["id"] == api.capture_id and job["attempt"] == 1


@pytest.mark.parametrize("access", ["anonymous", "foreign", "wrong_map", "missing_capture"])
def test_ownership_on_every_endpoint(capture_api, access):
    api = capture_api
    url = api.url
    headers = api.headers
    expected = 404
    if access == "anonymous":
        api.client.cookies.clear()
        expected = 401
    elif access == "foreign":
        create_organizer("other@example.test", "valid-password-123")
        login = api.client.post("/api/v1/auth/login", headers={"Origin": settings.app_origin},
                                json={"email": "other@example.test", "password": "valid-password-123"})
        headers = {"Origin": settings.app_origin, "X-CSRF-Token": login.json()["csrf_token"]}
    elif access == "wrong_map":
        url = url.replace(api.map_id, str(uuid4()))
    else:
        url = url.replace(api.capture_id, str(uuid4()))
    requests = [("GET", url, {}), ("PUT", url + "/frames/0", {"files": {"file": ("bad", b"invalid")}}),
                ("POST", url + "/stitch", {}), ("POST", url + "/cancel", {})]
    if access != "missing_capture":
        collection = url.rsplit("/", 1)[0]
        requests += [("GET", collection, {}), ("POST", collection, {"json": {
            "title": "C", "x": 0, "y": 0, "hfov_hint_deg": 60}})]
    for method, path, kwargs in requests:
        assert_error(api.client.request(method, path, headers=headers, **kwargs), expected,
                     "AUTH_REQUIRED" if expected == 401 else "NOT_FOUND")


@pytest.mark.parametrize("headers", [{}, {"Origin": "https://foreign.example"}, {"X-CSRF-Token": "wrong"}])
def test_mutation_origin_and_csrf(capture_api, headers):
    api = capture_api
    invalid = {} if not headers else {**api.headers, **headers}
    for method, path, kwargs in [
        ("POST", api.url.rsplit("/", 1)[0], {"json": {"title": "C", "x": 0, "y": 0, "hfov_hint_deg": 60}}),
        ("PUT", api.url + "/frames/0", {"files": {"file": ("f.png", frame_bytes())}}),
        ("POST", api.url + "/stitch", {}), ("POST", api.url + "/cancel", {}),
    ]:
        assert_error(api.client.request(method, path, headers=invalid, **kwargs), 403, "FORBIDDEN")


def test_replacement_rollback_keeps_committed_file(capture_api):
    api = capture_api
    assert api.upload().status_code == 200
    with database() as db:
        before = dict(db.execute("SELECT * FROM capture_frames WHERE capture_id=?", (api.capture_id,)).fetchone())
        original = (settings.media_path / before["storage_key"]).read_bytes()
        with pytest.raises(RuntimeError, match="commit aborted"):
            with transaction(db, immediate=True):
                row = db.execute("SELECT * FROM captures WHERE id=?", (api.capture_id,)).fetchone()
                service.store_capture_frame(db, row, 0, frame_bytes("blue"))
                raise RuntimeError("commit aborted")
        after = dict(db.execute("SELECT * FROM capture_frames WHERE capture_id=?", (api.capture_id,)).fetchone())
    assert before == after
    assert (settings.media_path / before["storage_key"]).read_bytes() == original


def test_disk_failure_preserves_previous_slot(capture_api, monkeypatch):
    api = capture_api
    before = api.upload().json()

    def disk_full(*args, **kwargs):
        raise OSError("disk full")

    monkeypatch.setattr(AssetStore, "write_atomic", disk_full)
    with database() as db:
        with pytest.raises(OSError, match="disk full"):
            with transaction(db, immediate=True):
                row = db.execute("SELECT * FROM captures WHERE id=?", (api.capture_id,)).fetchone()
                service.store_capture_frame(db, row, 0, frame_bytes("blue"))
    assert api.client.get(api.url).json() == before


def test_succeeded_session_is_read_only_and_resubmit_returns_existing_result(capture_api):
    api = capture_api
    api.fill()
    api.post("stitch")
    # Import a generated sphere solely to seed a terminal-state API fixture.
    # This is not a worker/stitching acceptance test.
    response = api.client.post(f"/api/v1/maps/{api.map_id}/assets", headers=api.headers,
                               data={"kind": "panorama"}, files={"file": ("sphere.png", frame_bytes(size=(128, 64)), "image/png")})
    assert response.status_code == 201
    asset_id = response.json()["id"]
    with database() as db:
        service.claim_next_capture(db)
        db.execute("UPDATE captures SET state='succeeded',progress=100,result_asset_id=?,finished_at=?,"
                   "lease_token=NULL,lease_expires_at=NULL WHERE id=?", (asset_id, service._now(), api.capture_id))
    first = api.client.get(api.url).json()
    result = api.post("stitch")
    assert result.status_code == 200 and result.json() == first
    assert first["result_asset_id"] == asset_id and first["attempt"] == 1
    assert_error(api.post("cancel"), 409, "CONFLICT")
    assert_error(api.upload(), 409, "CONFLICT")
