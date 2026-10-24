from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi.concurrency import run_in_threadpool
from fastapi import APIRouter, Depends, Header, Request, Response

from backend.app.auth import require_csrf, require_origin, require_session
from backend.app.db import database, transaction
from backend.app.errors import ApiError
from backend.app.modules.capture.service import (
    cancel_capture_job,
    capture_dto,
    get_owned_capture,
    store_capture_frame,
    prepare_capture_frame,
    submit_stitch,
)
from backend.app.modules.capture.uploads import read_frame_upload
from backend.app.modules.maps.snapshots import _owned_map
from backend.app.schemas import CreateCaptureRequest


router = APIRouter(prefix="/api/v1/maps/{map_id}/captures", tags=["captures"])


@router.get("")
def list_captures(map_id: str, row=Depends(require_session)):
    with database() as connection:
        with transaction(connection):
            _owned_map(connection, map_id, row["user_id"])
            rows = connection.execute(
                "SELECT * FROM captures WHERE map_id=? ORDER BY created_at DESC",
                (map_id,),
            ).fetchall()
            return [capture_dto(connection, item) for item in rows]


@router.post("", status_code=201)
def create_capture(
    map_id: str,
    payload: CreateCaptureRequest,
    csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
    _: None = Depends(require_origin),
    row=Depends(require_session),
):
    require_csrf(row, csrf_token)
    capture_id = str(uuid4())
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    with database() as connection:
        with transaction(connection, immediate=True):
            map_row = _owned_map(connection, map_id, row["user_id"])
            if not (0 <= payload.x <= map_row["width_units"] and 0 <= payload.y <= map_row["height_units"]):
                raise ApiError(
                    422,
                    "VALIDATION_ERROR",
                    "Capture coordinates are outside map bounds",
                    issues=[{"path": "x", "message": "Coordinates must be within map width and height"}],
                )
            active_count = connection.execute(
                "SELECT COUNT(*) FROM captures WHERE map_id=? AND state IN ('collecting','queued','running')",
                (map_id,),
            ).fetchone()[0]
            if active_count >= 2:
                raise ApiError(409, "CONFLICT", "At most two active capture sessions are allowed per map")
            connection.execute(
                "INSERT INTO captures(id,map_id,title,x,y,hfov_hint_deg,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
                (capture_id, map_id, payload.title, payload.x, payload.y, payload.hfov_hint_deg, now, now),
            )
            created = connection.execute("SELECT * FROM captures WHERE id=?", (capture_id,)).fetchone()
            return capture_dto(connection, created)


@router.get("/{capture_id}")
def get_capture(map_id: str, capture_id: str, row=Depends(require_session)):
    with database() as connection:
        with transaction(connection):
            capture_row = get_owned_capture(connection, map_id, capture_id, row["user_id"])
            return capture_dto(connection, capture_row)


@router.put("/{capture_id}/frames/{index}")
async def put_capture_frame(
    map_id: str,
    capture_id: str,
    index: int,
    request: Request,
    csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
    _: None = Depends(require_origin),
    row=Depends(require_session),
):
    require_csrf(row, csrf_token)
    # Reject foreign nested resources before reading/decoding their upload.
    # Recheck inside the writer transaction after the potentially slow body read.
    with database() as connection:
        get_owned_capture(connection, map_id, capture_id, row["user_id"])
    async with request.app.state.media_slots:
        raw_bytes = await read_frame_upload(request)
        return await run_in_threadpool(_store_frame, map_id, capture_id, row['user_id'], index, raw_bytes)


def _store_frame(map_id, capture_id, owner_id, index, raw_bytes):
    prepared = None
    storage_key = None
    with database() as connection:
        capture_row = get_owned_capture(connection, map_id, capture_id, owner_id)
        if not 0 <= index <= 15:
            raise ApiError(422, 'VALIDATION_ERROR', 'Frame index must be 0..15')
        if capture_row['state'] == 'collecting':
            try:
                prepared, storage_key = prepare_capture_frame(capture_id, index, raw_bytes)
            except ValueError as exc:
                raise ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', str(exc)) from exc
        with transaction(connection, immediate=True):
            capture_row = get_owned_capture(connection, map_id, capture_id, owner_id)
            return store_capture_frame(connection, capture_row, index, raw_bytes, prepared, storage_key)


@router.post("/{capture_id}/stitch")
def start_stitch(
    map_id: str,
    capture_id: str,
    response: Response,
    csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
    _: None = Depends(require_origin),
    row=Depends(require_session),
):
    require_csrf(row, csrf_token)
    with database() as connection:
        with transaction(connection, immediate=True):
            capture_row = get_owned_capture(connection, map_id, capture_id, row["user_id"])
            status_code, dto = submit_stitch(connection, capture_row)
            response.status_code = status_code
            return dto


@router.post("/{capture_id}/cancel")
def cancel_capture(
    map_id: str,
    capture_id: str,
    csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
    _: None = Depends(require_origin),
    row=Depends(require_session),
):
    require_csrf(row, csrf_token)
    with database() as connection:
        with transaction(connection, immediate=True):
            capture_row = get_owned_capture(connection, map_id, capture_id, row["user_id"])
            return cancel_capture_job(connection, capture_row)
