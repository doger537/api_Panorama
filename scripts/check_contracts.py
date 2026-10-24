from __future__ import annotations

import json
import runpy
import re
import sqlite3
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]


def check_openapi() -> None:
    document = yaml.safe_load((ROOT / "CONTRACTS/openapi.yaml").read_text(encoding="utf-8"))
    assert document.get("openapi") == "3.0.3"
    assert document.get("info", {}).get("title") == "TTKMap Space Map API"
    assert document.get("paths")

    def visit(value):
        if isinstance(value, dict):
            reference = value.get("$ref")
            if reference:
                assert reference.startswith("#/"), reference
                target = document
                for part in reference[2:].split("/"):
                    target = target[part.replace("~1", "/").replace("~0", "~")]
                assert target is not None, reference
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(document)
    assert "/api/v1/maps/{map_id}/document" in document["paths"]
    assert "/api/v1/public/maps/{slug}/route" in document["paths"]
    assert "/api/v1/items" not in document["paths"]


def check_schema() -> None:
    connection = sqlite3.connect(":memory:")
    connection.executescript((ROOT / "CONTRACTS/db_schema.sql").read_text(encoding="utf-8"))
    assert connection.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    assert connection.execute("PRAGMA user_version").fetchone()[0] == 1
    assert not connection.execute("PRAGMA foreign_key_check").fetchall()
    tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"maps", "pois", "panoramas", "hotspots", "captures", "capture_frames"} <= tables
    connection.close()


def check_task_graph() -> None:
    manifest = json.loads((ROOT / "TASKS/manifest.json").read_text(encoding="utf-8"))
    openapi = yaml.safe_load((ROOT / "CONTRACTS/openapi.yaml").read_text(encoding="utf-8"))
    tasks = {task["id"]: task for task in manifest["tasks"]}
    assert len(tasks) == len(manifest["tasks"])
    visiting: set[str] = set()
    complete: set[str] = set()

    def visit(task_id: str) -> None:
        assert task_id in tasks, f"unknown dependency {task_id}"
        assert task_id not in visiting, f"dependency cycle at {task_id}"
        if task_id in complete:
            return
        visiting.add(task_id)
        for dependency in tasks[task_id]["depends_on"]:
            assert dependency != task_id
            visit(dependency)
        visiting.remove(task_id)
        complete.add(task_id)

    for task_id in tasks:
        visit(task_id)

    def precedes(first: str, second: str) -> bool:
        return any(dep == first or precedes(first, dep) for dep in tasks[second]["depends_on"])

    def overlap(first: str, second: str) -> bool:
        if first == second:
            return True
        if first.endswith("/**") and second.startswith(first[:-2]):
            return True
        if second.endswith("/**") and first.startswith(second[:-2]):
            return True
        return False

    def owns(pattern: str, path: str) -> bool:
        return pattern == path or (pattern.endswith("/**") and path.startswith(pattern[:-2]))

    for task in tasks.values():
        assert re.fullmatch(r"[A-Za-z0-9_-]{1,64}", task["id"])
        command = task["verify_cmd"]
        if command is not None:
            assert not any(token in command for token in ("|", ";", "&&", "||", ">", "<", "\n")), (task["id"], command)
            assert not re.search(r"(^|\s)cd(\s|$)", command), (task["id"], command)

        for context_file in task["context_files"]:
            if context_file.startswith("CONTRACTS/") or (ROOT / context_file).is_file():
                continue
            producers = [
                source["id"]
                for source in tasks.values()
                if source["id"] != task["id"]
                and any(owns(pattern, context_file) for pattern in source["allowed_paths"])
                and precedes(source["id"], task["id"])
            ]
            assert producers, (task["id"], "context has no predecessor", context_file)

        for reference in task["contract_refs"]:
            if reference.startswith("#/"):
                target = openapi
                for part in reference[2:].split("/"):
                    target = target[part.replace("~1", "/").replace("~0", "~")]
                assert target is not None
            elif reference.startswith("/api/"):
                assert reference in openapi["paths"], (task["id"], reference)
            elif reference.startswith("CONTRACTS/"):
                assert (ROOT / reference).is_file(), (task["id"], reference)

    task_list = list(tasks.values())
    for index, first in enumerate(task_list):
        assert re.fullmatch(r"[A-Za-z0-9_-]{1,64}", first["id"])
        for second in task_list[index + 1:]:
            conflicts = any(overlap(left, right) for left in first["allowed_paths"] for right in second["allowed_paths"])
            assert not conflicts or precedes(first["id"], second["id"]) or precedes(second["id"], first["id"]), (first["id"], second["id"])


if __name__ == "__main__":
    check_openapi()
    check_schema()
    check_task_graph()
    assert (ROOT / 'TASKS/WORKPLAN.md').read_text() == runpy.run_path(str(ROOT / 'scripts/render_workplan.py'))['render'](), 'WORKPLAN drift'
    assert (ROOT / 'CONTRACTS/types.ts').read_text() == runpy.run_path(str(ROOT / 'scripts/generate_types.py'))['generate'](), 'DTO drift'
    print("TTKMap contracts, SQLite schema and task graph are valid")
