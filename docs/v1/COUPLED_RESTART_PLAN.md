# Coupled frontend/API restart — revised design review and implementation plan

> **Status:** Self-reviewed implementation design adopted for planning only. Source implementation and actual Docker acceptance remain pending; this document does not activate or authorize runtime changes.

**Goal:** After memory-only Web BFF custody is lost, prevent any replacement Next request process from starting against the pre-loss API epoch.

**Selected architecture:** Four separate Docker services remain: frontend, API, worker and DB. Device frontend/API have `restart: "no"`; every frontend image invocation waits behind a fresh-attempt gate. A **one-shot, operator-invoked host recovery transaction** removes the old pair, starts and probes a fresh exact API instance, then releases one exact frontend attempt. No continuously running controller, event consumer, heartbeat or automatic recovery loop is required for phase one.

**Tech stack:** Existing Linux Docker Engine/Compose deployment; Python standard-library host transaction and probe; dependency-free Node frontend gate. No new native endpoint or durable token mechanism.

**Spec:** This document; ADR-015; ADR-016; `docs/v1/DEVICE_SESSION_PROTOCOL.md`; `docs/v1/WEB_SESSION_IMPLEMENTATION_PLAN.md` activation gate.

**Reviewed baseline:** `b375cdefc68c79d79eb8dbc92ed1b1c505c3676d`. During final revision, canonical advanced to `264dede`; the acceptance ledger records the independently reviewed A1 source correction integrated at `ffbcb138d3cf63871ab7857f30dd14c65e072c9a`. This review inspected that narrow integration and the ledger, but did not rerun its tests. Real image/mount/lifecycle acceptance remains pending.

**Review status:** Revised and independently re-reviewed on 2026-10-21 UTC against findings A1–A6. No remaining design-document adoption blocker was found. No Docker acceptance has run; lifecycle implementation is deferred until an authorized Docker target is available. The review does not approve activation.

## Global constraints

- Auth mode parsing is exact: **absent → `legacy_password`; exact `legacy_password` → legacy; exact `device_sessions` → gated; explicit empty/unknown → fail closed**. Never use shell default expansion that conflates empty with absent.
- Default remains legacy; device mode never falls back to password Bearer.
- Exactly one frontend request process and one API process. No reload, cluster/process manager, multiple Uvicorn workers, rolling replicas, serverless or HMR continuity claim.
- Native protocol remains 1 and live-session cap remains 32. No cap increase, password-admin endpoint, durable BFF tokens/cleanup queue, new persistent signing secret or app-mounted Docker socket.
- Existing separate frontend/API/worker/DB images/services, non-root identities, per-role secret grants and data volumes remain. Only frontend publishes the existing loopback application port.
- Device API must preserve its configured password-file path exclusively for the strict native provider. Legacy, worker, DB and encryption loading remain unchanged by that narrow prerequisite.
- The production frontend image remains `NODE_ENV=production`. Production HTTP is rejected even with the insecure-loopback flag; full image/browser acceptance uses synthetic HTTPS.
- Launch IDs/markers contain no password, cookie, native token or recoverable token alias. They are orchestration metadata, not authentication credentials.
- Coupled recovery logs out native clients too. It cannot undo already-authorized writes/streams or replay unknown mutation outcomes.
- Actual runtime, host Docker/TLS tooling, credentials, OS/network settings and activation require separate authorization. None is changed by this review.

## Review focus and owning tasks

1. Password-file configuration is accidentally frozen by the image wrapper: prerequisite Task 0, real-image cases D4a/D4b.
2. Production-image HTTPS and absent-only legacy compatibility differ from loose fixtures: Tasks 1/2/4, D0/D3/D3a.
3. A dies after the last observation but before release: Task 3 and D8a–d distinguish old-epoch exclusion from present availability.
4. Same-ID restart, stale marker, delayed command or terminated wrapper bypass: Tasks 1/3, D1/D5/D7/D13.
5. Owned invalid resources, ambient Docker context or process customization undermine identity: Tasks 2/3, D9/D13/D14.

---

# Design

## 1. Baseline evidence and activation prerequisites

The current manifest independently restarts frontend/API with `unless-stopped` (`deploy/v1/compose.yaml:13,42`). The frontend image directly launches `node server.js`. API `/health` and Compose dependency ordering do not prove crash coupling.

ADR-016 says a frontend crash can discard credentials while native sessions still occupy the API cap of 32. The supported deployment must obtain a fresh API epoch before replacement frontend traffic. A 60-second BFF pending deadline does not expire those native families.

### Existing native readiness is sufficient for a historical barrier

- `api/device_session_service.py:45` generates a random boot epoch for each new service.
- `api/main.py:224` awaits device-auth initialization inside lifespan.
- `api/device_session_runtime.py:224–239` creates the service, awaits storage readiness and `check_ready()` before publishing runtime.
- `api/device_session_service.py:61–84` observes credentials and completes the native revoke-all barrier; uncertain acknowledgement fails closed.
- `api/routers/auth.py:99–108` makes exact `GET /api/auth/status` await `check_ready()` and report device mode/protocol 1.

A fresh, validated single-process API container plus successful native status **from that container's loopback** therefore proves that a new service completed readiness. The response does not expose epoch/container identity: freshness comes from verified process replacement and image/process contract, not the JSON alone. No new epoch/admin endpoint is needed.

