from __future__ import annotations

from datetime import datetime, timezone
import json
import struct
import zlib
from pathlib import Path

from backend.app.auth import hash_password
from backend.app.config import settings
from backend.app.db import database, initialize_database, transaction
from backend.app.modules.media.storage import AssetStore


DEMO_ORGANIZER_ID = "00000000-0000-4000-8000-000000000099"
DEMO_ORGANIZER_EMAIL = "alexey@ttk.ru"
DEMO_ORGANIZER_PASSWORD = "ttkmap-organizer-2026"

PLAZA_SLUG = "ttkplazabusinesscenteraaaa"
EXPO_SLUG = "ttkexpocitypavilionmapaaaa"
HOTEL_SLUG = "ttkgrandcityhotelspaceaaaa"


def make_png_bytes(width: int = 800, height: int = 400, rgb: tuple[int, int, int] = (227, 27, 35)) -> bytes:
    """Create a valid minimal RGB PNG image using standard library only."""
    row = b"\x00" + bytes(rgb) * width
    raw = row * height

    def chunk(tag: bytes, body: bytes) -> bytes:
        crc = zlib.crc32(tag + body) & 0xFFFFFFFF
        return struct.pack(">I", len(body)) + tag + body + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    idat = zlib.compress(raw, level=1)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def seed_demo_data(force: bool = False) -> dict[str, str]:
    initialize_database()
    settings.media_path.mkdir(parents=True, exist_ok=True)
    store = AssetStore(settings.media_path)
    now = _now()

    with database() as connection:
        with transaction(connection, immediate=True):
            existing_user = connection.execute("SELECT id FROM users WHERE email=?", (DEMO_ORGANIZER_EMAIL,)).fetchone()
            if existing_user is not None and not force:
                existing_maps = {
                    row["slug"]: row["id"]
                    for row in connection.execute("SELECT id,slug FROM maps WHERE slug IN (?,?,?)", (PLAZA_SLUG, EXPO_SLUG, HOTEL_SLUG))
                }
                if len(existing_maps) == 3:
                    return existing_maps

            if existing_user is None:
                user_id = DEMO_ORGANIZER_ID
                connection.execute(
                    "INSERT INTO users(id,email,password_hash,role,created_at) VALUES(?,?,?,?,?)",
                    (user_id, DEMO_ORGANIZER_EMAIL, hash_password(DEMO_ORGANIZER_PASSWORD), "organizer", now),
                )
            else:
                user_id = existing_user["id"]

            spaces = [
                {
                    "map_id": "00000000-0000-4000-8000-000000000101",
                    "slug": PLAZA_SLUG,
                    "title": "Бизнес-центр «ТТК Плаза»",
                    "description": "Главный офис ТрансТелеком. Переговорные комнаты, серверные, кофе-пойнты и зоны отдыха.",
                    "scale": 0.1,
                    "rgb": (227, 27, 35),
                    "shapes": [
                        {
                            "id": "00000000-0000-4000-8000-000000001001",
                            "kind": "room",
                            "label": "Зона ресепшн",
                            "points": [{"x": 40, "y": 40}, {"x": 220, "y": 40}, {"x": 220, "y": 460}, {"x": 40, "y": 460}],
                        },
                        {
                            "id": "00000000-0000-4000-8000-000000001002",
                            "kind": "room",
                            "label": "Переговорная Альфа",
                            "points": [{"x": 220, "y": 40}, {"x": 480, "y": 40}, {"x": 480, "y": 250}, {"x": 220, "y": 250}],
                        },
                        {
                            "id": "00000000-0000-4000-8000-000000001003",
                            "kind": "room",
                            "label": "Главный Конференц-Зал",
                            "points": [{"x": 220, "y": 250}, {"x": 660, "y": 250}, {"x": 660, "y": 460}, {"x": 220, "y": 460}],
                        },
                        {
                            "id": "00000000-0000-4000-8000-000000001004",
                            "kind": "wall",
                            "label": "Внешний контур",
                            "points": [{"x": 40, "y": 40}, {"x": 660, "y": 40}, {"x": 660, "y": 460}, {"x": 40, "y": 460}, {"x": 40, "y": 40}],
                        },
                    ],
                    "nodes": [
                        {"id": "00000000-0000-4000-8000-000000002001", "x": 175.0, "y": 150.0},
                        {"id": "00000000-0000-4000-8000-000000002002", "x": 385.0, "y": 150.0},
                        {"id": "00000000-0000-4000-8000-000000002003", "x": 280.0, "y": 350.0},
                        {"id": "00000000-0000-4000-8000-000000002004", "x": 540.0, "y": 150.0},
                    ],
                    "edges": [
                        {"id": "00000000-0000-4000-8000-000000003001", "a": "00000000-0000-4000-8000-000000002001", "b": "00000000-0000-4000-8000-000000002002"},
                        {"id": "00000000-0000-4000-8000-000000003002", "a": "00000000-0000-4000-8000-000000002002", "b": "00000000-0000-4000-8000-000000002003"},
                        {"id": "00000000-0000-4000-8000-000000003003", "a": "00000000-0000-4000-8000-000000002001", "b": "00000000-0000-4000-8000-000000002003"},
                        {"id": "00000000-0000-4000-8000-000000003004", "a": "00000000-0000-4000-8000-000000002002", "b": "00000000-0000-4000-8000-000000002004"},
                    ],
                    "pois": [
                        {
                            "id": "00000000-0000-4000-8000-000000004001",
                            "title": "Central Lobby & Reception",
                            "category": "entrance",
                            "category_label": None,
                            "description": "Корпус A, Этаж 1 | Свободно | 50 человек | Стойка информации, Турникеты, Инфо-терминал | TTK_Guest_5G (до 500 Мбит/с)",
                            "x": 175.0,
                            "y": 150.0,
                            "nav_node_id": "00000000-0000-4000-8000-000000002001",
                        },
                        {
                            "id": "00000000-0000-4000-8000-000000004002",
                            "title": "Переговорная Альфа",
                            "category": "hall",
                            "category_label": None,
                            "description": "Корпус A, Этаж 3 | Свободно | 10 человек | Проектор 4K, маркерная доска, ВКС Cisco | TTK_VIP_Conference",
                            "x": 385.0,
                            "y": 150.0,
                            "nav_node_id": "00000000-0000-4000-8000-000000002002",
                        },
                        {
                            "id": "00000000-0000-4000-8000-000000004003",
                            "title": "Главный Конференц-Зал",
                            "category": "hall",
                            "category_label": None,
                            "description": "Корпус B, Этаж 2 | Занято | 120 человек | Сцена, LED-экран 8x4m, Радиомикрофоны | TTK_Event_Free",
                            "x": 280.0,
                            "y": 350.0,
                            "nav_node_id": "00000000-0000-4000-8000-000000002003",
                        },
                        {
                            "id": "00000000-0000-4000-8000-000000004004",
                            "title": "Зона высокоскоростного Wi-Fi ТТК",
                            "category": "wifi",
                            "category_label": None,
                            "description": "Корпус A, Этаж 2 | Свободно | 30 человек | Коворкинг, розетки 220V, принтер | TTK_Ultra_WiFi6",
                            "x": 540.0,
                            "y": 150.0,
                            "nav_node_id": "00000000-0000-4000-8000-000000002004",
                        },
                    ],
                    "panoramas": [
                        {
                            "id": "00000000-0000-4000-8000-000000005001",
                            "asset_id": "00000000-0000-4000-8000-000000006001",
                            "title": "Панорама: Central Lobby & Reception",
                            "x": 175.0,
                            "y": 150.0,
                            "nav_node_id": "00000000-0000-4000-8000-000000002001",
                            "heading_offset_deg": 0.0,
                        },
                        {
                            "id": "00000000-0000-4000-8000-000000005002",
                            "asset_id": "00000000-0000-4000-8000-000000006002",
                            "title": "Панорама: Переговорная Альфа",
                            "x": 385.0,
                            "y": 150.0,
                            "nav_node_id": "00000000-0000-4000-8000-000000002002",
                            "heading_offset_deg": 0.0,
                        },
                        {
                            "id": "00000000-0000-4000-8000-000000005003",
                            "asset_id": "00000000-0000-4000-8000-000000006003",
                            "title": "Панорама: Главный Конференц-Зал",
                            "x": 280.0,
                            "y": 350.0,
                            "nav_node_id": "00000000-0000-4000-8000-000000002003",
                            "heading_offset_deg": 0.0,
                        },
                        {
                            "id": "00000000-0000-4000-8000-000000005004",
                            "asset_id": "00000000-0000-4000-8000-000000006004",
                            "title": "Панорама: Коворкинг и Wi-Fi ТТК",
                            "x": 540.0,
                            "y": 150.0,
                            "nav_node_id": "00000000-0000-4000-8000-000000002004",
                            "heading_offset_deg": 0.0,
                        },
                    ],
                    "hotspots": [
                        {"id": "00000000-0000-4000-8000-000000007001", "panorama_id": "00000000-0000-4000-8000-000000005001", "kind": "poi", "yaw_deg": 0.0, "pitch_deg": 0.0, "poi_id": "00000000-0000-4000-8000-000000004001", "target_panorama_id": None},
                        {"id": "00000000-0000-4000-8000-000000007002", "panorama_id": "00000000-0000-4000-8000-000000005001", "kind": "transition", "yaw_deg": 90.0, "pitch_deg": -5.0, "poi_id": None, "target_panorama_id": "00000000-0000-4000-8000-000000005002"},
                        {"id": "00000000-0000-4000-8000-000000007003", "panorama_id": "00000000-0000-4000-8000-000000005001", "kind": "transition", "yaw_deg": 150.0, "pitch_deg": -5.0, "poi_id": None, "target_panorama_id": "00000000-0000-4000-8000-000000005003"},
                        {"id": "00000000-0000-4000-8000-000000007004", "panorama_id": "00000000-0000-4000-8000-000000005002", "kind": "poi", "yaw_deg": 15.0, "pitch_deg": 0.0, "poi_id": "00000000-0000-4000-8000-000000004002", "target_panorama_id": None},
                        {"id": "00000000-0000-4000-8000-000000007005", "panorama_id": "00000000-0000-4000-8000-000000005002", "kind": "transition", "yaw_deg": -90.0, "pitch_deg": -5.0, "poi_id": None, "target_panorama_id": "00000000-0000-4000-8000-000000005001"},
                        {"id": "00000000-0000-4000-8000-000000007006", "panorama_id": "00000000-0000-4000-8000-000000005002", "kind": "transition", "yaw_deg": -150.0, "pitch_deg": -5.0, "poi_id": None, "target_panorama_id": "00000000-0000-4000-8000-000000005003"},
                        {"id": "00000000-0000-4000-8000-000000007007", "panorama_id": "00000000-0000-4000-8000-000000005002", "kind": "transition", "yaw_deg": 90.0, "pitch_deg": -5.0, "poi_id": None, "target_panorama_id": "00000000-0000-4000-8000-000000005004"},
                        {"id": "00000000-0000-4000-8000-000000007008", "panorama_id": "00000000-0000-4000-8000-000000005003", "kind": "poi", "yaw_deg": 0.0, "pitch_deg": 5.0, "poi_id": "00000000-0000-4000-8000-000000004003", "target_panorama_id": None},
                        {"id": "00000000-0000-4000-8000-000000007009", "panorama_id": "00000000-0000-4000-8000-000000005003", "kind": "transition", "yaw_deg": -30.0, "pitch_deg": -5.0, "poi_id": None, "target_panorama_id": "00000000-0000-4000-8000-000000005001"},
                        {"id": "00000000-0000-4000-8000-000000007010", "panorama_id": "00000000-0000-4000-8000-000000005003", "kind": "transition", "yaw_deg": 30.0, "pitch_deg": -5.0, "poi_id": None, "target_panorama_id": "00000000-0000-4000-8000-000000005002"},
                        {"id": "00000000-0000-4000-8000-000000007011", "panorama_id": "00000000-0000-4000-8000-000000005004", "kind": "poi", "yaw_deg": 0.0, "pitch_deg": 0.0, "poi_id": "00000000-0000-4000-8000-000000004004", "target_panorama_id": None},
                        {"id": "00000000-0000-4000-8000-000000007012", "panorama_id": "00000000-0000-4000-8000-000000005004", "kind": "transition", "yaw_deg": -90.0, "pitch_deg": -5.0, "poi_id": None, "target_panorama_id": "00000000-0000-4000-8000-000000005002"},
                    ],
                },
                {
                    "map_id": "00000000-0000-4000-8000-000000000102",
                    "slug": EXPO_SLUG,
                    "title": "Выставочный комплекс «Экспо-Сити»",
                    "description": "Инновационный форум связи и телекоммуникаций. Стенды партнёров и зоны нетворкинга.",
                    "scale": 0.15,
                    "rgb": (15, 23, 42),
                    "shapes": [
                        {
                            "id": "00000000-0000-4000-8000-000000011001",
                            "kind": "room",
                            "label": "Павильон №1 — Главный холл",
                            "points": [{"x": 40, "y": 40}, {"x": 660, "y": 40}, {"x": 660, "y": 460}, {"x": 40, "y": 460}],
                        },
                    ],
                    "nodes": [
                        {"id": "00000000-0000-4000-8000-000000012001", "x": 210.0, "y": 200.0},
                        {"id": "00000000-0000-4000-8000-000000012002", "x": 490.0, "y": 200.0},
                    ],
                    "edges": [
                        {"id": "00000000-0000-4000-8000-000000013001", "a": "00000000-0000-4000-8000-000000012001", "b": "00000000-0000-4000-8000-000000012002"},
                    ],
                    "pois": [
                        {
                            "id": "00000000-0000-4000-8000-000000014001",
                            "title": "Главный вход павильона А",
                            "category": "entrance",
                            "category_label": None,
                            "description": "Корпус A, Этаж 1 | Свободно | 200+ человек | Рамки металлодетекторов, Регистрация QR | Expo_Public_WiFi",
                            "x": 210.0,
                            "y": 200.0,
                            "nav_node_id": "00000000-0000-4000-8000-000000012001",
                        },
                        {
                            "id": "00000000-0000-4000-8000-000000014002",
                            "title": "Стенд ТТК Digital & B2B",
                            "category": "booth",
                            "category_label": None,
                            "description": "Корпус A, Этаж 1 | Свободно | 80 человек | Демо-терминалы, VR-зона, переговорные капсулы | TTK_Expo_5G",
                            "x": 490.0,
                            "y": 200.0,
                            "nav_node_id": "00000000-0000-4000-8000-000000012002",
                        },
                    ],
                    "panoramas": [
                        {
                            "id": "00000000-0000-4000-8000-000000015001",
                            "asset_id": "00000000-0000-4000-8000-000000016001",
                            "title": "Панорама: Главный вход павильона А",
                            "x": 210.0,
                            "y": 200.0,
                            "nav_node_id": "00000000-0000-4000-8000-000000012001",
                            "heading_offset_deg": 0.0,
                        },
                        {
                            "id": "00000000-0000-4000-8000-000000015002",
                            "asset_id": "00000000-0000-4000-8000-000000016002",
                            "title": "Панорама: Стенд ТТК Digital",
                            "x": 490.0,
                            "y": 200.0,
                            "nav_node_id": "00000000-0000-4000-8000-000000012002",
                            "heading_offset_deg": 0.0,
                        },
                    ],
                    "hotspots": [
                        {"id": "00000000-0000-4000-8000-000000017001", "panorama_id": "00000000-0000-4000-8000-000000015001", "kind": "poi", "yaw_deg": 0.0, "pitch_deg": 0.0, "poi_id": "00000000-0000-4000-8000-000000014001", "target_panorama_id": None},
                        {"id": "00000000-0000-4000-8000-000000017002", "panorama_id": "00000000-0000-4000-8000-000000015001", "kind": "transition", "yaw_deg": 90.0, "pitch_deg": -5.0, "poi_id": None, "target_panorama_id": "00000000-0000-4000-8000-000000015002"},
                        {"id": "00000000-0000-4000-8000-000000017003", "panorama_id": "00000000-0000-4000-8000-000000015002", "kind": "poi", "yaw_deg": 0.0, "pitch_deg": 0.0, "poi_id": "00000000-0000-4000-8000-000000014002", "target_panorama_id": None},
                        {"id": "00000000-0000-4000-8000-000000017004", "panorama_id": "00000000-0000-4000-8000-000000015002", "kind": "transition", "yaw_deg": -90.0, "pitch_deg": -5.0, "poi_id": None, "target_panorama_id": "00000000-0000-4000-8000-000000015001"},
                    ],
                },
                {
                    "map_id": "00000000-0000-4000-8000-000000000103",
                    "slug": HOTEL_SLUG,
                    "title": "Отель «Гранд Сити»",
                    "description": "Конференц-отель с панорамными номерами, спа-комплексом и ресторанами высокой кухни.",
                    "scale": 0.12,
                    "rgb": (30, 41, 59),
                    "shapes": [
                        {
                            "id": "00000000-0000-4000-8000-000000021001",
                            "kind": "room",
                            "label": "Гранд Лобби и Атриум",
                            "points": [{"x": 40, "y": 40}, {"x": 660, "y": 40}, {"x": 660, "y": 460}, {"x": 40, "y": 460}],
                        },
                    ],
                    "nodes": [
                        {"id": "00000000-0000-4000-8000-000000022001", "x": 350.0, "y": 250.0},
                        {"id": "00000000-0000-4000-8000-000000022002", "x": 520.0, "y": 340.0},
                    ],
                    "edges": [
                        {"id": "00000000-0000-4000-8000-000000023001", "a": "00000000-0000-4000-8000-000000022001", "b": "00000000-0000-4000-8000-000000022002"},
                    ],
                    "pois": [
                        {
                            "id": "00000000-0000-4000-8000-000000024001",
                            "title": "Ресепшн и Лобби",
                            "category": "entrance",
                            "category_label": None,
                            "description": "Корпус A, Этаж 1 | Свободно | 40 человек | Стойка регистрации, консьерж | GrandCity_Guest",
                            "x": 350.0,
                            "y": 250.0,
                            "nav_node_id": "00000000-0000-4000-8000-000000022001",
                        },
                        {
                            "id": "00000000-0000-4000-8000-000000024002",
                            "title": "Банкетный зал «Империал»",
                            "category": "hall",
                            "category_label": None,
                            "description": "Корпус A, Этаж 2 | Свободно | 150 человек | Акустическая система, проекторы, подиум | GrandCity_VIP_5G",
                            "x": 520.0,
                            "y": 340.0,
                            "nav_node_id": "00000000-0000-4000-8000-000000022002",
                        },
                    ],
                    "panoramas": [
                        {
                            "id": "00000000-0000-4000-8000-000000025001",
                            "asset_id": "00000000-0000-4000-8000-000000026001",
                            "title": "Панорама: Ресепшн и Лобби",
                            "x": 350.0,
                            "y": 250.0,
                            "nav_node_id": "00000000-0000-4000-8000-000000022001",
                            "heading_offset_deg": 0.0,
                        },
                        {
                            "id": "00000000-0000-4000-8000-000000025002",
                            "asset_id": "00000000-0000-4000-8000-000000026002",
                            "title": "Панорама: Банкетный зал «Империал»",
                            "x": 520.0,
                            "y": 340.0,
                            "nav_node_id": "00000000-0000-4000-8000-000000022002",
                            "heading_offset_deg": 0.0,
                        },
                    ],
                    "hotspots": [
                        {"id": "00000000-0000-4000-8000-000000027001", "panorama_id": "00000000-0000-4000-8000-000000025001", "kind": "poi", "yaw_deg": 0.0, "pitch_deg": 0.0, "poi_id": "00000000-0000-4000-8000-000000024001", "target_panorama_id": None},
                        {"id": "00000000-0000-4000-8000-000000027002", "panorama_id": "00000000-0000-4000-8000-000000025001", "kind": "transition", "yaw_deg": 115.0, "pitch_deg": -5.0, "poi_id": None, "target_panorama_id": "00000000-0000-4000-8000-000000025002"},
                        {"id": "00000000-0000-4000-8000-000000027003", "panorama_id": "00000000-0000-4000-8000-000000025002", "kind": "poi", "yaw_deg": 0.0, "pitch_deg": 0.0, "poi_id": "00000000-0000-4000-8000-000000024002", "target_panorama_id": None},
                        {"id": "00000000-0000-4000-8000-000000027004", "panorama_id": "00000000-0000-4000-8000-000000025002", "kind": "transition", "yaw_deg": -65.0, "pitch_deg": -5.0, "poi_id": None, "target_panorama_id": "00000000-0000-4000-8000-000000025001"},
                    ],
                },
            ]

            png_cache: dict[tuple[int, int, int], bytes] = {}
            result_slugs: dict[str, str] = {}

            for sp in spaces:
                map_id = sp["map_id"]
                slug = sp["slug"]
                result_slugs[slug] = map_id
                exists = connection.execute("SELECT id FROM maps WHERE id=? OR slug=?", (map_id, slug)).fetchone()
                if exists is not None:
                    continue

                connection.execute(
                    "INSERT INTO maps(id,owner_id,slug,title,description,is_published,revision,width_units,height_units,scale_m_per_unit,max_walk_gap_units,created_at,updated_at) "
                    "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (map_id, user_id, slug, sp["title"], sp["description"], 1, 1, 700, 500, sp["scale"], 500.0, now, now),
                )

                rgb = sp["rgb"]
                if rgb not in png_cache:
                    png_cache[rgb] = make_png_bytes(800, 400, rgb)
                raw_png = png_cache[rgb]

                for pano in sp["panoramas"]:
                    asset_id = pano["asset_id"]
                    preview_key, mobile_key, full_key, fw, fh = store.store_asset_variants(asset_id, raw_png, 800, 400)
                    connection.execute(
                        "INSERT INTO assets(id,map_id,kind,source,width_px,height_px,projection,haov_deg,vaov_deg,v_offset_deg,preview_key,mobile_key,full_key,created_at) "
                        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        (asset_id, map_id, "panorama", "upload", fw, fh, "equirectangular", 360, 180.0, 0.0, preview_key, mobile_key, full_key, now),
                    )

                for shape in sp["shapes"]:
                    pts = json.dumps(shape["points"], separators=(",", ":"))
                    connection.execute(
                        "INSERT INTO shapes(id,map_id,kind,label,points_json) VALUES(?,?,?,?,?)",
                        (shape["id"], map_id, shape["kind"], shape["label"], pts),
                    )
                for node in sp["nodes"]:
                    connection.execute(
                        "INSERT INTO nav_nodes(id,map_id,x,y) VALUES(?,?,?,?)",
                        (node["id"], map_id, node["x"], node["y"]),
                    )
                for edge in sp["edges"]:
                    connection.execute(
                        "INSERT INTO nav_edges(id,map_id,a,b) VALUES(?,?,?,?)",
                        (edge["id"], map_id, edge["a"], edge["b"]),
                    )
                for poi in sp["pois"]:
                    connection.execute(
                        "INSERT INTO pois(id,map_id,title,category,category_label,description,x,y,nav_node_id) VALUES(?,?,?,?,?,?,?,?,?)",
                        (poi["id"], map_id, poi["title"], poi["category"], poi["category_label"], poi["description"], poi["x"], poi["y"], poi["nav_node_id"]),
                    )
                for pano in sp["panoramas"]:
                    connection.execute(
                        "INSERT INTO panoramas(id,map_id,asset_id,title,x,y,nav_node_id,heading_offset_deg) VALUES(?,?,?,?,?,?,?,?)",
                        (pano["id"], map_id, pano["asset_id"], pano["title"], pano["x"], pano["y"], pano["nav_node_id"], pano["heading_offset_deg"]),
                    )
                for hs in sp["hotspots"]:
                    connection.execute(
                        "INSERT INTO hotspots(id,map_id,panorama_id,kind,yaw_deg,pitch_deg,poi_id,target_panorama_id) VALUES(?,?,?,?,?,?,?,?)",
                        (hs["id"], map_id, hs["panorama_id"], hs["kind"], hs["yaw_deg"], hs["pitch_deg"], hs["poi_id"], hs["target_panorama_id"]),
                    )

            return result_slugs


if __name__ == "__main__":
    seeded = seed_demo_data()
    print("Seeded TTKMap demo spaces:", json.dumps(seeded, ensure_ascii=False))
