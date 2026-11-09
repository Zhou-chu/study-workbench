"""Pure C3 evidence relations. No referenced records are read."""

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING or __package__:
    from . import spa_cutover_schema as s
else:
    import spa_cutover_schema as s


def _envelope_findings(value: dict[str, Any], subject: str) -> set[str]:
    result: set[str] = set()
    components, source = value["components"], value["source"]
    if components["kind"] == "unknown" or source is None:
        result.add(subject.upper() + "_ARTIFACT_UNVERIFIED")
        if subject == "current":
            result.add("ROLLBACK_ARTIFACT_UNVERIFIED")
    else:
        verifications = (
            [
                components["web"]["verification"],
                components["bff"]["verification"],
                components["gateway"]["verification"],
            ]
            if components["kind"] == "spa"
            else [components["verification"]]
        )
        if any(item["status"] != "passed" for item in verifications):
            result.add(subject.upper() + "_ARTIFACT_UNVERIFIED")
            if subject == "current":
                result.add("ROLLBACK_ARTIFACT_UNVERIFIED")
        if any(
            item["source_commit"] != source["commit"]
            or item["source_tree"] != source["tree"]
            for item in verifications
        ):
            result.add("EVIDENCE_IDENTITY_MISMATCH")
        if components["kind"] == "spa":
            for kind in ("web", "bff"):
                part = components[kind]
                if (
                    part["manifest"]["source_commit"] != source["commit"]
                    or part["verification"]["contract_digest"]
                    != part["manifest"]["contract_digest"]
                ):
                    result.add("EVIDENCE_IDENTITY_MISMATCH")
            if (
                components["web"]["manifest"]["contract_digest"]
                != components["bff"]["manifest"]["contract_digest"]
            ):
                result.add("RUNTIME_API_INCOMPATIBLE")
    if any(item is None for item in value["backend"].values()):
        result.add("SOURCE_DEPLOYMENT_IDENTITY_UNVERIFIED")
    if any(item is None for item in value["data_boundary"].values()):
        result.add("TOPOLOGY_OR_DATA_BOUNDARY_UNVERIFIED")
    return result


def _preparation(profile: dict[str, Any], candidate: dict[str, Any]) -> set[str]:
    s._exact(
        profile,
        "kind source_commit source_tree helper_sha256 catalog run summary evidence",
    )
    s._hash(profile["source_commit"], 40)
    s._hash(profile["source_tree"], 40)
    s._hash(profile["helper_sha256"])
    s._catalog(profile["catalog"])
    s._require(profile["summary"] is None and profile["evidence"] == [])
    run = profile["run"]
    s._exact(
        run,
        "version run_id source_commit api_commit environment auth_mode runtime_started phase fixture_digest contract_digest web_digest bff_digest web_slot bff_slot gateway_digest",
    )
    s._require(
        run["version"] == "spa-acceptance-run-v1"
        and run["environment"] == "synthetic-preparation-only"
    )
    s._require(
        run["runtime_started"] is False and run["auth_mode"] == "legacy_password"
    )
    s._enum(run["phase"], {"prepared", "closed", "cleanup_uncertain"})
    for key in ("run_id", "web_slot", "bff_slot"):
        s._id(run[key])
    for key in ("source_commit", "api_commit"):
        s._hash(run[key], 40)
    for key in (
        "fixture_digest",
        "contract_digest",
        "web_digest",
        "bff_digest",
        "gateway_digest",
    ):
        s._hash(run[key])
    result = {"ACCEPTANCE_SCOPE_NOT_EXECUTED", "ACCEPTANCE_INCOMPLETE"}
    components = candidate["components"]
    associations = {
        "source_commit": candidate["source"]["commit"],
        "api_commit": candidate["backend"]["api_commit"],
        "web_slot": components["web"]["identity"]["release_slot"],
        "bff_slot": components["bff"]["identity"]["release_slot"],
        "web_digest": components["web"]["manifest"]["asset_digest"],
        "bff_digest": components["bff"]["manifest"]["asset_digest"],
        "contract_digest": components["web"]["manifest"]["contract_digest"],
        "gateway_digest": components["gateway"]["stage"]["sha256"],
    }
    if (
        any(run[key] != item for key, item in associations.items())
        or profile["source_commit"] != candidate["source"]["commit"]
        or profile["source_tree"] != candidate["source"]["tree"]
    ):
        result.add("EVIDENCE_IDENTITY_MISMATCH")
    return result


GATE_FAMILIES = {
    "artifact_association": {"artifact-verifier", "legacy-build-association"},
    "served_identity": {"runtime-association", "entry-observation"},
    "auth_runtime": {"api-capability-observation", "runtime-association"},
    "ingress_topology": {"ingress-observation"},
    "cookie_upload": {
        "transport-observation",
        "artifact-verifier",
        "legacy-build-association",
    },
    "forward_owners": {"owner-window-observation"},
    "reverse_owners": {"owner-window-observation"},
    "schema_content": {"schema-content-observation", "rollback-rehearsal"},
    "backup_snapshot": {"backup-manifest"},
    "isolated_restore": {"isolated-restore-observation"},
    "operation_custody": {"operation-custody-observation"},
    "user_work": {"user-work-observation", "owner-window-observation"},
    "catalog_acceptance": {
        "case-observation",
        "user-decision",
        "owner-window-observation",
        "runtime-association",
        "entry-observation",
    },
    "rollback_drill": {
        "rollback-rehearsal",
        "owner-window-observation",
        "entry-observation",
    },
    "post_entry_acceptance": {
        "runtime-association",
        "entry-observation",
        "api-capability-observation",
        "transport-observation",
        "case-observation",
        "ingress-observation",
    },
}


def _result_refs(value: Any) -> set[str]:
    found: set[str] = set()
    if type(value) is dict:
        for key, item in value.items():
            if key == "proof_ids":
                found.update(item)
            elif key == "proof_id" or key.endswith("_proof_id"):
                found.add(item)
            else:
                found.update(_result_refs(item))
    elif type(value) is list:
        for item in value:
            found.update(_result_refs(item))
    return found


