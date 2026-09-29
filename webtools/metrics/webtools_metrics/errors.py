"""API errors: HTTP status + a stable code, never prose to be interpreted.

One format for every error response:

    {"error": "<CODE>", ...optional context fields}

The codes are part of the API contract: they are not renamed. The context fields
say **which** name or dimension was refused, because whoever sent the measurement
has to be able to fix it without reading our log.
"""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pymongo.errors import ConnectionFailure
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("webtools_metrics")

# The vocabulary refused what arrived.
UNKNOWN_SUBSYSTEM = "UNKNOWN_SUBSYSTEM"
UNKNOWN_METRIC = "UNKNOWN_METRIC"
UNKNOWN_DIMENSION = "UNKNOWN_DIMENSION"
UNKNOWN_DIMENSION_VALUE = "UNKNOWN_DIMENSION_VALUE"
MISSING_DIMENSION = "MISSING_DIMENSION"
# A value the metric does not carry: a duration on a counter that has none.
UNEXPECTED_VALUE = "UNEXPECTED_VALUE"
# Tokens sent for a provider the configuration does not declare, or of a kind that
# provider does not count. Both are answered by a line of configuration.
UNKNOWN_PROVIDER = "UNKNOWN_PROVIDER"
UNKNOWN_TOKEN_KIND = "UNKNOWN_TOKEN_KIND"
# A period asked for backwards, or wider than the rows allowed.
INVALID_RANGE = "INVALID_RANGE"
PROJECT_NOT_FOUND = "PROJECT_NOT_FOUND"
INVALID_BODY = "INVALID_BODY"
BODY_TOO_LARGE = "BODY_TOO_LARGE"
ROUTE_NOT_FOUND = "ROUTE_NOT_FOUND"
METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED"
IP_NOT_ALLOWED = "IP_NOT_ALLOWED"
DATABASE_UNAVAILABLE = "DATABASE_UNAVAILABLE"
INTERNAL_ERROR = "INTERNAL_ERROR"


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, **context: str) -> None:
        self.status_code = status_code
        self.code = code
        self.context = context


def error_response(status_code: int, code: str, **context: str) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"error": code, **context})


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def api_error(request: Request, exc: ApiError) -> JSONResponse:
        return error_response(exc.status_code, exc.code, **exc.context)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        if exc.status_code == 404:
            return error_response(404, ROUTE_NOT_FOUND)
        if exc.status_code == 405:
            return error_response(405, METHOD_NOT_ALLOWED)
        return error_response(exc.status_code, INTERNAL_ERROR)

    @app.exception_handler(RequestValidationError)
    async def invalid_body(request: Request, exc: RequestValidationError) -> JSONResponse:
        # FastAPI would answer 422 with the list of fields: we answer 400 with a
        # stable code. The detail stays in the log, not in the contract.
        logger.warning("invalid body on %s: %s", request.url.path, exc.errors())
        return error_response(400, INVALID_BODY)

    @app.exception_handler(ConnectionFailure)
    async def database_unavailable(request: Request, exc: ConnectionFailure) -> JSONResponse:
        logger.error("MongoDB unreachable: %s", exc)
        return error_response(503, DATABASE_UNAVAILABLE)

    @app.exception_handler(Exception)
    async def internal_error(request: Request, exc: Exception) -> JSONResponse:
        # The traceback is written to the log by uvicorn anyway.
        return error_response(500, INTERNAL_ERROR)
