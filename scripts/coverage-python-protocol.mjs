import assert from "node:assert/strict";
import { compareCoverageKeys } from "./coverage-inventory.mjs";
const roots = new Set([
  "api",
  "open_notebook",
  "commands",
  "scripts",
  "deploy",
  "apps",
]);
export function pythonSources(inventory) {
  assert.ok(
    Array.isArray(inventory) && new Set(inventory).size === inventory.length,
  );
  const result = [];
  for (const file of inventory) {
    if (!file.endsWith(".py")) continue;
    const root = file.split("/")[0];
    if (root === "tests" || root === "docs") continue;
    assert.ok(
      roots.has(root) || file === "run_api.py",
      "Unknown Python production root: " + file,
    );
    result.push(file);
  }
  assert.ok(result.length > 0, "No Python production inventory");
  return result.sort(compareCoverageKeys);
}
export function auditPythonExecution(selected, evidence) {
  assert.ok(
    Array.isArray(selected) && new Set(selected).size === selected.length,
  );
  assert.ok(
    evidence?.version === 1 && evidence.complete === true,
    "Incomplete Python execution evidence",
  );
  for (const key of [
    "collected",
    "reports",
    "deselected",
    "collectionFailures",
  ])
    assert.ok(Array.isArray(evidence[key]));
  assert.equal(evidence.deselected.length, 0, "Unexpected deselection");
  assert.equal(evidence.collectionFailures.length, 0, "Failed collection");
  if (selected.length === 0) {
    assert.equal(evidence.mode, "empty");
    assert.equal(evidence.sessionExitCode, null);
    assert.equal(evidence.collected.length, 0);
    assert.equal(evidence.reports.length, 0);
    return { executedFiles: [], passed: 0, skipped: 0 };
  }
  assert.ok(
    Number.isInteger(evidence.sessionExitCode) &&
      evidence.sessionExitCode >= 0 &&
      evidence.sessionExitCode <= 5,
  );
  const nodes = new Map();
  for (const row of evidence.collected) {
    assert.ok(
      typeof row.nodeid === "string" &&
        row.nodeid.length > 0 &&
        selected.includes(row.file),
    );
    assert.ok(!nodes.has(row.nodeid), "Duplicate collected node");
    nodes.set(row.nodeid, { file: row.file, phases: new Map() });
  }
  assert.deepEqual(
    [...new Set([...nodes.values()].map((row) => row.file))].sort(compareCoverageKeys),
    [...selected].sort(compareCoverageKeys),
    "Collected files differ",
  );
  for (const row of evidence.reports) {
    assert.ok(nodes.has(row.nodeid), "Uncollected executed node");
    assert.ok(
      ["setup", "call", "teardown"].includes(row.when) &&
        ["passed", "failed", "skipped"].includes(row.outcome),
      "Unknown report status",
    );
    assert.equal(typeof row.wasxfail, "boolean");
    const phases = nodes.get(row.nodeid).phases;
    assert.ok(!phases.has(row.when), "Duplicate phase report");
    phases.set(row.when, row);
  }
  const executed = new Set();
  let passed = 0,
    skipped = 0;
  for (const row of nodes.values()) {
    const { phases } = row;
    assert.ok(
      phases.has("setup") && phases.has("teardown"),
      "Incomplete test phases",
    );
    assert.ok(
      [...phases.values()].every((r) => r.outcome !== "failed"),
      "Test phase failed",
    );
    const setup = phases.get("setup"),
      call = phases.get("call");
    if (setup.outcome === "passed") assert.ok(call, "Missing call report");
    else assert.equal(call, undefined, "Call after skipped setup");
    if (call?.outcome === "passed" && !call.wasxfail) {
      executed.add(row.file);
      passed++;
    }
    if (setup.outcome === "skipped" || call?.outcome === "skipped") skipped++;
  }
  assert.deepEqual(
    [...executed].sort(compareCoverageKeys),
    [...selected].sort(compareCoverageKeys),
    "Selected file has no passing executed test",
  );
  return { executedFiles: [...executed].sort(compareCoverageKeys), passed, skipped };
}
