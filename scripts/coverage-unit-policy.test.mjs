import test from "node:test";
import assert from "node:assert/strict";
import {
  assertUnitIdentity,
  assertRatios,
  pythonRawCounts,
  istanbulRawCounts,
} from "./coverage-unit-policy.mjs";
const id = "11111111-1111-4111-8111-111111111111";
const expected = {
  partition: "web",
  runId: id,
  revision: "revision",
  selection: "selection",
  input: "input",
  childExit: 0,
};
const row = () => ({
  partition: "web",
  layer: "unit",
  unitRunId: id,
  selectionRevision: "revision",
  selectionSha256: "selection",
  inputDigest: "input",
  phase: "complete",
  testExitCode: 0,
  sourceChangedDuringRun: false,
  inputChangedDuringRun: false,
});
test("identity requires this invocation, not report existence", () =>
  assert.doesNotThrow(() => assertUnitIdentity(row(), expected)));
for (const [key, value] of Object.entries({
  partition: "domain",
  layer: "mixed",
  unitRunId: "old",
  selectionRevision: "old",
  selectionSha256: "old",
  inputDigest: "old",
  phase: "pending",
  testExitCode: 1,
  sourceChangedDuringRun: true,
  inputChangedDuringRun: true,
  blocked: "failed",
  missingReport: true,
})) {
  test("rejects " + key, () =>
    assert.throws(() =>
      assertUnitIdentity({ ...row(), [key]: value }, expected),
    ),
  );
}
test("actual failed child cannot be rescued by complete reports", () =>
  assert.throws(() =>
    assertUnitIdentity(row(), { ...expected, childExit: 1 }),
  ));
test("strict raw ratios ignore percent labels", () => {
  assert.throws(() =>
    assertRatios({ lines: { covered: 9, total: 10, pct: 100 } }, ["lines"]),
  );
  assert.doesNotThrow(() =>
    assertRatios({ lines: { covered: 10, total: 10, pct: 0 } }, ["lines"]),
  );
});
for (const value of [
  { covered: 0, total: 0 },
  { covered: 11, total: 10 },
  { covered: -1, total: 10 },
  { covered: 9.5, total: 10 },
])
  test("invalid raw count " + JSON.stringify(value), () =>
    assert.throws(() => assertRatios({ lines: value }, ["lines"])),
  );
const python = () => ({
  meta: { branch_coverage: true },
  files: {
    "api/a.py": {
      executed_lines: [1, 2],
      missing_lines: [3],
      executed_branches: [[1, 2]],
      missing_branches: [[1, 3]],
      summary: {
        covered_lines: 2,
        num_statements: 3,
        covered_branches: 1,
        num_branches: 2,
      },
    },
  },
  totals: {
    covered_lines: 2,
    num_statements: 3,
    covered_branches: 1,
    num_branches: 2,
  },
});
test("Python counts are rebuilt from native lines and arcs", () =>
  assert.deepEqual(pythonRawCounts(python(), { "api/a.py": 3 }), {
    lines: { covered: 2, total: 3 },
    branches: { covered: 1, total: 2 },
  }));
for (const [name, mutate] of Object.entries({
  percentOnly: (d) => (d.totals.covered_lines = 3),
  perFileLie: (d) => (d.files["api/a.py"].summary.covered_lines = 3),
  duplicate: (d) => d.files["api/a.py"].executed_lines.push(1),
  overlap: (d) => d.files["api/a.py"].missing_branches.push([1, 2]),
  noBranches: (d) => (d.meta.branch_coverage = false),
}))
  test("rejects native " + name, () => {
    const d = python();
    mutate(d);
    assert.throws(() => pythonRawCounts(d, { "api/a.py": 3 }));
  });

test("Python child run ID must be a real UUID shape", () => {
  const r = {
    ...row(),
    partition: "python",
    parentRunId: id,
    runId: "------------------------------------",
    nativeExitCode: 0,
    runnerExitCode: 0,
    emptyUnitPartition: false,
  };
  assert.throws(() =>
    assertUnitIdentity(r, { ...expected, partition: "python" }),
  );
});
test("native Python line and arc positions must fit actual source", () => {
  const d = python();
  d.files["api/a.py"].executed_lines = [1, 999];
  assert.throws(() => pythonRawCounts(d, { "api/a.py": 3 }));
  const b = python();
  b.files["api/a.py"].executed_branches = [[1, -999]];
  assert.throws(() => pythonRawCounts(b, { "api/a.py": 3 }));
});

for (const runId of [undefined, "", "------------------------------------"])
  test("rejects invalid expected invocation " + runId, () =>
    assert.throws(() =>
      assertUnitIdentity(
        { ...row(), unitRunId: runId },
        { ...expected, runId },
      ),
    ),
  );

