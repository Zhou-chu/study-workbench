"""Bounded C3 input schemas and reader.

Only the three explicitly supplied JSON files may be read. References inside
them are inert metadata. Structural consistency never authenticates observations.
"""

import json
import os
import stat
from pathlib import Path
from typing import Any

MAX_RAW = 1024 * 1024
MAX_DEPTH = 16
MAX_STRING = 512


def _bounded_value(value: Any) -> None:
    """Bound decoded containers before any schema-specific recursion."""
    pending = [(value, 0)]
    while pending:
        item, depth = pending.pop()
        if isinstance(item, (dict, list)):
            if depth >= MAX_DEPTH or len(item) > 1470:
                raise ValueError("Invalid input")
            values = [*item.keys(), *item.values()] if isinstance(item, dict) else item
            pending.extend((child, depth + 1) for child in values)
        elif isinstance(item, str):
            if len(item.encode("utf-8")) > MAX_STRING:
                raise ValueError("Invalid input")


def _json_depth(data: bytes) -> None:
    """Check lexical nesting before json.loads can recurse."""
    depth = 0
    quoted = False
    escaped = False
    for char in data:
        if quoted:
            if escaped:
                escaped = False
            elif char == 92:
                escaped = True
            elif char == 34:
                quoted = False
        elif char == 34:
            quoted = True
        elif char in (91, 123):
            depth += 1
            if depth > MAX_DEPTH:
                raise ValueError("Invalid input")
        elif char in (93, 125):
            depth -= 1


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Invalid input")
        result[key] = value
    return result


def _reject_constant(value: str) -> None:
    raise ValueError("Invalid input")


def load_input(path: str | Path) -> Any:
    """Read one regular input once, anchored through no-follow directory FDs.

    Unsupported safe-open platforms fail closed. Error text never contains a
    path, data, system exception, private locator, or credential.
    """
    descriptors: list[int] = []
    try:
        if not all(
            hasattr(os, name)
            for name in ("O_NOFOLLOW", "O_DIRECTORY", "O_NONBLOCK", "O_CLOEXEC")
        ):
            raise ValueError("Invalid input")
        raw = os.fspath(path)
        if not isinstance(raw, str) or not raw or "\\" in raw or "\x00" in raw:
            raise ValueError("Invalid input")
        parts = raw.split("/")
        absolute = raw.startswith("/")
        if absolute:
            parts = parts[1:]
        if not parts or any(part in ("", ".", "..") for part in parts):
            raise ValueError("Invalid input")
        directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
        directory = os.open("/" if absolute else ".", directory_flags)
        descriptors.append(directory)
        for part in parts[:-1]:
            directory = os.open(part, directory_flags, dir_fd=directory)
            descriptors.append(directory)
        descriptor = os.open(
            parts[-1],
            os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC,
            dir_fd=directory,
        )
        descriptors.append(descriptor)
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or not 1 <= before.st_size <= MAX_RAW:
            raise ValueError("Invalid input")
        data = os.read(descriptor, MAX_RAW + 1)
        after = os.fstat(descriptor)

        def signature(info):
            return (
                info.st_dev,
                info.st_ino,
                info.st_size,
                info.st_mtime_ns,
                info.st_ctime_ns,
            )

        if (
            len(data) != before.st_size
            or len(data) > MAX_RAW
            or signature(before) != signature(after)
        ):
            raise ValueError("Invalid input")
        if data.startswith(b"\xef\xbb\xbf"):
            raise ValueError("Invalid input")
        _json_depth(data)
        value = json.loads(
            data.decode("utf-8"),
            object_pairs_hook=_unique_object,
            parse_constant=_reject_constant,
        )
        _bounded_value(value)
        return value
    except (
        OSError,
        ValueError,
        TypeError,
        UnicodeError,
        RecursionError,
        OverflowError,
    ):
        raise ValueError("Invalid input") from None
    finally:
        for descriptor in reversed(descriptors):
            os.close(descriptor)


import hashlib
import re
from datetime import datetime

