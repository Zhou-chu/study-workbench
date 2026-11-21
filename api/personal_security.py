"""Extra fail-closed boundary for private V1 data, on upstream bearer auth."""

import os

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from open_notebook.utils.encryption import get_secret_from_env


class PersonalSecurityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        # Device mode owns credential observation and Origin policy, including
        # outage epoch invalidation. Never consult the legacy fallback loader.
        if os.environ.get("STUDY_WORKBENCH_AUTH_MODE") not in (None, "legacy_password"):
            return await call_next(request)
        private_mode = os.environ.get("STUDY_WORKBENCH_PRIVATE_MODE") != "0"
        protected = request.url.path.startswith("/api/personal/") or (
            private_mode and request.url.path.startswith("/api/")
        )
        if not protected:
            return await call_next(request)
        if not get_secret_from_env("OPEN_NOTEBOOK_PASSWORD"):
            response = JSONResponse(
                {
                    "error": {
                        "code": "PRIVATE_ACCESS_REQUIRED",
                        "message": "Configure private application access before using the workbench",
                    }
                },
                status_code=503,
            )
        else:
            origin = request.headers.get("origin")
            allowed = {
                v.strip().rstrip("/")
                for v in (os.environ.get("CORS_ORIGINS") or "").split(",")
                if v.strip() and v.strip() != "*"
            }
            allowed.add(str(request.base_url).rstrip("/"))
            if (
                request.method not in {"GET", "HEAD", "OPTIONS"}
                and origin
                and origin.rstrip("/") not in allowed
            ):
                response = JSONResponse(
                    {
                        "error": {
                            "code": "CROSS_SITE_REQUEST",
                            "message": "Cross-site mutation rejected",
                        }
                    },
                    status_code=403,
                )
            else:
                response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response
