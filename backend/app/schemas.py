from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


UUID = Annotated[str, Field(pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")]
Coordinate = Annotated[float, Field(ge=0, le=100000, allow_inf_nan=False)]
Yaw = Annotated[float, Field(ge=-180, lt=180, allow_inf_nan=False)]
Pitch = Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)]


class ApiErrorDetail(StrictModel):
    code: str
    message: str
    issues: list[dict[str, str]]
    current_revision: int | None


class ApiErrorEnvelope(StrictModel):
    error: ApiErrorDetail


class User(StrictModel):
    id: UUID
    email: str
    role: Literal["organizer"]


class Session(StrictModel):
    user: User
    csrf_token: str
    expires_at: datetime


class Point(StrictModel):
    x: Coordinate
    y: Coordinate


class Shape(StrictModel):
    id: UUID
    kind: Literal["wall", "room", "corridor"]
    label: str = Field(max_length=160)
    points: list[Point] = Field(min_length=2, max_length=512)


class NavNode(StrictModel):
    id: UUID
    x: Coordinate
    y: Coordinate


class NavEdge(StrictModel):
    id: UUID
    a: UUID
    b: UUID

    @model_validator(mode="after")
    def canonical_order(self) -> "NavEdge":
        if self.a >= self.b:
            raise ValueError("a must be lexicographically smaller than b")
        return self


class Poi(StrictModel):
    id: UUID
    title: str = Field(min_length=1, max_length=160)
    category: Literal["booth", "hall", "entrance", "service_desk", "wifi", "custom"]
    category_label: str | None = Field(max_length=80)
    description: str = Field(max_length=4000)
    x: Coordinate
    y: Coordinate
    nav_node_id: UUID | None

    @model_validator(mode="after")
    def custom_category_has_label(self) -> "Poi":
        if (self.category == "custom") != (self.category_label is not None):
            raise ValueError("category_label is required only for custom category")
        return self


class Panorama(StrictModel):
    id: UUID
    asset_id: UUID
    title: str = Field(min_length=1, max_length=160)
    x: Coordinate
    y: Coordinate
    nav_node_id: UUID | None
    heading_offset_deg: Yaw


class Hotspot(StrictModel):
    id: UUID
    panorama_id: UUID
    kind: Literal["poi", "transition"]
    yaw_deg: Yaw
    pitch_deg: Pitch
    poi_id: UUID | None
    target_panorama_id: UUID | None

    @model_validator(mode="after")
    def target_matches_kind(self) -> "Hotspot":
        valid = ((self.kind == "poi" and self.poi_id is not None and self.target_panorama_id is None)
                 or (self.kind == "transition" and self.poi_id is None and self.target_panorama_id is not None))
        if not valid:
            raise ValueError("hotspot target fields must match kind")
        return self


class MapDocument(StrictModel):
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(max_length=4000)
    is_published: bool
    scale_m_per_unit: float | None
    max_walk_gap_units: float = Field(gt=0, le=1000000, allow_inf_nan=False)
    background_asset_id: UUID | None
    shapes: list[Shape] = Field(max_length=1000)
    nodes: list[NavNode] = Field(max_length=2000)
    edges: list[NavEdge] = Field(max_length=4000)
    pois: list[Poi] = Field(max_length=500)
    panoramas: list[Panorama] = Field(max_length=200)
    hotspots: list[Hotspot] = Field(max_length=4000)

    @field_validator("scale_m_per_unit")
    @classmethod
    def valid_scale(cls, value: float | None) -> float | None:
        if value is not None and (not 0 < value <= 1000):
            raise ValueError("scale_m_per_unit must be positive and at most 1000")
        return value

    @model_validator(mode="after")
    def unique_ids(self) -> "MapDocument":
        groups = (self.shapes, self.nodes, self.edges, self.pois, self.panoramas, self.hotspots)
        ids = [item.id for group in groups for item in group]
        if len(ids) != len(set(ids)):
            raise ValueError("IDs must be unique across a map document")
        return self


class CreateMapRequest(StrictModel):
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(max_length=4000)
    width_units: int = Field(ge=1, le=100000)
    height_units: int = Field(ge=1, le=100000)
    scale_m_per_unit: float | None
    max_walk_gap_units: float = Field(gt=0, le=1000000, allow_inf_nan=False)

    @field_validator("scale_m_per_unit")
    @classmethod
    def valid_scale(cls, value: float | None) -> float | None:
        if value is not None and (not 0 < value <= 1000):
            raise ValueError("scale_m_per_unit must be positive and at most 1000")
        return value


class LoginRequest(StrictModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=12, max_length=128)

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        local, separator, domain = normalized.partition("@")
        if not separator or not local or "." not in domain or domain.startswith(".") or domain.endswith("."):
            raise ValueError("email must be a valid address")
        return normalized


class RouteRequest(StrictModel):
    revision: int = Field(ge=1)
    from_node_id: UUID
    to_node_id: UUID


class CreateCaptureRequest(StrictModel):
    title: str = Field(min_length=1, max_length=160)
    x: Coordinate
    y: Coordinate
    hfov_hint_deg: float = Field(ge=40, le=85, allow_inf_nan=False)