class StagedEvidence:
    """Finite joins over validated in-memory inputs, not an observation producer."""

    def __init__(
        self,
        candidate: dict[str, Any],
        current: dict[str, Any],
        acceptance: dict[str, Any],
    ):
        self.env = {"candidate": candidate, "current": current}
        self.a = acceptance
        self.phase = acceptance["phase"]
        self.scope = acceptance["scope"]
        self.p = acceptance["profile"]
        self.checks = acceptance["checks"]
        self.proofs = {p["id"]: p for p in self.p["provenance"]["proofs"]}
        self.contexts = {p["id"]: p for p in self.p["provenance"]["case_contexts"]}
        self.identity = {key: s._identity(value) for key, value in self.env.items()}
        self.identity["pair"] = s._digest(self.identity)
        self.pair = {
            key: acceptance[key] for key in ("candidate_sha256", "current_sha256")
        }
        self.errors: set[str] = set()
        self.complete = False
        self.catalog_valid = False
        self.backup_valid = False
        self.restore_valid = False
        self.unit = any(
            p["scope"] == "unit-fixture"
            for p in [*self.proofs.values(), *self.contexts.values()]
        )
        self.forward = self.proofs.get(self.a["transition"]["forward_entry_proof_id"])
        self.reverse = self.proofs.get(self.a["transition"]["reverse_entry_proof_id"])
        self.target = (
            "current"
            if self.reverse
            and (
                not self.forward
                or s._time(self.reverse["observed_at"])
                >= s._time(self.forward["observed_at"])
            )
            else "candidate"
        )

    def need(self, condition: bool, code: str = "EVIDENCE_IDENTITY_MISMATCH") -> bool:
        if not condition:
            self.errors.add(code)
        return condition

    def result(self, key: str) -> dict[str, Any] | None:
        check = self.checks[key]
        return (
            check["result"]
            if check["state"] == "observed" and check["status"] == "passed"
            else None
        )

    def proof(
        self,
        identifier: str,
        families: set[str],
        subject: str | None = None,
        phase: str | set[str] | None = None,
        scope: str | None = None,
    ) -> dict[str, Any] | None:
        proof = self.proofs.get(identifier)
        if not self.need(proof is not None):
            return None
        assert proof is not None
        if not self.need(
            proof["role"] == "primary"
            and proof["record"]["bytes"] > 0
            and proof["family"] in families
        ):
            return None
        if subject is not None:
            self.need(proof["subject"] == subject)
        if phase is not None:
            self.need(
                proof["phase"] in ({phase} if type(phase) is str else phase),
                "EVIDENCE_FRESHNESS_UNVERIFIED",
            )
        if scope is not None:
            self.need(
                proof["scope"] == scope
                or (proof["scope"] == "unit-fixture" and self.scope == "synthetic"),
                "EVIDENCE_SCOPE_MISMATCH",
            )
        return proof

    def require_families(
        self,
        identifiers: list[str],
        families: set[str],
        subject: str,
        phase: str | set[str],
        scope: str,
    ) -> None:
        for family in families:
            matches = [
                p
                for identifier in identifiers
                if (p := self.proofs.get(identifier))
                and p["family"] == family
                and p["subject"] == subject
                and p["role"] == "primary"
            ]
            self.need(bool(matches))
            for match in matches:
                self.proof(match["id"], {family}, subject, phase, scope)

    def _producer(self, proof: dict[str, Any]) -> None:
        family, producer, scope, phase = (
            proof["family"],
            proof["producer"]["kind"],
            proof["scope"],
            proof["phase"],
        )
        if producer == "synthetic-unit-fixture":
            self.need(
                scope == "unit-fixture" and self.scope == "synthetic",
                "EVIDENCE_SCOPE_MISMATCH",
            )
            return
        self.need(scope != "unit-fixture", "EVIDENCE_SCOPE_MISMATCH")
        if family == "artifact-verifier":
            allowed = (
                producer == "c1-artifact-verifier"
                and scope == "source"
                and phase == "source-verification"
            )
        elif family == "legacy-build-association":
            allowed = (
                producer == "legacy-next-verifier"
                and scope == "source"
                and phase == "source-verification"
            )
        elif family in {
            "owner-window-observation",
            "operation-custody-observation",
            "user-work-observation",
        }:
            allowed = (
                producer == "reviewed-owner-observer"
                and scope in {"synthetic", "production"}
                and (
                    scope != "synthetic"
                    or phase == "rehearsal"
                    or self.scope == "synthetic"
                )
            )
        elif family in {"backup-manifest", "isolated-restore-observation"}:
            allowed = producer == "reviewed-backup-restore" and scope in {
                "synthetic",
                "production",
            }
        elif family == "user-decision":
            allowed = (
                producer == "explicit-user-decision"
                and scope in {"synthetic", "production"}
                and phase == "user-review"
            )
        elif family == "entry-observation":
            allowed = producer == "reviewed-entry-observer" and scope in {
                "synthetic",
                "production",
            }
        elif family == "native-partial":
            allowed = producer == "native-runtime-v1" and scope == "synthetic"
        elif family == "supplemental-log":
            allowed = proof.get("role") == "supplemental"
        else:
            allowed = (
                scope == "synthetic"
                and producer
                in {"reviewed-synthetic-runtime", "reviewed-browser-observer"}
            ) or (
                scope == "production"
                and producer in {"reviewed-entry-observer", "reviewed-browser-observer"}
            )
        self.need(allowed, "EVIDENCE_SCOPE_MISMATCH")

    def provenance(self) -> None:
        raw_proofs = self.p["provenance"]["proofs"]
        raw_contexts = self.p["provenance"]["case_contexts"]
        self.need(
            len(self.proofs) == len(raw_proofs)
            and len(self.contexts) == len(raw_contexts)
        )
        for proof in [*raw_proofs, *raw_contexts]:
            self._producer(proof)
            self.need(
                proof["identity_sha256"] == self.identity[proof["subject"]]
                and proof["pair"] == self.pair
            )
            self.need(
                s._time(proof["observed_at"]) <= s._time(self.a["as_of"]),
                "EVIDENCE_FRESHNESS_UNVERIFIED",
            )
            self.need(
                proof["transition_id"] is not None
                or proof["phase"] in {"source-verification", "user-review"}
            )
            if proof["phase"] not in {
                "source-verification",
                "user-review",
                "rehearsal",
            }:
                self.need(proof["transition_id"] == self.a["transition"]["id"])
            for predecessor in proof["predecessor_ids"]:
                earlier = self.proofs.get(predecessor)
                self.need(earlier is not None)
                if earlier:
                    self.need(
                        s._time(earlier["observed_at"])
                        <= s._time(proof["observed_at"]),
                        "EVIDENCE_FRESHNESS_UNVERIFIED",
                    )
            if proof["family"] == "supplemental-log":
                self.need(proof.get("role") == "supplemental")
        # Bounded Kahn traversal avoids both recursive and exponential graph walks.
        remaining = {
            key: set(p["predecessor_ids"]) & set(self.proofs)
            for key, p in self.proofs.items()
        }
        while remaining:
            roots = {key for key, parents in remaining.items() if not parents}
            if not roots:
                self.errors.add("EVIDENCE_FRESHNESS_UNVERIFIED")
                break
            remaining = {
                key: parents - roots
                for key, parents in remaining.items()
                if key not in roots
            }
        for proof in raw_proofs:
            uses = {
                "checks": sorted(
                    [
                        {"check_id": key, "result": value["result"]}
                        for key, value in self.checks.items()
                        if proof["id"] in value["proof_ids"]
                    ],
                    key=lambda row: row["check_id"],
                ),
                "transition_roles": sorted(
                    key
                    for key in ("forward_entry_proof_id", "reverse_entry_proof_id")
                    if self.a["transition"][key] == proof["id"]
                ),
                "case_context_ids": sorted(
                    row["id"]
                    for row in raw_contexts
                    if proof["id"] in row["predecessor_ids"]
                ),
                "successor_proof_ids": sorted(
                    row["id"]
                    for row in raw_proofs
                    if proof["id"] in row["predecessor_ids"]
                ),
            }
            self.need(any(uses.values()))
            self.need(
                proof["claim_sha256"]
                == s._digest(
                    {
                        "proof": {
                            key: item
                            for key, item in proof.items()
                            if key != "claim_sha256"
                        },
                        "uses": uses,
                    }
                )
            )
        for key, check in self.checks.items():
            if check["state"] != "observed":
                continue
            self.need(_result_refs(check["result"]) <= set(check["proof_ids"]))
            primaries = []
            for identifier in check["proof_ids"]:
                proof = self.proofs.get(identifier)
                self.need(proof is not None)
                if proof and proof["role"] == "primary":
                    self.need(proof["family"] in GATE_FAMILIES[key])
                    primaries.append(proof)
            self.need(bool(primaries))

    def transition(self) -> None:
        for proof in self.proofs.values():
            if proof["family"] != "entry-observation" or proof["phase"] == "rehearsal":
                continue
            forward = proof["phase"] == "after-forward"
            owner_phase = "before-forward" if forward else "before-reverse"
            owner_subject = "current" if forward else "candidate"
            parents = [
                self.proofs.get(identifier) for identifier in proof["predecessor_ids"]
            ]
            owners = [
                p
                for p in parents
                if p
                and p["family"] == "owner-window-observation"
                and p["phase"] == owner_phase
                and p["subject"] == owner_subject
            ]
            self.need(bool(owners), "EVIDENCE_FRESHNESS_UNVERIFIED")
            field = "forward_entry_proof_id" if forward else "reverse_entry_proof_id"
            gate = "forward_owners" if forward else "reverse_owners"
            if self.a["transition"][field] == proof["id"]:
                self.need(
                    bool(
                        {owner["id"] for owner in owners}
                        & set(self.checks[gate]["proof_ids"])
                    ),
                    "EVIDENCE_FRESHNESS_UNVERIFIED",
                )
            for owner in owners:
                self.proof(
                    owner["id"],
                    {"owner-window-observation"},
                    owner_subject,
                    owner_phase,
                    self.live_scope,
                )
            if not forward:
                self.need(
                    any(
                        self.proofs.get(identifier, {}).get("family")
                        == "entry-observation"
                        and self.proofs[identifier]["phase"] == "after-forward"
                        for identifier in self.ancestors(proof["id"])
                    ),
                    "EVIDENCE_FRESHNESS_UNVERIFIED",
                )
        for field, subject, phase in (
            ("forward_entry_proof_id", "candidate", "after-forward"),
            ("reverse_entry_proof_id", "current", "after-reverse"),
        ):
            identifier = self.a["transition"][field]
            if identifier:
                self.proof(
                    identifier, {"entry-observation"}, subject, phase, self.live_scope
                )
        if self.phase in {"forward-verification", "reverse-entry"}:
            self.need(
                self.forward is not None and self.target == "candidate",
                "EVIDENCE_FRESHNESS_UNVERIFIED",
            )
        if self.phase == "reverse-verification":
            self.need(
                self.forward is not None
                and self.reverse is not None
                and self.target == "current",
                "EVIDENCE_FRESHNESS_UNVERIFIED",
            )
        if self.phase == "finalize":
            self.need(
                self.forward is not None and self.reverse is not None,
                "EVIDENCE_FRESHNESS_UNVERIFIED",
            )
        if self.forward and self.reverse:
            self.need(
                s._time(self.forward["observed_at"])
                != s._time(self.reverse["observed_at"]),
                "EVIDENCE_FRESHNESS_UNVERIFIED",
            )
        if self.phase == "forward-entry":
            self.need(
                self.forward is None or self.target == "current",
                "EVIDENCE_FRESHNESS_UNVERIFIED",
            )

    @property
    def live_scope(self) -> str:
        return "production" if self.scope == "production" else "synthetic"

    @property
    def live_phase(self) -> str:
        return {
            "forward-entry": "before-forward",
            "forward-verification": "after-forward",
            "reverse-entry": "before-reverse",
            "reverse-verification": "after-reverse",
            "finalize": "after-forward"
            if self.target == "candidate"
            else "after-reverse",
        }[self.phase]

    @property
    def baseline_subject(self) -> str:
        if self.phase == "forward-entry":
            return "current"
        if self.phase in {"forward-verification", "reverse-entry"}:
            return "candidate"
        return self.target if self.phase == "finalize" else "current"

    def _after_entry(self, proof: dict[str, Any] | None, current: bool = True) -> None:
        if not proof:
            return
        if proof["phase"] == "before-forward":
            if current and self.phase == "forward-entry" and self.reverse:
                self.need(
                    self.reverse["id"] in self.ancestors(proof["id"]),
                    "EVIDENCE_FRESHNESS_UNVERIFIED",
                )
            return
        if proof["phase"] in {
            "source-verification",
            "rehearsal",
            "baseline",
            "user-review",
        }:
            return
        # An entry record links its predecessor owner; it is not its own ancestor.
        if proof["family"] == "entry-observation":
            return
        expected = (
            "after-reverse" if proof["phase"] == "after-reverse" else "after-forward"
        )
        if current:
            event = self.reverse if expected == "after-reverse" else self.forward
            self.need(event is not None, "EVIDENCE_FRESHNESS_UNVERIFIED")
            if event:
                self.need(
                    event["id"] in self.ancestors(proof["id"])
                    and s._time(event["observed_at"]) <= s._time(proof["observed_at"]),
                    "EVIDENCE_FRESHNESS_UNVERIFIED",
                )
        else:
            self.need(
                any(
                    self.proofs.get(identifier, {}).get("family") == "entry-observation"
                    and self.proofs[identifier]["phase"] == expected
                    for identifier in self.ancestors(proof["id"])
                ),
                "EVIDENCE_FRESHNESS_UNVERIFIED",
            )

    def ancestors(self, identifier: str) -> set[str]:
        seen: set[str] = set()
        todo = list(self.proofs.get(identifier, {}).get("predecessor_ids", []))
        while todo:
            parent = todo.pop()
            if parent not in seen:
                seen.add(parent)
                todo.extend(self.proofs.get(parent, {}).get("predecessor_ids", []))
        return seen

    def binding(self) -> None:
        candidate = self.env["candidate"]
        c = candidate["components"]
        wanted = {
            "source_commit": candidate["source"]["commit"],
            "source_tree": candidate["source"]["tree"],
            "api_commit": candidate["backend"]["api_commit"],
            "worker_commit": candidate["backend"]["worker_commit"],
            "web_digest": c["web"]["manifest"]["asset_digest"],
            "bff_digest": c["bff"]["manifest"]["asset_digest"],
            "web_slot": c["web"]["identity"]["release_slot"],
            "bff_slot": c["bff"]["identity"]["release_slot"],
            "contract_digest": c["web"]["manifest"]["contract_digest"],
            "fixture_digest": "95931d63f7836be583d17aa8b419bc59c328df3b414a6418d6078939e2ccb423",
            "gateway_digest": c["gateway"]["stage"]["sha256"],
            "window_file_sha256": c["gateway"]["window_file"]["sha256"],
            "scope": self.scope,
            **self.pair,
        }
        self.need(self.p["binding"] == wanted)

    def artifact_association(self, value: dict[str, Any]) -> None:
        for label in ("candidate", "current", "rollback"):
            subject = "current" if label == "rollback" else label
            env, association = self.env[subject], value[label]
            self.need(
                association["kind"] == env["components"]["kind"]
                and association["identity_sha256"] == self.identity[subject]
            )
            if env["components"]["kind"] == "unknown":
                self.errors.add("CURRENT_ARTIFACT_UNVERIFIED")
                continue
            components = env["components"]
            family = (
                "artifact-verifier"
                if components["kind"] == "spa"
                else "legacy-build-association"
            )
            records = (
                [
                    components["web"]["verification"]["record"],
                    components["bff"]["verification"]["record"],
                    components["gateway"]["verification"]["record"],
                ]
                if components["kind"] == "spa"
                else [components["verification"]["record"]]
            )
            primaries = [
                self.proof(
                    identifier, {family}, subject, "source-verification", "source"
                )
                for identifier in association["proof_ids"]
            ]
            self.need(
                all(
                    any(p and p["record"] == record for p in primaries)
                    for record in records
                )
            )
            # The distinct gateway verification record's claim binds the complete
            # same-order retained declarations, including every original metadata
            # association. No extra per-slot API or current-HEAD source is invented.

    def _observations(self, key: str, value: dict[str, Any]) -> None:
        subjects = (
            {"current", "candidate"}
            if self.phase in {"forward-entry", "reverse-entry"}
            else {self.baseline_subject}
        )
        self.need({row["subject"] for row in value["observations"]} == subjects)
        for row in value["observations"]:
            subject = row["subject"]
            env = self.env[subject]
            kind = env["components"]["kind"]
            rehearsal = (self.phase == "forward-entry" and subject == "candidate") or (
                self.phase == "reverse-entry" and subject == "current"
            )
            phase = (
                "rehearsal"
                if rehearsal
                else ("baseline" if self.phase == "forward-entry" else self.live_phase)
            )
            scope = "synthetic" if rehearsal else self.live_scope
            services = (
                ["web", "bff", "api", "worker", "db"]
                if kind == "spa"
                else ["legacy-next", "api", "worker", "db"]
            )
            if key == "served_identity":
                self.need(row["identity_sha256"] == self.identity[subject])
                self.need(
                    row["gateway_digest"]
                    == (
                        env["components"]["gateway"]["stage"]["sha256"]
                        if kind == "spa"
                        else None
                    )
                )
                self.need(
                    [item["service"] for item in row["components"]] == services,
                    "TOPOLOGY_OR_DATA_BOUNDARY_UNVERIFIED",
                )
                for component in row["components"]:
                    service = component["service"]
                    if service in {"api", "worker"}:
                        self.need(
                            component["source_commit"]
                            == env["backend"][service + "_commit"]
                            and component["source_tree"]
                            == env["backend"]["source_tree"],
                            "SOURCE_DEPLOYMENT_IDENTITY_MISMATCH",
                        )
                    elif service != "db":
                        self.need(
                            env["source"] is not None
                            and component["source_commit"] == env["source"]["commit"]
                            and component["source_tree"] == env["source"]["tree"],
                            "SOURCE_DEPLOYMENT_IDENTITY_MISMATCH",
                        )
                        expected = (
                            env["components"][service]["manifest"]["asset_digest"]
                            if service in {"web", "bff"}
                            else env["components"]["artifact"]["artifact_sha256"]
                        )
                        self.need(
                            component["artifact_sha256"] == expected,
                            "SOURCE_DEPLOYMENT_IDENTITY_MISMATCH",
                        )
                self.require_families(
                    row["proof_ids"], {"runtime-association"}, subject, phase, scope
                )
            elif key == "auth_runtime":
                self.need(row["kind"] == kind, "RUNTIME_API_INCOMPATIBLE")
                api = row["api"] if kind == "spa" else row
                self.need(
                    api["api_commit"] == env["backend"]["api_commit"]
                    and api["worker_commit"] == env["backend"]["worker_commit"],
                    "RUNTIME_API_INCOMPATIBLE",
                )
                if kind == "legacy-next":
                    self.need(
                        row["legacy_runtime_identity_sha256"] == self.identity[subject]
                    )
                self.require_families(
                    row["proof_ids"],
                    {"api-capability-observation", "runtime-association"},
                    subject,
                    phase,
                    scope,
                )
            elif key == "ingress_topology":
                self.need(
                    row["service_kinds"] == services
                    and row["bff_instances"] == (1 if kind == "spa" else 0)
                    and row["boundary"] == env["data_boundary"],
                    "TOPOLOGY_OR_DATA_BOUNDARY_UNVERIFIED",
                )
                self.require_families(
                    row["proof_ids"], {"ingress-observation"}, subject, phase, scope
                )
                runtime = self.result("served_identity")
                if runtime:
                    matched = next(
                        (
                            item
                            for item in runtime["observations"]
                            if item["subject"] == subject
                        ),
                        None,
                    )
                    self.need(
                        matched is not None
                        and row["origin_id"] == matched["origin_id"],
                        "INGRESS_PROTECTION_UNVERIFIED",
                    )
            else:
                self.need(row["identity_sha256"] == self.identity[subject])
                allowed = {s._digest(env["backend"])}
                if kind == "spa":
                    allowed.update(
                        s._digest(env["components"][part]["identity"])
                        for part in ("web", "bff")
                    )
                elif kind == "legacy-next":
                    allowed.add(s._digest(env["components"]["artifact"]))
                for patch in row["patches"]:
                    self.need(
                        patch["component_identity_sha256"] in allowed,
                        "COOKIE_COMPATIBILITY_UNVERIFIED",
                    )
                    self.proof(
                        patch["proof_id"],
                        {"artifact-verifier", "legacy-build-association"},
                        subject,
                        "source-verification",
                        "source",
                    )
                for flow in row["flows"]:
                    self.need(flow["client"] == kind, "COOKIE_COMPATIBILITY_UNVERIFIED")
                    p = self.proof(
                        flow["proof_id"],
                        {"transport-observation"},
                        subject,
                        phase,
                        scope,
                    )
                    self._after_entry(p)
            if "proof_ids" in row:
                for identifier in row["proof_ids"]:
                    self._after_entry(self.proofs.get(identifier))

    def owners(self, value: dict[str, Any], reverse: bool) -> None:
        subject = "candidate" if reverse else "current"
        key = "reverse_owners" if reverse else "forward_owners"
        phase = "before-reverse" if reverse else "before-forward"
        identifiers = self.checks[key]["proof_ids"]
        self.require_families(
            identifiers, {"owner-window-observation"}, subject, phase, self.live_scope
        )
        for identifier in identifiers:
            active = (not reverse and self.phase == "forward-entry") or (
                reverse
                and (
                    self.phase in {"reverse-entry", "reverse-verification"}
                    or (self.phase == "finalize" and self.target == "current")
                )
            )
            self._after_entry(self.proofs.get(identifier), current=active)
        for owner in value["owners"]:
            self.need(
                owner["client"] == self.env[subject]["components"]["kind"]
                and owner["client_identity_sha256"] == self.identity[subject]
            )
            self.require_families(
                owner["proof_ids"],
                {"owner-window-observation"},
                subject,
                phase,
                self.live_scope,
            )
            if owner["reconcile"] == "original-custody-retained":
                custody = self.result("operation_custody")
                self.need(
                    custody is not None
                    and custody["continuity"] == "compatible-original-owner-retained"
                    and any(
                        entry["original_owner_id"] == owner["owner_id"]
                        and entry["state"] in {"pending", "unknown"}
                        for entry in custody["entries"]
                    ),
                    "UNKNOWN_OPERATION_CUSTODY_UNVERIFIED",
                )

    def schema_content(self, value: dict[str, Any]) -> None:
        env = self.env[self.baseline_subject]
        target = self.env[
            "candidate"
            if self.phase in {"forward-entry", "forward-verification"}
            or (self.phase == "finalize" and self.target == "candidate")
            else "current"
        ]
        self.need(
            value["baseline"]["storage_id"] == env["data_boundary"]["storage_id"]
            and value["baseline"]["data_contract_sha256"]
            == env["backend"]["data_contract_sha256"],
            "SCHEMA_ROLLBACK_UNVERIFIED",
        )
        self.need(
            value["target"]["migration_inventory_sha256"]
            == target["backend"]["migration_inventory_sha256"]
            and value["target"]["data_contract_sha256"]
            == target["backend"]["data_contract_sha256"]
            and value["rollback_identity_sha256"] == self.identity["current"],
            "SCHEMA_ROLLBACK_INCOMPATIBLE",
        )
        if value["migration_relation"] == "identical":
            self.need(
                env["backend"]["migration_inventory_sha256"]
                == target["backend"]["migration_inventory_sha256"],
                "SCHEMA_ROLLBACK_INCOMPATIBLE",
            )
        self.need(
            value["readability_basis"]
            == (
                "source-matched-rehearsal"
                if self.phase == "forward-entry"
                else "current-state-observed"
            ),
            "SCHEMA_ROLLBACK_UNVERIFIED",
        )
        self.need(
            value["candidate_era_content"]
            == (
                "production-preserved"
                if self.scope == "production" and self.phase != "forward-entry"
                else "synthetic-preserved"
            ),
            "SCHEMA_ROLLBACK_UNVERIFIED",
        )
        self.require_families(
            value["proof_ids"],
            {"schema-content-observation"},
            self.baseline_subject,
            self.live_phase,
            self.live_scope,
        )
        for identifier in value["proof_ids"]:
            if (
                self.proofs.get(identifier, {}).get("family")
                == "schema-content-observation"
            ):
                self._after_entry(self.proofs[identifier])
        self.require_families(
            value["proof_ids"], {"rollback-rehearsal"}, "pair", "rehearsal", "synthetic"
        )
        custody = self.result("operation_custody")
        self.need(
            custody is not None and custody["cutoff_id"] == value["cutoff_id"],
            "EVIDENCE_FRESHNESS_UNVERIFIED",
        )

    def backup_snapshot(self, value: dict[str, Any]) -> None:
        before = set(self.errors)
        current = self.env["current"]
        self.need(
            value["storage_id"] == current["data_boundary"]["storage_id"]
            and value["backend_identity_sha256"] == s._digest(current["backend"]),
            "BACKUP_NOT_VERIFIED",
        )
        self.proof(
            value["proof_id"],
            {"backup-manifest"},
            "current",
            "before-forward",
            self.live_scope,
        )
        if self.phase == "forward-entry":
            custody, schema = (
                self.result("operation_custody"),
                self.result("schema_content"),
            )
            self.need(
                custody is not None
                and custody["cutoff_id"] == value["cutoff_id"]
                and custody["hold_id"] == value["hold_id"],
                "BACKUP_NOT_VERIFIED",
            )
            self.need(
                schema is not None
                and schema["baseline"]["schema_sha256"] == value["schema_sha256"],
                "BACKUP_NOT_VERIFIED",
            )
        self.backup_valid = self.errors == before

    def isolated_restore(self, value: dict[str, Any]) -> None:
        before = set(self.errors)
        backup = self.result("backup_snapshot")
        self.need(backup is not None, "RESTORE_NOT_VERIFIED")
        if backup:
            keys = (
                "snapshot_id",
                "cutoff_id",
                "backend_identity_sha256",
                "schema_sha256",
                "inventory_sha256",
            )
            self.need(
                all(value[key] == backup[key] for key in keys)
                and value["source_storage_id"] == backup["storage_id"]
                and value["restored_bytes"] == backup["data_bytes"],
                "RESTORE_NOT_VERIFIED",
            )
        self.need(
            value["target_storage_id"] != value["source_storage_id"]
            and all(
                value["target_storage_id"] != env["data_boundary"]["storage_id"]
                for env in self.env.values()
            ),
            "RESTORE_NOT_VERIFIED",
        )
        p = self.proof(
            value["proof_id"],
            {"isolated-restore-observation"},
            "current",
            "before-forward",
            self.live_scope,
        )
        if p and backup:
            self.need(
                backup["proof_id"] in self.ancestors(p["id"]), "RESTORE_NOT_VERIFIED"
            )
        self.restore_valid = self.errors == before

    def operation_custody(self, value: dict[str, Any]) -> None:
        self.proof(
            value["proof_id"],
            {"operation-custody-observation"},
            self.baseline_subject,
            self.live_phase,
            self.live_scope,
        )
        self.need(
            value["pending_count"]
            == sum(item["state"] == "pending" for item in value["entries"])
            and value["unknown_count"]
            == sum(item["state"] == "unknown" for item in value["entries"]),
            "UNKNOWN_OPERATION_CUSTODY_UNVERIFIED",
        )
        pending = [
            item for item in value["entries"] if item["state"] in {"pending", "unknown"}
        ]
        self.need(
            not pending or value["continuity"] == "compatible-original-owner-retained",
            "ACTIVE_WRITES_NOT_QUIESCENT",
        )
        reverse = self.phase in {"reverse-entry", "reverse-verification"} or (
            self.phase == "finalize" and self.target == "current"
        )
        directional = self.result("reverse_owners" if reverse else "forward_owners")
        owners = (
            {owner["owner_id"]: owner for owner in directional["owners"]}
            if directional
            else {}
        )
        for item in value["entries"]:
            self.proof(
                item["proof_id"],
                {"operation-custody-observation"},
                self.baseline_subject,
                self.live_phase,
                self.live_scope,
            )
            if item["state"] in {"pending", "unknown"}:
                self.need(
                    item["disposition"] in {"check-only", "wait-original"}
                    and item["original_owner_id"] in owners
                    and owners[item["original_owner_id"]]["reconcile"]
                    == "original-custody-retained",
                    "UNKNOWN_OPERATION_CUSTODY_UNVERIFIED",
                )
            else:
                self.need(
                    item["disposition"] == "settled",
                    "UNKNOWN_OPERATION_CUSTODY_UNVERIFIED",
                )
        self._after_entry(self.proofs.get(value["proof_id"]))

    def user_work(self, value: dict[str, Any]) -> None:
        key = (
            "reverse_owners"
            if self.phase in {"reverse-entry", "reverse-verification"}
            or (self.phase == "finalize" and self.target == "current")
            else "forward_owners"
        )
        owners = self.result(key)
        custody = self.result("operation_custody")
        self.need(
            owners is not None
            and value["window_id"] == owners["window_id"]
            and value["cutoff_id"] == owners["cutoff_id"]
            and value["inventory_sha256"] == owners["owner_inventory_sha256"],
            "USER_WORK_PRESERVATION_UNVERIFIED",
        )
        self.need(
            custody is not None and value["cutoff_id"] == custody["cutoff_id"],
            "EVIDENCE_FRESHNESS_UNVERIFIED",
        )
        if owners:
            index = {owner["owner_id"]: owner for owner in owners["owners"]}
            for item in value["items"]:
                self.need(
                    item["owner_id"] in index
                    and index[item["owner_id"]]["save"] == "saved",
                    "USER_WORK_PRESERVATION_UNVERIFIED",
                )
            for owner in owners["owners"]:
                self.need(
                    owner["save"] != "saved"
                    or any(
                        item["owner_id"] == owner["owner_id"] for item in value["items"]
                    ),
                    "USER_WORK_PRESERVATION_UNVERIFIED",
                )
            self.require_families(
                self.checks["user_work"]["proof_ids"],
                {"owner-window-observation"},
                "candidate" if key == "reverse_owners" else "current",
                "before-reverse" if key == "reverse_owners" else "before-forward",
                self.live_scope,
            )
        self._after_entry(
            self.proof(
                value["proof_id"],
                {"user-work-observation"},
                self.baseline_subject,
                self.live_phase,
                self.live_scope,
            )
        )

    def rollback_drill(self, value: dict[str, Any]) -> None:
        self.need(
            value["candidate_identity_sha256"] == self.identity["candidate"]
            and value["current_identity_sha256"] == self.identity["current"]
            and value["before_reverse_content_sha256"]
            == value["after_reverse_content_sha256"],
            "ROLLBACK_DRILL_UNVERIFIED",
        )
        roles = [
            ("forward_owner_proof_id", "owner-window-observation", "current"),
            ("forward_entry_proof_id", "entry-observation", "candidate"),
            ("reverse_owner_proof_id", "owner-window-observation", "candidate"),
            ("reverse_entry_proof_id", "entry-observation", "current"),
            ("proof_id", "rollback-rehearsal", "pair"),
        ]
        proof_rows = [
            self.proof(value[key], {family}, subject, "rehearsal", "synthetic")
            for key, family, subject in roles
        ]
        if all(proof_rows):
            self.need(
                len({p["transition_id"] for p in proof_rows if p}) == 1,
                "ROLLBACK_DRILL_UNVERIFIED",
            )
            for earlier, later in zip(proof_rows, proof_rows[1:]):
                assert earlier is not None and later is not None
                self.need(
                    earlier["id"] in self.ancestors(later["id"]),
                    "ROLLBACK_DRILL_UNVERIFIED",
                )

    def post_entry_acceptance(self, value: dict[str, Any]) -> None:
        target = self.baseline_subject
        event = self.forward if target == "candidate" else self.reverse
        self.need(
            value["subject"] == target
            and value["served_identity_sha256"] == self.identity[target]
            and event is not None
            and value["entry_proof_id"] == event["id"]
        )
        self.proof(
            value["entry_proof_id"],
            {"entry-observation"},
            target,
            self.live_phase,
            self.live_scope,
        )
        self.require_families(
            self.checks["post_entry_acceptance"]["proof_ids"],
            {"runtime-association"},
            target,
            self.live_phase,
            self.live_scope,
        )
        runtime, ingress = (
            self.result("served_identity"),
            self.result("ingress_topology"),
        )
        self.need(
            runtime is not None
            and any(
                row["subject"] == target and row["origin_id"] == value["origin_id"]
                for row in runtime["observations"]
            ),
            "INGRESS_PROTECTION_UNVERIFIED",
        )
        self.need(
            ingress is not None
            and any(
                row["subject"] == target
                and row["origin_id"] == value["origin_id"]
                and row["protection_id"] == value["protection_id"]
                for row in ingress["observations"]
            ),
            "INGRESS_PROTECTION_UNVERIFIED",
        )
        for flow in value["flows"]:
            family = {
                "login": {"api-capability-observation", "case-observation"},
                "upload": {"transport-observation"},
                "access-protection": {"ingress-observation"},
            }.get(flow["id"], {"case-observation"})
            self._after_entry(
                self.proof(
                    flow["proof_id"], family, target, self.live_phase, self.live_scope
                )
            )

    def catalog(self) -> None:
        membership, cases, evidence = (
            self.p["catalog_membership"],
            self.p["cases"],
            self.p["evidence"],
        )
        self.need(s._digest(membership) == s.CATALOG["case_membership_sha256"])
        identifiers = [row["id"] for row in membership]
        self.need(identifiers == sorted(set(identifiers)))
        self.need([row["id"] for row in cases] == identifiers)
        members = {row["id"]: row for row in membership}
        slots = [
            (row["id"], kind)
            for row in membership
            for kind in sorted(row["required_evidence_types"])
        ]
        temporal = "C2-R11-old-tab-window"
        temporal_row = next((row for row in cases if row["id"] == temporal), None)
        deferred = temporal_row == {"id": temporal, "status": "blocked", "evidence": []}
        wanted = [slot for slot in slots if not deferred or slot[0] != temporal]
        okay = self.need(
            [(row["case_id"], row["evidence_type"]) for row in evidence] == wanted,
            "ACCEPTANCE_INCOMPLETE",
        )
        okay &= self.need(
            [row["id"] for row in evidence]
            == ["e" + str(i).zfill(4) for i in range(len(wanted))]
        )
        index = {row["id"]: row for row in evidence}
        used_contexts: set[str] = set()
        for row in cases:
            member = members.get(row["id"])
            if not member:
                continue
            if deferred and row["id"] == temporal:
                continue
            okay &= self.need(row["status"] == "passed", "ACCEPTANCE_INCOMPLETE")
            joined = [index.get(identifier) for identifier in row["evidence"]]
            okay &= self.need(
                len(joined) == len(member["required_evidence_types"])
                and {item["evidence_type"] for item in joined if item}
                == set(member["required_evidence_types"]),
                "ACCEPTANCE_INCOMPLETE",
            )
            for item in joined:
                if not self.need(item is not None):
                    okay = False
                    continue
                assert item is not None
                okay &= self.need(
                    item["case_id"] == row["id"]
                    and item["layer"] == member["layer"]
                    and item["conditions_sha256"] == s._digest(member["conditions"])
                    and item["outcome"] == row["status"]
                )
                context = self.contexts.get(item["context_id"])
                used_contexts.add(item["context_id"])
                if not self.need(context is not None):
                    okay = False
                    continue
                assert context is not None
                if member["layer"] in {
                    "user",
                    "browser",
                    "runtime",
                    "device",
                    "provider",
                    "gateway",
                    "image",
                }:
                    matching = [
                        self.proofs.get(identifier)
                        for identifier in context["predecessor_ids"]
                    ]
                    okay &= self.need(
                        any(
                            p
                            and p["role"] == "primary"
                            and p["family"] == context["family"]
                            and p["subject"] == context["subject"]
                            and p["phase"] == context["phase"]
                            and p["scope"] == context["scope"]
                            for p in matching
                        )
                    )
                if member["layer"] == "user":
                    okay &= self.need(
                        context["family"] == "user-decision"
                        and context["phase"] == "user-review"
                    )
                    self.need(
                        context["scope"] in {"synthetic", "production"}
                        or (
                            context["scope"] == "unit-fixture"
                            and self.scope == "synthetic"
                        ),
                        "EVIDENCE_SCOPE_MISMATCH",
                    )
                elif member["layer"] == "production":
                    family = (
                        "runtime-association"
                        if item["evidence_type"] == "old-tab-identity"
                        else "owner-window-observation"
                    )
                    okay &= self.need(
                        context["family"] == family
                        and context["phase"] in {"after-forward", "after-reverse"}
                    )
                    self.need(
                        context["scope"] == self.live_scope
                        or (
                            context["scope"] == "unit-fixture"
                            and self.scope == "synthetic"
                        ),
                        "EVIDENCE_SCOPE_MISMATCH",
                    )
                    for event_phase, subject in (
                        ("after-forward", "candidate"),
                        ("after-reverse", "current"),
                    ):
                        matches = [
                            self.proofs.get(identifier)
                            for identifier in context["predecessor_ids"]
                        ]
                        events = [
                            p
                            for p in matches
                            if p
                            and p["family"] == "entry-observation"
                            and p["phase"] == event_phase
                            and p["subject"] == subject
                        ]
                        okay &= self.need(bool(events))
                        for event in events:
                            self.proof(
                                event["id"],
                                {"entry-observation"},
                                subject,
                                event_phase,
                                self.live_scope,
                            )
                    if family == "owner-window-observation":
                        for owner_phase, subject in (
                            ("before-forward", "current"),
                            ("before-reverse", "candidate"),
                        ):
                            matches = [
                                self.proofs.get(identifier)
                                for identifier in context["predecessor_ids"]
                            ]
                            owners = [
                                p
                                for p in matches
                                if p
                                and p["family"] == family
                                and p["phase"] == owner_phase
                                and p["subject"] == subject
                            ]
                            okay &= self.need(bool(owners))
                            for owner in owners:
                                self.proof(
                                    owner["id"],
                                    {family},
                                    subject,
                                    owner_phase,
                                    self.live_scope,
                                )
                    else:
                        okay &= self.need(
                            any(
                                self.proofs.get(identifier, {}).get("family")
                                == "runtime-association"
                                for identifier in context["predecessor_ids"]
                            )
                        )
                else:
                    okay &= self.need(
                        context["family"] == "case-observation"
                        and context["subject"] == "candidate"
                        and context["phase"] == "rehearsal"
                    )
                    self.need(
                        context["scope"] == "synthetic"
                        or (
                            context["scope"] == "unit-fixture"
                            and self.scope == "synthetic"
                        ),
                        "EVIDENCE_SCOPE_MISMATCH",
                    )
        self.need(used_contexts == set(self.contexts))
        self.complete = bool(okay and not deferred and len(evidence) == 1470)
        self.catalog_valid = bool(
            okay
            and (
                self.complete
                or (deferred and len(evidence) == 1467 and self.phase != "finalize")
            )
        )
        self.need(self.catalog_valid, "ACCEPTANCE_INCOMPLETE")

    def catalog_acceptance(self, value: dict[str, Any]) -> None:
        self.need(self.catalog_valid, "ACCEPTANCE_INCOMPLETE")
        self.need(
            value["catalog_file_sha256"] == s.CATALOG["file_sha256"]
            and value["membership_sha256"] == s.CATALOG["case_membership_sha256"]
        )
        self.need(
            value["variant"] == ("complete" if self.complete else "pre-entry")
            and value["full_catalog_complete"] is self.complete
            and value["required_case_count"] == (615 if self.complete else 614)
            and value["required_evidence_count"] == (1470 if self.complete else 1467),
            "ACCEPTANCE_INCOMPLETE",
        )
        self.require_families(
            value["proof_ids"],
            {"case-observation"},
            "candidate",
            "rehearsal",
            "synthetic",
        )
        # A real user decision can concern the exact synthetic preview or target UI.
        user_ids = [
            identifier
            for identifier in value["proof_ids"]
            if self.proofs.get(identifier, {}).get("family") == "user-decision"
        ]
        self.need(bool(user_ids))
        for identifier in user_ids:
            self.proof(identifier, {"user-decision"}, "candidate", "user-review")
        if self.complete:
            for family, phase in (
                ("entry-observation", "after-forward"),
                ("entry-observation", "after-reverse"),
                ("owner-window-observation", "before-forward"),
                ("owner-window-observation", "before-reverse"),
            ):
                self.need(
                    any(
                        self.proofs.get(identifier, {}).get("family") == family
                        and self.proofs[identifier]["phase"] == phase
                        for identifier in value["proof_ids"]
                    ),
                    "ACCEPTANCE_INCOMPLETE",
                )
            self.need(
                any(
                    self.proofs.get(identifier, {}).get("family")
                    == "runtime-association"
                    for identifier in value["proof_ids"]
                ),
                "ACCEPTANCE_INCOMPLETE",
            )

    def evaluate(self, future: set[str]) -> tuple[set[str], bool, bool, str]:
        self.binding()
        self.provenance()
        self.transition()
        self.catalog()
        for key, check in self.checks.items():
            if key in future:
                self.need(
                    check["state"] in {"obligation", "unavailable"},
                    "EVIDENCE_FRESHNESS_UNVERIFIED",
                )
                continue
            result = self.result(key)
            if result is None:
                self.errors.update(s.DUE_BLOCKERS[key])
                if check["state"] == "observed":
                    self.errors.add(check["result"]["reason"])
                continue
            if key in {
                "served_identity",
                "auth_runtime",
                "ingress_topology",
                "cookie_upload",
            }:
                self._observations(key, result)
            elif key in {"forward_owners", "reverse_owners"}:
                self.owners(result, key == "reverse_owners")
            else:
                getattr(self, key)(result)
        for proof in self.proofs.values():
            if proof["role"] == "primary":
                self._after_entry(proof, current=False)
        invalid_provenance = self.errors & {
            "EVIDENCE_SCOPE_MISMATCH",
            "EVIDENCE_IDENTITY_MISMATCH",
            "EVIDENCE_FRESHNESS_UNVERIFIED",
        }
        backups = self.backup_valid and self.restore_valid and not invalid_provenance
        basis = (
            "unit-fixture"
            if self.unit
            else ("final-observations" if self.complete else "staged-observations")
        )
        return self.errors, self.complete, bool(backups), basis


