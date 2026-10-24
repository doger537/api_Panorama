from __future__ import annotations
from datetime import datetime, timedelta, timezone
import logging
import os
from pathlib import Path
import shutil
import signal
import tempfile
import time
from uuid import uuid4

from backend.app.config import settings
from backend.app.db import database, initialize_database, transaction
from backend.app.modules.capture.service import claim_next_capture
from backend.app.modules.media.storage import AssetStore
from backend.worker.runner import LeaseLost, StitchError
from backend.worker.stitching import stitch

logger = logging.getLogger(__name__)


def now():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


class JobLease:
    def __init__(self, capture_id, token, lease_seconds=120, deadline_seconds=900):
        self.capture_id, self.token = capture_id, token
        self.lease_seconds = lease_seconds
        self.deadline = time.monotonic() + deadline_seconds
        self.last_heartbeat = 0.0
        self.progress = 5

    def checkpoint(self, force=False):
        if time.monotonic() > self.deadline:
            raise StitchError('TIMEOUT', 'Capture exceeded its total processing deadline')
        # Renew and check cancellation every second while external tools run.
        if not force and time.monotonic() - self.last_heartbeat < 1:
            return
        with database() as db, transaction(db, immediate=True):
            expires = (datetime.now(timezone.utc) + timedelta(seconds=self.lease_seconds)).isoformat().replace('+00:00', 'Z')
            cursor = db.execute("UPDATE captures SET lease_expires_at=?,progress=?,updated_at=? "
                                "WHERE id=? AND state='running' AND lease_token=? AND julianday(lease_expires_at)>julianday(?)",
                                (expires, self.progress, now(), self.capture_id, self.token, now()))
            if cursor.rowcount != 1:
                raise LeaseLost('Capture cancelled, deleted or lease lost')
        self.last_heartbeat = time.monotonic()

    def advance(self, progress):
        self.progress = progress
        self.checkpoint(force=True)

    def valid(self, db):
        return db.execute("SELECT 1 FROM captures WHERE id=? AND state='running' AND lease_token=? "
                          "AND julianday(lease_expires_at)>julianday(?)", (self.capture_id, self.token, now())).fetchone()


def process_one_capture() -> bool:
    with database() as db:
        job = claim_next_capture(db)
        if job is None:
            return False
        frames = db.execute('SELECT storage_key,sha256 FROM capture_frames WHERE capture_id=? ORDER BY frame_index', (job['id'],)).fetchall()
    lease = JobLease(job['id'], job['lease_token'], deadline_seconds=int(os.getenv('STITCH_DEADLINE_SECONDS', '900')))
    asset_id = str(uuid4())
    committed = False
    started = time.monotonic()
    try:
        if len(frames) != 16:
            raise StitchError('INPUT_EXPIRED', 'Capture requires all 16 frames')
        if len({f['sha256'] for f in frames}) != 16:
            raise StitchError('NOT_ENOUGH_OVERLAP', 'Replace duplicate frames before stitching a new series')
        paths = [(settings.media_path / f['storage_key']).resolve() for f in frames]
        if any(settings.media_path.resolve() not in p.parents for p in paths):
            raise StitchError('INPUT_EXPIRED', 'Invalid frame storage reference')
        with tempfile.TemporaryDirectory(prefix='ttk-stitch-') as work:
            result = stitch(paths, Path(work), job['hfov_hint_deg'], lease.checkpoint, lease.advance)
            lease.checkpoint(force=True)
            store = AssetStore(settings.media_path)
            keys = store.store_asset_variants(asset_id, result.image_path.read_bytes(), result.width, result.height,
                                              kind='panorama', partial_vaov_deg=result.vaov_deg)
            lease.checkpoint(force=True)
            with database() as db, transaction(db, immediate=True):
                if not lease.valid(db):
                    raise LeaseLost('Lease lost before commit')
                db.execute('INSERT INTO assets(id,map_id,kind,source,width_px,height_px,projection,haov_deg,vaov_deg,v_offset_deg,preview_key,mobile_key,full_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                           (asset_id, job['map_id'], 'panorama', 'stitch', keys[3], keys[4], 'equirectangular', 360,
                            result.vaov_deg, result.v_offset_deg, *keys[:3], now()))
                db.execute("UPDATE captures SET state='succeeded',progress=100,finished_at=?,updated_at=?,result_asset_id=?,lease_token=NULL,lease_expires_at=NULL WHERE id=?", (now(), now(), asset_id, job['id']))
            committed = True
    except LeaseLost:
        logger.info('capture=%s cancelled or lease lost', job['id'])
    except Exception as error:
        code = error.code if isinstance(error, StitchError) else 'TOOL_FAILED'
        message = str(error) if isinstance(error, StitchError) else 'Stitching failed; retry or upload a ready panorama'
        logger.exception('capture=%s error_code=%s', job['id'], code)
        with database() as db, transaction(db, immediate=True):
            if lease.valid(db):
                db.execute("UPDATE captures SET state='failed',progress=?,finished_at=?,updated_at=?,error_code=?,error_message=?,result_asset_id=NULL,lease_token=NULL,lease_expires_at=NULL WHERE id=?",
                           (lease.progress, now(), now(), code, message, job['id']))
    finally:
        if not committed:
            shutil.rmtree(settings.media_path / asset_id, ignore_errors=True)
        logger.info('capture=%s committed=%s duration_seconds=%.2f', job['id'], committed, time.monotonic() - started)
    return True


def main():
    def shutdown(*_):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, shutdown)
    logging.basicConfig(level=logging.INFO)
    initialize_database()
    settings.media_path.mkdir(parents=True, exist_ok=True)
    while True:
        try:
            if not process_one_capture():
                time.sleep(2)
        except KeyboardInterrupt:
            logger.info('Worker shutting down; any uncommitted lease will expire')
            break
        except Exception:
            logger.exception('Worker queue poll failed')
            time.sleep(2)


if __name__ == '__main__':
    main()
