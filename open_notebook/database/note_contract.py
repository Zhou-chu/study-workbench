"""Shared revision scalar; native note revisions are authoritative."""

from typing import Annotated, Literal

from pydantic import Field

Revision = Annotated[int, Field(strict=True, ge=1)]
NoteWriteMode = Literal["legacy_single_web", "multiclient"]