### A1: existing wrapper breaks the configured-file contract

At the reviewed baseline, `deploy/v1/entrypoint.py:28–52` reads every required `_FILE`, materializes its value into the child environment, then deletes the file-path key. Device API consequently gives `StrictPasswordProvider.from_environment()` a frozen `OPEN_NOTEBOOK_PASSWORD`, not its configured file path. File changes/read failures can then be invisible to the provider even while native status succeeds.

Required narrow prerequisite, **API + exact device mode only**:

- Preserve `OPEN_NOTEBOOK_PASSWORD_FILE`; do not put its plaintext substitute in the child environment or leave a direct fallback.
- Retain existing initial file/configuration safety validation. The runtime strict provider remains responsible for its documented normalization and bounded per-operation rereads; do not invent another normalized snapshot.
- Keep all unrelated DB/encryption and absent/explicit-legacy handling unchanged. Worker materialization remains unchanged: its command path does not own device authentication. DB never receives app credentials.
- Reject explicit empty/unknown API mode; absent retains legacy.
- Test through the wrapper-produced environment and actual strict provider, not merely the provider with an independently constructed test environment.

This source prerequisite is independent of the launch gate. During this revision, root integrated independently reviewed source `a63f813755e92693df4c9a5e2413acdcda4ab652` at `ffbcb138d3cf63871ab7857f30dd14c65e072c9a`; `docs/v1/MULTICLIENT_ACCEPTANCE.md` records its RED/GREEN and independent checks. The current wrapper inspection matches the API-device-only requirement. Do not reimplement the patch. That source/ledger evidence does not establish actual image/mount behavior; D4a/D4b remain mandatory.

## 2. Alternatives and selection

| Approach | Decision |
|---|---|
| Independent restart policies; `depends_on.restart`; runbook alone | Reject: not enforcement of every unclean/manual frontend launch. |
| Host transaction without image gate | Reject: direct `docker start/restart` can serve before host recovery. |
| **Image gate + one-shot cold recovery transaction** | **Selected phase one.** Smallest sound approach for this single-user test deployment. Crash/manual restart leaves frontend unavailable until the operator invokes recovery; no autonomous-availability claim. |
| Image gate + continuous inventory/event controller | Sound only with additional lifecycle/fault tests, but not needed for the stated safety requirement. Adds daemon supervision, reconciliation, retries, drift monitoring and stop semantics. Defer until automatic recovery is explicitly required. A later watcher should invoke the same reviewed cold transaction, not duplicate its logic. |
| Durable tokens, cap increase, password-admin reset, combined app container | Reject: violates constraints or hides the lost-custody consequence. |
| API lease/epoch endpoint or ingress heartbeat | Unnecessary for historical old-epoch exclusion. A separate stronger availability/instant-fencing requirement could justify redesign; more polling cannot create atomic release. |

The previous proposal selected the continuous controller. This revision deliberately removes that unnecessary implementation requirement. Losing automatic restart availability is explicit: after a crash the gate remains closed, which is acceptable for this test deployment and materially simpler to maintain.