# This adapter is deliberately pinned to one retained, partial native receipt.
NATIVE_SOURCE = {
    "commit": "8e0d3af2b9c7623f1671c17246f6bf8eb345d920",
    "tree": "cb18fead5d07a894893494171d4fddafcf81d7a2",
    "api_commit": "8e0d3af2b9c7623f1671c17246f6bf8eb345d920",
    "worker_commit": "8e0d3af2b9c7623f1671c17246f6bf8eb345d920",
}
NATIVE_ARTIFACTS = {
    "web_slot": "c2-native-reviewfix1-8e0d3af-web-20261109",
    "bff_slot": "c2-native-reviewfix1-8e0d3af-bff-20261109",
    "web_digest": "afbba6e5fa6972b766aa83723b398b7066eb1a2fbdc6a2b53caa116b4dee77cd",
    "bff_digest": "24acb9a81c3836bb5b5608f303ff0916ea8ece1c3e94a5d38b8d69de8273e7d9",
    "contract_digest": "7457772928802237c1e2e59ba1841352dd4ccce5124c5259ce5eca09c161b0f1",
    "fixture_digest": "95931d63f7836be583d17aa8b419bc59c328df3b414a6418d6078939e2ccb423",
    "gateway_digest": "b87fb62a5e3bd9667f015139291b64a5f7896bafa51f8a18e2dc1d3c83ce933e",
    "window_file_sha256": "83d88f383b6814b785d4676f26e01081a5d9a611232843ef205b43094df1345b",
}
NATIVE_RECORDS = {
    "receipt": (
        9176,
        "8b126ddb6bb6fd5f610361f10c0de489b97e914ccdb6fc8fa67e0fd9b556600d",
    ),
    "report": (
        10352,
        "15f08e338a84e9b964c6e423530d3bd995f51fd3265982bbf868e1a091771395",
    ),
    "index": (2671, "c0c09439847ac4db5fde8655ddc49a5bf13a352c2ff336ae5a1e3860c054ffcd"),
    "results": (
        13698,
        "f99fee5edbfb7d8a7722f0b76975f0b072398ba494fcc38641d8045668188b57",
    ),
}
NATIVE_OBSERVATION = {
    "status": "partial_pass",
    "cleanup": "succeeded",
    "startup": ["db", "api", "worker", "bff"],
    "readiness": ["db/health", "api/health", "bff/config", "bff/api/auth/status"],
    "readiness_requests": {"attempted": 4, "completed": 4},
    "request_counts": {"attempted": 23, "completed": 23, "mutations": 7},
    "transaction": {
        "native_checks": "succeeded",
        "worker_completion": "extraction_succeeded",
        "export_status": "succeeded",
        "portable_status": "succeeded",
        "original_sha256": "20e21965df9711d91e8e2b03dd890a453f0a71bc5092c7eb251c43e4c664effa",
        "zip_sha256": "3f09f798e9a2dd0758f48f23705fecdd085afe50bacfabe7d786853b9fceb0ba",
    },
    "citation_validation": "not_run",
    "auxiliary_embedding": {
        "status": "failed",
        "reason": "no-model-configured",
        "source": "reviewed-results",
    },
}


