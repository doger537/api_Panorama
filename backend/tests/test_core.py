from __future__ import annotations

import sqlite3

import pytest


def test_schema_has_space_map_tables(db):
    names = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"users", "maps", "shapes", "pois", "panoramas", "hotspots", "captures"} <= names


def test_foreign_keys_are_enabled(db):
    assert db.execute("PRAGMA foreign_keys").fetchone()[0] == 1


def test_map_slug_and_extent_are_immutable(db):
    db.execute("INSERT INTO users(id,email,password_hash) VALUES(?,?,?)", ("00000000-0000-4000-8000-000000000001", "a@example.test", "$argon2id$v=19$m=65536,t=3,p=4$fixture$fixture"))
    db.execute("INSERT INTO maps(id,owner_id,slug,title,width_units,height_units,max_walk_gap_units) VALUES(?,?,?,?,?,?,?)", ("00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000001", "aaaaaaaaaaaaaaaaaaaaaaaaaa", "Map", 100, 100, 50))
    try:
        db.execute("UPDATE maps SET width_units=200 WHERE id=?", ("00000000-0000-4000-8000-000000000002",))
    except sqlite3.IntegrityError:
        pass
    else:
        raise AssertionError("map extent changed")


def test_capture_state_machine_rejects_skipped_state(db):
    user_id = "00000000-0000-4000-8000-000000000011"
    map_id = "00000000-0000-4000-8000-000000000012"
    capture_id = "00000000-0000-4000-8000-000000000013"
    db.execute("INSERT INTO users(id,email,password_hash) VALUES(?,?,?)", (user_id, "b@example.test", "$argon2id$v=19$m=65536,t=3,p=4$fixture$fixture"))
    db.execute("INSERT INTO maps(id,owner_id,slug,title,width_units,height_units,max_walk_gap_units) VALUES(?,?,?,?,?,?,?)", (map_id, user_id, "bbbbbbbbbbbbbbbbbbbbbbbbbb", "Capture map", 100, 100, 25))
    db.execute("INSERT INTO captures(id,map_id,title,x,y,hfov_hint_deg) VALUES(?,?,?,?,?,?)", (capture_id, map_id, "Capture", 10, 10, 60))

    with pytest.raises(sqlite3.IntegrityError):
        db.execute("UPDATE captures SET state='failed',attempt=1,progress=1,finished_at='2026-01-01T00:00:00Z',error_code='TOOL_FAILED',error_message='failed' WHERE id=?", (capture_id,))


def test_capture_frames_are_sealed_after_queueing(db):
    user_id = "00000000-0000-4000-8000-000000000021"
    map_id = "00000000-0000-4000-8000-000000000022"
    capture_id = "00000000-0000-4000-8000-000000000023"
    db.execute("INSERT INTO users(id,email,password_hash) VALUES(?,?,?)", (user_id, "c@example.test", "$argon2id$v=19$m=65536,t=3,p=4$fixture$fixture"))
    db.execute("INSERT INTO maps(id,owner_id,slug,title,width_units,height_units,max_walk_gap_units) VALUES(?,?,?,?,?,?,?)", (map_id, user_id, "cccccccccccccccccccccccccc", "Frame map", 100, 100, 25))
    db.execute("INSERT INTO captures(id,map_id,title,x,y,hfov_hint_deg) VALUES(?,?,?,?,?,?)", (capture_id, map_id, "Capture", 10, 10, 60))
    db.execute("INSERT INTO capture_frames(capture_id,frame_index,sha256,storage_key,width_px,height_px) VALUES(?,?,?,?,?,?)", (capture_id, 0, "a" * 64, "frame-0", 1200, 800))
    db.execute("UPDATE captures SET state='queued',attempt=1 WHERE id=?", (capture_id,))

    with pytest.raises(sqlite3.IntegrityError):
        db.execute("UPDATE capture_frames SET sha256=? WHERE capture_id=? AND frame_index=0", ("b" * 64, capture_id))
