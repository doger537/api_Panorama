from __future__ import annotations

from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from backend.app.config import settings
from backend.app.db import initialize_database
from backend.app.main import create_app
from scripts.seed_demo import PLAZA_SLUG, seed_demo_data


@pytest.fixture()
def client(tmp_path: Path):
    db_file = tmp_path / "routing_test.sqlite"
    media_dir = tmp_path / "media"
    orig_db, orig_media, orig_origin = settings.database_path, settings.media_path, settings.app_origin
    object.__setattr__(settings, "database_path", db_file)
    object.__setattr__(settings, "media_path", media_dir)
    object.__setattr__(settings, "app_origin", "http://testserver")
    try:
        initialize_database(db_file)
        media_dir.mkdir(parents=True, exist_ok=True)
        seed_demo_data()
        with TestClient(create_app()) as c:
            yield c
    finally:
        object.__setattr__(settings, "database_path", orig_db)
        object.__setattr__(settings, "media_path", orig_media)
        object.__setattr__(settings, "app_origin", orig_origin)


def test_public_snapshot_etag_and_dijkstra_walk(client: TestClient):
    res = client.get(f"/api/v1/public/maps/{PLAZA_SLUG}")
    assert res.status_code == 200
    etag = res.headers["ETag"]
    body = res.json()
    assert "owner_id" not in body

    # Conditional 304
    assert client.get(f"/api/v1/public/maps/{PLAZA_SLUG}", headers={"If-None-Match": etag}).status_code == 304

    # Route with panorama walk
    nodes = body["document"]["nodes"]
    route = client.post(
        f"/api/v1/public/maps/{PLAZA_SLUG}/route",
        json={"revision": body["revision"], "from_node_id": nodes[0]["id"], "to_node_id": nodes[3]["id"]},
    )
    assert route.status_code == 200
    rdata = route.json()
    assert len(rdata["node_ids"]) == 3
    assert rdata["walk"]["available"] is True
    assert len(rdata["walk"]["steps"]) == 3
