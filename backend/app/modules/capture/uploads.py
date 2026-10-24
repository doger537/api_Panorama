from fastapi import Request

from backend.app.errors import ApiError
from backend.app.modules.media.storage import FRAME_MAX_BYTES, parse_multipart_fields


async def read_frame_upload(request: Request) -> bytes:
    """Bound streaming bodies too; Content-Length is not trusted for limits."""
    fields = await parse_multipart_fields(request, FRAME_MAX_BYTES)
    file_entry = fields.get("file")
    if file_entry is None:
        raise ApiError(422, "VALIDATION_ERROR", "Multipart field 'file' is required")
    if len(file_entry[1]) > FRAME_MAX_BYTES:
        raise ApiError(413, "MEDIA_TOO_LARGE", "Uploaded frame exceeds maximum allowed size")
    return file_entry[1]
