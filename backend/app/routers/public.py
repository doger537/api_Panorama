from __future__ import annotations

import heapq
import math

from fastapi import APIRouter, Header, Response

from backend.app.db import database, transaction
from backend.app.errors import ApiError
from backend.app.modules.maps.snapshots import _snapshot
from backend.app.schemas import RouteRequest


router = APIRouter(prefix="/api/v1/public", tags=["public"])


def _etag_matches(header: str | None, etag: str) -> bool:
    if not header:
        return False
    return any(token.strip() in {"*", etag, f"W/{etag}"} for token in header.split(","))


@router.get("/maps/{slug}")
def get_public_map(slug: str, response: Response, if_none_match: str | None = Header(default=None, alias="If-None-Match")):
    with database() as connection:
        with transaction(connection):
            row = connection.execute("SELECT * FROM maps WHERE slug=? AND is_published=1", (slug,)).fetchone()
            if row is None:
                raise ApiError(404, "NOT_FOUND", "Published map not found")
            etag = f'"map-{row["id"]}-v{row["revision"]}"'
            response.headers["ETag"] = etag
            response.headers["Cache-Control"] = "no-cache"
            if _etag_matches(if_none_match, etag):
                response.status_code = 304
                return None
            return _snapshot(connection, row, public=True)


@router.post("/maps/{slug}/route")
def build_route(slug: str, payload: RouteRequest):
    with database() as connection:
        with transaction(connection):
            row = connection.execute("SELECT * FROM maps WHERE slug=? AND is_published=1", (slug,)).fetchone()
            if row is None:
                raise ApiError(404, "NOT_FOUND", "Published map not found")
            if payload.revision != row["revision"]:
                raise ApiError(409, "CONFLICT", "Map revision changed", current_revision=row["revision"])
            nodes = {item["id"]: item for item in connection.execute("SELECT id,x,y FROM nav_nodes WHERE map_id=?", (row["id"],))}
            if payload.from_node_id not in nodes or payload.to_node_id not in nodes:
                raise ApiError(422, "VALIDATION_ERROR", "Route node does not exist")
            adjacency: dict[str, list[tuple[str, float]]] = {node_id: [] for node_id in nodes}
            for edge in connection.execute("SELECT a,b FROM nav_edges WHERE map_id=?", (row["id"],)):
                a, b = edge["a"], edge["b"]
                weight = math.hypot(nodes[a]["x"] - nodes[b]["x"], nodes[a]["y"] - nodes[b]["y"])
                adjacency[a].append((b, weight))
                adjacency[b].append((a, weight))
            start, goal = payload.from_node_id, payload.to_node_id
            queue = [(0.0, start)]
            distance = {start: 0.0}
            previous: dict[str, str | None] = {start: None}
            while queue:
                current_distance, current = heapq.heappop(queue)
                if current == goal:
                    break
                if current_distance != distance.get(current):
                    continue
                for neighbour, weight in sorted(adjacency[current]):
                    candidate = current_distance + weight
                    if candidate < distance.get(neighbour, float("inf")):
                        distance[neighbour] = candidate
                        previous[neighbour] = current
                        heapq.heappush(queue, (candidate, neighbour))
            if goal not in distance:
                raise ApiError(422, "ROUTE_NOT_FOUND", "No connected route exists")
            path: list[str] = []
            cursor: str | None = goal
            while cursor is not None:
                path.append(cursor)
                cursor = previous[cursor]
            path.reverse()
            points = [{"x": nodes[item]["x"], "y": nodes[item]["y"]} for item in path]
            walk = _panorama_walk(connection, row, path, nodes)
            scale = row["scale_m_per_unit"]
            return {
                "revision": row["revision"],
                "node_ids": path,
                "polyline": points,
                "distance_units": distance[goal],
                "distance_m": distance[goal] * scale if scale else None,
                "walk": walk,
            }


def _panorama_walk(connection, map_row, path: list[str], nodes: dict[str, object]) -> dict:
    if len(path) < 2:
        node_id = path[0]
        return {
            "available": False,
            "steps": [],
            "gaps": [{"from_node_id": node_id, "to_node_id": node_id, "reason": "same_node"}],
        }

    panoramas = {
        row["nav_node_id"]: row
        for row in connection.execute(
            "SELECT id,nav_node_id,heading_offset_deg FROM panoramas WHERE map_id=? AND nav_node_id IS NOT NULL",
            (map_row["id"],),
        )
    }
    transitions = {
        (row["panorama_id"], row["target_panorama_id"]): row["id"]
        for row in connection.execute(
            "SELECT id,panorama_id,target_panorama_id FROM hotspots WHERE map_id=? AND kind='transition'",
            (map_row["id"],),
        )
    }
    gaps: list[dict[str, str]] = []
    for from_node, to_node in zip(path, path[1:]):
        from_panorama = panoramas.get(from_node)
        to_panorama = panoramas.get(to_node)
        if from_panorama is None or to_panorama is None:
            gaps.append({"from_node_id": from_node, "to_node_id": to_node, "reason": "missing_panorama"})
            continue
        edge_length = math.hypot(nodes[from_node]["x"] - nodes[to_node]["x"], nodes[from_node]["y"] - nodes[to_node]["y"])
        if edge_length > map_row["max_walk_gap_units"]:
            gaps.append({"from_node_id": from_node, "to_node_id": to_node, "reason": "gap_too_large"})
        if (from_panorama["id"], to_panorama["id"]) not in transitions:
            gaps.append({"from_node_id": from_node, "to_node_id": to_node, "reason": "missing_transition"})
    if gaps:
        return {"available": False, "steps": [], "gaps": gaps}

    steps = []
    for index, node_id in enumerate(path):
        if index + 1 < len(path):
            target_node_id = path[index + 1]
            dx = nodes[target_node_id]["x"] - nodes[node_id]["x"]
            dy = nodes[target_node_id]["y"] - nodes[node_id]["y"]
        else:
            previous_node_id = path[index - 1]
            dx = nodes[node_id]["x"] - nodes[previous_node_id]["x"]
            dy = nodes[node_id]["y"] - nodes[previous_node_id]["y"]
        bearing = math.degrees(math.atan2(dx, -dy))
        panorama = panoramas[node_id]
        yaw = ((bearing - panorama["heading_offset_deg"] + 180) % 360) - 180
        next_hotspot_id = None
        if index + 1 < len(path):
            next_hotspot_id = transitions[(panorama["id"], panoramas[path[index + 1]]["id"])]
        steps.append({"node_id": node_id, "panorama_id": panorama["id"], "yaw_deg": yaw, "next_hotspot_id": next_hotspot_id})
    return {"available": True, "steps": steps, "gaps": []}
