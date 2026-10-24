import pytest
from backend.tests.capture.conftest import capture_api
from backend.app.db import database
from backend.app.modules.capture.service import claim_next_capture
from backend.worker.main import JobLease, process_one_capture
from backend.worker.runner import LeaseLost


def test_expired_lease_cannot_renew_or_commit(capture_api):
    capture_api.fill()
    capture_api.post('stitch')
    with database() as db:
        job = claim_next_capture(db)
        db.execute("UPDATE captures SET lease_expires_at='2000-01-01T00:00:00Z' WHERE id=?", (job['id'],))
    lease = JobLease(job['id'], job['lease_token'])
    with pytest.raises(LeaseLost):
        lease.checkpoint(force=True)
    with database() as db:
        assert not lease.valid(db)


def test_cancelled_worker_cannot_renew(capture_api):
    capture_api.fill()
    capture_api.post('stitch')
    with database() as db:
        job = claim_next_capture(db)
    lease = JobLease(job['id'], job['lease_token'])
    lease.advance(30)
    capture_api.post('cancel')
    with pytest.raises(LeaseLost):
        lease.checkpoint(force=True)


def test_duplicate_series_stays_failed(capture_api):
    for index in range(16):
        assert capture_api.upload(index).status_code == 200
    capture_api.post('stitch')
    assert process_one_capture()
    result = capture_api.client.get(capture_api.url).json()
    assert result['state'] == 'failed'
    assert result['error_code'] == 'NOT_ENOUGH_OVERLAP'
    assert result['result_asset_id'] is None


def test_timeout_terminates_process_group(tmp_path):
    import os
    import sys
    from backend.worker.runner import run_command, StitchError
    pid_file=tmp_path/'pid'
    with pytest.raises(StitchError) as error:
        run_command([sys.executable,'-c',f"import os,time;open({str(pid_file)!r},'w').write(str(os.getpid()));time.sleep(20)"],cwd=tmp_path,checkpoint=lambda:None,timeout=0.5)
    assert error.value.code=='TIMEOUT'
    with pytest.raises(ProcessLookupError): os.kill(int(pid_file.read_text()),0)


def test_cancel_checkpoint_terminates_running_tool(tmp_path):
    import os
    import sys
    from backend.worker.runner import run_command
    pid_file=tmp_path/'pid'
    def checkpoint():
        if pid_file.exists(): raise LeaseLost('cancelled')
    with pytest.raises(LeaseLost):
        run_command([sys.executable,'-c',f"import os,time;open({str(pid_file)!r},'w').write(str(os.getpid()));time.sleep(20)"],cwd=tmp_path,checkpoint=checkpoint)
    with pytest.raises(ProcessLookupError): os.kill(int(pid_file.read_text()),0)


def test_renewed_job_cannot_be_claimed_by_second_consumer(capture_api, tmp_path):
    import sys
    from backend.worker.runner import run_command
    capture_api.fill()
    capture_api.post('stitch')
    with database() as db:
        job = claim_next_capture(db, lease_seconds=2)
    lease = JobLease(job['id'], job['lease_token'], lease_seconds=2)
    lease.advance(40)
    def competing_checkpoint():
        lease.checkpoint()
        with database() as other_consumer:
            assert claim_next_capture(other_consumer) is None
    # The tool runs longer than the original lease. Every runner checkpoint
    # checks the other consumer through a separate SQLite connection.
    run_command([sys.executable, '-c', 'import time; time.sleep(3)'],
                cwd=tmp_path, checkpoint=competing_checkpoint, timeout=8)
    with database() as db:
        assert claim_next_capture(db) is None
        current = db.execute('SELECT * FROM captures WHERE id=?', (job['id'],)).fetchone()
        assert current['attempt'] == 1 and current['progress'] == 40
        assert lease.valid(db)


def test_real_duplicate_fixture_never_creates_asset(capture_api):
    from pathlib import Path
    from io import BytesIO
    from PIL import Image
    root = Path(__file__).parents[1] / 'fixtures/stitch/negative_duplicates'
    for index in range(16):
        with Image.open(root / f'photo_{index+1}_2026-10-24_08-13-40.jpg') as image:
            image.thumbnail((600, 800))
            raw = BytesIO()
            image.save(raw, 'JPEG', quality=90)
        assert capture_api.upload(index, raw.getvalue()).status_code == 200
    capture_api.post('stitch')
    assert process_one_capture()
    result = capture_api.client.get(capture_api.url).json()
    assert result['state'] == 'failed' and result['result_asset_id'] is None
    with database() as db:
        assert db.execute('SELECT COUNT(*) FROM assets').fetchone()[0] == 0
