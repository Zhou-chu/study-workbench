# Load environment variables
from dotenv import load_dotenv

load_dotenv()

# Keep the internal SurrealDB websocket out of any configured HTTP proxy
# (issue #1160). Must run after load_dotenv() (so a proxy set in .env is
# already visible) and before the DB is touched.
from open_notebook.utils.proxy import ensure_internal_no_proxy

ensure_internal_no_proxy()

import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from loguru import logger
from starlette.exceptions import HTTPException as StarletteHTTPException

from api.auth import PasswordAuthMiddleware
from api.middleware import MaxBodySizeMiddleware, get_max_upload_size_bytes
from api.personal_security import PersonalSecurityMiddleware
from api.portable_limits import get_portable_limits
from api.routers import (
    auth,
    capabilities,
    chat,
    config,
    credentials,
    embedding,
    embedding_rebuild,
    episode_profiles,
    insights,
    languages,
    models,
    notebooks,
    notes,
    podcasts,
    providers,
    search,
    settings,
    source_chat,
    sources,
    speaker_profiles,
    transformations,
)
from api.routers import commands as commands_router
from api.routers import evidence as personal_evidence
from api.routers import notebooklm as personal_notebooklm
from api.routers import portable as personal_portable
from api.routers import source_snapshots as personal_source_snapshots
from api.routers import web_discovery as personal_web_discovery
from open_notebook.database.async_migrate import AsyncMigrationManager
from open_notebook.exceptions import (
    AuthenticationError,
    ConfigurationError,
    ExternalServiceError,
    InvalidInputError,
    NetworkError,
    NoteRevisionConflict,
    NoteRevisionRequired,
    NotFoundError,
    OpenNotebookError,
    RateLimitError,
    UnsupportedTypeException,
)
from open_notebook.integrations.notebooklm.contracts import BridgeError
from open_notebook.utils.encryption import get_secret_from_env


def _parse_cors_origins(raw: str) -> list[str]:
    """Parse CORS_ORIGINS env value into a list of origins."""
    value = raw.strip()
    if value == "*":
        return ["*"]
    return [origin.strip() for origin in value.split(",") if origin.strip()]


# Parsed once at module load; CORS_ORIGINS changes require a restart.
_cors_origins_raw = os.getenv("CORS_ORIGINS")
CORS_ALLOWED_ORIGINS = _parse_cors_origins(_cors_origins_raw or "*")
CORS_IS_DEFAULT_WILDCARD = _cors_origins_raw is None
# Keyed on the parsed list, not on whether the env var was set: an operator
# who explicitly sets CORS_ORIGINS=* must get the same wildcard treatment as
# the default, or credentials would combine with a wildcard origin - the
# exact reflect-any-Origin behavior this flag exists to prevent.
CORS_ALLOW_CREDENTIALS = "*" not in CORS_ALLOWED_ORIGINS

# Parsed once at module load; OPEN_NOTEBOOK_MAX_UPLOAD_SIZE_MB changes require a restart.
MAX_UPLOAD_SIZE_BYTES = get_max_upload_size_bytes()

DATABASE_STARTUP_RETRY_ATTEMPTS = 12
DATABASE_STARTUP_RETRY_INITIAL_DELAY_SECONDS = 1
DATABASE_STARTUP_RETRY_MAX_DELAY_SECONDS = 5
# Per-probe ceiling so a hung connection cannot exceed the retry budget or
# block startup indefinitely. A probe that exceeds this is treated as a
# transient failure and retried like any other unreachable-database attempt.
DATABASE_STARTUP_RETRY_PROBE_TIMEOUT_SECONDS = 5


def _cors_headers(request: Request) -> dict[str, str]:
    """
    Build CORS headers for error responses.

    Mirrors Starlette CORSMiddleware behavior: reflects the request Origin
    when the origin is allowed (or when wildcard is configured, since
    browsers reject `Access-Control-Allow-Origin: *` combined with
    credentials). Omits `Access-Control-Allow-Origin` for disallowed
    origins so the browser blocks the error body from leaking cross-origin.
    Only claims Access-Control-Allow-Credentials when the real CORSMiddleware
    would (see its allow_credentials comment above) - otherwise error
    responses would grant credentialed access the success path doesn't.
    """
    origin = request.headers.get("origin")
    headers: dict[str, str] = {
        "Access-Control-Allow-Methods": "*",
        "Access-Control-Allow-Headers": "*",
    }
    if CORS_ALLOW_CREDENTIALS:
        headers["Access-Control-Allow-Credentials"] = "true"

    if origin and ("*" in CORS_ALLOWED_ORIGINS or origin in CORS_ALLOWED_ORIGINS):
        headers["Access-Control-Allow-Origin"] = origin
        headers["Vary"] = "Origin"

    return headers


