import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { compareCoverageKeys } from "./coverage-inventory.mjs";
export function assertUnitIdentity(row, expected) {
  assert.match(
    expected.runId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
  assert.equal(expected.childExit, 0, "Child process failed");
  assert.equal(row?.partition, expected.partition, "Wrong partition");
  assert.equal(row.layer, "unit", "Not a unit report");
  assert.equal(
    row.partition === "python" ? row.parentRunId : row.unitRunId,
    expected.runId,
    "Stale/wrong invocation",
  );
  if (row.partition === "python")
    assert.match(
      row.runId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  assert.equal(row.selectionRevision, expected.revision);
  assert.equal(row.selectionSha256, expected.selection);
  assert.equal(row.inputDigest, expected.input);
  assert.equal(row.phase, "complete");
  assert.ok(!row.blocked && !row.missingReport);
  assert.equal(row.sourceChangedDuringRun, false);
  assert.equal(row.inputChangedDuringRun, false);
  if (row.partition === "python") {
    assert.equal(row.nativeExitCode, 0);
    assert.equal(row.runnerExitCode, 0);
    assert.equal(row.testExitCode, row.emptyUnitPartition ? null : 0);
  } else assert.equal(row.testExitCode, 0);
}
export function assertRatios(metrics, names) {
  for (const name of names) {
    const value = metrics[name];
    assert.ok(
      value &&
        Number.isSafeInteger(value.total) &&
        Number.isSafeInteger(value.covered) &&
        value.total > 0 &&
        value.covered >= 0 &&
        value.covered <= value.total,
      name + ": invalid/N/A counts",
    );
    assert.ok(
      BigInt(value.covered) * 10n > BigInt(value.total) * 9n,
      name + ": not strictly above 90%",
    );
  }
}
function unique(values, branch = false, limit) {
  assert.ok(Number.isSafeInteger(limit) && limit > 0);
  assert.ok(Array.isArray(values));
  const keys = values.map((value) => {
    if (branch)
      assert.ok(
        Array.isArray(value) &&
          value.length === 2 &&
          Number.isSafeInteger(value[0]) &&
          value[0] > 0 &&
          Number.isSafeInteger(value[1]) &&
          value[0] <= limit &&
          value[1] !== 0 &&
          Math.abs(value[1]) <= limit,
      );
    else assert.ok(Number.isSafeInteger(value) && value > 0 && value <= limit);
    return JSON.stringify(value);
  });
  assert.equal(new Set(keys).size, keys.length, "Duplicate native location");
  return new Set(keys);
}
export function pythonRawCounts(report, limits) {
  assert.equal(report?.meta?.branch_coverage, true);
  assert.ok(report.files && report.totals);
  const totals = {
    covered_lines: 0,
    num_statements: 0,
    covered_branches: 0,
    num_branches: 0,
  };
  assert.deepEqual(
    Object.keys(limits).sort(compareCoverageKeys),
    Object.keys(report.files).sort(compareCoverageKeys),
  );
  for (const [path, file] of Object.entries(report.files)) {
    const done = unique(file.executed_lines, false, limits[path]),
      missing = unique(file.missing_lines, false, limits[path]),
      arcs = unique(file.executed_branches, true, limits[path]),
      missingArcs = unique(file.missing_branches, true, limits[path]);
    for (const value of missing)
      assert.ok(!done.has(value), "Overlapping native line");
    for (const value of missingArcs)
      assert.ok(!arcs.has(value), "Overlapping native arc");
    const counts = {
      covered_lines: done.size,
      num_statements: done.size + missing.size,
      covered_branches: arcs.size,
      num_branches: arcs.size + missingArcs.size,
    };
    for (const [key, value] of Object.entries(counts)) {
      assert.equal(file.summary?.[key], value, "False per-file native count");
      totals[key] += value;
    }
  }
  for (const [key, value] of Object.entries(totals))
    assert.equal(report.totals[key], value, "False total native count");
  return {
    lines: { covered: totals.covered_lines, total: totals.num_statements },
    branches: { covered: totals.covered_branches, total: totals.num_branches },
  };
}

function location(loc, limit) {
  assert.ok(loc && loc.start && loc.end);
  for (const [role, pos] of Object.entries(loc)) {
    if (role !== "start" && role !== "end") continue;
    assert.ok(
      Number.isSafeInteger(pos.line) && pos.line > 0 && pos.line <= limit,
    );
    assert.ok(
      (role === "end" && pos.column === null) ||
        (Number.isSafeInteger(pos.column) && pos.column >= 0),
    );
  }
  assert.ok(loc.end.line >= loc.start.line);
  if (loc.end.line === loc.start.line && loc.end.column !== null)
    assert.ok(loc.end.column >= loc.start.column);
}
const implicitElseLocation = { start: {}, end: {} };
function branchLocations(branch, limit) {
  location(branch.loc, limit);
  for (const [index, loc] of branch.locations.entries()) {
    if (isDeepStrictEqual(loc, implicitElseLocation)) {
      // The V8-to-Istanbul mapper counts an omitted else as a second if arm,
      // with no source span. Validate that exact shape without dropping its slot.
      assert.equal(branch.type, "if");
      assert.equal(index, 1);
      assert.equal(branch.locations.length, 2);
      assert.equal(branch.line, branch.loc.start.line);
      assert.deepEqual(branch.locations[0], branch.loc);
    } else location(loc, limit);
  }
}
function counter(value) {
  assert.ok(Number.isSafeInteger(value) && value >= 0);
  return value > 0;
}
export function istanbulRawCounts(report, limits) {
  assert.deepEqual(Object.keys(report).sort(compareCoverageKeys), Object.keys(limits).sort(compareCoverageKeys));
  const result = Object.fromEntries(
    ["lines", "statements", "functions", "branches"].map((k) => [
      k,
      { total: 0, covered: 0 },
    ]),
  );
  const add = (name, values) => {
    result[name].total += values.length;
    result[name].covered += values.filter(Boolean).length;
  };
  for (const [path, file] of Object.entries(report)) {
    assert.equal(file.path, path);
    const limit = limits[path];
    assert.ok(Number.isSafeInteger(limit) && limit > 0);
    for (const [map, key] of [
      ["statementMap", "s"],
      ["fnMap", "f"],
      ["branchMap", "b"],
    ])
      assert.deepEqual(
        Object.keys(file[map]).sort(compareCoverageKeys),
        Object.keys(file[key]).sort(compareCoverageKeys),
      );
    const lines = new Map();
    for (const [id, loc] of Object.entries(file.statementMap)) {
      location(loc, limit);
      const hit = counter(file.s[id]);
      lines.set(loc.start.line, lines.get(loc.start.line) || false || hit);
    }
    add("lines", [...lines.values()]);
    add("statements", Object.values(file.s).map(counter));
    for (const f of Object.values(file.fnMap)) {
      location(f.loc, limit);
      location(f.decl, limit);
    }
    add("functions", Object.values(file.f).map(counter));
    for (const [id, b] of Object.entries(file.branchMap)) {
      assert.ok(Array.isArray(b.locations) && Array.isArray(file.b[id]));
      assert.equal(b.locations.length, file.b[id].length);
      branchLocations(b, limit);
      add("branches", file.b[id].map(counter));
    }
  }
  for (const value of Object.values(result))
    assert.ok(
      Number.isSafeInteger(value.total) && Number.isSafeInteger(value.covered),
    );
  return result;
}
