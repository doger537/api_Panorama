import asyncio

import pytest
from fastapi import Request
from PIL import Image

from backend.app.errors import ApiError
from backend.app.modules.capture import uploads
from backend.app.modules.capture.service import normalize_frame
from backend.tests.capture.conftest import frame_bytes


def test_chunked_body_rejected_before_unbounded_read(monkeypatch):
    monkeypatch.setattr(uploads, "FRAME_MAX_BYTES", 16)
    delivered = []

    async def receive():
        delivered.append(True)
        if len(delivered) > 2:
            raise AssertionError("Read continued after size limit")
        return {"type": "http.request", "body": b"x" * 40000, "more_body": True}

    request = Request({"type": "http", "headers": [(b"content-type", b"multipart/form-data; boundary=x")]}, receive)
    with pytest.raises(ApiError) as caught:
        asyncio.run(uploads.read_frame_upload(request))
    assert caught.value.status_code == 413
    assert len(delivered) == 2


@pytest.mark.parametrize("pixel_limit", [3000, 1000])
def test_decompression_bomb_warning_and_error_are_validation_failures(monkeypatch, pixel_limit):
    raw = frame_bytes(size=(80, 60))
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", pixel_limit)
    with pytest.raises(ValueError, match="decoded safely"):
        normalize_frame(raw)
