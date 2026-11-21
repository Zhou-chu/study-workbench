"""Legacy status and explicitly gated native device-session endpoints."""

from dataclasses import asdict
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Request, Response, Security
from fastapi.security import HTTPBearer
from pydantic import BaseModel, ConfigDict, Field, StrictStr

from api.device_session_models import AuthError
from api.device_session_runtime import AUTH_HEADERS, bearer, get_auth_mode, runtime
from open_notebook.utils.encryption import get_secret_from_env


class AuthFailureDetail(BaseModel):
    code: str
    message: str


class AuthFailure(BaseModel):
    error: AuthFailureDetail


class DeviceAuthStatus(BaseModel):
    auth_enabled: Literal[True]
    auth_mode: Literal["device_sessions"]
    protocol_version: Literal[1]


class LegacyAuthStatus(BaseModel):
    auth_enabled: bool
    message: str


router = APIRouter(
    prefix="/auth",
    tags=["auth"],
    responses={
        status: {"model": AuthFailure}
        for status in (400, 401, 403, 413, 415, 429, 503, "default")
    },
)


access_security = HTTPBearer(auto_error=False)


class SessionLogin(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password: StrictStr = Field(repr=False, json_schema_extra={"format": "password"})
    device_name: StrictStr


class SessionRefresh(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: StrictStr
    refresh_token: StrictStr = Field(repr=False)


class SessionTokens(BaseModel):
    session_id: str
    access_token: str = Field(repr=False)
    refresh_token: str = Field(repr=False)
    access_expires_at: str
    refresh_expires_at: str


class SessionInfo(BaseModel):
    session_id: str
    device_name: str
    created_at: str
    last_used_at: str
    expires_at: str
    revoked_at: str | None
    is_current: bool


class SessionList(BaseModel):
    sessions: list[SessionInfo]


def wire(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    if isinstance(value, dict):
        return {k: wire(v) for k, v in value.items()}
    return value


def service(request: Request):
    if get_auth_mode() != "device_sessions":
        raise AuthError("AUTH_UNAVAILABLE")
    value = runtime(request).service
    assert value is not None
    return value


@router.get("/status", response_model=DeviceAuthStatus | LegacyAuthStatus)
async def get_auth_status(request: Request, response: Response):
    response.headers.update(AUTH_HEADERS)
    if get_auth_mode() == "device_sessions":
        await service(request).check_ready()
        return {
            "auth_enabled": True,
            "auth_mode": "device_sessions",
            "protocol_version": 1,
        }
    auth_enabled = bool(get_secret_from_env("OPEN_NOTEBOOK_PASSWORD"))
    return {
        "auth_enabled": auth_enabled,
        "message": "Authentication is required"
        if auth_enabled
        else "Authentication is disabled",
    }


@router.post("/sessions", status_code=201, response_model=SessionTokens)
async def create_session(body: SessionLogin, request: Request, response: Response):
    response.headers.update(AUTH_HEADERS)
    result = await service(request).create_session(
        body.password,
        body.device_name,
        # ASGI client can already have been rewritten by proxy middleware.
        # Conservative shared bucket until trusted peer attribution is designed.
        client_address="shared-peer",
    )
    return wire(asdict(result))


@router.post("/sessions/refresh", response_model=SessionTokens)
async def refresh_session(body: SessionRefresh, request: Request, response: Response):
    response.headers.update(AUTH_HEADERS)
    return wire(
        asdict(
            await service(request).rotate_session(body.session_id, body.refresh_token)
        )
    )


@router.get(
    "/sessions", response_model=SessionList, dependencies=[Security(access_security)]
)
async def list_sessions(request: Request, response: Response):
    response.headers.update(AUTH_HEADERS)
    rows = await service(request).list_sessions(bearer(request))
    return {"sessions": [wire(asdict(row)) for row in rows]}


@router.delete(
    "/sessions/{session_id}", status_code=204, dependencies=[Security(access_security)]
)
async def revoke_session(session_id: str, request: Request):
    await service(request).revoke_session(bearer(request), session_id)
    return Response(status_code=204, headers=AUTH_HEADERS)


@router.delete("/sessions", status_code=204, dependencies=[Security(access_security)])
async def revoke_all_sessions(request: Request):
    await service(request).revoke_all_sessions(bearer(request))
    return Response(status_code=204, headers=AUTH_HEADERS)