SCOPES = {"source-only", "synthetic", "production"}
PHASES = {
    "forward-entry",
    "forward-verification",
    "reverse-entry",
    "reverse-verification",
    "finalize",
}
CHECK_IDS = (
    "artifact_association",
    "served_identity",
    "auth_runtime",
    "ingress_topology",
    "cookie_upload",
    "forward_owners",
    "reverse_owners",
    "schema_content",
    "backup_snapshot",
    "isolated_restore",
    "operation_custody",
    "user_work",
    "catalog_acceptance",
    "rollback_drill",
    "post_entry_acceptance",
)
BLOCKERS = (
    "INPUT_SCHEMA_INVALID",
    "EVIDENCE_SCOPE_MISMATCH",
    "EVIDENCE_IDENTITY_MISMATCH",
    "EVIDENCE_FRESHNESS_UNVERIFIED",
    "ACCEPTANCE_SCOPE_NOT_EXECUTED",
    "CANDIDATE_ARTIFACT_UNVERIFIED",
    "CURRENT_ARTIFACT_UNVERIFIED",
    "ROLLBACK_ARTIFACT_UNVERIFIED",
    "SOURCE_DEPLOYMENT_IDENTITY_MISMATCH",
    "SOURCE_DEPLOYMENT_IDENTITY_UNVERIFIED",
    "AUTH_MODE_UNVERIFIED",
    "AUTH_MODE_CHANGE_REQUIRES_SEPARATE_ACTIVATION",
    "FIRST_CUTOVER_REQUIRES_LEGACY_PASSWORD",
    "INGRESS_PROTECTION_UNVERIFIED",
    "TOPOLOGY_OR_DATA_BOUNDARY_UNVERIFIED",
    "COOKIE_COMPATIBILITY_UNVERIFIED",
    "COOKIE_COMPATIBILITY_FAILED",
    "RUNTIME_API_COMPATIBILITY_UNVERIFIED",
    "RUNTIME_API_INCOMPATIBLE",
    "OLD_CLIENT_WINDOW_UNPROVEN",
    "ROLLBACK_CLIENT_WINDOW_UNPROVEN",
    "SCHEMA_ROLLBACK_UNVERIFIED",
    "SCHEMA_ROLLBACK_INCOMPATIBLE",
    "DESTRUCTIVE_ROLLBACK_UNSUPPORTED",
    "BACKUP_NOT_VERIFIED",
    "RESTORE_NOT_VERIFIED",
    "ACTIVE_WRITES_NOT_QUIESCENT",
    "UNKNOWN_OPERATION_CUSTODY_UNVERIFIED",
    "USER_WORK_PRESERVATION_UNVERIFIED",
    "UNKNOWN_OPERATION_RESET_FORBIDDEN",
    "ACCEPTANCE_INCOMPLETE",
    "ROLLBACK_DRILL_UNVERIFIED",
)
DUE_BLOCKERS = {
    "artifact_association": (
        "CANDIDATE_ARTIFACT_UNVERIFIED",
        "CURRENT_ARTIFACT_UNVERIFIED",
        "ROLLBACK_ARTIFACT_UNVERIFIED",
    ),
    "served_identity": ("SOURCE_DEPLOYMENT_IDENTITY_UNVERIFIED",),
    "auth_runtime": ("RUNTIME_API_COMPATIBILITY_UNVERIFIED",),
    "ingress_topology": (
        "INGRESS_PROTECTION_UNVERIFIED",
        "TOPOLOGY_OR_DATA_BOUNDARY_UNVERIFIED",
    ),
    "cookie_upload": ("COOKIE_COMPATIBILITY_UNVERIFIED",),
    "forward_owners": ("OLD_CLIENT_WINDOW_UNPROVEN",),
    "reverse_owners": ("ROLLBACK_CLIENT_WINDOW_UNPROVEN",),
    "schema_content": ("SCHEMA_ROLLBACK_UNVERIFIED",),
    "backup_snapshot": ("BACKUP_NOT_VERIFIED",),
    "isolated_restore": ("RESTORE_NOT_VERIFIED",),
    "operation_custody": ("UNKNOWN_OPERATION_CUSTODY_UNVERIFIED",),
    "user_work": ("USER_WORK_PRESERVATION_UNVERIFIED",),
    "catalog_acceptance": ("ACCEPTANCE_INCOMPLETE",),
    "rollback_drill": ("ROLLBACK_DRILL_UNVERIFIED",),
    "post_entry_acceptance": ("ACCEPTANCE_INCOMPLETE",),
}
CATALOG = {
    "version": "spa-browser-cases-v1",
    "file_sha256": "a437fef4a01b2aa195836858aeb455714da3c47192adc556ee2e9a6676b8b9df",
    "operation_fingerprint": "b9fe7af28a5e85aaf628afa49b142b451aa4f985bc5de36c2e2796d3946936f6",
    "case_membership_sha256": "ab0a55bd912efef1901e259005189a25f3d51e7ea83afd257e6e64319473e7b4",
    "case_count": 615,
    "required_evidence_slots": 1470,
}
IDENTITY_KEYS = ("source", "auth_mode", "components", "backend", "data_boundary")
METADATA_KEYS = (
    "spa-artifact-manifest.json",
    "artifact-inventory.json",
    "artifact-identity.json",
)
VERIFICATION_KINDS = {
    "spa-web-source-contract",
    "spa-bff-source-contract",
    "spa-retained-bytes",
    "spa-gateway-files",
    "legacy-next-source-artifact",
}


class _Invalid(ValueError):
    pass


def _require(condition: bool) -> None:
    if not condition:
        raise _Invalid("INPUT_SCHEMA_INVALID")


def _exact(value: Any, fields: str | tuple[str, ...]) -> None:
    names = fields.split() if isinstance(fields, str) else fields
    _require(type(value) is dict and set(value) == set(names))


def _hash(value: Any, length: int = 64, nullable: bool = False) -> None:
    _require(
        (nullable and value is None)
        or (
            type(value) is str
            and re.fullmatch("[0-9a-f]{" + str(length) + "}", value) is not None
        )
    )


def _id(value: Any, nullable: bool = False) -> None:
    _require(
        (nullable and value is None)
        or (
            type(value) is str
            and re.fullmatch("[A-Za-z0-9_.-]{1,96}", value) is not None
        )
    )


def _number(value: Any, maximum: int, minimum: int = 0) -> None:
    _require(type(value) is int and minimum <= value <= maximum)


