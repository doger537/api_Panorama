"""Explicit maintenance on existing data; never used to reset a database."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import time

from backend.app.config import settings
from backend.app.db import database, SCHEMA_VERSION


def _media_keys(db):
    keys = {key for row in db.execute('SELECT preview_key,mobile_key,full_key FROM assets') for key in row}
    keys.update(row[0] for row in db.execute('SELECT storage_key FROM capture_frames'))
    return keys


def _media_path(root: Path, key: str) -> Path:
    path = (root / key).resolve()
    if root.resolve() not in path.parents:
        raise ValueError('Invalid media key')
    return path


def _digest(path: Path) -> str:
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def backup(destination: Path):
    """API and worker must be stopped so media and SQLite form one snapshot."""
    destination.mkdir(parents=True, exist_ok=False)
    with database() as source:
        target = sqlite3.connect(destination / 'database.sqlite')
        try:
            source.backup(target)
        finally:
            target.close()
    snapshot = sqlite3.connect(destination / 'database.sqlite')
    try:
        hashes = {}
        for key in sorted(_media_keys(snapshot)):
            source = _media_path(settings.media_path, key)
            target = _media_path(destination / 'media', key)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            hashes[key] = _digest(target)
        # Only a complete backup receives a manifest.
        (destination / 'manifest.json').write_text(json.dumps({
            'schema_version': SCHEMA_VERSION,
            'created_at': datetime.now(timezone.utc).isoformat(),
            'database_sha256': _digest(destination / 'database.sqlite'),
            'media_sha256': hashes,
        }, indent=2), encoding='utf-8')
    finally:
        snapshot.close()


def _verify_backup(source: Path):
    manifest = json.loads((source / 'manifest.json').read_text(encoding='utf-8'))
    if manifest['schema_version'] != SCHEMA_VERSION:
        raise ValueError('Backup needs an explicit schema migration')
    if _digest(source / 'database.sqlite') != manifest['database_sha256']:
        raise ValueError('Backup database checksum mismatch')
    db = sqlite3.connect((source / 'database.sqlite').resolve().as_uri() + '?mode=ro', uri=True)
    try:
        if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok' or db.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('Backup integrity check failed')
        if db.execute('PRAGMA user_version').fetchone()[0] != SCHEMA_VERSION:
            raise ValueError('Backup needs an explicit schema migration')
        keys = _media_keys(db)
        if keys != manifest['media_sha256'].keys():
            raise ValueError('Backup media manifest does not match database references')
        for key in keys:
            path = _media_path(source / 'media', key)
            if not path.is_file() or _digest(path) != manifest['media_sha256'][key]:
                raise ValueError('Backup media missing or checksum mismatch')
    finally:
        db.close()


def restore(source: Path, destination: Path):
    """Validate DB and every media file before restoring into a NEW directory."""
    if destination.exists():
        raise ValueError('Restore destination must not exist')
    _verify_backup(source)
    shutil.copytree(source, destination)
    _verify_backup(destination)


def collect_orphans(*, apply=False, grace_seconds=86400, retention_days=30):
    """Run while uploads and worker are stopped. Dry-run computes the same plan."""
    if retention_days < 1:
        raise ValueError('Retention must be at least one day')
    with database() as db:
        # Dry-run performs the prospective SQL changes in a rolled-back transaction.
        # Actual metadata removal commits BEFORE unlink: an I/O error may leave an
        # orphan, but can never resurrect a DB reference to a deleted file.
        db.execute('BEGIN IMMEDIATE')
        try:
            if db.execute("SELECT 1 FROM captures WHERE state IN ('queued','running') LIMIT 1").fetchone():
                raise ValueError('Drain or cancel queued/running captures before maintenance')
            modifier = f'-{retention_days} days'
            db.execute("DELETE FROM captures WHERE state IN ('succeeded','failed','cancelled') AND julianday(finished_at)<julianday('now',?)", (modifier,))
            db.execute("DELETE FROM assets WHERE julianday(created_at)<julianday('now',?) AND id NOT IN (SELECT asset_id FROM map_backgrounds UNION SELECT asset_id FROM panoramas UNION SELECT result_asset_id FROM captures WHERE result_asset_id IS NOT NULL)", (modifier,))
            keys = _media_keys(db)
            db.execute("DELETE FROM sessions WHERE julianday(expires_at)<=julianday('now')")
            db.commit() if apply else db.rollback()
        except BaseException:
            db.rollback()
            raise
    candidates = []
    root = settings.media_path.resolve()
    for path in root.rglob('*'):
        if path.is_symlink() or not path.is_file():
            continue
        key = path.relative_to(root).as_posix()
        if key not in keys and time.time() - path.stat().st_mtime > grace_seconds:
            candidates.append(key)
            if apply:
                path.unlink()
    return sorted(candidates)
