from __future__ import annotations

from typing import Any
import logging
import sqlite3

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        issues: list[dict[str, str]] | None = None,
        current_revision: int | None = None,
    ) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message
        self.issues = issues or []
        self.current_revision = current_revision


def error_body(code: str, message: str, issues: list[dict[str, str]] | None = None,
               current_revision: int | None = None) -> dict[str, Any]:
    return {
        "error": {
            "code": code,
            "message": message,
            "issues": issues or [],
            "current_revision": current_revision,
        }
    }


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def handle_api_error(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=error_body(exc.code, exc.message, exc.issues, exc.current_revision),
            headers={"Cache-Control": "no-store"},
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        issues = [
            {"path": ".".join(str(part) for part in error["loc"]), "message": error["msg"]}
            for error in exc.errors()
        ]
        return JSONResponse(
            status_code=422,
            content=error_body("VALIDATION_ERROR", "Request validation failed", issues),
            headers={"Cache-Control": "no-store"},
        )

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        mapping = {
            401: ("AUTH_REQUIRED", "Authentication required"),
            403: ("FORBIDDEN", "Access denied"),
            404: ("NOT_FOUND", "Resource not found"),
            405: ("BAD_REQUEST", "Method not allowed"),
        }
        code, message = mapping.get(exc.status_code, ("BAD_REQUEST", "Request failed"))
        return JSONResponse(
            status_code=exc.status_code,
            content=error_body(code, message),
            headers={"Cache-Control": "no-store"},
        )

    @app.exception_handler(sqlite3.IntegrityError)
    async def handle_integrity(_: Request, exc: sqlite3.IntegrityError) -> JSONResponse:
        logging.getLogger(__name__).warning('Rejected inconsistent document: %s', exc)
        return JSONResponse(status_code=422, content=error_body('VALIDATION_ERROR', 'Document contains conflicting identifiers or references'), headers={'Cache-Control': 'no-store'})

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        logging.getLogger(__name__).error("Request %s failed", request.url.path, exc_info=exc)
        return JSONResponse(
            status_code=500,
            content=error_body("INTERNAL_ERROR", "An internal error occurred"),
            headers={"Cache-Control": "no-store"},
        )