def _array(value: Any, maximum: int, minimum: int = 0) -> None:
    _require(type(value) is list and minimum <= len(value) <= maximum)


def _ids(value: Any, maximum: int, minimum: int = 0) -> None:
    _array(value, maximum, minimum)
    for item in value:
        _id(item)
    _require(len(set(value)) == len(value))


def _enum(value: Any, choices: set[str]) -> None:
    _require(type(value) is str and value in choices)


def _canonical(value: Any) -> bytes:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")


def _digest(value: Any) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


def _identity(envelope: dict[str, Any]) -> str:
    return _digest({key: envelope[key] for key in IDENTITY_KEYS})


def _time(value: Any) -> datetime:
    _require(
        type(value) is str
        and re.fullmatch(
            r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})",
            value,
        )
        is not None
    )
    result = datetime.fromisoformat(value)
    _require(result.utcoffset() is not None)
    return result


def _record(value: Any, named: bool = True, primary: bool = True) -> None:
    _exact(value, "id bytes sha256" if named else "bytes sha256")
    if named:
        _id(value["id"])
    _number(value["bytes"], 33554432, 1 if primary else 0)
    _hash(value["sha256"])


def _verification(value: Any, kind: str) -> None:
    _exact(
        value,
        "kind source_commit source_tree helper_sha256 contract_digest record status",
    )
    _require(value["kind"] in VERIFICATION_KINDS and value["kind"] == kind)
    _hash(value["source_commit"], 40)
    _hash(value["source_tree"], 40)
    _hash(value["helper_sha256"])
    _hash(value["contract_digest"])
    _record(value["record"])
    _enum(value["status"], {"passed", "failed", "blocked", "unavailable"})


def _component(value: Any, kind: str, verified: bool) -> None:
    _exact(
        value,
        "manifest identity inventory_header metadata verification"
        if verified
        else "manifest identity inventory_header metadata",
    )
    manifest, identity, inventory = (
        value["manifest"],
        value["identity"],
        value["inventory_header"],
    )
    _exact(
        manifest,
        "schema_version source_commit authored_digest asset_digest contract_digest ui_transport_protocol supported_contracts",
    )
    _require(manifest["schema_version"] == "spa-artifact-v1")
    _hash(manifest["source_commit"], 40)
    for key in ("authored_digest", "asset_digest", "contract_digest"):
        _hash(manifest[key])
    _number(manifest["ui_transport_protocol"], 1, 1)
    _require(manifest["supported_contracts"] == ["workspace-view-v1"])
    _exact(
        identity,
        "release_slot source_commit authored_digest contract_digest ui_transport_protocol supported_contracts",
    )
    _require(
        type(identity["release_slot"]) is str
        and re.fullmatch("[a-z0-9][a-z0-9-]{15,79}", identity["release_slot"])
        is not None
    )
    _number(identity["ui_transport_protocol"], 1, 1)
    _require(
        identity
        == {
            "release_slot": identity["release_slot"],
            **{
                key: manifest[key]
                for key in (
                    "source_commit",
                    "authored_digest",
                    "contract_digest",
                    "ui_transport_protocol",
                    "supported_contracts",
                )
            },
        }
    )
    _exact(inventory, "schema_version kind release_slot")
    _require(
        inventory
        == {
            "schema_version": "spa-inventory-v1",
            "kind": kind,
            "release_slot": identity["release_slot"],
        }
    )
    _exact(value["metadata"], METADATA_KEYS)
    for record in value["metadata"].values():
        _record(record, named=False)
    for filename, document in (
        ("spa-artifact-manifest.json", manifest),
        ("artifact-identity.json", identity),
    ):
        encoded = _canonical(document) + b"\n"
        _require(
            value["metadata"][filename]
            == {"bytes": len(encoded), "sha256": hashlib.sha256(encoded).hexdigest()}
        )
    if verified:
        _verification(value["verification"], "spa-" + kind + "-source-contract")


