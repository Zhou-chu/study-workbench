"""Public synthetic SSE bytes exercise the actual generator without providers."""

from fastapi import FastAPI

from api.routers import evidence, notebooklm, portable


def test_transport_schema_has_no_fake_json_success():
    app = FastAPI()
    for router in (evidence.router, notebooklm.router, portable.router):
        app.include_router(router, prefix="/api")
    paths = app.openapi()["paths"]
    for suffix, media in {
        "turns/{turn_id}/events": {"text/event-stream"},
        "source-versions/{source_version_id}/download": {
            "application/pdf",
            "text/plain",
            "text/markdown",
        },
        "exports/{export_id}/download": {"application/zip"},
        "artifacts/{artifact_id}/download": {"*/*"},
    }.items():
        responses = paths["/api/personal/" + suffix]["get"]["responses"]
        assert set(responses["200"]["content"]) == media
        for mime, value in responses["200"]["content"].items():
            assert value["schema"]["type"] == "string"
            assert value["schema"].get("format") == (
                None if mime == "text/event-stream" else "binary"
            )
        assert "anyOf" in responses["422"]["content"]["application/json"]["schema"]
        assert "default" in responses
        assert "text/plain" in responses["default"]["content"]
        if media != {"text/event-stream"}:
            assert set(responses["206"]["content"]) == media | {"multipart/byteranges"}
            assert set(responses["400"]["content"]) == {
                "application/json",
                "text/plain",
            }
            assert "Content-Range" in responses["416"]["headers"]
