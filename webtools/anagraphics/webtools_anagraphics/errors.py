"""Errori dell'API: stato HTTP + codice stabile, mai testo da interpretare.

Formato unico per ogni risposta di errore:

    {"error": "<CODICE>", ...campi di contesto opzionali}

I codici fanno parte del contratto dell'API: non si rinominano.
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
DRIVER_NOT_FOUND = "DRIVER_NOT_FOUND"
DISCOUNT_NOT_FOUND = "DISCOUNT_NOT_FOUND"
USER_NOT_FOUND = "USER_NOT_FOUND"
# L'utente c'è ma non ha una password impostata: non è un errore del chiamante.
CREDENTIAL_NOT_SET = "CREDENTIAL_NOT_SET"
SESSION_NOT_FOUND = "SESSION_NOT_FOUND"
SESSION_EXISTS = "SESSION_EXISTS"
TICKET_NOT_FOUND = "TICKET_NOT_FOUND"
TICKET_EXISTS = "TICKET_EXISTS"
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


def error_response(status_code: int, code: str, **context: str) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"error": code, **context})


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def api_error(request: Request, exc: ApiError) -> JSONResponse:
        return error_response(exc.status_code, exc.code, **exc.context)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        # Errori generati dal framework, non dagli endpoint.
        if exc.status_code == 404:
            return error_response(404, ROUTE_NOT_FOUND)
        if exc.status_code == 405:
            return error_response(405, METHOD_NOT_ALLOWED)
        return error_response(exc.status_code, INTERNAL_ERROR)

    @app.exception_handler(RequestValidationError)
    async def invalid_body(request: Request, exc: RequestValidationError) -> JSONResponse:
        # FastAPI risponderebbe 422 con l'elenco dei campi: noi diamo 400 e un
        # codice stabile. Il dettaglio resta nel log, non nel contratto.
        logger.warning("body non valido su %s: %s", request.url.path, exc.errors())
        return error_response(400, INVALID_BODY)

    @app.exception_handler(ConnectionFailure)
    async def database_unavailable(request: Request, exc: ConnectionFailure) -> JSONResponse:
        logger.error("MongoDB non raggiungibile: %s", exc)
        return error_response(503, DATABASE_UNAVAILABLE)

    @app.exception_handler(Exception)
    async def internal_error(request: Request, exc: Exception) -> JSONResponse:
        # Il traceback viene comunque scritto nel log da uvicorn.
        return error_response(500, INTERNAL_ERROR)