def _envelope(value: Any, subject: str) -> None:
    _bounded_value(value)
    _require(len(_canonical(value)) <= 65536)
    _exact(
        value,
        "schema_version scope release_id source auth_mode components backend data_boundary",
    )
    _require(value["schema_version"] == "spa-cutover-" + subject + "-v1")
    _enum(value["scope"], SCOPES)
    _id(value["release_id"])
    _require(
        value["auth_mode"] is None
        or value["auth_mode"] in ("legacy_password", "device_sessions")
    )
    source = value["source"]
    if source is None:
        _require(subject == "current")
    else:
        _exact(source, "commit tree")
        _hash(source["commit"], 40)
        _hash(source["tree"], 40)
    backend = value["backend"]
    _exact(
        backend,
        "api_commit worker_commit source_tree recipe_sha256 migration_inventory_sha256 data_contract_sha256",
    )
    for key, item in backend.items():
        _hash(
            item,
            40 if key in ("api_commit", "worker_commit", "source_tree") else 64,
            nullable=True,
        )
    _exact(value["data_boundary"], "topology_id storage_id lock_id")
    for item in value["data_boundary"].values():
        _id(item, nullable=True)
    components = value["components"]
    _require(type(components) is dict and type(components.get("kind")) is str)
    if components["kind"] == "spa":
        _exact(components, "kind web bff gateway")
        for kind in ("web", "bff"):
            _component(components[kind], kind, True)
        gateway = components["gateway"]
        _exact(gateway, "window window_file stage retained verification")
        window = gateway["window"]
        _exact(window, "schema_version current retained")
        _require(window["schema_version"] == "spa-client-window-v1")
        _ids(window["retained"], 32, 1)
        _require(
            window["current"]
            == window["retained"][0]
            == components["web"]["identity"]["release_slot"]
        )
        _record(gateway["window_file"], named=False)
        encoded = _canonical(window) + b"\n"
        _require(
            gateway["window_file"]
            == {"bytes": len(encoded), "sha256": hashlib.sha256(encoded).hexdigest()}
        )
        _exact(gateway["stage"], "file_count sha256")
        _number(gateway["stage"]["file_count"], 2147483647, 1)
        _hash(gateway["stage"]["sha256"])
        _array(gateway["retained"], 32, 1)
        _require(len(gateway["retained"]) == len(window["retained"]))
        for slot, entry in zip(window["retained"], gateway["retained"], strict=True):
            _component(entry, "web", False)
            _require(entry["identity"]["release_slot"] == slot)
        _require(
            gateway["retained"][0]
            == {
                key: item
                for key, item in components["web"].items()
                if key != "verification"
            }
        )
        _verification(gateway["verification"], "spa-gateway-files")
    elif components["kind"] == "legacy-next":
        _require(subject == "current")
        _exact(components, "kind verification artifact")
        _verification(components["verification"], "legacy-next-source-artifact")
        artifact = components["artifact"]
        _exact(
            artifact,
            "manifest_sha256 build_id source_sha256 artifact_sha256 generated_sha256 claim",
        )
        for key in (
            "manifest_sha256",
            "source_sha256",
            "artifact_sha256",
            "generated_sha256",
        ):
            _hash(artifact[key])
        _id(artifact["build_id"])
        _require(artifact["claim"] == "source-artifact-association-not-reproducibility")
    else:
        _exact(components, "kind")
        _require(subject == "current" and components["kind"] == "unknown")


def _check_wrapper(value: Any, key: str) -> None:
    _exact(value, "state status proof_ids result")
    _enum(value["state"], {"observed", "unavailable", "obligation"})
    if value["state"] == "observed":
        _enum(value["status"], {"passed", "failed", "blocked"})
        _ids(value["proof_ids"], 16, 1)
        if value["status"] != "passed":
            _exact(value["result"], "reason")
            _enum(
                value["result"]["reason"],
                set(DUE_BLOCKERS[key])
                | {
                    "EVIDENCE_SCOPE_MISMATCH",
                    "EVIDENCE_IDENTITY_MISMATCH",
                    "EVIDENCE_FRESHNESS_UNVERIFIED",
                }
                | {
                    "artifact_association": {"SOURCE_DEPLOYMENT_IDENTITY_MISMATCH"},
                    "served_identity": {"SOURCE_DEPLOYMENT_IDENTITY_MISMATCH"},
                    "auth_runtime": {
                        "AUTH_MODE_UNVERIFIED",
                        "AUTH_MODE_CHANGE_REQUIRES_SEPARATE_ACTIVATION",
                        "FIRST_CUTOVER_REQUIRES_LEGACY_PASSWORD",
                        "RUNTIME_API_INCOMPATIBLE",
                    },
                    "cookie_upload": {"COOKIE_COMPATIBILITY_FAILED"},
                    "schema_content": {
                        "SCHEMA_ROLLBACK_INCOMPATIBLE",
                        "DESTRUCTIVE_ROLLBACK_UNSUPPORTED",
                    },
                    "operation_custody": {
                        "ACTIVE_WRITES_NOT_QUIESCENT",
                        "UNKNOWN_OPERATION_RESET_FORBIDDEN",
                    },
                }.get(key, set()),
            )
    elif value["state"] == "unavailable":
        _enum(value["status"], {"not_run", "blocked", "unavailable", "unknown"})
        _require(value["proof_ids"] == [] and value["result"] is None)
    else:
        _require(
            value["status"] == "not_run"
            and value["proof_ids"] == []
            and value["result"] == {"obligation": key}
        )


def _acceptance_common(value: Any) -> None:
    _bounded_value(value)
    _exact(
        value,
        "schema_version scope candidate_sha256 current_sha256 as_of policy phase transition profile checks limitations",
    )
    _require(value["schema_version"] == "spa-cutover-acceptance-v1")
    _enum(value["scope"], SCOPES)
    _hash(value["candidate_sha256"])
    _hash(value["current_sha256"])
    _time(value["as_of"])
    _require(value["policy"] == "spa-cutover-staged-policy-v1")
    _enum(value["phase"], PHASES)
    _exact(value["transition"], "id forward_entry_proof_id reverse_entry_proof_id")
    _id(value["transition"]["id"])
    _id(value["transition"]["forward_entry_proof_id"], nullable=True)
    _id(value["transition"]["reverse_entry_proof_id"], nullable=True)
    _exact(value["checks"], CHECK_IDS)
    for key, check in value["checks"].items():
        _check_wrapper(check, key)
    _array(value["limitations"], 16)
    _require(all(type(item) is str for item in value["limitations"]))
    _require(
        type(value["profile"]) is dict
        and value["profile"].get("kind")
        in {
            "c2-source-preparation-v1",
            "c2-native-partial-v1",
            "c3-staged-structural-v1",
        }
    )


