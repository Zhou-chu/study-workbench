import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { unitPartitions } from "./coverage-unit-plan.mjs";
const repo = resolve(import.meta.dirname, ".."),
  hash = (b) => createHash("sha256").update(b).digest("hex");
// Adapter fixture: production inventory/Git are replaced here, never represented as a real repository measurement.
async function fixture(fn) {
  const root = mkdtempSync(resolve(tmpdir(), "unit-verify-"));
  const put = (path, value) => {
    const absolute = resolve(root, path);
    mkdirSync(resolve(absolute, ".."), { recursive: true });
    writeFileSync(
      absolute,
      typeof value === "string" ? value : JSON.stringify(value),
    );
    return absolute;
  };
  const read = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
  try {
    mkdirSync(resolve(root, "scripts"));
    for (const n of [
      "coverage-unit-verify.mjs",
      "coverage-unit-policy.mjs",
      "coverage-executed-files.mjs",
      "coverage-python-protocol.mjs",
      "coverage-native-union.mjs",
    ])
      copyFileSync(resolve(repo, "scripts", n), resolve(root, "scripts", n));
    put(
      "scripts/coverage-unit-plan.mjs",
      `export const unitPartitions=${JSON.stringify(unitPartitions)};export function planUnitPartitions(files){return {partitions:Object.fromEntries(Object.keys(unitPartitions).map(n=>[n,[n+'.test.ts']])),pythonFiles:['tests/test_a.py']}}`,
    );
    put(
      "scripts/coverage-inventory.mjs",
      `import {resolve} from 'node:path';export {compareCoverageKeys} from ${JSON.stringify(pathToFileURL(resolve(repo, 'scripts/coverage-inventory.mjs')).href)};export const inventory=(r,n)=>[resolve(r,'src/'+n+'.js')];export const sourceDigest=()=> 'sources';`,
    );
    put(
      "scripts/coverage-integrity.mjs",
      `import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';export const inputDigest=()=> 'inputs';export const fileDigest=p=>createHash('sha256').update(readFileSync(p)).digest('hex');`,
    );
    put(
      "scripts/coverage-scope.mjs",
      `export const auditRepositoryScope=()=>({records:[]});`,
    );
    const artifact = {
      revision: "revision",
      classificationSha256: "classes",
      inventory: ["api/a.py", "scripts/build.sh"],
      fileHashes: {},
    };
    const context = {
      artifact,
      selected: [],
      runId: "11111111-1111-4111-8111-111111111111",
      selection: "selection",
      input: "inputs",
      children: [
        { language: "javascript", status: 0, signal: null, error: null },
        { language: "python", status: 0, signal: null, error: null },
      ],
    };
    const rows = [];
    for (const [name, directory] of Object.entries(unitPartitions)) {
      const path = put("src/" + name + ".js", "function a(){return 1;}\n");
      artifact.fileHashes["src/" + name + ".js"] = hash(readFileSync(path));
      const loc = {
        start: { line: 1, column: 0 },
        end: { line: 1, column: 20 },
      };
      const raw = {
        [path]: {
          path,
          statementMap: { 0: loc },
          fnMap: { 0: { loc, decl: loc } },
          branchMap: { 0: { loc, locations: [loc] } },
          s: { 0: 1 },
          f: { 0: 1 },
          b: { 0: [1] },
        },
      };
      const metrics = Object.fromEntries(
        ["lines", "statements", "functions", "branches"].map((n) => [
          n,
          { total: 1, covered: 1, pct: 100 },
        ]),
      );
      const rawPath = put(
          "coverage/unit/" + name + "/coverage-final.json",
          raw,
        ),
        summary = put("coverage/unit/" + name + "/coverage-summary.json", {
          total: metrics,
          [path]: metrics,
        });
      const file = name + ".test.ts";
      context.selected.push(file);
      const execution = put(
        "coverage/unit/diagnostics/" + name + "-tests.json",
        directory
          ? {
              success: true,
              testResults: [
                {
                  name: resolve(root, file),
                  status: "passed",
                  assertionResults: [{ status: "passed" }],
                },
              ],
            }
          : {
              version: 1,
              engine: "node",
              complete: true,
              summaries: [
                {
                  file: resolve(root, file),
                  success: true,
                  counts: {
                    tests: 1,
                    passed: 1,
                    failed: 0,
                    cancelled: 0,
                    skipped: 0,
                    todo: 0,
                    topLevel: 1,
                    suites: 0,
                  },
                },
              ],
            },
      );
      const row = {
        partition: name,
        layer: "unit",
        unitRunId: context.runId,
        selectionRevision: "revision",
        selectionSha256: "selection",
        classificationSha256: "classes",
        inputDigest: "inputs",
        sourceDigest: "sources",
        phase: "complete",
        testExitCode: 0,
        sourceChangedDuringRun: false,
        inputChangedDuringRun: false,
        selectedTestFiles: [file],
        executedTestFiles: [file],
        executionReportHash: hash(readFileSync(execution)),
        reportHash: hash(readFileSync(summary)),
        rawReportHash: hash(readFileSync(rawPath)),
        coverage: metrics,
      };
      rows.push(row);
      put("coverage/unit/run-" + name + ".json", { partitions: [row] });
    }
    put("coverage/unit/run-all.json", { partitions: rows });
    const path = put("api/a.py", "def a():\n return 1\n");
    artifact.fileHashes["api/a.py"] = hash(readFileSync(path));
    context.selected.push("tests/test_a.py");
    const run = resolve(root, "coverage/unit/python/run-fixture"),
      raw = {
        meta: { branch_coverage: true },
        files: {
          "api/a.py": {
            executed_lines: [1, 2],
            missing_lines: [],
            executed_branches: [[1, 2]],
            missing_branches: [],
            summary: {
              covered_lines: 2,
              num_statements: 2,
              covered_branches: 1,
              num_branches: 1,
            },
          },
        },
        totals: {
          covered_lines: 2,
          num_statements: 2,
          covered_branches: 1,
          num_branches: 1,
        },
      };
    const rawPath = put("coverage/unit/python/run-fixture/coverage.json", raw),
      xml = put("coverage/unit/python/run-fixture/coverage.xml", "<coverage/>");
    const evidence = {
      version: 1,
      engine: "pytest",
      complete: true,
      sessionExitCode: 0,
      collected: [
        { nodeid: "tests/test_a.py::test_a", file: "tests/test_a.py" },
      ],
      deselected: [],
      collectionFailures: [],
      reports: ["setup", "call", "teardown"].map((when) => ({
        nodeid: "tests/test_a.py::test_a",
        when,
        outcome: "passed",
        wasxfail: false,
      })),
    };
    const execution = put(
      "coverage/unit/python/run-fixture/execution.json",
      evidence,
    );
    const { auditPythonExecution } = await import(
      pathToFileURL(resolve(root, "scripts/coverage-python-protocol.mjs")).href
    );
    const audit = auditPythonExecution(["tests/test_a.py"], evidence);
    put("coverage/unit/run-python.json", {
      partitions: [
        {
          partition: "python",
          layer: "unit",
          parentRunId: context.runId,
          runId: "22222222-2222-4222-8222-222222222222",
          selectionRevision: "revision",
          selectionSha256: "selection",
          classificationSha256: "classes",
          coverage: raw.totals,
          inputDigest: "inputs",
          phase: "complete",
          testExitCode: 0,
          nativeExitCode: 0,
          runnerExitCode: 0,
          sourceChangedDuringRun: false,
          inputChangedDuringRun: false,
          selectedTestFiles: ["tests/test_a.py"],
          executedTestFiles: audit.executedFiles,
          executionAudit: audit,
          executionReportHash: hash(readFileSync(execution)),
          sourceHashes: { "api/a.py": artifact.fileHashes["api/a.py"] },
          runDirectory: run,
          reportHash: hash(readFileSync(rawPath)),
          xmlReportHash: hash(readFileSync(xml)),
        },
      ],
    });
    const { verifyUnitReports } = await import(
      pathToFileURL(resolve(root, "scripts/coverage-unit-verify.mjs")).href
    );
    await fn({
      root,
      context,
      put,
      read,
      verify: () => verifyUnitReports(root, context),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
test("recounts all twelve adapter partitions but unsupported shell blocks overall", () =>
  fixture(({ verify }) => {
    const result = verify();
    assert.equal(result.partitions.length, 12);
    assert.ok(result.partitions.every((r) => r.passed));
    assert.equal(result.passed, false);
    assert.deepEqual(result.unsupported, ["scripts/build.sh"]);
  }));
for (const [name, change] of Object.entries({
  failedChild: ({ context }) => (context.children[0].status = 1),
  oldId: ({ context }) =>
    (context.runId = "33333333-3333-4333-8333-333333333333"),
  duplicate: ({ read, put }) => {
    const d = read("coverage/unit/run-all.json");
    d.partitions[1] = d.partitions[0];
    put("coverage/unit/run-all.json", d);
  },
  missingRaw: ({ put }) => put("coverage/unit/web/coverage-final.json", {}),
  rawCounter: ({ read, put }) => {
    const d = read("coverage/unit/web/coverage-final.json");
    Object.values(d)[0].s[0] = -1;
    put("coverage/unit/web/coverage-final.json", d);
  },
  sourceChanged: ({ put }) => put("src/web.js", "changed"),
  testNotExecuted: ({ read, put }) => {
    const d = read("coverage/unit/diagnostics/web-tests.json");
    d.testResults = [];
    put("coverage/unit/diagnostics/web-tests.json", d);
  },
  pythonFalseCount: ({ read, put }) => {
    const d = read("coverage/unit/python/run-fixture/coverage.json");
    d.totals.covered_lines = 100;
    put("coverage/unit/python/run-fixture/coverage.json", d);
  },
}))
  test("aggregate rejects " + name, () =>
    fixture((f) => {
      change(f);
      assert.throws(f.verify);
    }),
  );

for (const field of ["classificationSha256", "coverage"])
  test("rejects missing Python receipt " + field, () =>
    fixture((f) => {
      const d = f.read("coverage/unit/run-python.json");
      delete d.partitions[0][field];
      f.put("coverage/unit/run-python.json", d);
      assert.throws(f.verify);
    }),
  );
test("native Python nonzero exit cannot be hidden behind a zero receipt", () =>
  fixture((f) => {
    const path = "coverage/unit/python/run-fixture/execution.json",
      e = f.read(path);
    e.sessionExitCode = 1;
    const file = f.put(path, e);
    const row = f.read("coverage/unit/run-python.json");
    row.partitions[0].executionReportHash = hash(readFileSync(file));
    f.put("coverage/unit/run-python.json", row);
    assert.throws(f.verify);
  }));
