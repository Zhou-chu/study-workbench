import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve, isAbsolute } from "node:path";
import { startUnitAttempt, writeUnitResult } from "./coverage-unit-output.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
// Kept here deliberately: the owned aggregate is invalidated before loading repository policy.
const names = [
  "contracts",
  "domain",
  "web-transport",
  "bff",
  "web",
  "legacy-web",
  "node-tools",
  "legacy-node-tools",
  "deployment-config",
  "quality-tooling",
  "quality-configs",
  "python",
];
function options(args) {
  const result = {};
  for (const arg of args) {
    const m = /^--(python|tiktoken-cache)=(.+)$/.exec(arg);
    assert.ok(
      m && !Object.hasOwn(result, m[1]) && isAbsolute(m[2]),
      "Unknown/invalid option",
    );
    result[m[1]] = m[2];
  }
  assert.ok(
    result.python && result["tiktoken-cache"],
    "Explicit interpreter and token cache required",
  );
  return result;
}
async function run() {
  const attempt = startUnitAttempt(root, names);
  const result = { ...attempt, children: [] };
  let stage = "argument validation";
  try {
    const selectedOptions = options(process.argv.slice(2));
    stage = "selection and classification";
    const { createUnitSelection, validateCurrentUnitSelection } = await import(
      "./coverage-unit-selection.mjs"
    );
    const { inputDigest } = await import("./coverage-integrity.mjs");
    const { verifyUnitReports } = await import("./coverage-unit-verify.mjs");
    const artifact = createUnitSelection(root),
      selected = validateCurrentUnitSelection(root, artifact);
    const selection = createHash("sha256")
        .update(JSON.stringify(artifact))
        .digest("hex"),
      input = inputDigest(root);
    Object.assign(result, {
      revision: artifact.revision,
      selectionSha256: selection,
      inputDigest: input,
    });
    const artifactName = "selection-" + attempt.runId + ".json";
    writeUnitResult(root, artifactName, artifact);
    const artifactPath = resolve(root, "coverage/unit", artifactName);
    const children = [
      [
        "javascript",
        "coverage-workspaces.mjs",
        ["--unit-selection=" + artifactPath, "--unit-attempt=" + attempt.runId],
      ],
      [
        "python",
        "coverage-python-unit.mjs",
        [
          "--unit-selection=" + artifactPath,
          "--parent-attempt=" + attempt.runId,
          "--python=" + selectedOptions.python,
          "--tiktoken-cache=" + selectedOptions["tiktoken-cache"],
        ],
      ],
    ];
    for (const [language, script, args] of children) {
      stage = language + " unit execution";
      assert.deepEqual(validateCurrentUnitSelection(root, artifact), selected);
      assert.equal(inputDigest(root), input, "Inputs changed before child");
      const child = spawnSync(
        process.execPath,
        [resolve(root, "scripts", script), ...args],
        {
          cwd: root,
          stdio: "inherit",
          env: {
            ...process.env,
            NODE_OPTIONS: undefined,
            NODE_V8_COVERAGE: undefined,
          },
        },
      );
      result.children.push({
        language,
        status: child.status,
        signal: child.signal,
        error: child.error ? String(child.error) : null,
      });
      writeUnitResult(root, "run-total.json", result);
      assert.deepEqual(validateCurrentUnitSelection(root, artifact), selected);
      assert.equal(inputDigest(root), input, "Inputs changed during child");
    }
    stage = "coverage verification";
    const report = verifyUnitReports(root, {
      artifact,
      selected,
      runId: attempt.runId,
      selection,
      input,
      children: result.children,
    });
    Object.assign(result, report, { phase: "complete" });
  } catch (error) {
    Object.assign(result, {
      phase: "failed",
      passed: false,
      error: String(error),
    });
  }
  writeUnitResult(root, "run-total.json", result);
  if (!result.passed) {
    console.error(
      "Strict unit gate failed during " + stage + ". See the strict-unit diagnostics artifact.",
    );
  }
  return result.passed ? 0 : 1;
}
try {
  process.exitCode = await run();
} catch {
  console.error("Strict unit gate could not initialize or persist its diagnostic report.");
  process.exitCode = 1;
}