def _catalog(value: Any) -> None:
    _exact(value, tuple(CATALOG))
    _number(value["case_count"], 615, 615)
    _number(value["required_evidence_slots"], 1470, 1470)
    _require(value == CATALOG)


OBSERVATION_PHASES = {
    "source-verification",
    "rehearsal",
    "baseline",
    "before-forward",
    "after-forward",
    "before-reverse",
    "after-reverse",
    "user-review",
}
FAMILIES = {
    "artifact-verifier",
    "legacy-build-association",
    "runtime-association",
    "entry-observation",
    "ingress-observation",
    "transport-observation",
    "api-capability-observation",
    "owner-window-observation",
    "schema-content-observation",
    "backup-manifest",
    "isolated-restore-observation",
    "operation-custody-observation",
    "user-work-observation",
    "case-observation",
    "rollback-rehearsal",
    "user-decision",
    "native-partial",
    "supplemental-log",
}
PRODUCERS = {
    "c1-artifact-verifier",
    "legacy-next-verifier",
    "native-runtime-v1",
    "reviewed-synthetic-runtime",
    "reviewed-browser-observer",
    "reviewed-owner-observer",
    "reviewed-backup-restore",
    "reviewed-entry-observer",
    "explicit-user-decision",
    "synthetic-unit-fixture",
}
TRANSPORT_FLOWS = ("login", "config", "json", "upload", "sse", "download")
POST_FLOWS = (
    "login",
    "upload",
    "question-answer",
    "citation",
    "note",
    "export",
    "access-protection",
)
BACKUP_CATEGORIES = [
    "db",
    "personal-content",
    "checkpoints",
    "uploads",
    "podcasts",
    "runtime-config",
    "authorized-secret-custody",
]


def _boundary(value: Any) -> None:
    _exact(value, "topology_id storage_id lock_id")
    for item in value.values():
        _id(item)


def _subjects(rows: Any) -> None:
    _array(rows, 2, 1)
    for row in rows:
        _require(type(row) is dict)
        _enum(row.get("subject"), {"candidate", "current"})
    _require(len({row["subject"] for row in rows}) == len(rows))