# Import commands to register them in the API process
try:
    logger.info("Commands imported in API process")
except Exception as e:
    logger.error(f"Failed to import commands in API process: {e}")


async def _wait_for_database(migration_manager: AsyncMigrationManager) -> None:
    """
    Wait for SurrealDB to accept connections before running migrations.

    Docker Compose can start the API before the database name is resolvable. Keep
    migration errors fail-fast by only retrying this lightweight readiness probe.
    """
    attempts = max(1, DATABASE_STARTUP_RETRY_ATTEMPTS)
    delay = DATABASE_STARTUP_RETRY_INITIAL_DELAY_SECONDS

    for attempt in range(1, attempts + 1):
        try:
            await asyncio.wait_for(
                migration_manager.ping(),
                timeout=DATABASE_STARTUP_RETRY_PROBE_TIMEOUT_SECONDS,
            )
            if attempt > 1:
                logger.info(f"Database became reachable on attempt {attempt}")
            return
        except Exception as e:
            if attempt == attempts:
                logger.error(
                    f"Database did not become reachable after {attempts} attempts"
                )
                raise

            logger.warning(
                "Database is not reachable yet "
                f"(attempt {attempt}/{attempts}): {str(e)}. "
                f"Retrying in {delay:g} seconds..."
            )
            await asyncio.sleep(delay)
            delay = min(delay * 2, DATABASE_STARTUP_RETRY_MAX_DELAY_SECONDS)