def _native(profile: dict[str, Any], candidate: dict[str, Any]) -> set[str]:
    s._exact(
        profile,
        "kind observation_scope producer source artifacts catalog native summary case_results limitations",
    )
    s._require(
        profile["observation_scope"] == "synthetic-native-partial"
        and profile["summary"] is None
        and profile["case_results"] == []
    )
    s._catalog(profile["catalog"])
    s._array(profile["limitations"], 16)
    s._require(all(type(item) is str for item in profile["limitations"]))
    producer = profile["producer"]
    s._exact(producer, "version helper_sha256 receipt report index results")
    s._require(
        producer["version"] == "spa-native-runtime-receipt-v1"
        and producer["helper_sha256"]
        == "03113671e88abcf17a1050b763b9bb2c9b1a573f18d5cc106054c634820b2576"
    )
    for name, (size, digest) in NATIVE_RECORDS.items():
        s._record(producer[name])
        s._require(
            producer[name]["bytes"] == size and producer[name]["sha256"] == digest
        )
    # Canonical byte equality distinguishes bool from int and forbids all extras.
    s._require(s._canonical(profile["source"]) == s._canonical(NATIVE_SOURCE))
    s._require(s._canonical(profile["artifacts"]) == s._canonical(NATIVE_ARTIFACTS))
    s._require(s._canonical(profile["native"]) == s._canonical(NATIVE_OBSERVATION))
    result = {"ACCEPTANCE_SCOPE_NOT_EXECUTED", "ACCEPTANCE_INCOMPLETE"}
    c = candidate["components"]
    actual_source = {
        **candidate["source"],
        "api_commit": candidate["backend"]["api_commit"],
        "worker_commit": candidate["backend"]["worker_commit"],
    }
    actual_artifacts = {
        "web_slot": c["web"]["identity"]["release_slot"],
        "bff_slot": c["bff"]["identity"]["release_slot"],
        "web_digest": c["web"]["manifest"]["asset_digest"],
        "bff_digest": c["bff"]["manifest"]["asset_digest"],
        "contract_digest": c["web"]["manifest"]["contract_digest"],
        "fixture_digest": NATIVE_ARTIFACTS["fixture_digest"],
        "gateway_digest": c["gateway"]["stage"]["sha256"],
        "window_file_sha256": c["gateway"]["window_file"]["sha256"],
    }
    if actual_source != NATIVE_SOURCE or actual_artifacts != NATIVE_ARTIFACTS:
        result.add("EVIDENCE_IDENTITY_MISMATCH")
    return result