def _result(key: str, value: Any) -> None:
    """The closed fifteen successful result unions; no caller-defined schema."""
    if key == "artifact_association":
        _exact(value, "candidate current rollback")
        for association in value.values():
            _exact(association, "kind identity_sha256 proof_ids")
            _enum(association["kind"], {"spa", "legacy-next"})
            _hash(association["identity_sha256"])
            _ids(association["proof_ids"], 16, 1)
    elif key in {
        "served_identity",
        "auth_runtime",
        "ingress_topology",
        "cookie_upload",
    }:
        _exact(
            value,
            "observations mode_transition" if key == "auth_runtime" else "observations",
        )
        if key == "auth_runtime":
            _require(value["mode_transition"] == "unchanged")
        _subjects(value["observations"])
        for row in value["observations"]:
            if key == "served_identity":
                _exact(
                    row,
                    "subject identity_sha256 gateway_digest origin_id components proof_ids",
                )
                _hash(row["identity_sha256"])
                _hash(row["gateway_digest"], nullable=True)
                _id(row["origin_id"])
                _ids(row["proof_ids"], 16, 1)
                _array(row["components"], 5, 4)
                for component in row["components"]:
                    _exact(
                        component,
                        "service execution execution_identity_sha256 source_commit source_tree artifact_sha256 config_id",
                    )
                    _enum(
                        component["service"],
                        {"web", "bff", "legacy-next", "api", "worker", "db"},
                    )
                    _enum(component["execution"], {"image", "native"})
                    _hash(component["execution_identity_sha256"])
                    _hash(component["source_commit"], 40, True)
                    _hash(component["source_tree"], 40, True)
                    _hash(component["artifact_sha256"], nullable=True)
                    _id(component["config_id"])
                _require(
                    len({item["service"] for item in row["components"]})
                    == len(row["components"])
                )
            elif key == "auth_runtime":
                _enum(row.get("kind"), {"spa", "legacy-next"})
                _ids(row.get("proof_ids"), 16, 1)
                _require(row.get("auth_mode") == "legacy_password")
                if row["kind"] == "spa":
                    _exact(row, "kind subject auth_mode config api proof_ids")
                    _exact(
                        row["config"],
                        "ui_transport_protocol web_session_protocol client_contracts",
                    )
                    _number(row["config"]["ui_transport_protocol"], 1, 1)
                    _require(
                        row["config"]["web_session_protocol"] is None
                        and row["config"]["client_contracts"] == ["workspace-view-v1"]
                    )
                    _exact(row["api"], "api_commit worker_commit supported_contracts")
                    _hash(row["api"]["api_commit"], 40)
                    _hash(row["api"]["worker_commit"], 40)
                    _require(row["api"]["supported_contracts"] == ["workspace-view-v1"])
                else:
                    _exact(
                        row,
                        "kind subject auth_mode legacy_runtime_identity_sha256 api_commit worker_commit proof_ids",
                    )
                    _require(row["subject"] == "current")
                    _hash(row["legacy_runtime_identity_sha256"])
                    _hash(row["api_commit"], 40)
                    _hash(row["worker_commit"], 40)
            elif key == "ingress_topology":
                _exact(
                    row,
                    "subject origin_id protection_id service_kinds bff_instances boundary backend_reachability writer_owner_ids proof_ids",
                )
                for name in ("origin_id", "protection_id"):
                    _id(row[name])
                _ids(row["service_kinds"], 5, 4)
                _number(row["bff_instances"], 1)
                _boundary(row["boundary"])
                _require(
                    row["backend_reachability"] == "internal-only"
                    and row["writer_owner_ids"] == ["api", "worker"]
                )
                _ids(row["proof_ids"], 16, 1)
            else:
                _exact(row, "subject identity_sha256 patches flows")
                _hash(row["identity_sha256"])
                _array(row["patches"], 2, 2)
                for patch in row["patches"]:
                    _exact(
                        patch,
                        "requirement_id patch_id source_commit component_identity_sha256 proof_id",
                    )
                    _enum(
                        patch["requirement_id"],
                        {"private-ingress-cookie", "upload-compatibility"},
                    )
                    _id(patch["patch_id"])
                    _hash(patch["source_commit"], 40)
                    _hash(patch["component_identity_sha256"])
                    _id(patch["proof_id"])
                _require(
                    {p["requirement_id"] for p in row["patches"]}
                    == {"private-ingress-cookie", "upload-compatibility"}
                )
                _array(row["flows"], 6, 6)
                for flow in row["flows"]:
                    _exact(flow, "client flow outcome proof_id")
                    _enum(flow["client"], {"legacy-next", "spa"})
                    _enum(flow["flow"], set(TRANSPORT_FLOWS))
                    _require(flow["outcome"] == "passed")
                    _id(flow["proof_id"])
                _require(
                    {flow["flow"] for flow in row["flows"]} == set(TRANSPORT_FLOWS)
                )
    elif key in {"forward_owners", "reverse_owners"}:
        _exact(
            value,
            "direction window_id cutoff_id owner_inventory_sha256 owners unseen_count unowned_count",
        )
        _require(
            value["direction"]
            == ("old-to-new" if key == "forward_owners" else "new-to-old")
        )
        for name in ("window_id", "cutoff_id"):
            _id(value[name])
        _hash(value["owner_inventory_sha256"])
        for name in ("unseen_count", "unowned_count"):
            _number(value[name], 0)
        _array(value["owners"], 256)
        for owner in value["owners"]:
            _exact(
                owner,
                "owner_id client client_identity_sha256 save reconcile exit proof_ids",
            )
            _id(owner["owner_id"])
            _enum(owner["client"], {"legacy-next", "spa"})
            _hash(owner["client_identity_sha256"])
            _enum(owner["save"], {"saved", "no-obligation"})
            _enum(
                owner["reconcile"],
                {"settled", "original-custody-retained", "no-operation"},
            )
            _require(owner["exit"] == "observed")
            _ids(owner["proof_ids"], 16, 1)
        _require(
            len({owner["owner_id"] for owner in value["owners"]})
            == len(value["owners"])
        )
    elif key == "schema_content":
        _exact(
            value,
            "baseline target rollback_identity_sha256 migration_relation readability_basis candidate_era_content schema_action data_action cutoff_id proof_ids",
        )
        _exact(value["baseline"], "schema_sha256 data_contract_sha256 storage_id")
        _hash(value["baseline"]["schema_sha256"])
        _hash(value["baseline"]["data_contract_sha256"])
        _id(value["baseline"]["storage_id"])
        _exact(value["target"], "migration_inventory_sha256 data_contract_sha256")
        for item in value["target"].values():
            _hash(item)
        _hash(value["rollback_identity_sha256"])
        _enum(value["migration_relation"], {"identical", "backward-compatible"})
        _enum(
            value["readability_basis"],
            {"source-matched-rehearsal", "current-state-observed"},
        )
        _enum(
            value["candidate_era_content"],
            {"synthetic-preserved", "production-preserved"},
        )
        _require(
            value["schema_action"] == "no-downgrade"
            and value["data_action"] == "retain-current"
        )
        _id(value["cutoff_id"])
        _ids(value["proof_ids"], 16, 1)
    elif key == "backup_snapshot":
        _exact(
            value,
            "snapshot_id cutoff_id hold_id storage_id backend_identity_sha256 schema_sha256 inventory_sha256 categories consistency snapshot_role data_bytes proof_id",
        )
        for name in ("snapshot_id", "cutoff_id", "hold_id", "storage_id", "proof_id"):
            _id(value[name])
        for name in ("backend_identity_sha256", "schema_sha256", "inventory_sha256"):
            _hash(value[name])
        _require(
            value["categories"] == BACKUP_CATEGORIES
            and value["consistency"] == "all-writers-quiescent"
            and value["snapshot_role"] == "pre-forward-insurance"
        )
        _number(value["data_bytes"], 2**63 - 1, 1)
    elif key == "isolated_restore":
        _exact(
            value,
            "snapshot_id cutoff_id source_storage_id target_storage_id backend_identity_sha256 schema_sha256 inventory_sha256 integrity readability originals restored_bytes proof_id",
        )
        for name in (
            "snapshot_id",
            "cutoff_id",
            "source_storage_id",
            "target_storage_id",
            "proof_id",
        ):
            _id(value[name])
        for name in ("backend_identity_sha256", "schema_sha256", "inventory_sha256"):
            _hash(value[name])
        _require(
            all(
                value[name] == "verified"
                for name in ("integrity", "readability", "originals")
            )
        )
        _number(value["restored_bytes"], 2**63 - 1, 1)
    elif key == "operation_custody":
        _exact(
            value,
            "cutoff_id hold_id inventory_sha256 admission continuity entries pending_count unknown_count unowned_count proof_id",
        )
        for name in ("cutoff_id", "hold_id", "proof_id"):
            _id(value[name])
        _hash(value["inventory_sha256"])
        _require(value["admission"] == "held")
        _enum(value["continuity"], {"quiescent", "compatible-original-owner-retained"})
        for name in ("pending_count", "unknown_count", "unowned_count"):
            _number(value[name], 256 if name != "unowned_count" else 0)
        _array(value["entries"], 256)
        for item in value["entries"]:
            _exact(
                item,
                "operation_id original_owner_id original_handle_id state disposition proof_id",
            )
            for name in (
                "operation_id",
                "original_owner_id",
                "original_handle_id",
                "proof_id",
            ):
                _id(item[name])
            _enum(
                item["state"],
                {"pending", "unknown", "succeeded", "failed", "not-dispatched"},
            )
            _enum(item["disposition"], {"wait-original", "check-only", "settled"})
        _require(
            len({item["operation_id"] for item in value["entries"]})
            == len(value["entries"])
        )
    elif key == "user_work":
        _exact(
            value,
            "window_id cutoff_id inventory_sha256 items unsaved_count discarded_count update_action proof_id",
        )
        for name in ("window_id", "cutoff_id", "proof_id"):
            _id(value[name])
        _hash(value["inventory_sha256"])
        _number(value["unsaved_count"], 0)
        _number(value["discarded_count"], 0)
        _require(value["update_action"] == "explicit-owner-action")
        _array(value["items"], 256)
        for item in value["items"]:
            _exact(item, "owner_id obligation_id kind disposition saved_record_id")
            for name in ("owner_id", "obligation_id", "saved_record_id"):
                _id(item[name])
            _enum(item["kind"], {"draft", "file", "delete-confirmation"})
            _require(item["disposition"] == "saved")
        _require(
            len({(i["owner_id"], i["obligation_id"]) for i in value["items"]})
            == len(value["items"])
        )
    elif key == "catalog_acceptance":
        _enum(
            value.get("variant") if type(value) is dict else None,
            {"pre-entry", "complete"},
        )
        fields = "variant catalog_file_sha256 membership_sha256 required_case_count required_evidence_count full_catalog_complete proof_ids"
        _exact(
            value,
            fields
            + (
                " temporal_case_id temporal_case_status"
                if value["variant"] == "pre-entry"
                else ""
            ),
        )
        for name in ("catalog_file_sha256", "membership_sha256"):
            _hash(value[name])
        _number(value["required_case_count"], 615, 614)
        _number(value["required_evidence_count"], 1470, 1467)
        _require(type(value["full_catalog_complete"]) is bool)
        _ids(value["proof_ids"], 16, 1)
        if value["variant"] == "pre-entry":
            _require(
                value["temporal_case_id"] == "C2-R11-old-tab-window"
                and value["temporal_case_status"] == "blocked"
            )
    elif key == "rollback_drill":
        _exact(
            value,
            "observation_scope candidate_identity_sha256 current_identity_sha256 forward_entry_proof_id reverse_entry_proof_id forward_owner_proof_id reverse_owner_proof_id fixture_epoch_id before_reverse_content_sha256 after_reverse_content_sha256 content_classes outcome schema_action data_action proof_id",
        )
        for name in (
            "candidate_identity_sha256",
            "current_identity_sha256",
            "before_reverse_content_sha256",
            "after_reverse_content_sha256",
        ):
            _hash(value[name])
        for name in (
            "forward_entry_proof_id",
            "reverse_entry_proof_id",
            "forward_owner_proof_id",
            "reverse_owner_proof_id",
            "fixture_epoch_id",
            "proof_id",
        ):
            _id(value[name])
        _require(
            value["observation_scope"] == "synthetic"
            and value["content_classes"] == ["note", "edit", "upload"]
            and value["outcome"] == "preserved"
            and value["schema_action"] == "no-downgrade"
            and value["data_action"] == "retain-current"
        )
    else:
        _require(key == "post_entry_acceptance")
        _exact(
            value,
            "subject entry_proof_id served_identity_sha256 origin_id protection_id flows",
        )
        _enum(value["subject"], {"candidate", "current"})
        for name in ("entry_proof_id", "origin_id", "protection_id"):
            _id(value[name])
        _hash(value["served_identity_sha256"])
        _array(value["flows"], 7, 7)
        for flow in value["flows"]:
            _exact(flow, "id outcome proof_id")
            _enum(flow["id"], set(POST_FLOWS))
            _require(flow["outcome"] == "passed")
            _id(flow["proof_id"])
        _require({flow["id"] for flow in value["flows"]} == set(POST_FLOWS))