async def _run_database_migrations() -> None:
    """Run startup database migrations after SurrealDB is reachable."""
    migration_manager = AsyncMigrationManager()
    await _wait_for_database(migration_manager)

    current_version = await migration_manager.get_current_version()
    logger.info(f"Current database version: {current_version}")

    if await migration_manager.needs_migration():
        logger.warning("Database migrations are pending. Running migrations...")
        await migration_manager.run_migration_up()
        new_version = await migration_manager.get_current_version()
        logger.success(
            f"Migrations completed successfully. Database is now at version {new_version}"
        )
    else:
        logger.info("Database is already at the latest version. No migrations needed.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan event handler for the FastAPI application.
    Runs database migrations automatically on startup.
    """
    from open_notebook.config import get_note_write_mode

    get_note_write_mode()

    # Startup: Security checks
    logger.info("Starting API initialization...")

    # Security check: Encryption key
    if not get_secret_from_env("OPEN_NOTEBOOK_ENCRYPTION_KEY"):
        logger.warning(
            "OPEN_NOTEBOOK_ENCRYPTION_KEY not set. "
            "API key encryption will fail until this is configured. "
            "Set OPEN_NOTEBOOK_ENCRYPTION_KEY to any secret string."
        )

    # Run database migrations

    try:
        await _run_database_migrations()
    except Exception as e:
        logger.error(f"CRITICAL: Database migration failed: {str(e)}")
        logger.exception(e)
        # Fail fast - don't start the API with an outdated database schema
        raise RuntimeError(f"Failed to run database migrations: {str(e)}") from e

    from api.device_session_runtime import initialize_device_auth

    await initialize_device_auth(app)
    logger.success("API initialization completed successfully")

    async def dispatch_personal_jobs():
        from api.notebooklm_service import dispatch_due_jobs

        while True:
            try:
                await dispatch_due_jobs()
            except Exception as exc:
                # IDs/error class only; no remote payload or credential logging.
                logger.warning("Personal job dispatch deferred: {}", type(exc).__name__)
            await asyncio.sleep(5)

    dispatcher = asyncio.create_task(dispatch_personal_jobs())
    try:
        yield
    finally:
        dispatcher.cancel()
        try:
            await dispatcher
        except asyncio.CancelledError:
            pass

    # Shutdown: cleanup if needed
    logger.info("API shutdown complete")


app = FastAPI(
    title="Open Notebook API",
    description="API for Open Notebook - Research Assistant",
    lifespan=lifespan,
)

from api.device_session_runtime import install_auth_handlers

install_auth_handlers(app)

if CORS_IS_DEFAULT_WILDCARD:
    logger.warning(
        "CORS_ORIGINS is not set — API accepts cross-origin requests from any "
        "origin (default: '*'). For production deployments, set CORS_ORIGINS to "
        "your frontend origin(s), e.g. "
        "CORS_ORIGINS=https://notebook.example.com"
    )
else:
    logger.info(f"CORS allowed origins: {CORS_ALLOWED_ORIGINS}")

# Body limits run after password authentication but before multipart parsing.
# Only the authenticated portable import route gets the portable ZIP budget.
app.add_middleware(
    MaxBodySizeMiddleware,
    max_body_size=MAX_UPLOAD_SIZE_BYTES,
    portable_body_size=get_portable_limits().max_request_bytes,
)
app.add_middleware(
    PasswordAuthMiddleware,
    excluded_paths=[
        "/",
        "/health",
        "/docs",
        "/openapi.json",
        "/redoc",
        "/api/auth/status",
        "/api/config",
    ],
)

app.add_middleware(PersonalSecurityMiddleware)

# Add CORS middleware last (so it processes first, and so it can attach
# CORS headers to a 413 raised by MaxBodySizeMiddleware)
#
# allow_credentials is tied to whether CORS_ORIGINS resolves to specific
# origins: combining allow_origins=["*"] with allow_credentials=True makes
# Starlette reflect the request's Origin header verbatim (browsers reject a
# literal "*" alongside credentials), which defeats the origin allowlist.
# The frontend never sends credentialed requests (withCredentials: false)
# and auth is a Bearer header, not a cookie, so this isn't independently
# exploitable today - but there's no reason to allow it for any wildcard
# case. Once an operator explicitly scopes CORS_ORIGINS to real origins,
# credentialed cross-origin requests to those origins are safe to allow.
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOWED_ORIGINS,
    allow_credentials=CORS_ALLOW_CREDENTIALS,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Custom exception handler to ensure CORS headers are included in error responses
# This helps when errors occur before the CORS middleware can process them
@app.exception_handler(StarletteHTTPException)
async def custom_http_exception_handler(request: Request, exc: StarletteHTTPException):
    """
    Custom exception handler that ensures CORS headers are included in error responses.
    This is particularly important for 413 (Payload Too Large) errors during file uploads.

    Note: If a reverse proxy (nginx, traefik) returns 413 before the request reaches
    FastAPI, this handler won't be called. In that case, configure your reverse proxy
    to add CORS headers to error responses.
    """
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers={**(exc.headers or {}), **_cors_headers(request)},
    )


@app.exception_handler(NotFoundError)
async def not_found_error_handler(request: Request, exc: NotFoundError):
    return JSONResponse(
        status_code=404,
        content={"detail": str(exc)},
        headers=_cors_headers(request),
    )


@app.exception_handler(InvalidInputError)
async def invalid_input_error_handler(request: Request, exc: InvalidInputError):
    return JSONResponse(
        status_code=400,
        content={"detail": str(exc)},
        headers=_cors_headers(request),
    )


@app.exception_handler(AuthenticationError)
async def authentication_error_handler(request: Request, exc: AuthenticationError):
    return JSONResponse(
        status_code=401,
        content={"detail": str(exc)},
        headers=_cors_headers(request),
    )


@app.exception_handler(RateLimitError)
async def rate_limit_error_handler(request: Request, exc: RateLimitError):
    return JSONResponse(
        status_code=429,
        content={"detail": str(exc)},
        headers=_cors_headers(request),
    )


@app.exception_handler(ConfigurationError)
async def configuration_error_handler(request: Request, exc: ConfigurationError):
    return JSONResponse(
        status_code=422,
        content={"detail": str(exc)},
        headers=_cors_headers(request),
    )


@app.exception_handler(NetworkError)
async def network_error_handler(request: Request, exc: NetworkError):
    return JSONResponse(
        status_code=502,
        content={"detail": str(exc)},
        headers=_cors_headers(request),
    )


@app.exception_handler(ExternalServiceError)
async def external_service_error_handler(request: Request, exc: ExternalServiceError):
    return JSONResponse(
        status_code=502,
        content={"detail": str(exc)},
        headers=_cors_headers(request),
    )


@app.exception_handler(UnsupportedTypeException)
async def unsupported_type_error_handler(
    request: Request, exc: UnsupportedTypeException
):
    return JSONResponse(
        status_code=415,
        content={"detail": str(exc)},
        headers=_cors_headers(request),
    )


@app.exception_handler(OpenNotebookError)
async def open_notebook_error_handler(request: Request, exc: OpenNotebookError):
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)},
        headers=_cors_headers(request),
    )


@app.exception_handler(BridgeError)
async def personal_bridge_error_handler(request: Request, exc: BridgeError):
    statuses = {
        "IDEMPOTENCY_CONFLICT": 409,
        "EMPTY_SCOPE": 422,
        "SCOPE_ISOLATION_UNAVAILABLE": 422,
        "UNMAPPED_SOURCE": 422,
        "SOURCE_NOT_READY": 422,
        "INVALID_REQUEST": 422,
        "NEEDS_REAUTH": 401,
        "QUOTA_LIMIT": 429,
    }
    return JSONResponse(
        status_code=statuses.get(exc.code, 502),
        content={"error": {"code": exc.code, "message": str(exc)}},
        headers={**_cors_headers(request), "Cache-Control": "no-store"},
    )


# Include routers
app.include_router(personal_evidence.router, prefix="/api")
app.include_router(personal_notebooklm.router, prefix="/api")
app.include_router(personal_portable.router, prefix="/api")
app.include_router(personal_source_snapshots.router, prefix="/api")
app.include_router(personal_web_discovery.router, prefix="/api")
app.include_router(auth.router, prefix="/api", tags=["auth"])
app.include_router(config.router, prefix="/api", tags=["config"])
app.include_router(notebooks.router, prefix="/api", tags=["notebooks"])
app.include_router(search.router, prefix="/api", tags=["search"])
app.include_router(models.router, prefix="/api", tags=["models"])
app.include_router(transformations.router, prefix="/api", tags=["transformations"])
app.include_router(notes.router, prefix="/api", tags=["notes"])
app.include_router(embedding.router, prefix="/api", tags=["embedding"])
app.include_router(
    embedding_rebuild.router, prefix="/api/embeddings", tags=["embeddings"]
)
app.include_router(settings.router, prefix="/api", tags=["settings"])
app.include_router(sources.router, prefix="/api", tags=["sources"])
app.include_router(insights.router, prefix="/api", tags=["insights"])
app.include_router(commands_router.router, prefix="/api", tags=["commands"])
app.include_router(podcasts.router, prefix="/api", tags=["podcasts"])
app.include_router(episode_profiles.router, prefix="/api", tags=["episode-profiles"])
app.include_router(speaker_profiles.router, prefix="/api", tags=["speaker-profiles"])
app.include_router(chat.router, prefix="/api", tags=["chat"])
app.include_router(source_chat.router, prefix="/api", tags=["source-chat"])
app.include_router(credentials.router, prefix="/api", tags=["credentials"])
app.include_router(providers.router, prefix="/api", tags=["providers"])
app.include_router(capabilities.router, prefix="/api", tags=["capabilities"])
app.include_router(languages.router, prefix="/api", tags=["languages"])


@app.get("/")
async def root():
    return {"message": "Open Notebook API is running"}


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.exception_handler(NoteRevisionConflict)
async def note_revision_conflict_handler(request: Request, exc: NoteRevisionConflict):
    return JSONResponse(
        status_code=409,
        content={
            "detail": {
                "code": "NOTE_REVISION_CONFLICT",
                "current_revision": exc.current_revision,
            }
        },
        headers=_cors_headers(request),
    )


@app.exception_handler(NoteRevisionRequired)
async def note_revision_required_handler(request: Request, exc: NoteRevisionRequired):
    return JSONResponse(
        status_code=428,
        content={"detail": {"code": "NOTE_REVISION_REQUIRED"}},
        headers=_cors_headers(request),
    )
