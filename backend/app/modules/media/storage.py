from __future__ import annotations

from email.parser import BytesParser
from email.policy import default as default_email_policy
import io
import shutil
import os
import tempfile
from pathlib import Path
import warnings
from uuid import uuid4

from fastapi import Request

from backend.app.errors import ApiError

from PIL import Image
from backend.app.modules.media.images import make_variants
Image.MAX_IMAGE_PIXELS = 40_000_000

PLAN_MAX_BYTES = 15 * 1024 * 1024
PANORAMA_MAX_BYTES = 40 * 1024 * 1024
FRAME_MAX_BYTES = 12 * 1024 * 1024
MAX_DIMENSION = 8192
MAX_PIXELS = 40_000_000


def inspect_image_bytes(data: bytes, max_bytes: int) -> tuple[str, int, int]:
    if len(data) > max_bytes:
        raise ApiError(413, "MEDIA_TOO_LARGE", "Uploaded file exceeds maximum allowed size")
    if len(data) < 12:
        raise ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Unsupported or empty image file")

    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        fmt = "png"
    elif data.startswith(b"\xff\xd8\xff"):
        fmt = "jpeg"
    elif data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        fmt = "webp"
    else:
        raise ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Only JPEG, PNG and WebP images are supported")

    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as img:
                width, height = img.size
                if width * height > MAX_PIXELS:
                    raise ApiError(413, 'MEDIA_TOO_LARGE', 'Image pixel count exceeds safety limit')
                if max(width, height) > MAX_DIMENSION:
                    raise ApiError(422, 'VALIDATION_ERROR', f'Image dimensions exceed {MAX_DIMENSION}px')
                img.verify()
            with Image.open(io.BytesIO(data)) as img:
                if img.getexif().get(274) in (5, 6, 7, 8):
                    width, height = height, width
    except ApiError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise ApiError(413, "MEDIA_TOO_LARGE", "Image pixel count exceeds safety limit") from exc
    except Exception as exc:
        raise ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Corrupted or invalid image content") from exc

    if width <= 0 or height <= 0:
        raise ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Invalid image dimensions")
    if width * height > MAX_PIXELS:
        raise ApiError(413, "MEDIA_TOO_LARGE", "Image pixel count exceeds maximum allowed")
    if width > MAX_DIMENSION or height > MAX_DIMENSION:
        raise ApiError(422, "VALIDATION_ERROR", f"Image dimensions ({width}x{height}) exceed {MAX_DIMENSION}px")
    return fmt, int(width), int(height)


async def parse_multipart_fields(request: Request, max_bytes: int) -> dict[str, tuple[str | None, bytes]]:
    content_type = request.headers.get("content-type", "")
    if "multipart/form-data" not in content_type.lower():
        raise ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Expected multipart/form-data request")
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > max_bytes + 65536:
            raise ApiError(413, "MEDIA_TOO_LARGE", "Multipart payload exceeds maximum allowed size")
        body.extend(chunk)
    from fastapi.concurrency import run_in_threadpool
    return await run_in_threadpool(_parse_multipart_body, content_type, bytes(body))


def _parse_multipart_body(content_type: str, body: bytes) -> dict[str, tuple[str | None, bytes]]:
    raw_headers = f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("utf-8")
    msg = BytesParser(policy=default_email_policy).parsebytes(raw_headers + body)
    if not msg.is_multipart():
        raise ApiError(400, "BAD_REQUEST", "Malformed multipart body")
    fields: dict[str, tuple[str | None, bytes]] = {}
    for part in msg.iter_parts():
        disposition = part.get_content_disposition()
        if disposition != "form-data":
            continue
        name = part.get_param("name", header="content-disposition")
        filename = part.get_filename()
        payload = part.get_payload(decode=True) or b""
        if name:
            if name in fields:
                raise ApiError(400, 'BAD_REQUEST', 'Duplicate multipart field')
            fields[str(name)] = (filename, payload)
    return fields


class AssetStore:
    """Small storage seam shared by media and capture agents.

    The media feature owns validation and derivative generation. This class only
    provides a stable path boundary for atomic writes on one local volume.
    """

    def __init__(self, root: Path) -> None:
        self.root = root

    def asset_dir(self, asset_id: str) -> Path:
        path = self.root / asset_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def write_atomic(self, relative_key: str, data: bytes) -> Path:
        target = (self.root / relative_key).resolve()
        root_resolved = self.root.resolve()
        if root_resolved != target and root_resolved not in target.parents:
            raise ValueError("Invalid storage key outside media root")
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = target.with_name(f".{target.name}.{uuid4().hex}.tmp")
        try:
            with tmp_path.open("wb") as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(tmp_path, target)
        except BaseException:
            tmp_path.unlink(missing_ok=True)
            raise
        return target

    def frame_path(self, capture_id: str, index: int) -> Path:
        return self.root / "captures" / capture_id / f"{index:02d}.frame"

    def write_frame_atomic(self, capture_id: str, index: int, data: bytes) -> Path:
        target = self.frame_path(capture_id, index)
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix=".frame-", dir=target.parent)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, target)
        except BaseException:
            Path(temporary).unlink(missing_ok=True)
            raise
        return target

    def store_asset_variants(self, asset_id: str, raw_bytes: bytes, width: int, height: int,
                             *, kind: str = 'plan', partial_vaov_deg: float | None = None) -> tuple[str, str, str, int, int]:
        self.root.mkdir(parents=True, exist_ok=True)
        if shutil.disk_usage(self.root).free < max(100 * 1024 * 1024, len(raw_bytes) * 4):
            raise ApiError(503, 'SERVICE_UNAVAILABLE', 'Media storage is full; try again after maintenance')
        variants, final_w, final_h = make_variants(raw_bytes, kind, partial_vaov_deg=partial_vaov_deg)
        keys = [f"{asset_id}/{variant}.webp" for variant in ('preview', 'mobile', 'full')]
        for variant, key in zip(('preview', 'mobile', 'full'), keys):
            self.write_atomic(key, variants[variant])
        return *keys, final_w, final_h
