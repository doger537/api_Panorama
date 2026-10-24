from __future__ import annotations

from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]


def test_openapi_refs_resolve():
    document = yaml.safe_load((ROOT / "CONTRACTS/openapi.yaml").read_text(encoding="utf-8"))
    assert document["openapi"] == "3.0.3"
    assert document["info"]["title"] == "TTKMap Space Map API"
    assert document["paths"]

    def visit(value):
        if isinstance(value, dict):
            reference = value.get("$ref")
            if reference:
                assert reference.startswith("#/"), reference
                target = document
                for part in reference[2:].split("/"):
                    target = target[part.replace("~1", "/").replace("~0", "~")]
                assert target is not None
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(document)


def test_api_is_ttkmap_not_items_crud():
    document = yaml.safe_load((ROOT / "CONTRACTS/openapi.yaml").read_text(encoding="utf-8"))
    paths = document["paths"]
    assert "/api/v1/maps/{map_id}/document" in paths
    assert "/api/v1/public/maps/{slug}/route" in paths
    assert "/api/v1/items" not in paths


def test_types_cover_core_map_and_capture_schemas():
    source = (ROOT / "CONTRACTS/types.ts").read_text(encoding="utf-8")
    for type_name in ("MapDocument", "Poi", "Panorama", "Hotspot", "Capture", "RouteResponse"):
        assert f"type {type_name} =" in source
