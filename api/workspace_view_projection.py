"""Pure, allowlisted projection. Reads never dispatch/recover operations."""

from collections.abc import Callable
from typing import Any, TypeVar

from pydantic import TypeAdapter, ValidationError

from api import workspace_view_contracts as c

V = TypeVar("V", bound=c.PublicView)
Projector = Callable[[Any], Any]


def _invalid():
    return {"projection_status": "invalid"}


def _issue(value):
    if isinstance(value, dict):
        if value.get("projection_status") in ("unknown", "invalid"):
            return value["projection_status"]
        if value.get("validity") in ("unknown", "invalid"):
            return value["validity"]
        issues = [_issue(item) for item in value.values()]
    elif isinstance(value, list):
        issues = [_issue(item) for item in value]
    else:
        return None
    return (
        "invalid" if "invalid" in issues else "unknown" if "unknown" in issues else None
    )


def _rows(project: Projector) -> Projector:
    return (
        lambda value: [project(v) for v in value]
        if isinstance(value, list)
        else _invalid()
    )


def _nullable(project: Projector) -> Projector:
    return lambda value: None if value is None else project(value)


def _model(
    model: type[V], value: Any, nested: dict[str, Projector] | None = None
) -> dict[str, Any]:
    if not isinstance(value, dict):
        return _invalid()
    fields = model.model_fields
    result = {}
    # Per-model input omissions are documented and never apply to proof subtrees.
    omitted = {
        c.SourceVersionView: {"file_path"},
        c.TurnView: {"usage", "request_hash"},
        c.JobView: {"worker_job_id", "request_hash", "lease_until", "dispatch_after"},
        c.ArtifactView: {"file_path", "path"},
    }.get(model, set())
    has_unknown = (
        bool(set(value) - set(fields) - omitted) or "projection_status" in value
    )
    for key, field in fields.items():
        if key not in value:
            continue
        raw = value[key]
        if nested and key in nested:
            result[key] = _nullable(nested[key])(raw)
        elif key in {"error", "download_error"}:
            result[key] = None if raw is None else {"projection_status": "unknown"}
        else:
            try:
                result[key] = TypeAdapter(field.annotation).validate_python(
                    raw, strict=True
                )
                if hasattr(result[key], "model_dump"):
                    result[key] = result[key].model_dump(exclude_unset=True)
            except ValidationError:
                result[key] = _invalid()
    issue = _issue(result)
    if has_unknown and issue != "invalid":
        issue = "unknown"
    if issue:
        result["projection_status"] = issue
    # Validate the output, never coerce retained input to defaults.
    return model.model_validate(result).model_dump(exclude_unset=True)


def _scope(value):
    return _model(
        c.ScopeView, value, {"mappings": _rows(lambda v: _model(c.MappingView, v))}
    )


def _provenance(value):
    if not isinstance(value, dict) or value.get("kind") not in ("derived", "web"):
        return {"projection_status": "unknown"}
    return _model(
        c.ProvenanceView,
        value,
        {"scope_snapshot": _scope, "citations": _rows(_citation)},
    )


def _citation(value):
    return _model(
        c.EvidenceCitationView,
        value,
        {
            "provenance": _provenance,
            "locator": lambda v: _model(c.LocatorView, v),
            "remote_reference": lambda v: _model(c.RemoteReferenceView, v),
        },
    )


def _version(value):
    return _model(c.SourceVersionView, value, {"provenance": _provenance})


def _turn(value):
    return _model(
        c.TurnView,
        value,
        {
            "scope_snapshot": _scope,
            "citations": _rows(_citation),
            "retrieval_request": lambda v: _model(c.RetrievalRequestView, v),
            "retrieval": lambda v: _model(c.RetrievalView, v),
            "coverage": lambda v: _model(c.CoverageView, v),
            "budget": lambda v: _model(c.BudgetView, v),
        },
    )


def _dispatch(value):
    if not isinstance(value, dict):
        return {"validity": "invalid"}
    if set(value) != {"dispatch_ack", "job_id", "turn_id", "retry_safe"}:
        return {
            "validity": "unknown"
            if set(value) - {"dispatch_ack", "job_id", "turn_id", "retry_safe"}
            else "invalid"
        }
    try:
        receipt = c.KnownDispatchReceipt.model_validate(value)
        if not receipt.job_id.strip() or not receipt.turn_id.strip():
            return {"validity": "invalid"}
        return {"validity": "valid", "receipt": receipt.model_dump()}
    except ValidationError:
        return {"validity": "invalid"}


def _result(operation, value):
    if operation == "chat":
        return _turn(value)
    if operation == "source_snapshot":
        return _model(c.SourceResultView, value, {"provenance": _provenance})
    if operation in ("extract_evidence", "reparse", "revalidate"):
        return _model(c.MaintenanceResultView, value)
    if operation in ("audio", "download"):
        return _model(
            c.ArtifactResultView,
            value,
            {"artifact": lambda v: _model(c.ArtifactView, v)},
        )
    if operation == "create_notebook":
        return _model(c.RemoteNotebookResultView, value)
    # sync/import/ask archives are intentionally separate, not CHAT results.
    return {"projection_status": "unknown"}


def _job(value):
    if not isinstance(value, dict):
        return _invalid()
    result = _model(
        c.JobView,
        value,
        {
            "request_snapshot": lambda v: _model(c.RequestSnapshotView, v),
            "dispatch_receipt": _dispatch,
            "result": lambda v: _result(value.get("operation"), v),
        },
    )
    if "dispatch_receipt" in value:
        receipt = result.get("dispatch_receipt")
        if receipt is None:
            result["projection_status"] = "invalid"
        elif receipt.get("validity") == "valid":
            known = receipt["receipt"]
            if any(
                key in value and value[key] != known[key]
                for key in ("job_id", "turn_id")
            ):
                result["dispatch_receipt"] = {"validity": "invalid"}
                result["projection_status"] = "invalid"
    return result


def project_workspace_view(value: dict[str, Any]) -> c.WorkspaceViewV1:
    """Input is jsonable_encoder's existing workspace wire, not persistence data."""
    result = _model(
        c.WorkspaceViewV1,
        {**value, "schema_version": "workspace-view-v1"},
        {
            "notebook": lambda v: _model(c.NotebookView, v),
            "sources": _rows(
                lambda v: _model(c.SourceView, v, {"versions": _rows(_version)})
            ),
            "notes": _rows(
                lambda v: _model(
                    c.NoteView,
                    v,
                    {
                        "scope_snapshot": _scope,
                        "citations": _rows(_citation),
                        "provenance": _provenance,
                    },
                )
            ),
            "turns": _rows(_turn),
            "jobs": _rows(_job),
            "selection": lambda v: _model(
                c.SelectionView, v, {"reading": lambda r: _model(c.ReadingView, r)}
            ),
            "link": lambda v: _model(c.LinkView, v),
            "legacy_history": _rows(
                lambda v: _model(
                    c.LegacyHistoryView,
                    v,
                    {"messages": _rows(lambda m: _model(c.LegacyMessageView, m))},
                )
            ),
        },
    )
    return c.WorkspaceViewV1.model_validate(result)
