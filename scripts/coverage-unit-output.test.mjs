import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { startUnitAttempt, writeUnitResult } from "./coverage-unit-output.mjs";
function fixture(fn) {
  const root = mkdtempSync(resolve(tmpdir(), "unit-output-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
test("new attempt invalidates old complete aggregate and child rows before options", () =>
  fixture((root) => {
    mkdirSync(resolve(root, "coverage/unit"), { recursive: true });
    writeFileSync(
      resolve(root, "coverage/unit/run-total.json"),
      JSON.stringify({ phase: "complete", passed: true }),
    );
    const a = startUnitAttempt(root, ["web", "python"]);
    const read = (n) =>
      JSON.parse(
        readFileSync(resolve(root, "coverage/unit/run-" + n + ".json"), "utf8"),
      );
    assert.equal(read("total").phase, "pending");
    assert.equal(read("total").passed, false);
    assert.equal(read("web").partitions[0].parentRunId, a.runId);
    assert.equal(read("python").partitions[0].phase, "pending");
    assert.equal(read("all").phase, "pending");
  }));
test("output directory symlink cannot touch outside sentinel", () =>
  fixture((root) => {
    mkdirSync(resolve(root, "outside"));
    writeFileSync(resolve(root, "outside/run-total.json"), "sentinel");
    symlinkSync(resolve(root, "outside"), resolve(root, "coverage"));
    assert.throws(() => startUnitAttempt(root, ["web"]));
    assert.equal(
      readFileSync(resolve(root, "outside/run-total.json"), "utf8"),
      "sentinel",
    );
  }));
test("destination symlink is replaced without writing its target", () =>
  fixture((root) => {
    mkdirSync(resolve(root, "coverage/unit"), { recursive: true });
    writeFileSync(resolve(root, "target"), "sentinel");
    symlinkSync(
      resolve(root, "target"),
      resolve(root, "coverage/unit/run-total.json"),
    );
    const a = startUnitAttempt(root, ["web"]);
    writeUnitResult(root, "run-total.json", {
      ...a,
      phase: "failed",
      passed: false,
    });
    assert.equal(readFileSync(resolve(root, "target"), "utf8"), "sentinel");
  }));
test("writer rejects traversal or child-controlled output names", () =>
  fixture((root) => {
    assert.throws(() => writeUnitResult(root, "../outside", { passed: true }));
  }));
