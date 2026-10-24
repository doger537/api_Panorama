from dataclasses import dataclass
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.app.auth import clear_login_failures, create_organizer
from backend.app.config import settings
from backend.app.main import create_app


def frame_bytes(color="red", fmt="PNG", size=(80, 60)):
    output = BytesIO()
    Image.new("RGB", size, color).save(output, format=fmt)
    return output.getvalue()


@dataclass
class CaptureAPI:
    client: TestClient
    headers: dict
    map_id: str
    capture_id: str

    @property
    def url(self):
        return f"/api/v1/maps/{self.map_id}/captures/{self.capture_id}"

    def upload(self, index=0, raw=None):
        return self.client.put(
            f"{self.url}/frames/{index}", headers=self.headers,
            files={"file": ("frame.png", frame_bytes() if raw is None else raw, "image/png")},
        )

    def fill(self):
        # Synthetic API fixtures only: never evidence of real stitching.
        for index in range(16):
            assert self.upload(index, frame_bytes((index * 10, 40, 90))).status_code == 200

    def post(self, action):
        return self.client.post(f"{self.url}/{action}", headers=self.headers)


@pytest.fixture
def capture_api(tmp_path):
    original = {key: getattr(settings, key) for key in ("database_path", "media_path", "app_origin", "cookie_secure")}
    for key, value in dict(database_path=tmp_path / "capture.sqlite", media_path=tmp_path / "media",
                           app_origin="http://testserver", cookie_secure=False).items():
        object.__setattr__(settings, key, value)
    try:
        clear_login_failures()
        with TestClient(create_app()) as client:
            create_organizer("owner@example.test", "valid-password-123")
            origin = {"Origin": settings.app_origin}
            login = client.post("/api/v1/auth/login", headers=origin,
                                json={"email": "owner@example.test", "password": "valid-password-123"})
            assert login.status_code == 200
            headers = {**origin, "X-CSRF-Token": login.json()["csrf_token"]}
            response = client.post("/api/v1/maps", headers=headers, json={
                "title": "Map", "width_units": 500, "height_units": 500,
                "description": "", "scale_m_per_unit": None, "max_walk_gap_units": 100,
            })
            assert response.status_code == 201
            map_id = response.json()["snapshot"]["id"]
            response = client.post(f"/api/v1/maps/{map_id}/captures", headers=headers,
                                   json={"title": "Capture", "x": 50, "y": 50, "hfov_hint_deg": 60})
            assert response.status_code == 201
            yield CaptureAPI(client, headers, map_id, response.json()["id"])
    finally:
        clear_login_failures()
        for key, value in original.items():
            object.__setattr__(settings, key, value)
