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
import { spawnSync } from "node:child_process";
const repo = resolve(import.meta.dirname, "..");
for (const args of [
  ["--unknown"],
  ["--python=/python", "--tiktoken-cache=/cache"],
])
  test(
    "actual aggregate startup failure invalidates prior complete: " + args,
    () => {
      const root = mkdtempSync(resolve(tmpdir(), "unit-all-"));
      try {
        mkdirSync(resolve(root, "scripts"));
        mkdirSync(resolve(root, "coverage/unit"), { recursive: true });
        for (const name of [
          "coverage-unit-all.mjs",
          "coverage-unit-output.mjs",
        ])
          copyFileSync(
            resolve(repo, "scripts", name),
            resolve(root, "scripts", name),
          );
        writeFileSync(
          resolve(root, "coverage/unit/run-total.json"),
          JSON.stringify({ phase: "complete", passed: true, runId: "old" }),
        );
        const child = spawnSync(
          process.execPath,
          [resolve(root, "scripts/coverage-unit-all.mjs"), ...args],
          { encoding: "utf8" },
        );
        assert.equal(child.status, 1);
        const report = JSON.parse(
          readFileSync(resolve(root, "coverage/unit/run-total.json"), "utf8"),
        );
        assert.equal(report.phase, "failed");
        assert.equal(report.passed, false);
        assert.notEqual(report.runId, "old");
        assert.ok(report.error);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
