"""Pure phase-aware Notebook cutover planner. Never executes a transition."""

import argparse
import sys
from typing import TYPE_CHECKING, Any, NoReturn

if TYPE_CHECKING or __package__:
    from . import spa_cutover_evidence as e
    from . import spa_cutover_schema as s
else:
    import spa_cutover_evidence as e
    import spa_cutover_schema as s

load_input = s.load_input


def _future_checks(phase: str) -> set[str]:
    if phase == "forward-entry":
        return {"reverse_owners", "post_entry_acceptance"}
    if phase == "forward-verification":
        return {"reverse_owners"}
    if phase == "reverse-entry":
        return {"post_entry_acceptance"}
    return set()


def make_cutover_plan(
    *, candidate: Any, current: Any, acceptance: Any
) -> dict[str, Any]:
    """Reduce supplied declarations only; never read records or perform actions."""
    blockers: set[str] = set()
    valid: dict[str, dict[str, Any]] = {}
    for subject, envelope in (("candidate", candidate), ("current", current)):
        try:
            s._envelope(envelope, subject)
            valid[subject] = envelope
            blockers.update(e._envelope_findings(envelope, subject))
        except (ValueError, TypeError, KeyError, RecursionError, OverflowError):
            blockers.add("INPUT_SCHEMA_INVALID")
    phase = None
    basis = "unavailable"
    complete = False
    backups = False
    try:
        s._acceptance_common(acceptance)
        phase = acceptance["phase"]
        if len(valid) == 2:
            if {candidate["scope"], current["scope"], acceptance["scope"]} != {
                acceptance["scope"]
            }:
                blockers.add("EVIDENCE_SCOPE_MISMATCH")
            if acceptance["candidate_sha256"] != s._digest(candidate) or acceptance[
                "current_sha256"
            ] != s._digest(current):
                blockers.add("EVIDENCE_IDENTITY_MISMATCH")
            profile = acceptance["profile"]
            if profile["kind"] == "c3-staged-structural-v1":
                s._staged_shape(acceptance)
                findings, complete, backups, basis = e.StagedEvidence(
                    candidate, current, acceptance
                ).evaluate(_future_checks(phase))
                blockers.update(findings)
            else:
                s._require(
                    len(s._canonical(profile)) <= 16384
                    and len(s._canonical(acceptance)) <= 131072
                )
                s._require(
                    phase == "forward-entry"
                    and acceptance["transition"]["forward_entry_proof_id"] is None
                    and acceptance["transition"]["reverse_entry_proof_id"] is None
                )
                for key, check in acceptance["checks"].items():
                    s._require(
                        check["state"] == "unavailable"
                        or (
                            key in _future_checks(phase)
                            and check["state"] == "obligation"
                        )
                    )
                    if key not in _future_checks(phase):
                        blockers.update(s.DUE_BLOCKERS[key])
                if profile["kind"] == "c2-source-preparation-v1":
                    blockers.update(e._preparation(profile, candidate))
                else:
                    blockers.update(e._native(profile, candidate))
                basis = "partial-only"
                if acceptance["scope"] != "source-only":
                    blockers.add("EVIDENCE_SCOPE_MISMATCH")
        if acceptance["scope"] == "source-only":
            blockers.add("ACCEPTANCE_SCOPE_NOT_EXECUTED")
    except (ValueError, TypeError, KeyError, RecursionError, OverflowError):
        blockers.add("INPUT_SCHEMA_INVALID")
    auth_mode = None
    if len(valid) == 2:
        if any(
            candidate["data_boundary"][key] != current["data_boundary"][key]
            for key in ("storage_id", "lock_id")
        ):
            blockers.add("TOPOLOGY_OR_DATA_BOUNDARY_UNVERIFIED")
        if candidate["auth_mode"] is None or current["auth_mode"] is None:
            blockers.add("AUTH_MODE_UNVERIFIED")
        elif candidate["auth_mode"] != current["auth_mode"]:
            blockers.add("AUTH_MODE_CHANGE_REQUIRES_SEPARATE_ACTIVATION")
        elif candidate["auth_mode"] != "legacy_password":
            blockers.add("FIRST_CUTOVER_REQUIRES_LEGACY_PASSWORD")
        else:
            auth_mode = "legacy_password"

    def summary(subject: str) -> dict[str, Any]:
        item = valid.get(subject)
        return {
            "scope": item["scope"] if item else None,
            "release_id": item["release_id"] if item else None,
            "phase": phase,
            "evidence_basis": basis,
            "envelope_sha256": s._digest(item) if item else None,
            "source": dict(item["source"]) if item and item["source"] else None,
            "full_catalog_complete": complete,
        }

    if blockers & {
        "INPUT_SCHEMA_INVALID",
        "EVIDENCE_SCOPE_MISMATCH",
        "EVIDENCE_IDENTITY_MISMATCH",
        "EVIDENCE_FRESHNESS_UNVERIFIED",
        "BACKUP_NOT_VERIFIED",
        "RESTORE_NOT_VERIFIED",
    }:
        backups = False
    if blockers & {
        "INPUT_SCHEMA_INVALID",
        "EVIDENCE_SCOPE_MISMATCH",
        "EVIDENCE_IDENTITY_MISMATCH",
        "EVIDENCE_FRESHNESS_UNVERIFIED",
        "ACCEPTANCE_INCOMPLETE",
    }:
        complete = False
    affirmative = {
        "COOKIE_COMPATIBILITY_FAILED",
        "RUNTIME_API_INCOMPATIBLE",
        "SCHEMA_ROLLBACK_INCOMPATIBLE",
        "DESTRUCTIVE_ROLLBACK_UNSUPPORTED",
        "UNKNOWN_OPERATION_RESET_FORBIDDEN",
    }
    compatibility = (
        "blocked"
        if blockers & affirmative
        else "unavailable"
        if blockers
        else "compatible"
    )
    actions, reverse = _actions(phase) if not blockers else ([], [])
    return {
        "candidate": summary("candidate"),
        "current": summary("current"),
        "backups_verified": backups,
        "auth_mode": auth_mode,
        "compatibility": compatibility,
        "blockers": [key for key in s.BLOCKERS if key in blockers],
        "ordered_actions": actions,
        "rollback_actions": reverse,
    }


