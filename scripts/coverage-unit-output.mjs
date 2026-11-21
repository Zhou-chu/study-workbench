import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  realpathSync,
  openSync,
  closeSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { resolve } from "node:path";
function output(root) {
  root = resolve(root);
  assert.equal(realpathSync(root), root, "Noncanonical owner root");
  for (const part of ["coverage", "coverage/unit"]) {
    const dir = resolve(root, part);
    mkdirSync(dir, { recursive: true });
    assert.equal(realpathSync(dir), dir, "Output symlink rejected");
  }
  return resolve(root, "coverage/unit");
}
export function writeUnitResult(root, name, value) {
  assert.match(name, /^(?:run-[a-z-]+|selection-[0-9a-f-]+)\.json$/);
  const directory = output(root),
    path = resolve(directory, name),
    temporary = path + "." + randomUUID() + ".tmp";
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value, null, 2) + "\n");
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, path);
}
export function startUnitAttempt(root, names) {
  const attempt = {
    runId: randomUUID(),
    startedAt: new Date().toISOString(),
    phase: "pending",
    passed: false,
    layer: "unit",
  };
  writeUnitResult(root, "run-total.json", attempt);
  writeUnitResult(root, "run-all.json", attempt);
  for (const partition of names)
    writeUnitResult(root, "run-" + partition + ".json", {
      partitions: [{ partition, phase: "pending", parentRunId: attempt.runId }],
    });
  return attempt;
}
