"""Private, explicit web discovery; not the internal /api/search endpoint."""

import asyncio

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from api.web_discovery_contracts import (
    WebIdempotencyConflict,
    WebImportRequest,
    WebImportResponse,
    WebSearchRequest,
    WebSearchResponse,
    WebSearchStatus,
)
from api.web_discovery_provider import FirecrawlProvider
from api.web_discovery_service import WebDiscoveryService
from open_notebook.domain.notebook import Notebook

router = APIRouter(prefix="/personal", tags=["personal-web-discovery"])


def get_web_discovery_service():
    return WebDiscoveryService()


@router.get("/web-search/status", response_model=WebSearchStatus)
async def web_search_status():
    return FirecrawlProvider().status()


@router.post("/web-search", response_model=WebSearchResponse)
async def web_search(value: WebSearchRequest, request: Request):
    task = asyncio.create_task(FirecrawlProvider().search(value.query, value.limit))
    try:
        while not task.done():
            if await request.is_disconnected():
                task.cancel()
                raise asyncio.CancelledError
            await asyncio.wait({task}, timeout=0.2)
        return await task
    finally:
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)


@router.post(
    "/notebooks/{notebook_id}/sources/web-import", response_model=WebImportResponse
)
async def web_import(
    notebook_id: str,
    value: WebImportRequest,
    service=Depends(get_web_discovery_service),
):
    await Notebook.get(notebook_id)
    try:
        return await service.import_source(notebook_id, value)
    except WebIdempotencyConflict:
        return JSONResponse(
            status_code=409, content={"detail": {"code": "WEB_IDEMPOTENCY_CONFLICT"}}
        )
