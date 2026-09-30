"""API errors: HTTP status + a stable code, never prose to be interpreted.

One format for every error response:

    {"error": "<CODE>"}

The codes are part of the API contract: they are not renamed. Whoever calls this
subsystem is another subsystem, so an error has to be something a program can
branch on, not a sentence somebody would have to read.
"""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("webtools_developer")

ROUTE_NOT_FOUND = "ROUTE_NOT_FOUND"
METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED"
IP_NOT_ALLOWED = "IP_NOT_ALLOWED"
# There is no such project.
PROJECT_NOT_FOUND = "PROJECT_NOT_FOUND"
# The project is where the build begins, and what says so is anagraphics: without it
# a build cannot even be refused for the right reason.
ANAGRAPHICS_UNAVAILABLE = "ANAGRAPHICS_UNAVAILABLE"
# Three different facts about where a project is, and three codes: a caller that reads
# one word cannot tell a project that is not ready yet from one that has already been
# through here, and the two are answered differently.
DEVELOPMENT_ALREADY_STARTED = "DEVELOPMENT_ALREADY_STARTED"
PROJECT_NOT_READY = "PROJECT_NOT_READY"
PROJECT_REJECTED = "PROJECT_REJECTED"
BODY_TOO_LARGE = "BODY_TOO_LARGE"
INVALID_BODY = "INVALID_BODY"
INTERNAL_ERROR = "INTERNAL_ERROR"


class ApiError(Exception):
    def __init__(self, status_code: int, code: str) -> None:
        self.status_code = status_code
        self.code = code


def error_response(status_code: int, code: str, request: Request | None = None) -> JSONResponse:
    """The refusal, and — when the request is at hand — a note of which one it was.

    Whoever counts the requests needs the code, and reading it back out of the body
    would mean parsing our own answer. It is left on the request instead, where the
    middleware that measures picks it up.
    """
    if request is not None:
        request.state.error_code = code
    return JSONResponse(status_code=status_code, content={"error": code})


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def api_error(request: Request, exc: ApiError) -> JSONResponse:
        return error_response(exc.status_code, exc.code, request)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
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

    @app.exception_handler(Exception)
    async def internal_error(request: Request, exc: Exception) -> JSONResponse:
        # The traceback is written to the log by uvicorn anyway.
        return error_response(500, INTERNAL_ERROR, request)
