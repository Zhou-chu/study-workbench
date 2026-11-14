# Local Sonar baseline — candidate d119643

> Current checkpoint: see the 49fddcb update below. The original d119643 section is historical, not the current analysis result.

## Verified update: 49fddcb (2026-11-13)

The fixed archive was analyzed successfully after expanding the scan source list to include five previously omitted configuration files. Final scope: 748 main files. No Python analyzer NPE, unable-to-analyze error, or coverage import path error remains in this scan. The unchanged-salt declaration workaround is now verified; the actual S2053 fixed-salt vulnerability is OPEN at encryption.py:137, not resolved or accepted.

| Overall metric | Result |
| --- | --- |
| MQR maintainability | A; 22 impact issues |
| MQR security | D; 14 impact issues |
| MQR reliability | D; 65 impact issues |
| Issue states | 80 OPEN, 13 FIXED, 21 reviewed FALSE_POSITIVE |
| Coverage | 75.1%; lines 74.3%, branches 76.2% |
| Quality Gate | ERROR |

The 21 false positives have per-issue evidence (18 UI translation strings and three Python URL/blocklist sentinels); they are not 21 vulnerabilities fixed in code. Metrics count overlapping impacts.

Fresh Python regression for this revision: 3919 passed, 128 skipped, zero failed, six existing warnings. Coverage includes all 176 Python production files: 16749/23320 lines (71.82%), 4549/6792 branches (66.98%). The command exits 1 because the coverage threshold is unmet. Fresh modern/legacy Node tool runs pass 42/42 and 26/26 tests. Other imported JS reports remain historical baseline measurements, not fresh CI acceptance for this commit.

Stable audit: local `notebook-quality-20261113/sonar/49fddcb/`, including source hashes, original reports, normalized path audit, issues, measures and gate status. The first scan is preserved separately; the final scan includes the corrected scope.

Subsequent ec0e622 closes the three configuration measurement gaps through an independent official c8/esbuild partition (3/3 sources, statements/lines 47/47, branches 6/6, functions 2/2) without removing any of the original 24 tooling/configuration files. Tooling remains a separate 21-file partition and is below target. That commit also fixes invalid stored-engine handling and external cancellation propagation; it has targeted tests but is not yet covered by the above Sonar analysis. SDK asynchronous file I/O and fixed-salt remediation remain ongoing. No full-repository >90 or Quality Gate success is claimed.

## Historical first analysis

## Outcome

Local analysis completed, but **acceptance failed and analysis has a known file-level gap**. This is not a publication or deployment of the Notebook application.

- Dashboard: http://127.0.0.1:19000/dashboard?id=notebook-local
- SonarQube Community Build 26.11.0.134175; PostgreSQL 17.12; Scanner 8.4.0.
- Fixed source: git archive `d119643`, no .git directory, runtime data or ignored secrets. Later auth-only tests are not part of this analysis.
- Source audit: 742 main files / 128843 Sonar LoC; Python176, TS/TSX532, JavaScript20, CSS9, HTML1, Docker4. This does not imply unsupported shell files were analyzed.
- No cloud upload, GitHub push, external account authorization or subscription change.

| Overall metric | Result |
| --- | --- |
| MQR maintainability | A; 32 impact issues |
| MQR security | D; 35 impact issues |
| MQR reliability | D; 76 impact issues |
| Distinct issues | 112 (impacts can overlap) |
| Coverage | 74.4%; lines73.3%, branches75.9% |
| Security hotspots | 0 |
| Quality Gate | ERROR |

Scanner/compute-engine success only means processing completed. It does not mean the gate passed, all files were successfully checked, or all security risks were found. Community Build lacks commercial advanced SAST/SCA capabilities.

## Coverage and gate integrity

Nine LCOV reports (534 paths) and the full Python XML were imported from preserved originals. Cross-platform paths were transformed only in the scan copies, with a conversion audit. The first XML conversion produced duplicate sources and ambiguity; that scan's 52.5% coverage is invalid and superseded. The second scan had no unresolved coverage paths.

Sonar's 552 JS/TS main files exceed the LCOV inventory by 18 measurement/build configuration files. All 18 remain in Sonar analysis; they are not fixtures or a reason to shrink Sonar scope. See the saved `sonar-lcov-difference.json` for each path. Existing CI coverage docs expressly excluded the measurement harness; future full-repository coverage alignment must include or separately measure that tooling rather than imply identical denominators.

The local `Notebook Overall Acceptance` gate retains the four original new-code conditions and adds seven overall conditions: MQR A for all three qualities, zero security/reliability impact issues, overall coverage90.01 and hotspot review100. The configuration contains 11 conditions; not every new-code condition has a measurable first-analysis value. No rule, issue or hotspot was silently disabled/closed. CI's raw-count strict >90 checks remain independently required; Sonar's aggregate is not interchangeable with per-language statements/branches/functions/lines.

## Analyzer defect, not a silent exclusion

Python analyzer 5.32.0.37250 throws a NullPointerException in `PredictableSaltCheck.hasRaisedOnSensitiveArgument` while analyzing `open_notebook/utils/encryption.py`. This persisted on both scans. The file remains in scope, and the incomplete analysis must block any claim of full safety verification.

The upstream implementation before commit `03215b16f00f75f7f50d202a08405484998813fa` searched only ordinary assignment ancestors and added a possible null issue location. Current upstream master handles annotated assignments and null locations, but its pom declares 5.33-SNAPSHOT. A supported released upgrade has not been confirmed; no unreleased plugin was installed.

A possible compatibility workaround is an equivalent constant declaration, verified by encryption compatibility tests and a rescan. It must not change the salt bytes, PBKDF2 cost, stored ciphertext format or existing-decryption behavior merely to silence a scanner. This workaround has not been applied. The underlying predictable-salt finding, if produced after the analyzer works, still needs an explicit security assessment.

Official source: https://github.com/SonarSource/sonar-python/blob/master/python-checks/src/main/java/org/sonar/python/checks/PredictableSaltCheck.java

## Local service boundary

Only Sonar publishes a host port, 127.0.0.1:19000. PostgreSQL has no host port and remains on its private internal network. Sonar has a dedicated bridge for localhost port forwarding; standard container egress exists, but telemetry and update-center are disabled. No host firewall, routing or kernel security setting was changed. No public listener or host-network mode was enabled.

Resource caps: Sonar2CPU/4GiB, PostgreSQL1CPU/1GiB, scanner2CPU/3GiB. Restart policy is no; no boot autostart was configured. Existing containers and Notebook database were not touched.

Administrator credentials and expiring project-scoped analysis tokens are encrypted with DPAPI outside the repository. The official scanner entrypoint can put a token in Java process arguments: do not collect full process command lines or raw environment inspection. The first token was revoked after discovering this behavior; reports and source do not contain tokens.

## Evidence and next work

Stable local evidence: `/home/USER/notebook-quality-20261113/sonar/d119643/`: preserved logs and source hash audit, issues/rules, measures, gate configuration/status, coverage conversion and original reports. Rule metadata for 27 rules supports evidence-based remediation. For example S8396 concerns Optional Pydantic defaults: required-but-nullable response fields must retain their API contract; do not blindly add None defaults.

Next: triage and test security/reliability findings, resolve the analyzer gap without weakening rules, add missing tooling coverage, then rescan a fixed commit and rerun strict CI gates. No overall acceptance target is claimed complete.