def _actions(phase: str | None) -> tuple[list[str], list[str]]:
    common = [
        "Dry-run only: verify exact separate authorization and genuine observation custody; these structural claims authorize nothing.",
        "Immediately revalidate sources, protected route, storage/schema epoch, actual owners and original-operation custody. Any drift or uncertainty means DEFER and replan.",
        "Keep old Next and exact rollback source/artifacts available. Entry-stage compatibility is not full 615-case acceptance or permission to retire it.",
    ]
    entry = [
        "Before this direction executes, actual owners must SAVE, RECONCILE and EXIT with original pending/unknown custody retained; otherwise DEFER. Never force reload, timeout, restart-to-clear or replay.",
        "Verify matched pre-forward backup and isolated restore insurance at its named cutoff. This historical snapshot does not cover later candidate writes.",
        "Perform only separately authorized compatible code/routing changes with unchanged protection and current content; never restore an old snapshot or downgrade schema.",
        "Collect actual target post-entry served/source, auth/API, protected topology and Cookie/transport counterparts of checks 2-5, plus login, upload, question-answer, citation, note, export and access-protection observations. These obligations are not pre-passed.",
    ]
    verification = [
        "Verify actual target checks 2-5 and the seven post-entry flows against the exact observed entry and current epoch.",
        "Preserve current content and original request custody. An unknown entry or operation outcome must be resolved before retry or a new reverse-entry evaluation.",
    ]
    finalize = [
        "Independently verify all 615 cases and 1470 slots, including actual both-direction R11 owner/entry evidence and the latest target's actual checks. Never manufacture an unnecessary live rollback to obtain a green row.",
        "Any later retirement requires genuine final evidence and separate exact authorization; this output neither retires old Next nor declares deployment.",
    ]
    ordered = (
        common
        + (entry if phase in {"forward-entry", "reverse-entry"} else verification)
        + (finalize if phase == "finalize" else [])
    )
    rollback = [
        "Conditional reverse procedure only: resolve the actual entry outcome and preserve original pending/unknown handles without replay.",
        "Obtain separate exact reverse authorization and evaluate a new reverse-entry plan using fresh candidate-era schema/content, custody and actual-owner SAVE/RECONCILE/EXIT. Missing or unknown facts mean DEFER.",
        "Use exact compatible retained code/routing while retaining current content. No snapshot restore, schema downgrade, forced reload or restart-to-clear-unknown.",
        "Collect actual restored-current post-entry identity, protected transport and seven application flows, plus candidate-era content preservation. Keep old Next/artifacts until genuine full finalization.",
    ]
    return ordered, rollback


class _Parser(argparse.ArgumentParser):
    def error(self, message: str) -> NoReturn:
        raise ValueError("Invalid arguments")


def main(argv: list[str] | None = None) -> int:
    """Read only the three required files and print one safe JSON dry-run."""
    parser = _Parser(
        prog="spa_cutover_plan.py",
        allow_abbrev=False,
        description="Structural dry-run only. No execution or authorization.",
    )
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--current", required=True)
    parser.add_argument("--acceptance", required=True)
    try:
        args = parser.parse_args(argv)
        candidate = load_input(args.candidate)
        current = load_input(args.current)
        acceptance = load_input(args.acceptance)
    except (ValueError, OSError, TypeError):
        print("Invalid arguments or input.", file=sys.stderr)
        return 2
    plan = make_cutover_plan(
        candidate=candidate, current=current, acceptance=acceptance
    )
    print(s._canonical(plan).decode("utf-8"))
    return 1 if plan["blockers"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