def _proof(value: Any, context: bool = False) -> None:
    fields = "id family producer scope phase subject identity_sha256 pair observed_at transition_id predecessor_ids"
    _exact(value, fields if context else fields + " role record claim_sha256")
    _id(value["id"])
    if context:
        _require(re.fullmatch("c(?:0[0-9]|1[0-5])", value["id"]) is not None)
    _enum(value["family"], FAMILIES)
    _exact(value["producer"], "kind version")
    _enum(value["producer"]["kind"], PRODUCERS)
    _id(value["producer"]["version"], nullable=True)
    _enum(value["scope"], {"source", "synthetic", "production", "unit-fixture"})
    _enum(value["phase"], OBSERVATION_PHASES)
    _enum(value["subject"], {"candidate", "current", "pair"})
    _hash(value["identity_sha256"])
    _exact(value["pair"], "candidate_sha256 current_sha256")
    for item in value["pair"].values():
        _hash(item)
    _time(value["observed_at"])
    _id(value["transition_id"], nullable=True)
    _ids(value["predecessor_ids"], 4)
    if not context:
        _enum(value["role"], {"primary", "supplemental"})
        _record(value["record"], primary=value["role"] == "primary")
        _hash(value["claim_sha256"])


def _staged_shape(acceptance: dict[str, Any]) -> None:
    p = acceptance["profile"]
    _exact(p, "kind binding catalog catalog_membership cases evidence provenance")
    _exact(
        p["binding"],
        "source_commit source_tree api_commit worker_commit web_digest bff_digest web_slot bff_slot contract_digest fixture_digest gateway_digest window_file_sha256 scope candidate_sha256 current_sha256",
    )
    for name, item in p["binding"].items():
        if name == "scope":
            _enum(item, SCOPES)
        elif name in {"web_slot", "bff_slot"}:
            _id(item)
        else:
            _hash(
                item,
                40
                if name
                in {"source_commit", "source_tree", "api_commit", "worker_commit"}
                else 64,
            )
    _catalog(p["catalog"])
    _array(p["catalog_membership"], 615, 615)
    for row in p["catalog_membership"]:
        _exact(
            row, "id operation_ids layer mandatory conditions required_evidence_types"
        )
        _id(row["id"])
        _ids(row["operation_ids"], 446)
        _enum(
            row["layer"],
            {
                "browser",
                "runtime",
                "device",
                "provider",
                "gateway",
                "image",
                "production",
                "user",
            },
        )
        _require(row["mandatory"] is True)
        _exact(row["conditions"], "viewport locale theme input device zoom")
        _array(row["conditions"]["viewport"], 2, 2)
        for n in row["conditions"]["viewport"]:
            _number(n, 16384, 1)
        _number(row["conditions"]["zoom"], 1000, 1)
        for name in ("locale", "theme", "input", "device"):
            _id(row["conditions"][name])
        _ids(row["required_evidence_types"], 16, 1)
    _array(p["cases"], 615, 615)
    for row in p["cases"]:
        _exact(row, "id status evidence")
        _id(row["id"])
        _enum(row["status"], {"passed", "failed", "not_run", "blocked"})
        _ids(row["evidence"], 16)
    _array(p["evidence"], 1470)
    for row in p["evidence"]:
        _exact(
            row,
            "id case_id layer conditions_sha256 evidence_type outcome record context_id",
        )
        for name in ("id", "case_id", "layer", "evidence_type", "context_id"):
            _id(row[name])
        _hash(row["conditions_sha256"])
        _enum(row["outcome"], {"passed", "failed", "not_run", "blocked"})
        _record(row["record"], named=False)
    provenance = p["provenance"]
    _exact(provenance, "normalization proofs case_contexts")
    _record(provenance["normalization"])
    _array(provenance["proofs"], 64)
    _array(provenance["case_contexts"], 16)
    for proof in provenance["proofs"]:
        _proof(proof)
    for context in provenance["case_contexts"]:
        _proof(context, True)
    _require(
        sum(x["role"] == "primary" for x in provenance["proofs"]) <= 48
        and sum(x["role"] == "supplemental" for x in provenance["proofs"]) <= 16
    )
    _require(len(_canonical(acceptance)) <= 896 * 1024)
    _require(
        len(_canonical({k: p[k] for k in ("catalog_membership", "cases", "evidence")}))
        <= 800 * 1024
    )
    _require(
        len(
            _canonical({"checks": acceptance["checks"], "proofs": provenance["proofs"]})
        )
        <= 64 * 1024
    )
    remainder = {k: v for k, v in acceptance.items() if k not in {"profile", "checks"}}
    remainder["profile"] = {
        k: v
        for k, v in p.items()
        if k not in {"catalog_membership", "cases", "evidence", "provenance"}
    }
    remainder["provenance"] = {k: v for k, v in provenance.items() if k != "proofs"}
    _require(len(_canonical(remainder)) <= 32 * 1024)
    for key, check in acceptance["checks"].items():
        if check["state"] == "observed" and check["status"] == "passed":
            _result(key, check["result"])
