import assert from "node:assert/strict";
import { readFileSync, realpathSync, lstatSync, readdirSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import {
  assertUnitIdentity,
  assertRatios,
  pythonRawCounts,
  istanbulRawCounts,
} from "./coverage-unit-policy.mjs";
import { planUnitPartitions, unitPartitions } from "./coverage-unit-plan.mjs";
import { compareCoverageKeys, inventory, sourceDigest } from "./coverage-inventory.mjs";
import { fileDigest, inputDigest } from "./coverage-integrity.mjs";
import { auditRepositoryScope } from "./coverage-scope.mjs";
import { auditExecutedFiles } from "./coverage-executed-files.mjs";
import { mergeNativeCoverage, nativeRebasedPaths } from "./coverage-native-union.mjs";
import {
  pythonSources,
  auditPythonExecution,
} from "./coverage-python-protocol.mjs";
const metricNames = ["lines", "statements", "functions", "branches"];
function regular(root, path) {
  path = resolve(path);
  assert.ok(
    path.startsWith(resolve(root) + sep),
    "Evidence outside owned root",
  );
  assert.equal(realpathSync(path), path, "Symlink evidence rejected");
  assert.ok(lstatSync(path).isFile());
  return path;
}
function read(root, path) {
  return JSON.parse(readFileSync(regular(root, path), "utf8"));
}
function digest(root, path, expected) {
  assert.equal(
    fileDigest(regular(root, path)),
    expected,
    "Evidence hash changed",
  );
}
function countsEqual(actual, expected) {
  for (const name of metricNames)
    for (const key of ["total", "covered"])
      assert.equal(
        actual?.[name]?.[key],
        expected[name][key],
        "Summary differs from raw counters",
      );
}
function sources(root, files, artifact) {
  const limits = Object.create(null);
  for (const path of files) {
    regular(root, path);
    const rel = relative(root, path).replaceAll("\\", "/");
    assert.ok(
      Object.hasOwn(artifact.fileHashes, rel),
      "Untracked production file",
    );
    assert.equal(
      fileDigest(path),
      artifact.fileHashes[rel],
      "Source bytes differ from selection",
    );
    limits[path] = Math.max(1, readFileSync(path, "utf8").split("\n").length);
  }
  assert.equal(new Set(files).size, files.length);
  return limits;
}
function envelope(root, name) {
  const value = read(
    root,
    resolve(root, "coverage/unit/run-" + name + ".json"),
  );
  assert.ok(
    Array.isArray(value.partitions) && value.partitions.length === 1,
    "Wrong partition envelope",
  );
  return value.partitions[0];
}
export function verifyUnitReports(root, context) {
  const { artifact, selected, runId, selection, input, children } = context;
  assert.deepEqual(
    children.map((c) => c.language),
    ["javascript", "python"],
  );
  assert.ok(
    children.every(
      (c) => c.status === 0 && c.signal === null && c.error === null,
    ),
    "Actual child failed",
  );
  assert.equal(inputDigest(root), input, "Current input digest differs");
  const plan = planUnitPartitions(selected),
    results = [],
    all = read(root, resolve(root, "coverage/unit/run-all.json"));
  assert.ok(Array.isArray(all.partitions));
  assert.deepEqual(
    all.partitions.map((r) => r.partition).sort(compareCoverageKeys),
    Object.keys(unitPartitions).sort(compareCoverageKeys),
    "Missing/extra/duplicate partition",
  );
  const seen = new Set();
  for (const [name, directory] of Object.entries(unitPartitions)) {
    const row = envelope(root, name),
      expectedFiles = plan.partitions[name];
    assert.deepEqual(
      all.partitions.find((r) => r.partition === name),
      row,
      "Individual/combined row mismatch",
    );
    assertUnitIdentity(row, {
      partition: name,
      runId,
      revision: artifact.revision,
      selection,
      input,
      childExit: children[0].status,
    });
    assert.deepEqual(row.selectedTestFiles, expectedFiles);
    assert.equal(row.classificationSha256, artifact.classificationSha256);
    assert.equal(row.sourceDigest, sourceDigest(root, name, directory));
    const files = inventory(root, name, directory);
    for (const f of files) {
      assert.ok(!seen.has(f), "Production source counted twice");
      seen.add(f);
    }
    const limits = sources(root, files, artifact),
      raw = read(
        root,
        resolve(root, "coverage/unit", name, "coverage-final.json"),
      );
    digest(
      root,
      resolve(root, "coverage/unit", name, "coverage-final.json"),
      row.rawReportHash,
    );
    const metrics = istanbulRawCounts(raw, limits),
      summaryPath = resolve(
        root,
        "coverage/unit",
        name,
        "coverage-summary.json",
      ),
      summary = read(root, summaryPath);
    digest(root, summaryPath, row.reportHash);
    assert.deepEqual(
      Object.keys(summary).sort(compareCoverageKeys),
      ["total", ...files].sort(compareCoverageKeys),
      "Summary denominator mismatch",
    );
    countsEqual(summary.total, metrics);
    countsEqual(row.coverage, metrics);
    for (const file of files)
      countsEqual(
        summary[file],
        istanbulRawCounts({ [file]: raw[file] }, { [file]: limits[file] }),
      );
    const nativeFiles =
      name === "quality-tooling"
        ? expectedFiles.filter((f) => /^scripts\/[^/]+\.test\.mjs$/.test(f))
        : [];
    const vitestFiles = expectedFiles.filter((f) => !nativeFiles.includes(f));
    const executionPath = resolve(
      root,
      "coverage/unit/diagnostics",
      name + "-tests.json",
    );
    digest(root, executionPath, row.executionReportHash);
    let executed = auditExecutedFiles(
      root,
      vitestFiles,
      read(root, executionPath),
      directory ? "vitest" : "node",
    );
    if (nativeFiles.length) {
      const e = row.nativeUnionEvidence;
      assert.ok(e);
      const run = resolve(e.runDirectory);
      assert.ok(run.startsWith(resolve(root, "coverage/unit") + sep));
      const execution = resolve(run, "execution.json");
      digest(root, execution, e.executionHash);
      digest(root, executionPath, e.vitestExecutionHash);
      digest(
        root,
        resolve(root, "coverage/unit", name, "coverage-final.json"),
        e.finalReportHash,
      );
      assert.equal(e.nodeVersion, "v24.19.0");
      assert.deepEqual(e.versions, {
        "ast-v8-to-istanbul": "1.0.8",
        "@bcoe/v8-coverage": "1.0.2",
        vitest: "4.1.12",
        "@vitest/coverage-v8": "4.1.12",
        "istanbul-lib-coverage": "3.2.2",
        "istanbul-lib-report": "3.0.1",
        "istanbul-reports": "3.2.0",
      });
      assert.deepEqual(
        Object.keys(e.rawHashes).sort(compareCoverageKeys),
        readdirSync(resolve(run, "raw")).sort(compareCoverageKeys),
      );
      assert.ok(Object.keys(e.rawHashes).length > 0);
      assert.deepEqual(
        e.testHashes,
        Object.fromEntries(
          nativeFiles.map((f) => [resolve(root, f), artifact.testHashes[f]]),
        ),
      );
      digest(root, resolve(run, "native-map.json"), e.nativeMapHash);
      digest(root, resolve(run, "vitest-base.json"), e.baseReportHash);
      for (const [path, hash] of Object.entries(e.rawHashes))
        digest(root, resolve(run, "raw", path), hash);
      assert.deepEqual(
        e.sourceHashes,
        Object.fromEntries(
          files.map((f) => [
            f,
            artifact.fileHashes[relative(root, f).replaceAll("\\", "/")],
          ]),
        ),
      );
      const completedNative = auditExecutedFiles(
        root, nativeFiles, read(root, execution), "node",
      );
      const receipt = (selected, executed) => ({
        exitCode: 0, before: e.sourceHashes, after: e.sourceHashes,
        selected, executed,
      });
      const base = read(root, resolve(run, "vitest-base.json"));
      const addition = read(root, resolve(run, "native-map.json"));
      const replayed = mergeNativeCoverage({
        base,
        addition,
        sources: e.sourceHashes,
        left: receipt(vitestFiles, executed),
        right: receipt(nativeFiles, completedNative),
      });
      assert.deepEqual(e.rebasedUntouchedSources, nativeRebasedPaths(base, addition));
      assert.deepEqual(raw, replayed, "Native union replay mismatch");
      executed = [...executed, ...completedNative].sort(compareCoverageKeys);
    }
    assert.deepEqual(executed, [...expectedFiles].sort(compareCoverageKeys));
    assert.deepEqual(row.executedTestFiles, executed);
    let passed = true,
      error;
    try {
      assertRatios(metrics, metricNames);
    } catch (e) {
      passed = false;
      error = String(e);
    }
    results.push({
      partition: name,
      passed,
      metrics,
      ...(error ? { error } : {}),
    });
  }
  const row = envelope(root, "python");
  assertUnitIdentity(row, {
    partition: "python",
    runId,
    revision: artifact.revision,
    selection,
    input,
    childExit: children[1].status,
  });
  const files = pythonSources(artifact.inventory),
    limits = sources(
      root,
      files.map((f) => resolve(root, f)),
      artifact,
    );
  assert.deepEqual(
    row.sourceHashes,
    Object.fromEntries(files.map((f) => [f, artifact.fileHashes[f]])),
  );
  assert.deepEqual(row.selectedTestFiles, plan.pythonFiles);
  const run = resolve(row.runDirectory);
  assert.ok(run.startsWith(resolve(root, "coverage/unit/python") + sep));
  const rawPath = resolve(run, "coverage.json"),
    execution = resolve(run, "execution.json");
  digest(root, rawPath, row.reportHash);
  digest(root, execution, row.executionReportHash);
  digest(root, resolve(run, "coverage.xml"), row.xmlReportHash);
  const executionEvidence = read(root, execution);
  assert.equal(
    executionEvidence.sessionExitCode,
    plan.pythonFiles.length ? 0 : null,
  );
  const audit = auditPythonExecution(plan.pythonFiles, executionEvidence);
  assert.deepEqual(audit, row.executionAudit);
  assert.deepEqual(audit.executedFiles, row.executedTestFiles);
  const raw = read(root, rawPath),
    nativeLimits = Object.create(null);
  for (const path of Object.keys(raw.files)) {
    const absolute = resolve(root, path);
    assert.ok(Object.hasOwn(limits, absolute));
    nativeLimits[path] = limits[absolute];
  }
  assert.equal(Object.keys(nativeLimits).length, files.length);
  assert.equal(
    new Set(Object.keys(nativeLimits).map((f) => resolve(root, f))).size,
    files.length,
  );
  assert.equal(row.classificationSha256, artifact.classificationSha256);
  assert.deepEqual(row.coverage, raw.totals);
  const metrics = pythonRawCounts(raw, nativeLimits);
  let passed = true,
    error;
  try {
    assertRatios(metrics, ["lines", "branches"]);
    const covered =
        BigInt(metrics.lines.covered) + BigInt(metrics.branches.covered),
      total = BigInt(metrics.lines.total) + BigInt(metrics.branches.total);
    assert.ok(
      covered * 10000n >= total * 9001n,
      "Python combined below 90.01%",
    );
  } catch (e) {
    passed = false;
    error = String(e);
  }
  results.push({
    partition: "python",
    passed,
    metrics,
    ...(error ? { error } : {}),
  });
  const scope = auditRepositoryScope(root);
  const unmeasured = scope.records
    .filter((r) =>
      ["unmeasured", "configuration", "coverage-harness"].includes(r.kind),
    )
    .map((r) => r.path);
  const unsupported = artifact.inventory.filter((path) =>
    /\.(?:sh|bash|zsh|ps1|bat|cmd)$/.test(path),
  );
  assert.equal(inputDigest(root), input);
  return {
    partitions: results,
    unmeasured,
    unsupported,
    passed:
      results.every((r) => r.passed) &&
      !unmeasured.length &&
      !unsupported.length,
  };
}
