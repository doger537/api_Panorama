from __future__ import annotations

import json
import secrets
import shutil
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, Response, Query
from backend.app.modules.maps.snapshots import _snapshot, _owned_map
from backend.app.modules.maps.validation import _validate_document

from backend.app.auth import require_csrf, require_origin, require_session
from backend.app.config import settings
from backend.app.db import database, transaction
from backend.app.errors import ApiError
from backend.app.schemas import CreateMapRequest, MapDocument


router = APIRouter(prefix="/api/v1/maps", tags=["maps"])


def _slug() -> str:
    alphabet = "abcdefghijklmnopqrstuvwxyz234567"
    value = secrets.token_bytes(16)
    number = int.from_bytes(value, "big")
    chars = []
    for _ in range(26):
        chars.append(alphabet[number & 31])
        number >>= 5
    return "".join(chars)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


@router.get("")
def list_maps(row=Depends(require_session), offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=100)):
    with database() as connection:
        rows = connection.execute("SELECT id,slug,title,is_published,revision,updated_at FROM maps WHERE owner_id=? ORDER BY updated_at DESC,id DESC LIMIT ? OFFSET ?", (row["user_id"], limit, offset)).fetchall()
    return [dict(item) | {"is_published": bool(item["is_published"])} for item in rows]


@router.post("", status_code=201)
def create_map(payload: CreateMapRequest, response: Response, csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"), _: None = Depends(require_origin), row=Depends(require_session)):
    require_csrf(row, csrf_token)
    map_id = str(uuid4())
    now = _now()
    with database() as connection:
        with transaction(connection, immediate=True):
            connection.execute(
                "INSERT INTO maps(id,owner_id,slug,title,description,width_units,height_units,scale_m_per_unit,max_walk_gap_units,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (map_id, row["user_id"], _slug(), payload.title, payload.description, payload.width_units, payload.height_units, payload.scale_m_per_unit, payload.max_walk_gap_units, now, now),
            )
            map_row = connection.execute("SELECT * FROM maps WHERE id=?", (map_id,)).fetchone()
            result = _snapshot(connection, map_row)
    response.headers["ETag"] = f'"map-{map_id}-v1"'
    return result


@router.get("/{map_id}")
def get_map(map_id: str, response: Response, row=Depends(require_session)):
    with database() as connection:
        with transaction(connection):
            map_row = _owned_map(connection, map_id, row["user_id"])
            response.headers["ETag"] = f'"map-{map_id}-v{map_row["revision"]}"'
            return _snapshot(connection, map_row)


@router.delete("/{map_id}", status_code=204)
def delete_map(map_id: str, response: Response, if_match: str = Header(..., alias="If-Match"),
               csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
               _: None = Depends(require_origin), row=Depends(require_session)):
    require_csrf(row, csrf_token)
    with database() as connection:
        with transaction(connection, immediate=True):
            map_row = _owned_map(connection, map_id, row["user_id"])
            expected = f'"map-{map_id}-v{map_row["revision"]}"'
            if if_match != expected:
                raise ApiError(412, "VERSION_CONFLICT", "Map changed since it was loaded", current_revision=map_row["revision"])
            asset_ids = [item["id"] for item in connection.execute("SELECT id FROM assets WHERE map_id=?", (map_id,))]
            frame_keys = [item["storage_key"] for item in connection.execute(
                "SELECT f.storage_key FROM capture_frames f JOIN captures c ON c.id=f.capture_id WHERE c.map_id=?",
                (map_id,),
            )]
            connection.execute("DELETE FROM maps WHERE id=?", (map_id,))
    media_root = settings.media_path.resolve()
    for asset_id in asset_ids:
        target = (media_root / asset_id).resolve()
        if media_root in target.parents:
            shutil.rmtree(target, ignore_errors=True)
    for key in frame_keys:
        target = (media_root / key).resolve()
        if media_root in target.parents:
            try:
                target.unlink(missing_ok=True)
            except OSError:
                pass
    response.status_code = 204
    return response


@router.put("/{map_id}/document")
def replace_document(map_id: str, document: MapDocument, response: Response, if_match: str = Header(..., alias="If-Match"), csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"), _: None = Depends(require_origin), row=Depends(require_session)):
    require_csrf(row, csrf_token)
    with database() as connection:
        with transaction(connection, immediate=True):
            map_row = _owned_map(connection, map_id, row["user_id"])
            expected = f'"map-{map_id}-v{map_row["revision"]}"'
            if if_match != expected:
                raise ApiError(412, "VERSION_CONFLICT", "Map changed since it was loaded", current_revision=map_row["revision"])
            _validate_document(connection, map_row, document)
            now = _now()
            connection.execute("DELETE FROM hotspots WHERE map_id=?", (map_id,))
            connection.execute("DELETE FROM panoramas WHERE map_id=?", (map_id,))
            connection.execute("DELETE FROM pois WHERE map_id=?", (map_id,))
            connection.execute("DELETE FROM nav_edges WHERE map_id=?", (map_id,))
            connection.execute("DELETE FROM nav_nodes WHERE map_id=?", (map_id,))
            connection.execute("DELETE FROM shapes WHERE map_id=?", (map_id,))
            connection.execute("DELETE FROM map_backgrounds WHERE map_id=?", (map_id,))
            if document.background_asset_id is not None:
                connection.execute("INSERT INTO map_backgrounds(map_id,asset_id) VALUES(?,?)", (map_id, document.background_asset_id))
            connection.execute("UPDATE maps SET title=?,description=?,is_published=?,scale_m_per_unit=?,max_walk_gap_units=?,revision=revision+1,updated_at=? WHERE id=?", (document.title, document.description, int(document.is_published), document.scale_m_per_unit, document.max_walk_gap_units, now, map_id))
            for shape in document.shapes:
                points_json = json.dumps([point.model_dump() for point in shape.points], separators=(",", ":"))
                connection.execute("INSERT INTO shapes(id,map_id,kind,label,points_json) VALUES(?,?,?,?,?)", (shape.id, map_id, shape.kind, shape.label, points_json))
            for node in document.nodes:
                connection.execute("INSERT INTO nav_nodes(id,map_id,x,y) VALUES(?,?,?,?)", (node.id, map_id, node.x, node.y))
            for edge in document.edges:
                connection.execute("INSERT INTO nav_edges(id,map_id,a,b) VALUES(?,?,?,?)", (edge.id, map_id, edge.a, edge.b))
            for poi in document.pois:
                connection.execute("INSERT INTO pois(id,map_id,title,category,category_label,description,x,y,nav_node_id) VALUES(?,?,?,?,?,?,?,?,?)", (poi.id, map_id, poi.title, poi.category, poi.category_label, poi.description, poi.x, poi.y, poi.nav_node_id))
            for panorama in document.panoramas:
                connection.execute("INSERT INTO panoramas(id,map_id,asset_id,title,x,y,nav_node_id,heading_offset_deg) VALUES(?,?,?,?,?,?,?,?)", (panorama.id, map_id, panorama.asset_id, panorama.title, panorama.x, panorama.y, panorama.nav_node_id, panorama.heading_offset_deg))
            for hotspot in document.hotspots:
                connection.execute("INSERT INTO hotspots(id,map_id,panorama_id,kind,yaw_deg,pitch_deg,poi_id,target_panorama_id) VALUES(?,?,?,?,?,?,?,?)", (hotspot.id, map_id, hotspot.panorama_id, hotspot.kind, hotspot.yaw_deg, hotspot.pitch_deg, hotspot.poi_id, hotspot.target_panorama_id))
            refreshed = connection.execute("SELECT * FROM maps WHERE id=?", (map_id,)).fetchone()
            result = _snapshot(connection, refreshed)
    response.headers["ETag"] = f'"map-{map_id}-v{result["snapshot"]["revision"]}"'
    return result
