import test from "node:test";
import assert from "node:assert/strict";
import {
  pythonSources,
  auditPythonExecution,
} from "./coverage-python-protocol.mjs";
test("all tracked Python production roots retained, tests and evidence distinct", () => {
  assert.deepEqual(
    pythonSources([
      "api/a.py",
      "open_notebook/b.py",
      "scripts/helper.py",
      "apps/web/tool.py",
      "run_api.py",
      "tests/test_a.py",
      "docs/sample.py",
      "frontend/a.ts",
    ]),
    [
      "api/a.py",
      "apps/web/tool.py",
      "open_notebook/b.py",
      "run_api.py",
      "scripts/helper.py",
    ],
  );
});
test("unknown Python production root cannot silently disappear", () =>
  assert.throws(() => pythonSources(["new_package/a.py"])));
const evidence = () => ({
  version: 1,
  complete: true,
  sessionExitCode: 0,
  collected: [{ nodeid: "tests/test_a.py::test_a", file: "tests/test_a.py" }],
  deselected: [],
  collectionFailures: [],
  reports: ["setup", "call", "teardown"].map((when) => ({
    nodeid: "tests/test_a.py::test_a",
    when,
    outcome: "passed",
    wasxfail: false,
  })),
});
test("actual collected and executed files match selected files", () =>
  assert.deepEqual(
    auditPythonExecution(["tests/test_a.py"], evidence()).executedFiles,
    ["tests/test_a.py"],
  ));
for (const [name, mutate] of Object.entries({
  "missing collection": (e) => (e.collected = []),
  "extra collection": (e) =>
    e.collected.push({
      nodeid: "tests/test_b.py::test_b",
      file: "tests/test_b.py",
    }),
  "duplicate collection": (e) => e.collected.push(e.collected[0]),
  deselection: (e) => (e.deselected = ["tests/test_a.py::test_b"]),
  "failed collection": (e) => (e.collectionFailures = ["tests/test_a.py"]),
  "missing call": (e) =>
    (e.reports = e.reports.filter((r) => r.when !== "call")),
  "duplicate report": (e) => e.reports.push(e.reports[0]),
  "foreign report": (e) =>
    e.reports.push({ nodeid: "foreign", when: "call", outcome: "passed" }),
  "unknown outcome": (e) => (e.reports[1].outcome = "pending"),
  "all skipped": (e) => {
    e.reports[0].outcome = "skipped";
    e.reports.splice(1, 1);
  },
  "failed teardown": (e) => (e.reports[2].outcome = "failed"),
  "incomplete session": (e) => (e.complete = false),
})) {
  test("rejects " + name, () => {
    const e = evidence();
    mutate(e);
    assert.throws(() => auditPythonExecution(["tests/test_a.py"], e));
  });
}
test("empty mode is explicit and not fabricated pytest execution", () => {
  const e = {
    version: 1,
    complete: true,
    mode: "empty",
    sessionExitCode: null,
    collected: [],
    deselected: [],
    collectionFailures: [],
    reports: [],
  };
  assert.deepEqual(auditPythonExecution([], e).executedFiles, []);
  assert.throws(() => auditPythonExecution([], evidence()));
});

test("native subtest calls are retained without replacing or multiplying parent calls", () => {
  const e = evidence();
  e.reports.splice(
    1,
    0,
    { ...e.reports[1], kind: "subtest" },
    { ...e.reports[1], kind: "subtest", outcome: "skipped" },
  );
  assert.deepEqual(auditPythonExecution(["tests/test_a.py"], e), {
    executedFiles: ["tests/test_a.py"],
    passed: 1,
    skipped: 0,
  });
});

for (const [name, mutate] of Object.entries({
  "failed subtest": (e) =>
    e.reports.splice(1, 0, { ...e.reports[1], kind: "subtest", outcome: "failed" }),
  "subtest without parent call": (e) => (e.reports[1].kind = "subtest"),
  "subtest on a non-call phase": (e) => (e.reports[0].kind = "subtest"),
  "subtest after parent call": (e) =>
    e.reports.splice(2, 0, { ...e.reports[1], kind: "subtest" }),
  "subtest with orphan node": (e) =>
    e.reports.splice(1, 0, { ...e.reports[1], nodeid: "foreign", kind: "subtest" }),
  "unknown report kind": (e) => (e.reports[1].kind = "unknown"),
})) {
  test("rejects " + name, () => {
    const e = evidence();
    mutate(e);
    assert.throws(() => auditPythonExecution(["tests/test_a.py"], e));
  });
}
