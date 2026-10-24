from __future__ import annotations

from contextlib import asynccontextmanager
import os
from pathlib import Path
import sys
import logging
import sqlite3
import time
import asyncio
from uuid import uuid4
from backend.app.errors import ApiError

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from backend.app.config import settings
from backend.app.db import database, initialize_database
from backend.app.errors import install_error_handlers
from backend.app.routers import auth, captures, maps, media, public


FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    settings.media_path.mkdir(parents=True, exist_ok=True)
    if os.getenv("TTK_AUTO_SEED", "0") == "1" and os.getenv("TTK_ENV", "production") == "demo" and "pytest" not in sys.modules:
        try:
            from scripts.seed_demo import seed_demo_data
            seed_demo_data()
        except Exception:
            logging.getLogger(__name__).exception("Demo seed failed")
            raise
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="TTKMap Space Map API", version="0.1.0", lifespan=lifespan)
    # Bound both buffered upload bodies and simultaneous Pillow allocations.
    app.state.media_slots = asyncio.Semaphore(2)
    install_error_handlers(app)
    app.include_router(auth.router)
    app.include_router(maps.router)
    app.include_router(media.router)
    app.include_router(captures.router)
    app.include_router(public.router)

    @app.middleware("http")
    async def cache_policy(request: Request, call_next) -> Response:
        started = time.monotonic()
        request_id = str(uuid4())
        response = await call_next(request)
        response.headers['X-Request-ID'] = request_id
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
        if not request.url.path.startswith(('/embed/', '/m/', '/api/', '/assets/')):
            response.headers['X-Frame-Options'] = 'DENY'
        frame_policy = "frame-ancestors *" if request.url.path.startswith('/embed/') else "frame-ancestors 'none'"
        response.headers['Content-Security-Policy'] = "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; " + frame_policy
        logging.getLogger(__name__).info('request=%s method=%s path=%s status=%s duration_ms=%.1f', request_id, request.method, request.url.path, response.status_code, (time.monotonic()-started)*1000)
        path = request.url.path
        if path.startswith("/api/v1/public/maps/"):
            response.headers.setdefault("Cache-Control", "no-cache")
        elif path.startswith("/api/v1/media/"):
            response.headers.setdefault("Cache-Control", "private, no-cache")
        elif path.startswith("/api/v1/"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response

    @app.get("/healthz", tags=["system"])
    def health() -> dict[str, str]:
        try:
            with database() as connection:
                connection.execute("SELECT 1").fetchone()
        except (sqlite3.Error, OSError) as exc:
            raise ApiError(503, 'SERVICE_UNAVAILABLE', 'Database is unavailable') from exc
        return {"status": "ok"}

    if FRONTEND_DIST.is_dir():
        assets_dir = FRONTEND_DIST / "assets"
        if assets_dir.is_dir():
            app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        def serve_spa(full_path: str):
            if full_path.startswith('api/'):
                raise ApiError(404, 'NOT_FOUND', 'API endpoint not found')
            candidate = (FRONTEND_DIST / full_path).resolve()
            if full_path and candidate.is_file() and FRONTEND_DIST.resolve() in candidate.parents:
                return FileResponse(candidate, headers={"Cache-Control": "no-store"})
            index_file = FRONTEND_DIST / "index.html"
            if index_file.is_file():
                return FileResponse(index_file, headers={"Cache-Control": "no-store"})
            return Response(status_code=404)

    return app


app = create_app()
