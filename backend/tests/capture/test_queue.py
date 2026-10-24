from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from threading import Barrier
from uuid import uuid4

import pytest

from backend.app.db import database, transaction
from backend.app.errors import ApiError
from backend.app.modules.capture import service


def capture_row(db, capture_id):
    return db.execute("SELECT * FROM captures WHERE id=?", (capture_id,)).fetchone()


@pytest.fixture
def queued(capture_api):
    capture_api.fill()
    assert capture_api.post("stitch").status_code == 202
    return capture_api


def expire(db, capture_id):
    db.execute("UPDATE captures SET lease_expires_at='2000-01-01T00:00:00Z' WHERE id=?", (capture_id,))


def test_lease_recovery_exactly_two_attempts_and_old_worker_fenced(queued):
    with database() as db:
        first = service.claim_next_capture(db)
        assert first["attempt"] == 1
        assert service.claim_next_capture(db) is None
        expire(db, queued.capture_id)
    # A fresh connection represents a restarted worker process.
    with database() as db:
        second = service.claim_next_capture(db)
        assert second["attempt"] == 2
        assert second["lease_token"] != first["lease_token"]
        stale_update = db.execute(
            "UPDATE captures SET progress=99 WHERE id=? AND state='running' AND lease_token=?",
            (first["id"], first["lease_token"]),
        )
        assert stale_update.rowcount == 0
        expire(db, queued.capture_id)
        assert service.claim_next_capture(db) is None
        failed = capture_row(db, queued.capture_id)
        assert failed["state"] == "failed" and failed["error_code"] == "WORKER_LOST"
        assert failed["attempt"] == 2 and failed["progress"] < 100
        assert failed["lease_token"] is None and failed["result_asset_id"] is None
        assert failed["finished_at"] is not None
    response = queued.post("stitch")
    assert response.status_code == 409
    assert queued.client.get(queued.url).json()["state"] == "failed"


def test_failed_job_explicit_retry_clears_failure_and_stays_sealed(queued):
    with database() as db:
        service.claim_next_capture(db)
        db.execute(
            "UPDATE captures SET state='failed',finished_at=?,error_code='TOOL_FAILED',error_message='Tool failed',"
            "lease_token=NULL,lease_expires_at=NULL WHERE id=?", (service._now(), queued.capture_id),
        )
    assert queued.post("cancel").status_code == 409
    retry = queued.post("stitch")
    assert retry.status_code == 202
    result = retry.json()
    assert result["attempt"] == 2 and result["state"] == "queued"
    for field in ("started_at", "finished_at", "error_code", "error_message", "result_asset_id"):
        assert result[field] is None
    assert queued.post("stitch").json() == result
    assert queued.upload(raw=b"different content").status_code == 409


def test_cancelled_lease_cannot_be_used_or_recovered(queued):
    with database() as db:
        claimed = service.claim_next_capture(db)
    assert queued.post("cancel").status_code == 200
    with database() as db:
        assert db.execute(
            "UPDATE captures SET progress=90 WHERE id=? AND state='running' AND lease_token=?",
            (queued.capture_id, claimed["lease_token"]),
        ).rowcount == 0
        assert service.claim_next_capture(db) is None


def test_concurrent_claims_only_one_worker_gets_job(queued):
    barrier = Barrier(2)

    def claim():
        with database() as db:
            barrier.wait(timeout=10)
            row = service.claim_next_capture(db)
            return dict(row) if row else None

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: claim(), range(2)))
    jobs = [row for row in results if row]
    assert len(jobs) == 1 and jobs[0]["id"] == queued.capture_id
    assert jobs[0]["attempt"] == 1


@pytest.mark.parametrize("actions", [("submit", "submit"), ("submit", "cancel"), ("claim", "cancel")])
def test_concurrent_queue_operations_are_serialized(capture_api, actions):
    api = capture_api
    api.fill()
    if "claim" in actions:
        api.post("stitch")
    barrier = Barrier(2)

    def perform(action):
        with database() as db:
            barrier.wait(timeout=10)
            with transaction(db, immediate=True):
                row = capture_row(db, api.capture_id)
                try:
                    if action == "submit":
                        return service.submit_stitch(db, row)[0]
                    if action == "cancel":
                        service.cancel_capture_job(db, row)
                    else:
                        service.claim_next_capture(db)
                    return 200
                except ApiError as error:
                    return error.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(perform, actions))
    with database() as db:
        final = capture_row(db, api.capture_id)
        if actions == ("submit", "submit"):
            assert results == [202, 202]
            assert final["state"] == "queued" and final["attempt"] == 1
        else:
            assert results[1] == 200 and results[0] in (200, 202, 409)
            assert final["state"] == "cancelled"
            assert final["lease_token"] is None and final["result_asset_id"] is None


def test_claim_transaction_rollback_does_not_consume_job(queued):
    with database() as db:
        with pytest.raises(RuntimeError):
            with transaction(db, immediate=True):
                assert service.claim_next_capture(db)["id"] == queued.capture_id
                raise RuntimeError("crash before commit")
    with database() as db:
        row = capture_row(db, queued.capture_id)
        assert row["state"] == "queued" and row["attempt"] == 1
        assert service.claim_next_capture(db)["attempt"] == 1


def test_expiry_handles_rfc3339_without_fractional_seconds(queued, monkeypatch):
    class FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 10, 24, 12, 0, 0, 500000, tzinfo=timezone.utc)

    with database() as db:
        service.claim_next_capture(db)
        db.execute("UPDATE captures SET lease_expires_at='2026-10-24T12:00:00Z' WHERE id=?", (queued.capture_id,))
        monkeypatch.setattr(service, "datetime", FrozenDatetime)
        assert service.claim_next_capture(db)["attempt"] == 2


@pytest.mark.parametrize("seconds", [0, -1, 0.5])
def test_invalid_lease_duration(queued, seconds):
    with database() as db:
        with pytest.raises(ValueError, match="positive integer"):
            service.claim_next_capture(db, seconds)
        assert capture_row(db, queued.capture_id)["state"] == "queued"


def test_fifo_claim_order_and_no_leases_exposed(queued):
    with database() as db:
        second_id = str(uuid4())
        db.execute("INSERT INTO captures(id,map_id,title,x,y,hfov_hint_deg,created_at) VALUES(?,?,?,?,?,?,?)",
                   (second_id, queued.map_id, "Second", 0, 0, 60, "2099-01-01T00:00:00Z"))
        db.execute("UPDATE captures SET state='queued',attempt=1 WHERE id=?", (second_id,))
        assert service.claim_next_capture(db)["id"] == queued.capture_id
        assert service.claim_next_capture(db)["id"] == second_id
    dto = queued.client.get(queued.url).json()
    assert "lease_token" not in dto and "lease_expires_at" not in dto
