import asyncio
import pytest
from fastapi import Request
from backend.app.errors import ApiError
from backend.app.modules.media.storage import parse_multipart_fields


def test_asset_stream_is_stopped_before_reading_an_unbounded_body():
    consumed=[]
    async def receive():
        consumed.append(True)
        return {'type':'http.request','body':b'x'*40000,'more_body':True}
    request=Request({'type':'http','headers':[(b'content-type',b'multipart/form-data; boundary=test')]},receive)
    with pytest.raises(ApiError) as error:
        asyncio.run(parse_multipart_fields(request,100))
    assert error.value.status_code==413
    assert len(consumed)==2


def test_slow_image_processing_keeps_health_responsive(monkeypatch, api_client):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    from backend.tests.integration.test_audit_regressions import credentials, create
    from backend.app.modules.media import storage
    from scripts.seed_demo import make_png_bytes
    headers = credentials(api_client)
    snapshot, _ = create(api_client, headers)
    entered, release = Event(), Event()
    original = storage.make_variants

    def slow(*args, **kwargs):
        entered.set()
        assert release.wait(5), 'Health request was blocked by image processing'
        return original(*args, **kwargs)

    monkeypatch.setattr(storage, 'make_variants', slow)
    with ThreadPoolExecutor(max_workers=2) as pool:
        upload = pool.submit(api_client.post, f"/api/v1/maps/{snapshot['id']}/assets", headers=headers,
            files={'kind': (None, 'plan'), 'file': ('plan.png', make_png_bytes(40, 30), 'image/png')})
        try:
            assert entered.wait(3)
            health = pool.submit(api_client.get, '/healthz')
            assert health.result(timeout=2).status_code == 200
        finally:
            release.set()
        assert upload.result(timeout=5).status_code == 201


from backend.tests.integration.test_api_integration import api_client


def test_frame_file_io_does_not_hold_sqlite_writer_lock(monkeypatch, capture_api):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    from backend.app.modules.media.storage import AssetStore
    entered, release = Event(), Event()
    original = AssetStore.write_atomic

    def slow(self, key, data):
        entered.set()
        assert release.wait(5), 'Frame preparation held the SQLite writer lock'
        return original(self, key, data)

    monkeypatch.setattr(AssetStore, 'write_atomic', slow)
    with ThreadPoolExecutor(max_workers=2) as pool:
        upload = pool.submit(capture_api.upload)
        try:
            assert entered.wait(3)
            create = pool.submit(capture_api.client.post, '/api/v1/maps', headers=capture_api.headers,
                json={'title': 'Parallel write', 'description': '', 'width_units': 100, 'height_units': 100,
                      'scale_m_per_unit': None, 'max_walk_gap_units': 50})
            assert create.result(timeout=2).status_code == 201
        finally:
            release.set()
        assert upload.result(timeout=5).status_code == 200


from backend.tests.capture.conftest import capture_api
