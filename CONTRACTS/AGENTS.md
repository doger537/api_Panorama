# TTKMap contract rules

`openapi.yaml` is OpenAPI 3.0.3 and the transport source of truth. `types.ts` mirrors its DTOs and feature agents must not create duplicate contract types. `db_schema.sql` is an executable SQLite 3.40+ initialization schema for an empty database; existing databases require an explicit migration and backup.

JSON uses `snake_case`, timestamps are UTC RFC3339 with `Z`, and identifiers are lowercase UUIDv4 strings. Public slugs are stable 26-character lowercase base32 tokens. Plan coordinates are local units with `(0,0)` at the upper-left, X right and Y down; map extents are immutable. Panorama yaw and pitch are degrees, yaw `[-180,180)`, pitch `[-90,90]`, and `heading_offset_deg` maps yaw zero to plan bearing from `-Y`.

`PUT /api/v1/maps/{map_id}/document` is a complete atomic replacement guarded by `If-Match`. A successful save increments `revision` once and keeps the slug. Published maps expose the current saved document; public responses use ETag and `no-cache`. Every organizer mutation requires the session cookie, CSRF header and matching `Origin`; nested resources check map ownership.

SQLite connections must enable `foreign_keys`, WAL and a busy timeout. Media is immutable after processing and is served only through an authorization-aware endpoint. Raw capture frames are never public. A failed stitching job remains failed with a documented error code; it cannot produce a ready panorama.

The mandatory product includes protected editing, imported and hand-drawn plans, POIs, mobile guided capture, real server-side stitching, direct panorama upload, panorama placement/hotspots, stable public links and embed, graph routing and a conditional panorama walkthrough. Offline mode, multiple floors, analytics, AI plan recognition, multiple buildings and full 3D reconstruction are backlog.

The worker consumes durable jobs using a lease and heartbeat. Only a measured, validated stitching result may become a ready asset.
