# Capture API and durable queue (C3)

The captures router authenticates every operation and checks the capture's map
and owner. Mutations require Origin and CSRF. Upload ownership is checked before
reading the body, then rechecked inside the writer transaction. Streaming bodies
are bounded to 12 MiB plus 64 KiB multipart overhead; the file itself is limited
to 12 MiB before decoding. Only decoded JPEG/PNG/WebP up to 1600 pixels per side
are accepted. Frames are rotated and re-encoded without EXIF.

Each slot 0..15 hashes the original upload. Identical retries acknowledge the
existing slot even after submission; changes are only accepted while collecting.
Different contents use different storage keys so an aborted SQLite transaction
cannot corrupt a previously committed slot. Unreferenced files from replacement
or rollback are private; retention/garbage collection must inspect committed
`capture_frames.storage_key` references and coordinate with upload transactions.
The worker must read those keys, never derive a filename from the slot number.

SQLite `captures` is the queue; there is no in-memory job list. Submission and
cancellation read/update under `BEGIN IMMEDIATE`. Queued/running resubmission
does not spend another attempt. A failed job may be explicitly resubmitted once.
Cancellation clears the lease and cannot be undone. No HTTP endpoint invokes
Hugin or marks a result succeeded.

`claim_next_capture(connection, lease_seconds=120)` starts an IMMEDIATE
transaction when the connection is idle. If the caller already has a transaction,
it must be an IMMEDIATE transaction and the caller owns commit/rollback. A claim
returns a running row with a new lease token. Expired running jobs are requeued
for attempt 2; expiry of attempt 2 leaves `failed/WORKER_LOST`, with no asset.
Expiry is evaluated when a consumer claims work, not by HTTP polling. Jobs and
leases survive application/worker restarts.

C4 owns heartbeat, Hugin/enblend, deadlines and committing actual output. Every
worker progress/heartbeat/result mutation must check the current running state,
token and unexpired lease in the same transaction as its write. Cancellation or
reclaim invalidates the old token. The C3 tests cover token invalidation and
queue recovery, not a successful stitch or physical-device acceptance.

Run from the repository root:

```text
docker compose --profile test run --rm backend-test python -m pytest backend/tests/capture -q
```

When Docker is unavailable, the equivalent Python 3.12 test invocation is
`python -m pytest backend/tests/capture -q` with backend requirements installed.
The API fixtures use generated small images for state/storage tests only.

## Local verification (2026-10-24)

Base: `c0fb4a9` (origin/main). Windows, Python 3.12, Node 22.23.4:

- `python -m pytest backend/tests/capture -q`: 49 passed.
- `python -m pytest backend/tests -q`: 94 passed.
- `python scripts/check_contracts.py`: passed.
- `npm --prefix frontend ci --no-audit --no-fund`: passed.
- `npm --prefix frontend run test`: 66 passed (existing jsdom canvas warnings).
- Direct TypeScript `--noEmit -p frontend/tsconfig.json` and Vite `build frontend`: passed.
- `git diff --check`: passed.

Docker is unavailable on this host, so the prescribed Compose test command was
not run. These historical checks do not replace current acceptance. The build wrapper
now calls TypeScript/Vite JavaScript entrypoints through Node; the earlier Windows
`npx.cmd` invocation has been removed. A new Windows smoke is still required.
Current verification is recorded in `docs/audit-resolution.md`.