const js = () => ({
  "/r/a.js": {
    path: "/r/a.js",
    statementMap: {
      0: { start: { line: 1, column: 0 }, end: { line: 1, column: 8 } },
      1: { start: { line: 1, column: 9 }, end: { line: 1, column: null } },
    },
    fnMap: {
      0: {
        loc: { start: { line: 1, column: 0 }, end: { line: 2, column: 1 } },
        decl: { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } },
      },
    },
    branchMap: {
      0: {
        loc: { start: { line: 1, column: 0 }, end: { line: 2, column: 1 } },
        locations: [
          { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } },
          { start: { line: 2, column: 0 }, end: { line: 2, column: 1 } },
        ],
      },
    },
    s: { 0: 0, 1: 1 },
    f: { 0: 1 },
    b: { 0: [1, 0] },
  },
});
test("Istanbul counters rebuild native line union and all four totals", () =>
  assert.deepEqual(istanbulRawCounts(js(), { "/r/a.js": 2 }), {
    lines: { total: 1, covered: 1 },
    statements: { total: 2, covered: 1 },
    functions: { total: 1, covered: 1 },
    branches: { total: 2, covered: 1 },
  }));
const implicitElse = () => {
  const report = js();
  const file = report["/r/a.js"];
  const branch = file.branchMap[0];
  branch.type = "if";
  branch.line = branch.loc.start.line;
  branch.locations = [structuredClone(branch.loc), { start: {}, end: {} }];
  return report;
};
test("an Istanbul implicit else arm retains its own denominator and hits", async () => {
  const { default: coverage } = await import("istanbul-lib-coverage");
  for (const hits of [[1, 0], [0, 3]]) {
    const report = implicitElse();
    report["/r/a.js"].b[0] = hits;
    const expected = coverage.createCoverageMap(report).getCoverageSummary().toJSON();
    const raw = istanbulRawCounts(report, { "/r/a.js": 2 });
    assert.deepEqual(raw.branches, { total: 2, covered: 1 });
    assert.equal(raw.branches.total, expected.branches.total);
    assert.equal(raw.branches.covered, expected.branches.covered);
  }
});
for (const [name, mutate] of Object.entries({
  wrongType: (branch) => (branch.type = "cond-expr"),
  wrongArm: (branch) => branch.locations.reverse(),
  wrongParent: (branch) => (branch.line = 2),
  unrelatedConsequent: (branch) => (branch.locations[0].end.column = 2),
  partialPosition: (branch) => (branch.locations[1].start.line = 2),
})) {
  test("rejects an invalid implicit arm: " + name, () => {
    const report = implicitElse();
    mutate(report["/r/a.js"].branchMap[0]);
    assert.throws(() => istanbulRawCounts(report, { "/r/a.js": 2 }));
  });
}
for (const [name, mutate] of Object.entries({
  extra: (d) => (d["/r/a.js"].s[2] = 1),
  negative: (d) => (d["/r/a.js"].f[0] = -1),
  fraction: (d) => (d["/r/a.js"].b[0][0] = 0.5),
  arity: (d) => d["/r/a.js"].b[0].push(1),
  outside: (d) => (d["/r/a.js"].statementMap[0].start.line = 999),
  wrongPath: (d) => (d["/r/a.js"].path = "/else.js"),
}))
  test("rejects corrupt Istanbul " + name, () => {
    const d = js();
    mutate(d);
    assert.throws(() => istanbulRawCounts(d, { "/r/a.js": 2 }));
  });
test("Istanbul missing and extra production sources fail closed", () => {
  assert.throws(() => istanbulRawCounts(js(), {}));
  assert.throws(() => istanbulRawCounts({}, { "/r/a.js": 2 }));
});

test("strict ratios retain precision near MAX_SAFE_INTEGER", () =>
  assert.doesNotThrow(() =>
    assertRatios(
      { lines: { covered: 8106479329266890, total: 9007199254740988 } },
      ["lines"],
    ),
  ));

// Native Istanbul counter semantics, not percentages or a hand-authored expected summary.
test("raw recount agrees with installed Istanbul native summarizer", async () => {
  const { default: coverage } = await import("istanbul-lib-coverage");
  for (const hit of [0, 1, 13]) {
    const report = js();
    report["/r/a.js"].s[1] = hit;
    report["/r/a.js"].f[0] = hit;
    report["/r/a.js"].b[0] = [hit, hit];
    const native = coverage
      .createCoverageMap(report)
      .getCoverageSummary()
      .toJSON();
    const actual = istanbulRawCounts(report, { "/r/a.js": 2 });
    for (const name of ["lines", "functions", "statements", "branches"])
      assert.deepEqual(actual[name], {
        total: native[name].total,
        covered: native[name].covered,
      });
  }
});
