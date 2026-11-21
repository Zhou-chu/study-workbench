"""Startup-owned opt-in HTTP boundary; never authenticates ambient cookies."""

import json
import os
from dataclasses import dataclass
from typing import Literal
from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from starlette.responses import JSONResponse

from api.device_session_models import AuthError
from api.device_session_service import DeviceSessionService

AuthMode = Literal["legacy_password", "device_sessions"]
AUTH_HEADERS = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
PUBLIC_AUTH = {
    ("GET", "/api/auth/status"),
    ("POST", "/api/auth/sessions"),
    ("POST", "/api/auth/sessions/refresh"),
}
APP_COOKIES = {
    "__Host-sw-access",
    "__Host-sw-refresh",
    "__Host-sw-session",
    "sw-access",
    "sw-refresh",
    "sw-session",
}


def get_auth_mode() -> AuthMode:
    mode = os.environ.get("STUDY_WORKBENCH_AUTH_MODE")
    if mode is None:
        mode = "legacy_password"
    if mode == "legacy_password":
        return "legacy_password"
    if mode == "device_sessions":
        return "device_sessions"
    raise AuthError("AUTH_UNAVAILABLE")


def configured_origins() -> frozenset[str]:
    origins = frozenset(
        x.strip()
        for x in os.environ.get("STUDY_WORKBENCH_AUTH_ORIGINS", "").split(",")
        if x.strip()
    )
    for origin in origins:
        parsed = urlsplit(origin)
        if (
            parsed.scheme not in {"https", "http"}
            or not parsed.netloc
            or parsed.username
            or parsed.password
            or parsed.path
            or parsed.query
            or parsed.fragment
            or "*" in origin
            or origin != f"{parsed.scheme}://{parsed.netloc}"
        ):
            raise AuthError("AUTH_UNAVAILABLE")
    return origins


@dataclass
class DeviceAuthRuntime:
    mode: AuthMode
    service: DeviceSessionService | None
    origins: frozenset[str] | set[str]


def runtime(request: Request) -> DeviceAuthRuntime:
    value = getattr(request.app.state, "device_auth_runtime", None)
    if value is None or value.mode != "device_sessions" or value.service is None:
        raise AuthError("AUTH_UNAVAILABLE")
    return value


def auth_response(
    code: str, status: int, message: str, retry_after: int | None = None
) -> JSONResponse:
    headers = dict(AUTH_HEADERS)
    if status == 401:
        headers["WWW-Authenticate"] = "Bearer"
    if retry_after is not None:
        headers["Retry-After"] = str(retry_after)
    return JSONResponse(
        {"error": {"code": code, "message": message}},
        status_code=status,
        headers=headers,
    )


def error_response(exc: AuthError) -> JSONResponse:
    return auth_response(exc.code, exc.status_code, str(exc), exc.retry_after)


def bearer(request: Request) -> str:
    values = request.headers.getlist("authorization")
    if len(values) != 1:
        raise AuthError("AUTH_REQUIRED")
    parts = values[0].split(" ")
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1]:
        raise AuthError("AUTH_REQUIRED")
    return parts[1]


async def device_dispatch(request: Request, call_next, excluded_paths: list[str]):
    try:
        context = runtime(request)
        assert context.service is not None
        # Even reads reject a supplied foreign origin. Never trust Host or XFF.
        origins = request.headers.getlist("origin")
        if origins and (len(origins) != 1 or origins[0] not in context.origins):
            return auth_response(
                "CROSS_SITE_REQUEST", 403, "Cross-site request rejected."
            )
        if any(name in request.cookies for name in APP_COOKIES):
            return auth_response(
                "AUTH_MIXED_CREDENTIALS", 400, "Conflicting credentials."
            )
        public = (request.method, request.url.path) in PUBLIC_AUTH
        issuing = request.method == "POST" and request.url.path in {
            "/api/auth/sessions",
            "/api/auth/sessions/refresh",
        }
        if issuing and request.headers.getlist("authorization"):
            return auth_response(
                "AUTH_MIXED_CREDENTIALS", 400, "Conflicting credentials."
            )
        if request.url.path.startswith("/api/auth/") and request.method not in {
            "GET",
            "HEAD",
            "OPTIONS",
        }:
            lengths = request.headers.getlist("content-length")
            if len(lengths) > 1:
                raise AuthError("AUTH_INVALID_REQUEST")
            if lengths:
                try:
                    size = int(lengths[0])
                    if size < 0:
                        raise ValueError
                except ValueError:
                    raise AuthError("AUTH_INVALID_REQUEST") from None
                if size > 8192:
                    return auth_response(
                        "AUTH_BODY_TOO_LARGE", 413, "Authentication body too large."
                    )
            body = bytearray()
            async for chunk in request.stream():
                if len(body) + len(chunk) > 8192:
                    return auth_response(
                        "AUTH_BODY_TOO_LARGE", 413, "Authentication body too large."
                    )
                body.extend(chunk)
            request._body = bytes(body)
            if issuing:
                if (
                    request.headers.get("content-type", "")
                    .split(";", 1)[0]
                    .strip()
                    .lower()
                    != "application/json"
                ):
                    return auth_response(
                        "AUTH_UNSUPPORTED_MEDIA_TYPE", 415, "JSON required."
                    )
                try:
                    parsed = json.loads(body)
                    if not isinstance(parsed, dict):
                        raise ValueError
                except (ValueError, UnicodeError, RecursionError):
                    raise AuthError("AUTH_INVALID_REQUEST") from None
            elif body:
                raise AuthError("AUTH_INVALID_REQUEST")
        # Bypass only exact auth route+method, plus existing narrow public reads.
        public_read = (
            request.method in {"GET", "HEAD"}
            and request.url.path in excluded_paths
            and request.url.path != "/api/auth/status"
        )
        if not public and not public_read and request.method != "OPTIONS":
            request.state.device_session = await context.service.authenticate_access(
                bearer(request)
            )
        response = await call_next(request)
        if request.url.path.startswith("/api/auth/") and response.status_code in {
            404,
            405,
        }:
            # Keep framework routing status/Allow semantics, but do not violate
            # the auth-only error envelope advertised by this router.
            sanitized = auth_response(
                "AUTH_INVALID_REQUEST",
                response.status_code,
                "Invalid authentication request.",
            )
            if "allow" in response.headers:
                sanitized.headers["Allow"] = response.headers["allow"]
            return sanitized
        if request.url.path.startswith("/api/"):
            response.headers.update(AUTH_HEADERS)
        return response
    except AuthError as exc:
        return error_response(exc)


def install_auth_handlers(app: FastAPI) -> None:
    @app.exception_handler(AuthError)
    async def handle_auth(request: Request, exc: AuthError):
        return error_response(exc)

    @app.exception_handler(RequestValidationError)
    async def handle_validation(request: Request, exc: RequestValidationError):
        if request.url.path.startswith("/api/auth/"):
            return error_response(AuthError("AUTH_INVALID_REQUEST"))
        return await request_validation_exception_handler(request, exc)


async def initialize_device_auth(app: FastAPI) -> None:
    from api.device_session_credentials import StrictPasswordProvider
    from api.device_session_repository import SurrealDeviceSessionStore

    mode = get_auth_mode()
    service = None
    origins: frozenset[str] = frozenset()
    if mode == "device_sessions":
        origins = configured_origins()
        store = SurrealDeviceSessionStore()
        service = DeviceSessionService(
            store, StrictPasswordProvider.from_environment(dict(os.environ))
        )
        await store.ready()
        await service.check_ready()
    app.state.device_auth_runtime = DeviceAuthRuntime(mode, service, origins)
