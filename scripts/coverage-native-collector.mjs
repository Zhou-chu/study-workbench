import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  lstatSync,
} from "node:fs";
import { resolve, relative, dirname, isAbsolute } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { qualityToolingFiles } from "./coverage-inventory.mjs";
import { auditExecutedFiles } from "./coverage-executed-files.mjs";
import { mergeNativeCoverage } from "./coverage-native-union.mjs";
import { coverageEnvironment } from "./coverage-environment.mjs";
const require = createRequire(import.meta.url);
const versions = Object.freeze({
  "ast-v8-to-istanbul": "1.0.8",
  "@bcoe/v8-coverage": "1.0.2",
  vitest: "4.1.12",
  "@vitest/coverage-v8": "4.1.12",
  "istanbul-lib-coverage": "3.2.2",
  "istanbul-lib-report": "3.0.1",
  "istanbul-reports": "3.2.0",
});
const hash = (data) => createHash("sha256").update(data).digest("hex");
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
function local(root, path) {
  const file = resolve(root, path),
    rel = relative(root, file).replaceAll("\\", "/");
  assert.ok(
    rel && !rel.startsWith("../") && !isAbsolute(rel),
    "Source outside root",
  );
  assert.equal(realpathSync(file), file, "Symlink source is unsupported");
  assert.ok(lstatSync(file).isFile());
  return file;
}
export function captureNativeSources(root, files) {
  assert.ok(
    Array.isArray(files) &&
      files.length &&
      new Set(files).size === files.length,
  );
  return Object.fromEntries(
    [...files].sort().map((path) => {
      const file = local(root, path);
      return [file, hash(readFileSync(file))];
    }),
  );
}
function checkVersions() {
  for (const [name, expected] of Object.entries(versions)) {
    let directory = dirname(require.resolve(name));
    while (!readdirSync(directory).includes("package.json"))
      directory = dirname(directory);
    let pkg = read(resolve(directory, "package.json"));
    while (pkg.name !== name) {
      directory = dirname(directory);
      pkg = read(resolve(directory, "package.json"));
    }
    assert.equal(
      pkg.version,
      expected,
      "Unsupported converter version: " + name,
    );
  }
}
function containsPath(parent, file) {
  const rel = relative(parent, file).replaceAll("\\", "/");
  return (
    rel !== "" && rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel)
  );
}
/** Only packages from this collector's lockfile and anchored dependency tree. */
function dependencyPolicy() {
  const owner = fileURLToPath(new URL("../", import.meta.url));
  const lockPath = resolve(owner, "package-lock.json");
  const lockBytes = readFileSync(lockPath);
  const lock = JSON.parse(lockBytes);
  const anchor = realpathSync(resolve(owner, "node_modules"));
  const observed = Object.create(null);
  return {
    observed,
    lockHash: hash(lockBytes),
    verifyUnchanged() {
      assert.equal(
        hash(readFileSync(lockPath)),
        hash(lockBytes),
        "Dependency lock changed",
      );
      for (const [file, row] of Object.entries(observed)) {
        assert.equal(realpathSync(file), file, "Dependency identity changed");
        assert.equal(
          hash(readFileSync(file)),
          row.sha256,
          "Observed dependency bytes changed",
        );
        assert.equal(
          realpathSync(row.metadataPath),
          row.metadataPath,
          "Dependency metadata identity changed",
        );
        assert.equal(
          hash(readFileSync(row.metadataPath)),
          row.metadataHash,
          "Dependency metadata changed",
        );
      }
    },
    permits(file) {
      const actual = realpathSync(file);
      if (actual !== file || !containsPath(anchor, actual)) return false;
      const parts = relative(anchor, actual).replaceAll("\\", "/").split("/");
      const nested = parts.lastIndexOf("node_modules");
      const start = nested + 1;
      const count = parts[start]?.startsWith("@") ? 2 : 1;
      const packageParts = parts.slice(0, start + count);
      const key = "node_modules/" + packageParts.join("/");
      const record = lock.packages?.[key];
      if (!record || record.link || typeof record.version !== "string")
        return false;
      const packageRoot = resolve(anchor, ...packageParts);
      if (realpathSync(resolve(owner, key)) !== packageRoot) return false;
      const metadataPath = resolve(packageRoot, "package.json");
      if (realpathSync(metadataPath) !== metadataPath) return false;
      const metadataBytes = readFileSync(metadataPath);
      const metadata = JSON.parse(metadataBytes);
      const name = record.name ?? parts.slice(start, start + count).join("/");
      if (metadata.name !== name || metadata.version !== record.version)
        return false;
      observed[file] = {
        package: name,
        version: record.version,
        sha256: hash(readFileSync(file)),
        metadataPath,
        metadataHash: hash(metadataBytes),
      };
      return true;
    },
  };
}
/** Runs native Node itself. Neither executed files nor source hashes come from test arguments. */
export async function collectNativeUnion({
  root,
  sourcePaths,
  snapshot,
  vitestFiles,
  nodeFiles,
  vitestReport,
  baseReport,
  output,
}) {
  root = realpathSync(root);
  checkVersions();
  const dependencies = dependencyPolicy();
  assert.equal(process.version, "v24.19.0", "Unsupported native Node version");
  assert.ok(
    nodeFiles.length > 0 && nodeFiles.every((f) => f.endsWith(".mjs")),
    "Only explicit native ESM tests supported",
  );
  for (const f of nodeFiles) local(root, f);
  const testHashes = captureNativeSources(root, nodeFiles);
  const expectedSources = qualityToolingFiles(root);
  assert.deepStrictEqual(
    sourcePaths.map((f) => resolve(root, f)).sort(),
    expectedSources,
    "Native production inventory mismatch",
  );
  const before = captureNativeSources(root, expectedSources);
  assert.deepStrictEqual(before, snapshot, "Source hash changed since Vitest");
  const executedVitestFiles = auditExecutedFiles(
    root,
    vitestFiles,
    read(vitestReport),
    "vitest",
  );
  const baseBytes = readFileSync(baseReport);
  const base = JSON.parse(baseBytes);
  assert.deepStrictEqual(
    Object.keys(base).sort(),
    Object.keys(before).sort(),
    "Incomplete Vitest denominator",
  );
  mkdirSync(output, { recursive: true });
  const run = mkdtempSync(resolve(output, "native-"));
  const raw = resolve(run, "raw");
  mkdirSync(raw);
  writeFileSync(resolve(run, "vitest-base.json"), baseBytes);
  writeFileSync(
    resolve(run, "vitest-execution.json"),
    readFileSync(vitestReport),
  );
  writeFileSync(
    resolve(run, "source-snapshot.json"),
    JSON.stringify(snapshot, null, 2),
  );
  const execution = resolve(run, "execution.json");
  const reporter = fileURLToPath(
    new URL("./coverage-node-reporter.mjs", import.meta.url),
  );
  const runtimeHash = hash(readFileSync(reporter));
  const env = coverageEnvironment(resolve(run, "environment"), process.env);
  env.NODE_V8_COVERAGE = raw;
  // Run-local restriction: custom loader registration is outside the proven model.
  // This is not an adversarial-code sandbox; tests are reviewed repository code.
  const loaderGuard = `import module from 'node:module';
    for (const key of ['register', 'registerHooks']) {
      Object.defineProperty(module, key, {value() { throw Error('Custom loaders are unsupported by native coverage'); }, writable:false, configurable:false});
    }
    module.syncBuiltinESMExports();`;
  const args = [
    "--import=data:text/javascript," + encodeURIComponent(loaderGuard),
    "--no-experimental-strip-types",
    "--test",
    "--test-concurrency=1",
    "--test-reporter=" + reporter,
    "--test-reporter-destination=" + execution,
    ...nodeFiles,
  ];
  const child = spawnSync(process.execPath, args, {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024,
  });
  writeFileSync(
    resolve(run, "test.log"),
    (child.stdout ?? "") + (child.stderr ?? ""),
  );
  assert.equal(child.status, 0, "Native test runner failed");
  const executedNodeFiles = auditExecutedFiles(
    root,
    nodeFiles,
    read(execution),
    "node",
  );
  assert.deepStrictEqual(
    qualityToolingFiles(root),
    expectedSources,
    "Native production inventory changed",
  );
  const after = captureNativeSources(root, expectedSources);
  assert.deepStrictEqual(
    captureNativeSources(root, nodeFiles),
    testHashes,
    "Native test bytes changed",
  );
  assert.deepStrictEqual(
    after,
    before,
    "Source hash changed during native execution",
  );
  const { mergeProcessCovs } = await import("@bcoe/v8-coverage");
  const { default: convert } = await import("ast-v8-to-istanbul");
  const { parseAstAsync } = await import("vitest/node");
  const rawHashes = {},
    records = [],
    coveredEntrypoints = new Set();
  for (const filename of readdirSync(raw).sort()) {
    assert.ok(
      filename.endsWith(".json"),
      "Unexpected native coverage artifact",
    );
    const bytes = readFileSync(resolve(raw, filename));
    rawHashes[filename] = hash(bytes);
    const report = JSON.parse(bytes);
    assert.ok(Array.isArray(report.result), "Malformed native V8 result");
    assert.ok(
      !report["source-map-cache"] ||
        Object.keys(report["source-map-cache"]).length === 0,
      "Native source-map cache unsupported",
    );
    const entrypoints = nodeFiles.filter((f) =>
      report.result.some(
        (entry) => entry.url === pathToFileURL(resolve(root, f)).href,
      ),
    );
    // The test coordinator/reporter process is not a selected unit test.
    if (!entrypoints.length) continue;
    for (const entrypoint of entrypoints) coveredEntrypoints.add(entrypoint);
    const selected = [];
    for (const entry of report.result) {
      if (!entry.url.startsWith("file:")) {
        assert.ok(
          entry.url.startsWith("node:") ||
            entry.url ===
              "data:text/javascript," + encodeURIComponent(loaderGuard),
          "Unsupported generated/eval script",
        );
        continue;
      }
      const file = fileURLToPath(entry.url);
      if (!Object.hasOwn(before, file)) {
        const rel = relative(root, file).replaceAll("\\", "/");
        if (nodeFiles.includes(rel)) continue;
        if (file === reporter && hash(readFileSync(reporter)) === runtimeHash)
          continue;
        if (dependencies.permits(file)) continue;
        if (containsPath(root, file))
          throw Error("Uninventoried native project module: " + rel);
        throw Error("Unknown external native module: " + file);
      }
      assert.ok(
        file.endsWith(".mjs"),
        "Only native ESM production modules supported",
      );
      const code = readFileSync(file, "utf8");
      assert.ok(
        !/(?:\/\/[#@]|\/\*[#@])\s*source(?:Mapping)?URL\s*=/.test(code),
        "Native source-map/transform annotation unsupported",
      );
      assert.equal(
        entry.url,
        pathToFileURL(file).href,
        "Noncanonical native URL",
      );
      assert.ok(Array.isArray(entry.functions) && entry.functions.length > 0);
      for (const fn of entry.functions) {
        assert.ok(
          typeof fn.isBlockCoverage === "boolean" &&
            Array.isArray(fn.ranges) &&
            fn.ranges.length > 0,
          "Incomplete V8 function coverage",
        );
        if (!fn.isBlockCoverage)
          assert.ok(
            fn.ranges.length === 1 && fn.ranges[0].count === 0,
            "Unproven non-block coverage",
          );
        for (const r of fn.ranges)
          assert.ok(
            Number.isSafeInteger(r.startOffset) &&
              Number.isSafeInteger(r.endOffset) &&
              r.startOffset >= 0 &&
              r.endOffset <= code.length &&
              r.endOffset > r.startOffset &&
              Number.isSafeInteger(r.count) &&
              r.count >= 0,
            "Invalid native V8 range",
          );
      }
      selected.push(entry);
    }
    records.push({ result: selected });
  }
  assert.ok(records.length > 0, "Missing native raw coverage");
  assert.deepStrictEqual(
    [...coveredEntrypoints].sort(),
    [...nodeFiles].sort(),
    "Missing test-worker raw evidence",
  );
  const addition = {};
  for (const entry of mergeProcessCovs(records).result) {
    const code = readFileSync(fileURLToPath(entry.url), "utf8");
    const mapped = JSON.parse(
      JSON.stringify(
        await convert({
          code,
          ast: await parseAstAsync(code),
          wrapperLength: 0,
          coverage: entry,
        }),
      ),
    );
    Object.assign(addition, mapped);
  }
  writeFileSync(
    resolve(run, "native-map.json"),
    JSON.stringify(addition, null, 2),
  );
  const receipt = (selected, executed) => ({
    exitCode: 0,
    before,
    after,
    selected,
    executed,
  });
  const combined = mergeNativeCoverage({
    base,
    addition,
    sources: before,
    left: receipt(vitestFiles, executedVitestFiles),
    right: receipt(nodeFiles, executedNodeFiles),
  });
  assert.deepStrictEqual(
    qualityToolingFiles(root),
    expectedSources,
    "Inventory changed during mapping",
  );
  assert.deepStrictEqual(
    captureNativeSources(root, expectedSources),
    before,
    "Source bytes changed during mapping",
  );
  assert.deepStrictEqual(
    captureNativeSources(root, nodeFiles),
    testHashes,
    "Test bytes changed during mapping",
  );
  dependencies.verifyUnchanged();
  assert.equal(
    hash(readFileSync(reporter)),
    runtimeHash,
    "Reporter bytes changed",
  );
  const evidence = {
    dependencyLockHash: dependencies.lockHash,
    observedDependencies: dependencies.observed,
    reporterHash: runtimeHash,
    versions,
    loaderGuardHash: hash(loaderGuard),
    nodeVersion: process.version,
    testHashes,
    sourceHashes: before,
    rawHashes,
    runDirectory: run,
    nativeMapHash: hash(readFileSync(resolve(run, "native-map.json"))),
    executionHash: hash(readFileSync(execution)),
    vitestExecutionHash: hash(readFileSync(vitestReport)),
    baseReportHash: hash(readFileSync(baseReport)),
    executedNodeFiles,
    executedVitestFiles,
    mappedSources: Object.keys(addition),
    sourceFiles: Object.keys(combined),
  };
  const { default: coverage } = await import("istanbul-lib-coverage");
  const { default: reportLib } = await import("istanbul-lib-report");
  const { default: reports } = await import("istanbul-reports");
  const context = reportLib.createContext({
    dir: output,
    coverageMap: coverage.createCoverageMap(combined),
  });
  for (const name of ["json", "json-summary", "lcovonly"])
    reports.create(name).execute(context);
  evidence.finalReportHash = hash(
    readFileSync(resolve(output, "coverage-final.json")),
  );
  writeFileSync(
    resolve(output, "native-union-evidence.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  return evidence;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await collectNativeUnion(read(process.argv[2]));
}
