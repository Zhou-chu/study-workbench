"""Documentation-only transport schemas; never validate or rewrite wire responses."""

from typing import Any

# HTTP errors are deliberately not normalized. Validation detail is a list,
# revision/submission detail can be an object, and middleware may use error.
ERROR_SCHEMA = {
    "anyOf": [
        {
            "type": "object",
            "required": ["detail"],
            "properties": {"detail": {}},
            "additionalProperties": True,
        },
        {
            "type": "object",
            "required": ["error"],
            "properties": {
                "error": {
                    "type": "object",
                    "required": ["code", "message"],
                    "properties": {
                        "code": {"type": "string"},
                        "message": {"type": "string"},
                    },
                    "additionalProperties": True,
                }
            },
            "additionalProperties": True,
        },
    ]
}


def transport_responses(media: list[str], description: str) -> dict[Any, Any]:
    """Describe success bytes and known app errors, not arbitrary proxy errors."""
    error = {
        "description": (
            "Application HTTP error: retain status and the original envelope. "
            "detail may be a string, object or validation list; error contains "
            "code/message. Unhandled server errors can be plain text; proxy errors "
            "may have other media types."
        ),
        "content": {
            "application/json": {"schema": ERROR_SCHEMA},
            "text/plain": {"schema": {"type": "string"}},
        },
    }
    responses = {
        200: {
            "description": description,
            "content": {
                mime: {"schema": {"type": "string", "format": "binary"}}
                for mime in media
            },
        },
        422: error,
        "default": error,
    }

    if media != ["text/event-stream"]:
        responses[206] = {
            "description": "Existing FileResponse partial bytes; not a new cross-client resume guarantee.",
            "content": {
                mime: {"schema": {"type": "string", "format": "binary"}}
                for mime in [*media, "multipart/byteranges"]
            },
        }
        responses[400] = {
            "description": "Application JSON error or framework malformed Range text.",
            "content": {
                "application/json": {"schema": ERROR_SCHEMA},
                "text/plain": {"schema": {"type": "string"}},
            },
        }
        responses[416] = {
            "description": "Framework unsatisfiable Range; empty text body.",
            "headers": {"Content-Range": {"schema": {"type": "string"}}},
            "content": {"text/plain": {"schema": {"type": "string"}}},
        }
    return responses


TURN_EVENTS_RESPONSES = transport_responses(
    ["text/event-stream"],
    "UTF-8 SSE, not JSON or model-token streaming. stage carries a stored turn "
    "(status) or job summary (state); final carries a stored succeeded/failed "
    "turn; error carries TURN_NOT_FOUND. Payloads retain historical extensions. "
    "No event IDs, replay cursor or resume guarantee. EOF is not success. "
    "See docs/v1/STREAM_DOWNLOAD_PROTOCOL.md.",
)
# An SSE body is text rather than an opaque file, but never an application/json DTO.
TURN_EVENTS_RESPONSES[200]["content"]["text/event-stream"]["schema"] = {
    "type": "string"
}