Docker documents dependency restart propagation for explicit Compose operations and warns against conflicting host/Docker restart ownership; neither supplies the required cross-container crash invariant. [Compose startup order](https://docs.docker.com/compose/how-tos/startup-order/), [Docker restart policies](https://docs.docker.com/engine/containers/start-containers-automatically/).

## 3. Exact safety guarantee, observation boundary and limits

For every device-mode frontend attempt `F` released by a valid recovery transaction:

`old_frontends_removed < old_apis_removed < fresh_A_start < A_auth_ready_observed < release(F) < Next_listen(F)`.

All old frontend/API containers, including created/stopped instances, are removed before the fresh API starts. A successful status probe plus matching API identity at the final observation is the **historical evidence boundary**. A release targets the frontend's fresh in-memory invocation ID, not a name, stable container ID or old marker.

**A3: readiness is not atomic with release.** If A dies/restarts after final successful inspection but before marker publication or Next binding, F may briefly start and be unavailable. This does not resurrect the pre-loss epoch: old API containers were removed, and A genuinely completed a fresh epoch. A restarted A creates yet another fresh epoch. Changes observed before release invalidate the transaction; changes occurring after its last observation can race release. A failed/lost release ACK does not prove no listener started.

The selected one-shot tool performs a post-release verification before reporting success. If it observes a failure, it fences its owned frontend and reports blocked. After the tool has exited, ordinary API/BFF failure behavior and the next explicit cold recovery handle later faults; there is **no continuous detector**. If “Next must never bind when A has died in the final race” becomes a requirement, this architecture does not satisfy it without a stronger lifecycle primitive.

A restart of the same frontend container is a new attempt. Every recovery invocation forgets any prior authority and starts cold. It never loads READY state or adopts a running pair from a previous log.

This is a crash/operational-correctness boundary, not a defense against malicious Docker administrators, arbitrary code execution in the frontend, entrypoint overrides or competing orchestration. The frontend UID can potentially tamper with its own nonsecret markers; they are not an authentication mechanism. Trusted local daemon, exclusive managed network and one request process per app service are assumptions.

Initially support only the explicitly tested **rootful Linux Docker Engine/Compose** versions/architectures. Rootless Docker, Desktop, remote daemons, Windows locks and other live-restore configurations need separate evidence. Portable app images are not proof of portable host orchestration.

## 4. Image-level frontend launch gate

Put the gate in the frontend image entrypoint. Device mode cannot opt out using an environment `READY=true` or omitted override. Exact mode table is the Global constraints table; unchanged base image/manifest with the variable absent must still start legacy normally.

Proposed `deploy/v1/frontend-entrypoint.sh` waits for `frontend-gate.mjs wait`, then execs `node /app/frontend/server.js` **once**. No child restart loop. Signal handling is latched: TERM/INT while waiting or crossing helper-completion/exec prevents server exec. Helper nonzero exit never starts Next. SIGKILL/container removal must kill the whole process tree; actual image/init behavior needs D13.

Each device invocation:

1. verifies fixed `/run/study-workbench-lifecycle` is the required tmpfs and expected directory;
2. generates a fresh random 256-bit lowercase hex attempt ID **in memory**, regardless of existing files;
3. clears stale release material and atomically writes a bounded attempt marker;
4. opens no TCP/HTTP listener and waits indefinitely for one strict-schema matching release;
5. consumes that release once, then returns success; there is no reentry/autorestart.

Use a 64 KiB container-local tmpfs, node-owned, restrictive permissions, `nosuid,nodev,noexec`. Verify actual flags/UID across restarts. Fixed paths only; reject symlink/nonregular marker paths; never print marker contents or read a caller-selected path. Metadata contains no secrets. Docker documents stop-time tmpfs removal, Linux limitations and possible swap backing; fresh invocation matching is still mandatory even if files survive unexpectedly. [Docker tmpfs](https://docs.docker.com/engine/storage/tmpfs/).

Strict protocol, at most 1024 UTF-8 bytes and no extra keys:

- attempt: `{ "protocol":"coupled-v1", "attempt_id":"<64 lowercase hex>" }`
- release: `{ "protocol":"coupled-v1", "attempt_id":"<same>", "api_container_id":"<full ID>", "api_started_at":"<Docker observed value>" }`

API fields are audit metadata; the gate does not independently authenticate an API. Fixed `attempt`/`release` helper commands run via `docker exec <full frontend ID> node /app/frontend/frontend-gate.mjs ...`. Release rechecks the current attempt and atomically renames a file. Wrong/missing/stale/oversized/malformed release cannot start Next.

Docker exec is tied to the primary process and is not restarted with the container; this supports but does not replace attempt matching. [Docker exec](https://docs.docker.com/reference/cli/docker/container/exec/).

## 5. Deployment, ownership and process contract

### Opt-in device profile

New JSON-subset `deploy/v1/compose.device-sessions.yaml` adds frontend/API `restart: "no"`, the gate tmpfs, explicit matched device mode/origins and ownership labels. Preserve base legacy defaults, existing four services, ports, volumes, secret grants and privilege restrictions. Worker/DB retain their separate Docker restart ownership; the host transaction only starts missing/stopped instances during bootstrap, never supervises them.

Production browser origin is HTTPS. The existing insecure-loopback flag is **nonproduction only** and cannot enable HTTP in the production image. Device mode without its required mount/configuration blocks. Validate the merged profile and actual image/container configuration, not just override text.

### A6: ownership precedes validity

Fixed Compose project is `study-workbench-v1`; fixed device deployment ID is `study-workbench-v1-device`. Stamp each device service with immutable creation labels:

- `org.studyworkbench.lifecycle=coupled-v1`
- `org.studyworkbench.deployment=study-workbench-v1-device`
- `org.studyworkbench.role=frontend|api|worker|db` (exact service role)

The first two labels define ownership independently of whether image/policy/configuration is valid. Role identifies permitted actions; built-in Compose project/service labels must agree as a conformance check. A resource with matching project name but missing/different ownership labels is unrelated/conflicting: zero mutations and blocked recovery. Owned invalid frontend resources are quiesced even on the first cold invocation; do not refuse to recognize ownership merely because their image/restart policy drifted. Role/Compose-role inconsistency blocks release and fences every owned instance identified as frontend by either role; never guess an unowned resource's identity. Removal of all ownership labels or malicious relabelling is outside the trusted-administrator assumption.

The device profile does not silently convert an existing legacy project. Any ownership/name collision requires a separately authorized migration that stops the legacy deployment and preserves the intended named data volumes. No auto-copy, volume rename or automatic deletion.

Pin the host tool to `unix:///var/run/docker.sock` and an expected daemon ID enrolled by the operator in root-owned `/etc/study-workbench/coupled-recovery.json`. This nonsecret configuration also pins exact image IDs/digests and absolute manifest/env-file/CLI paths; it contains no secret values. Reject ambient `DOCKER_HOST`, `DOCKER_CONTEXT`, TLS-target overrides and caller overrides of endpoint/project/lock. Every Docker invocation explicitly targets the enrolled endpoint; daemon-ID mismatch stops before actions.

Use a deterministic lock under root-owned `/run/lock/study-workbench/`, keyed by SHA-256 of the enrolled daemon ID plus the fixed deployment ID. No caller-selected lock path or symlink; never unlink/recreate a held lock. Equivalent project/path spellings cannot evade one lock. A second transaction exits without mutation. Host setup/registration is separately authorized, not created by this proposal. Host Docker authority is powerful/root-equivalent; no app socket does not mean the host tool is unprivileged.

### A5: container identity is not request-process identity by itself

`State.Pid` under `init: true` identifies init, not directly Uvicorn/Next. Treat `(container ID, StartedAt, init PID)` as container-lifecycle evidence only with pinned image/entrypoint/command and verified process topology.

Preserve strict actual-environment allowlists. Reject `WEB_CONCURRENCY`, all `UVICORN_*` launch overrides, `NODE_OPTIONS` preloads, cluster/process-manager/alternate-entrypoint configuration and other unapproved environment differences. Reject reload/multiple workers in argv. The later lifecycle launch may explicitly pass Uvicorn `--workers 1` for device API as defense in depth; this is **not** part of the separately assigned password-file fix and does not replace rejecting reload/customization. Uvicorn's environment settings are documented in [official settings](https://uvicorn.dev/settings/).

Inspect actual request-process topology and kill the real request process in acceptance. An environment mutation that leaves init stable while internally respawning service children must be rejected. Do not dump full process environments/secret values to check this; inspect only approved names/presence and nonsecret process/launch metadata.

## 6. One-shot cold recovery transaction

One command, `recover`, owns the lock and a bounded transaction. There is no persistent controller process, events cursor, READY journal or automatic retry/backoff service.

1. **Identify target/ownership, then validate.** Verify enrolled local daemon, ownership/config/process contracts, all owned containers including stopped/created/restarting, and exclusive network membership. On owned-invalid state, quiesce owned frontend IDs before blocked exit. Never act on foreign resources.
2. **Remove old frontend.** Exact full IDs only: graceful stop for at most ten seconds, force removal if necessary, then confirm each old ID absent. Paused/removing/unknown is not proof. If removal cannot be established, no API replacement and no release.
3. **Remove old API.** Only after frontend removal, stop/remove every owned old API ID and confirm absence. Do not delete named volumes. Removing old IDs fences late starts against them.
4. **Create stopped objects only.** Explicit base/override/project/env paths with `docker compose create --no-build --pull never --no-recreate` for the four-service project. Preserve existing DB/worker. Do not use `up`, `restart`, `down`, force-recreate or remove-orphans. Validate every resulting object against ownership and enrolled configuration; matching name/role alone is insufficient.
5. **Start fresh API.** Start initial DB by exact ID if necessary and require its declared health; then start the fresh API by exact ID. Await native readiness for at most 120 seconds, with no overlapping probes. Failure leaves frontend absent/gated and exits blocked; another invocation starts cold, never adopts a remembered partial success.
6. **Start gated frontend.** Start exact frontend ID; read its fresh attempt. Recheck topology, API readiness and lifecycle identity. Any observed API/frontend/attempt change before release invalidates the transaction.
7. **Release once.** Target exact frontend ID and attempt. Any ambiguous release result means it may already have started: do not blindly resend. Fence the frontend and return blocked; next invocation repeats the whole pair replacement.
8. **Post-release observation.** Check exact frontend identity/config metadata and API status again within ten seconds. If a race is observed, fence frontend and report blocked. This is observation, not an atomicity guarantee. Start a missing/stopped worker by exact ID after API readiness; its running state is not proof of job readiness. Success records only bounded nonsecret IDs/outcomes and releases the host lock. The tool then exits.

On ordinary failure after mutations or on TERM/INT, latch cancellation, issue no new release, and attempt owned frontend removal. Never claim no listener if removal is uncertain. A SIGKILL may prevent cleanup; the exact gate/old-ID rules remain the safety boundary. A subsequent invocation always cold-recovers.

### Exact native readiness probe and its bounds

Run fixed `deploy/v1/probe-device-auth.py` inside the selected API container by full ID. GET `http://127.0.0.1:5055/api/auth/status`, no Authorization/Cookie/Origin, no environment proxy, no redirects, body ≤4096 bytes. Only 200 with exactly `{auth_enabled:true,auth_mode:"device_sessions",protocol_version:1}` passes. `/health`, legacy/generic200, malformed/oversized, redirect, timeout and 429/503 do not.

The helper must **not** import/instantiate `api.main` or `DeviceSessionService`; that could create another epoch. Enforce a 2.5-second **in-container total wall deadline** over connection, headers and body (Linux timer/termination), plus two-second socket deadlines and a three-second outer Docker exec deadline. Socket timeout alone does not bound a trickling response. Emit only a bounded sanitized result.

No overlapping/unbounded accumulation of probes: after an uncertain host timeout, do not assume the in-container exec was canceled and do not launch another until its exit is established or the selected API is removed through the safe frontend-first sequence. If neither can be proved, return blocked. A stopped/paused scheduler is not a real-time execution guarantee.

Inspect API lifecycle identity before/after the probe and before release. Changes observed then reject release. After the last successful observation, apply §3's historical-barrier—not contemporaneous-liveness—contract.

### Late-operation fencing

A timed-out/killed host CLI may already have submitted work to the daemon. Carry the lock into live child CLI processes where practical, but do not equate child death with daemon cancellation.

- Separate stopped creation from exact-ID start.
- Remove all old owned frontend/API IDs before new API start.
- Never target a later destructive/start/release operation by name.
- Delayed create uses no-recreate and cannot intentionally replace/start a current pair; newly discovered objects still require complete validation.
- Old removed-ID starts/releases fail; same-ID frontend restarts reject old attempts.
- Ambiguous removal/inspection is not proof. No blind mutation retries or release retries.

Actual Docker/Compose ordering is a required D7 runtime gate, not a theorem inferred from CLI docs. If an accepted old request can revive a confirmed-removed ID or no-recreate can replace an active pair on the tested runtime, reject this design for that runtime. [Compose create](https://docs.docker.com/reference/cli/docker/compose/create/).

## 7. Failure behavior and operator consequences

| Event | Selected phase-one behavior |
|---|---|
| Next/request-process/container dies | No automatic replacement. Frontend remains down; next explicit recover rotates API before releasing a fresh attempt. |
| Manual frontend start/restart; old marker replay | New in-memory attempt waits without listening. No event delivery is needed. |
| Recovery tool killed before release | No new release; possible old/partial objects are removed by next cold invocation. |
| Tool killed after submitting release | F may start, but release followed a completed fresh-epoch barrier. Lost ACK is not cancellation. Next invocation still cold-recovers. |
| API dies after tool exits | API has no autorestart. Existing frontend may show unavailable; no new Next is launched. Operator runs cold recover. |
| Manual API restart after final proof | Creates another fresh epoch; old credentials fail. F may be temporarily unavailable; no claim of instant detection. |
| DB/credential outage in same live API | Existing BFF/native code must fail closed; no tool runs automatically or rotates epochs merely for an outage. File failure/restore is covered by the integrated A1 source correction; actual image/mount evidence remains pending. |
| Worker failure | Independent Docker policy may restart worker. No pair rotation; API health never establishes job completion. |
| Native cap429 without process loss | No automatic pair reset. Use another valid client or explicitly invoke authorized pair recovery, accepting native-client logout. |
| Owned config/replica drift | Next recover fences owned frontend before blocked exit; no ongoing drift-policing claim while tool is absent. An extra gated frontend cannot self-release. |
| Daemon unavailable or uncertain stop | No new release. Existing listener shutdown may be unproven; report that truthfully. Cold recovery after control returns. |
| Normal upgrade/restart | Non-rolling matched images/config; cold frontend-first recovery. No automatic request replay; data volumes preserved. |

## 8. Production-image HTTPS and password-file acceptance setup

### A2: HTTPS fixture, not a production HTTP bypass

Production-image browser tests use `https://127.0.0.1:9443` as the exact configured Web/API allowed origin. Existing frontend publication remains `127.0.0.1:8502 → container:3000`; this is an internal loopback transport, not the browser origin.

An explicitly authorized disposable **host-only** TLS fixture forwards 9443 to 8502, outside the four-service application Compose project. A minimal Node `https`→`http` streaming harness can preserve method/body, Origin, Cookie, response headers, cancellation and SSE without adding identity/authentication headers. Use an ephemeral synthetic CA/certificate with IP SAN 127.0.0.1, trusted only by the dedicated test browser profile and fixture client; no global trust-store edits, public ingress, real certificates/credentials or disabled certificate verification. If the target lacks the approved TLS/browser tooling, mark that gate blocked rather than install or fudge it.

Do not change `NODE_ENV`, weaken cookie policy, or use insecure-loopback HTTP for full production-image D3. HTTP can inspect whether the internal port listens or support explicitly nonproduction component fixtures, but is not production Web/cookie acceptance. Add a negative test that production+HTTP+insecure flag still rejects; positive HTTPS must use `__Host-sw-session` with production attributes.

### A1: actual file visibility versus host pathname changes

The supported production Compose secret grants stay unchanged. Compose implements each secret as an individual bind-mounted file ([Docker secrets documentation](https://docs.docker.com/compose/how-tos/use-secrets/)). Therefore do not assume host unlink/atomic replacement makes the mounted in-container pathname disappear or show a new inode. Test the actual projection and record what the strict provider can observe.

For this profile the supported password replacement procedure is **stop the pair, atomically replace the synthetic/authorized host secret, then recreate through cold recovery**. It preserves atomic replacement while ensuring a fresh mount and fresh API epoch; no live hot-reload claim for host source-path replacement. Existing per-operation rereads must still react to changes/read failures genuinely visible at the configured container path.

Two distinct real-image evidence tracks are required:

1. **Production projection:** same secret grants/effective manifest; exercise observable content/read-permission changes and host-source unlink/replace semantics. Verify no direct-value fallback. Test the stop/replace/recreate procedure and old-token rejection. A host unlink that leaves mounted content readable is documented as unobserved, not mislabelled a passed missing-file test.
2. **Container-visible removal fixture:** a separately labelled built-backend-image integration fixture exposes **only one synthetic password file** in a dedicated read-only test directory (no additional secrets or broader production mounts). Using the real image entrypoint/API/provider, remove/change/restore that file at the actually configured container-visible path. This proves wrapper/provider behavior for observed disappearance, not production bind-file hot reload. It does not alter production grants or count as their projection evidence.

During observed missing/unreadable/invalid file state, status/protected auth/refresh must be unavailable. Restoring the same previous value must not revive old access/refresh; fresh login may succeed only after the native revocation barrier. A valid changed password fences old credentials and rejects login with the old password. No raw credential output, sentinel exception dump or argv exposure is permitted.

---

# Implementation plan — only after source ownership/target decision

## File structure and interfaces

| File | Responsibility |
|---|---|
| `deploy/v1/entrypoint.py`, existing container tests | Separately owned Task 0 prerequisite: API-device password-file preservation; later lifecycle task may separately pin device Uvicorn workers. |
| `deploy/v1/frontend-entrypoint.sh`, `frontend-gate.mjs`, frontend Dockerfile | One checked launch/gate/exec path. |
| `deploy/v1/probe-device-auth.py`, backend Dockerfile | Bounded existing native-status probe, no app imports. |
| `deploy/v1/compose.device-sessions.yaml`, static checker/tests | Explicit device profile, labels, strict merged/image config contract. |
| `scripts/v1/coupled_recovery.py`, `coupled_docker.py` | One-shot cold state machine and narrow Docker adapter. No event watcher/service/backoff loop. |
| `tests/test_v1_coupled_recovery.py`, `test_v1_coupled_docker.py`, `test_v1_device_auth_probe.py`, `deploy/v1/frontend-gate.test.mjs` | Offline trace/protocol/adapter tests. |
| `scripts/v1/coupled_lifecycle_check.py`, `synthetic_https_ingress.mjs` | Explicit opt-in disposable real-image harness and test-only loopback TLS proxy. |
| Lifecycle ADR, Docker migration docs, root-owned changelog/evidence ledger | Limitations, ownership/host enrollment, manual recovery, credential projection and activation gates. |

Exact Python interfaces to freeze before implementation:

- `ContainerRef(id: str, started_at: str, init_pid: int, role: str)`; `LaunchAttempt(container: ContainerRef, attempt_id: str)`.
- `DockerPort.identify_owned() -> Inventory` precedes `validate_contract(inventory) -> None`.
- `DockerPort.stop_remove(ref, grace_seconds: int) -> None` returns only after confirmed absence; typed `ControlUnavailable`/`ContractViolation` otherwise.
- `create_stopped() -> Inventory`; `start(ref) -> ContainerRef`; `probe_auth(ref) -> bool`; `read_attempt(ref) -> LaunchAttempt`; `release(attempt, api: ContainerRef) -> None`.
- `Recovery.recover() -> RecoveryReceipt`; constructor injects Docker port, clock and bounded logger. Receipt holds nonsecret observed identities/results, never reusable release authority.
- Probe `is_device_status(status: int, body: bytes) -> bool`; gate `parseAttempt(bytes)`, `parseRelease(bytes, expectedAttempt)` and `wait|attempt|release` CLI.

### Task 0 — Credential-source prerequisite, reviewed/integrated; do not reimplement

**Files:** `deploy/v1/entrypoint.py`, `tests/test_v1_container_contract.py`; existing native provider/core/HTTP regressions.

Completion below is attributed to the canonical acceptance ledger and inspected source, not tests rerun by this design reviewer.

- [x] RED regressions and API-device-only child-environment/mode correction recorded; absent/legacy, DB/encryption and worker behavior preserved.
- [x] Wrapper-produced environment is exercised with the real strict provider/service for missing/invalid/change/restoration behavior; independent checks include same-mtime atomic replacement and non-revival of old sessions.
- [x] Reviewed source integrated at `ffbcb138d3cf63871ab7857f30dd14c65e072c9a`. Ledger records guarded full backend suite 1627 passed/37 skipped, focused 156 passed/18 skipped and 27 additional independent passing checks. Do not reopen or duplicate this completed source patch.
- [ ] Establish real-image/projection evidence in Task 4. Offline source success is not Docker acceptance.

### Task 1 — Frontend image fence

- [ ] Write RED built-in `node:test` cases: absent, exact legacy, empty, unknown, device with/without mount; no release/no listener; fresh ID despite stale files; exact match executes once; wrong/malformed/oversized/symlink marker rejected; helper nonzero and TERM/INT latched across helper-exit/exec; SIGKILL fixture cannot leave serving orphan.
- [ ] Run `node --test deploy/v1/frontend-gate.test.mjs`, require missing-behavior failure.
- [ ] Implement §4 and image entrypoint with no request-process restart loop.
- [ ] Run tests GREEN and `git diff --check`; commit focused gate change.

### Task 2 — Native probe and strict device contract

- [ ] Write RED probe tests for exact JSON, proxy/redirect rejection, body bounds, trickling total-wall deadline, uncertain outer timeout and no overlapping exec accumulation; reject `/health`/legacy/generic200/503. Assert no API/service import and sanitized bounded output.
- [ ] Write RED effective-manifest/image mutation tests for ownership labels, absent-only defaults, production HTTP negative, restart policies, tmpfs, origins, replicas, actual process/env overrides (`WEB_CONCURRENCY`, `UVICORN_*`, `NODE_OPTIONS`), socket/ports/privilege and unchanged per-role grants/volumes.
- [ ] Run `python -m pytest tests/test_v1_device_auth_probe.py tests/test_v1_container_contract.py -q` RED; implement helper/profile/checker, preserve native status schema. Separately review explicit device `--workers 1` if added.
- [ ] Run GREEN plus static legacy/device checker modes; outputs explicitly say Docker NOT RUN. Commit focused contract change.

### Task 3 — One-shot transaction and adversarial model

- [ ] Write RED traces for each state boundary and independent operation **submission, daemon completion, reply delivery, gate consumption, wrapper death, listen and observations**. Merely delaying the reply of an already-atomic fake command is insufficient.
- [ ] Assert §3's historical partial order for every release; inject old late create/start/remove/release, lost release ACK, same-ID new attempt, controller death, stale-created config, concurrent name conflicts and daemon-unavailable results.
- [ ] Model all four A3 race placements: during probe/before final inspection forbid release; after final observation/before marker or listen allow unavailable frontend but never old-epoch authorization. Post-release observed failure fences frontend.
- [ ] Test cold owned-invalid resources are fenced; same project without ownership untouched; changed daemon/context rejected; equivalent paths share deterministic lock; foreign network participants untouched. Test exact-ID argv, no `up/restart/down`, no build/pull, no shell/secret read, no blind mutation retry.
- [ ] Run `python -m pytest tests/test_v1_coupled_recovery.py tests/test_v1_coupled_docker.py -q` RED; implement §§5–6, no watcher/reconcile daemon/backoff or persistent READY adoption.
- [ ] Run GREEN, deployment/native regressions, formatter/linter and diff check; independent security/state-machine review. Commit one-shot recovery source/docs. Do not enroll the host or activate it.

### Task 4 — Real Docker target and disposable acceptance

- [ ] On an authorized target, validate/pin image digests, CLI/Compose/daemon versions, architecture, process topology, tmpfs, secret projection and test-only HTTPS trust. Refuse existing/non-test resources; never install missing tools silently.
- [ ] Implement/run D0–D14 below using synthetic data/secrets; provider/model calls disabled. The actual production-image HTTPS and real DB cases cannot be replaced by HTTP mocks.
- [ ] Record nonsecret daemon-side/process/gate ordering and old-token outcomes. Diagnose/fix source defects with regression tests; no weakened acceptance or production flags.
- [ ] Independently review integrated implementation and real evidence. Browser/private-ingress/native gates remain separate; runtime activation still requires explicit authority. No requirement to start Task 1–3 merely to wait for a missing Docker host.

## Acceptance matrix

### Offline, useful but not Docker acceptance

All protocol/model/adapter tests above must pass. They prove emitted traces/config handling against assumptions, not actual container kill semantics, request-process topology, tmpfs persistence, TLS/browser behavior, bind-mount visibility, native DB barrier/cap reset or daemon cancellation. Existing native provider tests without the image wrapper are not evidence for Task 0 integration.

### Real production-image/disposable Linux acceptance

| ID | Injection | Required result |
|---|---|---|
| D0 | Unchanged base image/manifest with mode absent; explicit legacy/empty/unknown; device mount absent | Absent/exact legacy preserve baseline behavior; empty/unknown/device missing mount fail closed. No shell absent/empty conflation. |
| D1 | Direct device frontend start/restart with no recovery tool; replay stale marker | Fresh attempt, no Next listener until exact release. Observe both internal/publication ports; HTTP auth failure alone is not proof of no listener. |
| D2 | Isolated ungated negative control, 32 native sessions, frontend-only custody loss | New login remains cap-limited with unchanged API. Never ship this control or use it as a supported rollback. |
| D3 | Production HTTPS pair, 32 confirmed synthetic Web sessions; SIGKILL actual Next process, then explicit recover | No autonomous frontend resurrection. Recovery trace has old-front removal → old-API removal → fresh native-ready → exact release → Next listen. Old cookies/access/refresh fail; fresh login succeeds; synthetic durable note survives. Repeat twice to catch marker reuse. SIGKILL proves abrupt process loss, not cgroup OOM. |
| D3a | Production HTTP plus insecure-loopback flag; then correct synthetic HTTPS | HTTP remains rejected without changing NODE_ENV. HTTPS succeeds with production `__Host-sw-session`, exact Origin/CSRF and real browser headers. |
| D4 | DB or genuinely observable credential unavailability during fresh API startup | No replacement frontend release. Stale `/health`/prior status cannot pass. Explicit later recover uses a new cold transaction. |
| D4a | Actual production secret projection: visible read failure/content change, host unlink/atomic replacement, same-value restoration | Observed failures return503; changed valid value fences old tokens; same-value restoration never revives observed-outage sessions. Document unobserved source-path changes honestly. Stop/replace/recreate loads new mounted value and old tokens fail. |
| D4b | Separate actual built-image entrypoint/API fixture with only the dedicated synthetic password-file directory | Container-visible remove/change/restore exercises strict source exclusivity: no environment fallback; status/access/refresh unavailable during observed outage; old credentials reject after restoration; fresh login succeeds after barrier. Not production bind-file hot-reload evidence. |
| D5 | Kill recover tool before/after each boundary, including submitted release before ACK | No replacement can use pre-loss epoch. Submitted release may complete; next invocation always cold-recovers. Tool absent after frontend death leaves it down/gated. |
| D6 | No Docker events delivered; manual frontend restart after successful one-shot exit | Safety unchanged: no event consumer exists; gate stays closed until next explicit recover. No claim of automatic recovery latency. |
| D7 | Delayed daemon execution/ACK for create/start/remove/release; name conflict; uncertain probe cleanup | No removed-ID resurrection, no no-recreate replacement of current pair, no stale-attempt release, no adoption of stale wrong config, no accumulated in-container probes. Record daemon-side events, not just delayed stdout. Any violated runtime assumption fails acceptance. |
| D8a–b | A death/restart during probe or before final successful inspection | Observed identity/readiness failure: no release. |
| D8c–d | A dies/restarts after final inspection but before marker, or after marker before Next listens | No release **or** briefly unavailable F is permitted. No pre-loss credential can authorize; post-release observed failure fences F. If tool already exited, next explicit recover restores service. Never claim contemporaneous liveness was atomic. |
| D9 | Cold start with owned invalid image/policy/replicas; same-name unrelated project; foreign network member | Fence owned frontend before blocking; zero foreign mutations; no arbitrary “healthy replica” selection. No ongoing drift monitor is claimed. |
| D10 | Worker crash and independent synthetic job canary | Worker-only failure does not rotate API/frontend. Job recovery separately observed, not inferred from API health. |
| D11 | Daemon/host restart with the specifically supported live-restore setting | No independent new device frontend/API listener; surviving old BFF memory is not a new launch. Explicit cold recovery works. Other daemon configurations remain unsupported until tested. |
| D12 | Operator recovery/upgrade during long write/SSE/upload | Frontend-before-API removal; no automatic mutation replay; unknown outcomes preserved; native clients reauthenticate; volumes unchanged. |
| D13 | Real request-process/init death; wrapper helper exit/TERM/INT/SIGKILL boundaries; tmpfs/UID; environment worker/reload/preload injection | Whole-container fencing, no orphan serving process or post-cancel exec; exact gate invocation change; invalid process/env contract rejected; no credential files in gate tmpfs. |
| D14 | Changed Docker endpoint/context/daemon ID; same project via alternate path; competing lock holder | Before mutation reject non-enrolled target; deterministic lock prevents competing tool; no unrelated host/project actions. |

Continuous connection sampling alone cannot exclude a short race. Combine native old-token rejection, instrumented process/gate traces and the exact historical barrier assertions. A real cgroup-OOM test is additional evidence if the chosen runtime claims it; do not relabel SIGKILL as OOM acceptance.

## Current blocker and stopping condition

At review time `command -v docker` returned no path and `/var/run/docker.sock` was absent. Python 3.12.14 and Node 24.19.0 existed, while the frontend Dockerfile targets Node 22.19.0; host success would not establish image behavior. No Docker/image/app/TLS runtime, secret access or installation was attempted.

**Pending action:** execute D0–D14 on an authorized disposable rootful Linux Docker target using reviewed production images, actual synthetic DB/data, narrowly scoped synthetic secret fixtures and test-profile-trusted HTTPS ingress. **Target:** a Docker-capable test host, not this absent local daemon. **Reason blocked:** missing Docker CLI/socket and no read-only-subtask authority to install/enable tooling, enroll a privileged host tool or change runtime/credentials/OS/network/trust settings. **Status:** pending / NOT RUN, not a sandbox denial and not acceptance; no bypass attempted.

Current stopping condition is a self-consistent reviewed proposal plus explicit target/evidence requirements. Source work may wait for the real target; activation must wait for actual acceptance and separate authority.

## Response to independent audit and self-review

| Finding | Verified evidence / amendment | Status in this artifact |
|---|---|---|
| A1 password-file integration | Baseline wrapper deletes `_FILE`; strict provider then sees only snapshot. Added exact API-device prerequisite, unchanged worker/legacy/DB/encryption, wrapper→provider tests and separate production-projection/container-visible-removal evidence. | Plan corrected; source independently reviewed/integrated per canonical ledger at ffbcb13; image/mount acceptance still NOT RUN. |
| A2 production HTTPS | Baseline production policy rejects HTTP regardless flag. Selected host-only synthetic HTTPS, dedicated trusted test profile, unchanged NODE_ENV, positive production cookie and negative HTTP tests. | Plan corrected; TLS/Docker/browser acceptance NOT RUN. |
| A3 observation/release race | Accepted concrete last-inspect→API-death→release trace. Guarantee is historical old-epoch exclusion; D8a–d explicitly permit post-proof unavailable startup. | Overclaim removed; no atomic-liveness assertion. |
| A4 absent-only default | Backend and Next distinguish absent from empty. Added exact table, unchanged-base tests and latched wrapper termination tests. | Explicit in Global constraints/§4/D0. |
| A5 process/env identity | init PID is not request-process PID; Uvicorn env can select workers. Added actual env/topology/image checks, override negatives and request-process death evidence. | Explicit in §5/Task2/D13; not claimed verified. |
| A6 ownership/target | Ownership cannot depend on conformance. Added fixed labels, target enrollment, local daemon pinning, deterministic protected lock and cold-invalid/foreign tests. | Explicit in §5/Task3/D9/D14; host enrollment not performed. |
| Simpler alternative | Continuous reconciliation is unnecessary for safety in this single-user test deployment. Selected one-shot cold recovery; removed event watcher, service supervision and backoff from implementation requirements. | Selected architecture, with explicit manual-recovery availability tradeoff. |
| Additional audit cautions | Added total in-container probe deadline, uncertain-exec no-accumulation, independent submission/completion model, Linux scope and accurate SIGKILL-versus-OOM wording. | Covered by Tasks2–4/D7/D13. |

No native epoch endpoint, persistent READY adoption, credential persistence, token-cap change or combined-container workaround was introduced. No repository source, runtime, credentials, installed packages or OS/network settings were changed by this revision.
