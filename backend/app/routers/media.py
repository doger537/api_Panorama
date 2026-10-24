from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4
import shutil
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from fastapi import APIRouter, Depends, Header, Request, Response

from backend.app.auth import get_optional_session, require_csrf, require_origin, require_session
from backend.app.config import settings
from backend.app.db import database, transaction
from backend.app.errors import ApiError
from backend.app.modules.media.storage import (
    PANORAMA_MAX_BYTES,
    PLAN_MAX_BYTES,
    AssetStore,
    inspect_image_bytes,
    parse_multipart_fields,
)
from backend.app.modules.maps.snapshots import _owned_map
from backend.app.modules.media.images import InvalidImage


router = APIRouter(tags=["media"])


def _asset_dto(row) -> dict:
    asset_id = row["id"]
    return {
        "id": asset_id,
        "kind": row["kind"],
        "source": row["source"],
        "width_px": row["width_px"],
        "height_px": row["height_px"],
        "projection": row["projection"],
        "haov_deg": row["haov_deg"],
        "vaov_deg": row["vaov_deg"],
        "v_offset_deg": row["v_offset_deg"],
        "preview_url": f"/api/v1/media/{asset_id}/preview",
        "mobile_url": f"/api/v1/media/{asset_id}/mobile",
        "full_url": f"/api/v1/media/{asset_id}/full",
        "created_at": row["created_at"],
    }


@router.get("/api/v1/maps/{map_id}/assets")
def list_assets(map_id: str, row=Depends(require_session)):
    with database() as connection:
        with transaction(connection):
            _owned_map(connection, map_id, row["user_id"])
            rows = connection.execute(
                "SELECT id,kind,source,width_px,height_px,projection,haov_deg,vaov_deg,v_offset_deg,created_at "
                "FROM assets WHERE map_id=? ORDER BY created_at DESC",
                (map_id,),
            ).fetchall()
    return [_asset_dto(item) for item in rows]


@router.post("/api/v1/maps/{map_id}/assets", status_code=201)
async def upload_asset(
    map_id: str,
    request: Request,
    csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
    _: None = Depends(require_origin),
    row=Depends(require_session),
):
    require_csrf(row, csrf_token)
    with database() as connection:
        _owned_map(connection, map_id, row["user_id"])

    async with request.app.state.media_slots:
        fields = await parse_multipart_fields(request, PANORAMA_MAX_BYTES)
        return await run_in_threadpool(_store_upload, map_id, row['user_id'], fields)


def _store_upload(map_id, owner_id, fields):
    kind_entry = fields.get("kind")
    file_entry = fields.get("file")
    if kind_entry is None or file_entry is None:
        raise ApiError(422, "VALIDATION_ERROR", "Both 'kind' and 'file' multipart fields are required")

    kind = kind_entry[1].decode("utf-8", errors="replace").strip()
    if kind not in {"plan", "panorama"}:
        raise ApiError(422, "VALIDATION_ERROR", "Asset kind must be 'plan' or 'panorama'", issues=[{"path": "kind", "message": "Must be 'plan' or 'panorama'"}])

    raw_bytes = file_entry[1]
    max_bytes = PLAN_MAX_BYTES if kind == "plan" else PANORAMA_MAX_BYTES
    _, width, height = inspect_image_bytes(raw_bytes, max_bytes)

    projection = None
    haov_deg = None
    vaov_deg = None
    v_offset_deg = None
    if kind == "panorama":
        if width != 2 * height:
            raise ApiError(
                422,
                "VALIDATION_ERROR",
                "Uploaded panorama must have a 2:1 equirectangular aspect ratio",
                issues=[{"path": "file", "message": f"Expected 2:1 aspect ratio, got {width}x{height}"}],
            )
        projection = "equirectangular"
        haov_deg = 360
        vaov_deg = 180.0
        v_offset_deg = 0.0

    asset_id = str(uuid4())
    store = AssetStore(settings.media_path)
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    try:
        preview_key, mobile_key, full_key, final_w, final_h = store.store_asset_variants(asset_id, raw_bytes, width, height, kind=kind)
        with database() as connection:
            with transaction(connection, immediate=True):
                _owned_map(connection, map_id, owner_id)
                connection.execute(
                    "INSERT INTO assets(id,map_id,kind,source,width_px,height_px,projection,haov_deg,vaov_deg,v_offset_deg,preview_key,mobile_key,full_key,created_at) "
                    "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (asset_id, map_id, kind, "upload", final_w, final_h, projection, haov_deg, vaov_deg, v_offset_deg, preview_key, mobile_key, full_key, now),
                )
                saved = connection.execute("SELECT * FROM assets WHERE id=?", (asset_id,)).fetchone()
    except InvalidImage as exc:
        shutil.rmtree(settings.media_path / asset_id, ignore_errors=True)
        raise ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', str(exc)) from exc
    except BaseException:
        shutil.rmtree(settings.media_path / asset_id, ignore_errors=True)
        raise
    return _asset_dto(saved)


@router.get("/api/v1/media/{asset_id}/{variant}")
def get_media(
    asset_id: str,
    variant: str,
    if_none_match: str | None = Header(default=None, alias="If-None-Match"),
    session_row=Depends(get_optional_session),
):
    if variant not in {"preview", "mobile", "full"}:
        raise ApiError(404, "NOT_FOUND", "Media variant not found")

    with database() as connection:
        with transaction(connection):
            asset = connection.execute(
                "SELECT a.*, m.owner_id, m.is_published FROM assets a JOIN maps m ON m.id=a.map_id WHERE a.id=?",
                (asset_id,),
            ).fetchone()
            if asset is None:
                raise ApiError(404, "NOT_FOUND", "Media asset not found")

            is_owner = session_row is not None and session_row["user_id"] == asset["owner_id"]
            is_publicly_attached = False
            if not is_owner and asset["is_published"]:
                bg = connection.execute(
                    "SELECT 1 FROM map_backgrounds WHERE map_id=? AND asset_id=?",
                    (asset["map_id"], asset_id),
                ).fetchone()
                pano = connection.execute(
                    "SELECT 1 FROM panoramas WHERE map_id=? AND asset_id=? LIMIT 1",
                    (asset["map_id"], asset_id),
                ).fetchone()
                is_publicly_attached = bg is not None or pano is not None

            if not (is_owner or is_publicly_attached):
                raise ApiError(404, "NOT_FOUND", "Media asset not found")

            key_col = f"{variant}_key"
            rel_key = asset[key_col]

    etag = f'"asset-{asset_id}-{variant}"'
    headers = {"ETag": etag, "Cache-Control": "private, no-cache"}
    file_path = (settings.media_path / rel_key).resolve()
    if settings.media_path.resolve() not in file_path.parents or not file_path.is_file():
        raise ApiError(404, "NOT_FOUND", "Media file not found")
    if if_none_match == etag:
        return Response(status_code=304, headers=headers)

    return FileResponse(file_path, media_type="image/webp", headers=headers)
