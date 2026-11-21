"""Surreal-commands integration for Open Notebook"""

# The worker starts via `surreal-commands-worker --import-modules commands`,
# so this package is imported before the worker connects to SurrealDB. Inject
# the internal DB hosts into no_proxy first so the DB websocket is never
# tunnelled through a configured HTTP proxy (issue #1160).
from open_notebook.utils.proxy import ensure_internal_no_proxy

ensure_internal_no_proxy()

from .embedding_commands import (
    embed_insight_command,
    embed_note_command,
    embed_source_command,
    rebuild_embeddings_command,
)
from .podcast_commands import generate_podcast_command
from .source_commands import process_source_command

__all__ = [
    # Embedding commands
    "embed_note_command",
    "embed_insight_command",
    "embed_source_command",
    "rebuild_embeddings_command",
    # Other commands
    "generate_podcast_command",
    "process_source_command",
]

# StudyWorkbench V1: CPU extraction and explicit answer jobs
from .evidence_commands import (
    extract_evidence_command,
    index_evidence_command,
    maintain_evidence_command,
)
from .personal_commands import personal_turn_command

__all__ += [
    "extract_evidence_command",
    "maintain_evidence_command",
    "index_evidence_command",
    "personal_turn_command",
]

from .notebooklm_commands import notebooklm_execute, notebooklm_poll
from .portable_commands import export_portable

__all__ += ["notebooklm_execute", "notebooklm_poll", "export_portable"]
