"""API errors: HTTP status + a stable code, never prose to be interpreted.

One format for every error response:

    {"error": "<CODE>", ...optional context fields}

The codes are part of the API contract: they are not renamed.
"""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pymongo.errors import ConnectionFailure
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("webtools_anagraphics")

PROJECT_NOT_FOUND = "PROJECT_NOT_FOUND"
CONFIGURATION_NOT_FOUND = "CONFIGURATION_NOT_FOUND"
# The configuration is there and holds nothing at that path.
PROVIDER_NOT_FOUND = "PROVIDER_NOT_FOUND"
# The path holds something, and it is not a provider object: a price is
# written into `<anything>.providers.<name>` and nowhere else.
NOT_A_PROVIDER_OBJECT = "NOT_A_PROVIDER_OBJECT"
DRIVER_NOT_FOUND = "DRIVER_NOT_FOUND"
DISCOUNT_NOT_FOUND = "DISCOUNT_NOT_FOUND"
USER_NOT_FOUND = "USER_NOT_FOUND"
# The user exists but has no password set: not the caller's mistake.
CREDENTIAL_NOT_SET = "CREDENTIAL_NOT_SET"
SESSION_NOT_FOUND = "SESSION_NOT_FOUND"
SESSION_EXISTS = "SESSION_EXISTS"
TICKET_NOT_FOUND = "TICKET_NOT_FOUND"
TICKET_EXISTS = "TICKET_EXISTS"
# A submission_id already used for another user's project.
SUBMISSION_EXISTS = "SUBMISSION_EXISTS"
# No step yet open with that name on the project's pipeline.
OPEN_STEP_NOT_FOUND = "OPEN_STEP_NOT_FOUND"
# The user's turn credit is not enough for what was asked.
NOT_ENOUGH_TURNS = "NOT_ENOUGH_TURNS"
# A period asked for with a day that is not a day, or backwards.
INVALID_RANGE = "INVALID_RANGE"
# A list asked for with no filter, with more than one, or with a value that names no
# filter. Which filters may travel together is part of this API's contract.
INVALID_QUERY = "INVALID_QUERY"
INVALID_BODY = "INVALID_BODY"
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


def error_response(
    status_code: int, code: str, request: Request | None = None, **context: str
) -> JSONResponse:
    """The refusal, and — when the request is at hand — a note of which one it was.

    Whoever counts the requests needs the code, and reading it back out of the body
    would mean parsing our own answer. It is left on the request instead, where the
    middleware that measures picks it up. The same as in comm-center, the analyst and
    the drivers' pool: this subsystem is simply the last to count anything.
    """
    if request is not None:
        request.state.error_code = code
    return JSONResponse(status_code=status_code, content={"error": code, **context})


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def api_error(request: Request, exc: ApiError) -> JSONResponse:
        return error_response(exc.status_code, exc.code, request, **exc.context)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        # Errors raised by the framework, not by the endpoints.
        if exc.status_code == 404:
            return error_response(404, ROUTE_NOT_FOUND, request)
        if exc.status_code == 405:
            return error_response(405, METHOD_NOT_ALLOWED, request)
        return error_response(exc.status_code, INTERNAL_ERROR, request)

    @app.exception_handler(RequestValidationError)
    async def invalid_body(request: Request, exc: RequestValidationError) -> JSONResponse:
        # FastAPI would answer 422 with the list of fields: we answer 400 with a
        # stable code. The detail stays in the log, not in the contract.
        logger.warning("invalid body on %s: %s", request.url.path, exc.errors())
        return error_response(400, INVALID_BODY, request)

    @app.exception_handler(ConnectionFailure)
    async def database_unavailable(request: Request, exc: ConnectionFailure) -> JSONResponse:
        logger.error("MongoDB unreachable: %s", exc)
        return error_response(503, DATABASE_UNAVAILABLE, request)

    @app.exception_handler(Exception)
    async def internal_error(request: Request, exc: Exception) -> JSONResponse:
        # The traceback is written to the log by uvicorn anyway.
        return error_response(500, INTERNAL_ERROR, request)
