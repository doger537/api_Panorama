from backend.app.errors import ApiError
from backend.app.schemas import MapDocument

def _orientation(a, b, c) -> float:
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)


def _segments_intersect(a, b, c, d) -> bool:
    eps = 1e-9
    ab_c, ab_d = _orientation(a, b, c), _orientation(a, b, d)
    cd_a, cd_b = _orientation(c, d, a), _orientation(c, d, b)
    if ab_c * ab_d < -eps and cd_a * cd_b < -eps:
        return True

    def on_segment(p, q, r):
        return (min(p.x, r.x) - eps <= q.x <= max(p.x, r.x) + eps
                and min(p.y, r.y) - eps <= q.y <= max(p.y, r.y) + eps)

    return ((abs(ab_c) <= eps and on_segment(a, c, b))
            or (abs(ab_d) <= eps and on_segment(a, d, b))
            or (abs(cd_a) <= eps and on_segment(c, a, d))
            or (abs(cd_b) <= eps and on_segment(c, b, d)))


def _validate_document(connection, map_row, document: MapDocument) -> None:
    map_id = map_row["id"]
    width = float(map_row["width_units"])
    height = float(map_row["height_units"])
    issues: list[dict[str, str]] = []

    def check_bounds(x: float, y: float, path: str) -> None:
        if not (0.0 <= x <= width and 0.0 <= y <= height):
            issues.append({"path": path, "message": f"Coordinates ({x}, {y}) are outside map bounds ({width}x{height})"})

    if document.background_asset_id is not None:
        bg_row = connection.execute(
            "SELECT kind FROM assets WHERE map_id=? AND id=?",
            (map_id, document.background_asset_id),
        ).fetchone()
        if bg_row is None or bg_row["kind"] != "plan":
            issues.append({"path": "background_asset_id", "message": "Background asset must belong to this map and have kind 'plan'"})

    tables = {'shapes': document.shapes, 'nav_nodes': document.nodes, 'nav_edges': document.edges,
              'pois': document.pois, 'panoramas': document.panoramas, 'hotspots': document.hotspots}
    for table, entities in tables.items():
        for entity in entities:
            if connection.execute(f'SELECT 1 FROM {table} WHERE id=? AND map_id<>?', (entity.id, map_id)).fetchone():
                issues.append({'path': table, 'message': 'Entity ID already in use; assign a new UUID'})
    shape_ids: set[str] = set()
    for idx, shape in enumerate(document.shapes):
        path_prefix = f"shapes.{idx}"
        if shape.id in shape_ids:
            issues.append({"path": f"{path_prefix}.id", "message": "Duplicate shape id"})
        shape_ids.add(shape.id)
        for p_idx, pt in enumerate(shape.points):
            check_bounds(pt.x, pt.y, f"{path_prefix}.points.{p_idx}")
        if shape.kind == "wall":
            for p_idx in range(len(shape.points) - 1):
                p1, p2 = shape.points[p_idx], shape.points[p_idx + 1]
                if abs(p1.x - p2.x) < 1e-6 and abs(p1.y - p2.y) < 1e-6:
                    issues.append({"path": f"{path_prefix}.points.{p_idx + 1}", "message": "Wall segment cannot have zero length"})
        else:
            if len(shape.points) < 3:
                issues.append({"path": f"{path_prefix}.points", "message": "Room or corridor polygon requires at least 3 points"})
            else:
                distinct = {(round(pt.x, 6), round(pt.y, 6)) for pt in shape.points}
                area2 = 0.0
                pts = shape.points
                for i in range(len(pts)):
                    j = (i + 1) % len(pts)
                    area2 += pts[i].x * pts[j].y - pts[j].x * pts[i].y
                for a in range(len(pts)):
                    for b in range(a + 1, len(pts)):
                        if b == a + 1 or (a == 0 and b == len(pts) - 1):
                            continue
                        if _segments_intersect(pts[a], pts[(a+1) % len(pts)], pts[b], pts[(b+1) % len(pts)]):
                            issues.append({'path': f'{path_prefix}.points', 'message': 'Polygon cannot intersect itself'})
                            break
                if len(distinct) < 3 or abs(area2) < 1e-6:
                    issues.append({"path": f"{path_prefix}.points", "message": "Polygon must have non-zero area"})

    nodes_by_id: dict[str, object] = {}
    for idx, node in enumerate(document.nodes):
        path_prefix = f"nodes.{idx}"
        if node.id in nodes_by_id:
            issues.append({"path": f"{path_prefix}.id", "message": "Duplicate node id"})
        nodes_by_id[node.id] = node
        check_bounds(node.x, node.y, path_prefix)

    edge_ids: set[str] = set()
    edge_pairs: set[tuple[str, str]] = set()
    for idx, edge in enumerate(document.edges):
        path_prefix = f"edges.{idx}"
        if edge.id in edge_ids:
            issues.append({"path": f"{path_prefix}.id", "message": "Duplicate edge id"})
        edge_ids.add(edge.id)
        if edge.a not in nodes_by_id:
            issues.append({"path": f"{path_prefix}.a", "message": "Edge node 'a' does not exist"})
        if edge.b not in nodes_by_id:
            issues.append({"path": f"{path_prefix}.b", "message": "Edge node 'b' does not exist"})
        pair = (edge.a, edge.b)
        if pair in edge_pairs:
            issues.append({"path": path_prefix, "message": "Duplicate edge between the same nodes"})
        edge_pairs.add(pair)
        if edge.a in nodes_by_id and edge.b in nodes_by_id:
            na, nb = nodes_by_id[edge.a], nodes_by_id[edge.b]
            if abs(na.x - nb.x) < 1e-6 and abs(na.y - nb.y) < 1e-6:
                issues.append({"path": path_prefix, "message": "Edge endpoints cannot have identical coordinates"})

    poi_ids: set[str] = set()
    for idx, poi in enumerate(document.pois):
        path_prefix = f"pois.{idx}"
        if poi.id in poi_ids:
            issues.append({"path": f"{path_prefix}.id", "message": "Duplicate POI id"})
        poi_ids.add(poi.id)
        check_bounds(poi.x, poi.y, path_prefix)
        if poi.nav_node_id is not None and poi.nav_node_id not in nodes_by_id:
            issues.append({"path": f"{path_prefix}.nav_node_id", "message": "POI nav_node_id does not exist"})

    panorama_ids: set[str] = set()
    panorama_nodes: set[str] = set()
    for idx, panorama in enumerate(document.panoramas):
        path_prefix = f"panoramas.{idx}"
        if panorama.id in panorama_ids:
            issues.append({"path": f"{path_prefix}.id", "message": "Duplicate panorama id"})
        panorama_ids.add(panorama.id)
        check_bounds(panorama.x, panorama.y, path_prefix)
        asset_row = connection.execute(
            "SELECT kind FROM assets WHERE map_id=? AND id=?",
            (map_id, panorama.asset_id),
        ).fetchone()
        if asset_row is None or asset_row["kind"] != "panorama":
            issues.append({"path": f"{path_prefix}.asset_id", "message": "Panorama asset must belong to this map and have kind 'panorama'"})
        if panorama.nav_node_id is not None:
            if panorama.nav_node_id not in nodes_by_id:
                issues.append({"path": f"{path_prefix}.nav_node_id", "message": "Panorama nav_node_id does not exist"})
            elif panorama.nav_node_id in panorama_nodes:
                issues.append({"path": f"{path_prefix}.nav_node_id", "message": "At most one panorama can be attached to a navigation node"})
            else:
                panorama_nodes.add(panorama.nav_node_id)

    hotspot_ids: set[str] = set()
    hotspot_targets: set[tuple[str, str, str | None, str | None]] = set()
    for idx, hotspot in enumerate(document.hotspots):
        path_prefix = f"hotspots.{idx}"
        if hotspot.id in hotspot_ids:
            issues.append({"path": f"{path_prefix}.id", "message": "Duplicate hotspot id"})
        hotspot_ids.add(hotspot.id)
        if hotspot.panorama_id not in panorama_ids:
            issues.append({"path": f"{path_prefix}.panorama_id", "message": "Hotspot panorama_id does not exist"})
        if hotspot.kind == "poi":
            if hotspot.poi_id not in poi_ids:
                issues.append({"path": f"{path_prefix}.poi_id", "message": "Hotspot poi_id does not exist"})
        else:
            if hotspot.target_panorama_id not in panorama_ids:
                issues.append({"path": f"{path_prefix}.target_panorama_id", "message": "Hotspot target_panorama_id does not exist"})
            elif hotspot.target_panorama_id == hotspot.panorama_id:
                issues.append({"path": f"{path_prefix}.target_panorama_id", "message": "Transition hotspot cannot target its own panorama"})
        target_key = (hotspot.panorama_id, hotspot.kind, hotspot.poi_id, hotspot.target_panorama_id)
        if target_key in hotspot_targets:
            issues.append({"path": path_prefix, "message": "Duplicate hotspot target on the same panorama"})
        hotspot_targets.add(target_key)

    if issues:
        raise ApiError(422, "VALIDATION_ERROR", "Map document validation failed", issues=issues)

    if document.is_published and not document.pois:
        raise ApiError(422, "PUBLISH_BLOCKED", "A published map needs at least one POI")
