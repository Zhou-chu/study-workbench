import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  existsSync,
} from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { validateCurrentUnitSelection } from "./coverage-unit-selection.mjs";
import {
  pythonSources,
  auditPythonExecution,
} from "./coverage-python-protocol.mjs";
import {
  inputDigest,
  fileDigest,
  saveManifest,
} from "./coverage-integrity.mjs";
import { recordedRun } from "./coverage-process.mjs";
import { coverageEnvironment } from "./coverage-environment.mjs";
const ownerRoot = fileURLToPath(new URL("../", import.meta.url));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
function options(args) {
  const result = {};
  for (const arg of args) {
    const match =
      /^--(unit-selection|python|tiktoken-cache|parent-attempt)=(.+)$/.exec(
        arg,
      );
    assert.ok(
      match && !Object.hasOwn(result, match[1]),
      "Invalid/duplicate Python unit option",
    );
    if (match[1] === "parent-attempt")
      assert.match(
        match[2],
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    else assert.ok(isAbsolute(match[2]), "Explicit absolute path required");
    result[match[1]] = match[2];
  }
  for (const key of ["unit-selection", "python", "tiktoken-cache"])
    assert.ok(result[key], "Missing " + key);
  return result;
}
function sourceHashes(root, files) {
  return Object.fromEntries(
    files.map((file) => [file, fileDigest(resolve(root, file))]),
  );
}
function auditCoverage(root, expected, report) {
  assert.ok(
    report?.meta?.branch_coverage === true && report.files && report.totals,
    "Missing native branch coverage",
  );
  const actual = Object.keys(report.files).map((file) =>
    relative(root, resolve(root, file)).replaceAll("\\", "/"),
  );
  const missing = expected.filter((file) => !actual.includes(file)),
    unexpected = actual.filter((file) => !expected.includes(file));
  assert.equal(new Set(actual).size, actual.length, "Duplicate source aliases");
  const keys = [
    "covered_lines",
    "num_statements",
    "covered_branches",
    "num_branches",
  ];
  for (const key of keys) {
    let sum = 0;
    for (const row of Object.values(report.files)) {
      assert.ok(
        Number.isSafeInteger(row.summary[key]) && row.summary[key] >= 0,
        "Invalid coverage count",
      );
      sum += row.summary[key];
    }
    assert.equal(
      report.totals[key],
      sum,
      "Coverage totals differ from complete file counts",
    );
  }
  assert.ok(
    report.totals.covered_lines <= report.totals.num_statements &&
      report.totals.covered_branches <= report.totals.num_branches,
  );
  return {
    expectedSourceFiles: expected.length,
    reportedSourceFiles: actual.length,
    missing,
    unexpected,
  };
}
function executePythonUnit(root, args, attempt) {
  const selectedOptions = options(args);
  if (selectedOptions["parent-attempt"])
    attempt.parentRunId = selectedOptions["parent-attempt"];
  const artifact = read(selectedOptions["unit-selection"]);
  const selected = validateCurrentUnitSelection(root, artifact).filter((file) =>
    file.endsWith(".py"),
  );
  assert.ok(
    selected.every((file) =>
      /^tests\/(?:.*\/)?(?:test_.*|.*_test)\.py$/.test(file),
    ),
    "Unsupported Python unit path",
  );
  const sources = pythonSources(artifact.inventory),
    before = sourceHashes(root, sources),
    inputs = inputDigest(root);
  const initial = {
    ...attempt,
    layer: "unit",
    partition: "python",
    selectionRevision: artifact.revision,
    selectionSha256: hash(JSON.stringify(artifact)),
    classificationSha256: artifact.classificationSha256,
    selectedTestFiles: selected,
    emptyUnitPartition: selected.length === 0,
    sourceHashes: before,
    inputDigest: inputs,
  };
  for (const dir of ["coverage", "coverage/unit", "coverage/unit/python"]) {
    mkdirSync(resolve(root, dir), { recursive: true });
    assert.equal(
      realpathSync(resolve(root, dir)),
      resolve(root, dir),
      "Output symlink rejected",
    );
  }
  saveManifest(
    root,
    "python",
    { ...initial, phase: "pending", testExitCode: null, nativeExitCode: null },
    "coverage/unit",
  );
  let run;
  let nativeExitCode = null;
  try {
    // Only this validated producer calls an explicitly selected existing interpreter.
    const interpreter = selectedOptions.python,
      interpreterRealpath = realpathSync(interpreter),
      interpreterHash = fileDigest(interpreterRealpath);
    run = mkdtempSync(resolve(root, "coverage/unit/python/run-"));
    const environment = coverageEnvironment(
      resolve(run, "environment"),
      process.env,
    );
    const versions = JSON.parse(
      execFileSync(
        interpreter,
        [
          "-I",
          "-c",
          'import json,sys,pytest,coverage; print(json.dumps({"python":sys.version,"executable":sys.executable,"pytest":pytest.__version__,"coverage":coverage.__version__}))',
        ],
        { cwd: root, env: environment, encoding: "utf8", timeout: 10000 },
      ),
    );
    const venvConfig = resolve(interpreter, "../../pyvenv.cfg");
    const interpreterEvidence = {
      command: interpreter,
      realpath: interpreterRealpath,
      sha256: interpreterHash,
      versions,
      ...(existsSync(venvConfig)
        ? { venvConfigSha256: fileDigest(venvConfig) }
        : {}),
    };
    const config = resolve(run, "coverage.ini"),
      execution = resolve(run, "execution.json");
    const baseConfig = readFileSync(
      resolve(root, "scripts/quality/coverage-python.ini"),
      "utf8",
    );
    assert.match(baseConfig, /^data_file\s*=.*$/m);
    writeFileSync(
      config,
      baseConfig.replace(
        /^data_file\s*=.*$/m,
        "data_file = " + resolve(run, ".coverage"),
      ),
    );
    const common = {
      ...attempt,
      layer: "unit",
      partition: "python",
      selectionRevision: artifact.revision,
      selectionSha256: hash(JSON.stringify(artifact)),
      classificationSha256: artifact.classificationSha256,
      selectedTestFiles: selected,
      emptyUnitPartition: selected.length === 0,
      sourceHashes: before,
      inputDigest: inputs,
      interpreter: interpreterEvidence,
      runDirectory: run,
    };
    saveManifest(
      root,
      "python",
      { ...common, phase: "pending", testExitCode: null },
      "coverage/unit",
    );
    let childArgs;
    if (selected.length) {
      childArgs = [
        "-I",
        resolve(root, "scripts/offline_pytest.py"),
        "--tiktoken-cache",
        selectedOptions["tiktoken-cache"],
        "--",
        ...selected,
        "-p",
        "scripts.quality.unit_pytest_evidence",
        "--unit-evidence=" + execution,
        "--cov",
        "--cov-config=" + config,
        "--cov-report=json:" + resolve(run, "coverage.json"),
        "--cov-report=xml:" + resolve(run, "coverage.xml"),
        "--junitxml=" + resolve(run, "junit.xml"),
        "-o",
        "addopts=",
      ];
    } else {
      const request = resolve(run, "empty-request.json");
      writeFileSync(
        request,
        JSON.stringify({
          config,
          output: run,
          cache: selectedOptions["tiktoken-cache"],
        }),
      );
      childArgs = [
        "-I",
        resolve(root, "scripts/quality/unit_pytest_evidence.py"),
        "--empty",
        request,
      ];
    }
    nativeExitCode = recordedRun(interpreter, childArgs, {
      cwd: root,
      env: environment,
      logPath: resolve(run, "test.log"),
    });
    const row = {
      ...common,
      phase: "complete",
      testExitCode: selected.length ? nativeExitCode : null,
      nativeExitCode,
      executionMode: selected.length ? "pytest" : "empty-coverage",
      sourceChangedDuringRun:
        JSON.stringify(before) !== JSON.stringify(sourceHashes(root, sources)),
      inputChangedDuringRun: inputs !== inputDigest(root),
    };
    let exitCode = nativeExitCode;
    try {
      validateCurrentUnitSelection(root, artifact);
      assert.equal(realpathSync(interpreter), interpreterRealpath);
      assert.equal(fileDigest(interpreterRealpath), interpreterHash);
      if (interpreterEvidence.venvConfigSha256)
        assert.equal(
          fileDigest(venvConfig),
          interpreterEvidence.venvConfigSha256,
        );
      assert.equal(row.sourceChangedDuringRun, false);
      assert.equal(row.inputChangedDuringRun, false);
      const evidence = read(execution);
      row.executionReportHash = fileDigest(execution);
      row.nativeSessionExitCode = evidence.sessionExitCode;
      row.nativeReports = {
        passedCalls: evidence.reports.filter(
          (v) => v.when === "call" && v.outcome === "passed",
        ).length,
        failedReports: evidence.reports.filter((v) => v.outcome === "failed")
          .length,
        skippedReports: evidence.reports.filter((v) => v.outcome === "skipped")
          .length,
      };
      row.executionAudit = auditPythonExecution(selected, evidence);
      row.executedTestFiles = row.executionAudit.executedFiles;
      row.executionReportHash = fileDigest(execution);
      if (!selected.length)
        row.coverageThresholdExitCode = {
          json: evidence.coverageJsonExitCode,
          xml: evidence.coverageXmlExitCode,
        };
      const coveragePath = resolve(run, "coverage.json"),
        coverage = read(coveragePath);
      row.audit = auditCoverage(root, sources, coverage);
      row.coverage = coverage.totals;
      row.reportHash = fileDigest(coveragePath);
      row.xmlReportHash = fileDigest(resolve(run, "coverage.xml"));
      row.strictLineBranchPassed =
        coverage.totals.covered_lines * 100 >
          coverage.totals.num_statements * 90 &&
        (coverage.totals.num_branches === 0 ||
          coverage.totals.covered_branches * 100 >
            coverage.totals.num_branches * 90);
      if (
        row.audit.missing.length ||
        row.audit.unexpected.length ||
        !row.strictLineBranchPassed
      )
        exitCode = exitCode || 1;
    } catch (error) {
      row.phase = "failed";
      row.blocked = String(error);
      exitCode = exitCode || 1;
    }
    row.runnerExitCode = exitCode;
    saveManifest(root, "python", row, "coverage/unit");
    console.log(JSON.stringify(row, null, 2));
    return exitCode;
  } catch (error) {
    const row = {
      ...initial,
      phase: "failed",
      testExitCode: selected.length ? nativeExitCode : null,
      nativeExitCode,
      runDirectory: run,
      runnerExitCode: nativeExitCode || 1,
      blocked: String(error),
    };
    saveManifest(root, "python", row, "coverage/unit");
    console.error(JSON.stringify(row, null, 2));
    return nativeExitCode || 1;
  }
}
function prepareOwnOutput(root) {
  for (const directory of [
    "coverage",
    "coverage/unit",
    "coverage/unit/python",
  ]) {
    const path = resolve(root, directory);
    mkdirSync(path, { recursive: true });
    assert.equal(realpathSync(path), path, "Output symlink rejected");
  }
}
/** All attempts invalidate the owned report before parsing caller-controlled input. */
export function runPythonUnit(root = ownerRoot, args = process.argv.slice(2)) {
  const ownedRoot = realpathSync(ownerRoot);
  const attempt = {
    layer: "unit",
    partition: "python",
    runId: randomUUID(),
    startedAt: new Date().toISOString(),
  };
  try {
    prepareOwnOutput(ownedRoot);
    saveManifest(
      ownedRoot,
      "python",
      {
        ...attempt,
        phase: "pending",
        testExitCode: null,
        nativeExitCode: null,
      },
      "coverage/unit",
    );
    assert.equal(
      realpathSync(root),
      ownedRoot,
      "Runner root does not belong to this producer",
    );
    return executePythonUnit(ownedRoot, args, attempt);
  } catch (error) {
    const failed = {
      ...attempt,
      phase: "failed",
      testExitCode: null,
      nativeExitCode: null,
      runnerExitCode: 1,
      blocked: String(error),
    };
    try {
      prepareOwnOutput(ownedRoot);
      saveManifest(ownedRoot, "python", failed, "coverage/unit");
    } catch (writeError) {
      failed.reportWriteError = String(writeError);
    }
    console.error(JSON.stringify(failed, null, 2));
    return 1;
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  process.exitCode = runPythonUnit();
