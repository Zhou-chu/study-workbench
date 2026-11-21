import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
const repo = resolve(import.meta.dirname, "..");
const python = process.env.NOTEBOOK_TEST_PYTHON;
const cache = process.env.NOTEBOOK_TEST_TOKEN_CACHE;
assert.ok(
  python && cache,
  "Explicit prepared Python and existing token cache required",
);
function fixture(body, empty = false) {
  const root = mkdtempSync(resolve(tmpdir(), "python-unit-fixture-"));
  try {
    for (const dir of [
      "scripts/quality",
      "open_notebook",
      "tests",
      "api",
      "coverage/unit/python",
    ])
      mkdirSync(resolve(root, dir), { recursive: true });
    copyFileSync(
      resolve(repo, "scripts/offline_pytest.py"),
      resolve(root, "scripts/offline_pytest.py"),
    );
    copyFileSync(
      resolve(repo, "scripts/quality/unit_pytest_evidence.py"),
      resolve(root, "scripts/quality/unit_pytest_evidence.py"),
    );
    writeFileSync(resolve(root, "open_notebook/__init__.py"), "");
    writeFileSync(
      resolve(root, "api/untouched.py"),
      "def untouched():\n    return 7\n",
    );
    writeFileSync(resolve(root, "tests/test_selected.py"), body);
    writeFileSync(
      resolve(root, "tests/test_forbidden.py"),
      "raise RuntimeError('MUST NOT COLLECT')\n",
    );
    const out = resolve(root, "coverage/unit/python"),
      config = resolve(out, "coverage.ini"),
      evidence = resolve(out, "execution.json");
    writeFileSync(
      config,
      `[run]\nbranch=True\nsource=${root}\nrelative_files=True\ndata_file=${out}/.coverage\nomit=tests/*\n[report]\ninclude_namespace_packages=True\ninclude=api/*\nfail_under=90.01\nprecision=2\n`,
    );
    let args;
    if (empty) {
      const request = resolve(out, "request.json");
      writeFileSync(request, JSON.stringify({ config, output: out, cache }));
      args = [
        "-I",
        resolve(root, "scripts/quality/unit_pytest_evidence.py"),
        "--empty",
        request,
      ];
    } else
      args = [
        "-I",
        resolve(root, "scripts/offline_pytest.py"),
        "--tiktoken-cache",
        cache,
        "--",
        "tests/test_selected.py",
        "-p",
        "scripts.quality.unit_pytest_evidence",
        "--unit-evidence=" + evidence,
        "--cov",
        "--cov-config=" + config,
        "--cov-report=json:" + out + "/coverage.json",
        "--cov-report=xml:" + out + "/coverage.xml",
        "-o",
        "addopts=",
      ];
    const r = spawnSync(python, args, {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
      env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
    });
    assert.ok(
      existsSync(evidence),
      "Native execution evidence was not produced: " + r.stdout + r.stderr,
    );
    return {
      status: r.status,
      log: r.stdout + r.stderr,
      evidence: JSON.parse(readFileSync(evidence, "utf8")),
      coverage: existsSync(resolve(out, "coverage.json"))
        ? JSON.parse(readFileSync(resolve(out, "coverage.json"), "utf8"))
        : null,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
test("offline native collection proves exact file and complete uncovered source zero", () => {
  const r = fixture("def test_pass():\n    assert 1 + 1 == 2\n");
  assert.equal(r.status, 1, r.log); // native coverage threshold failure, not a fake pass
  assert.equal(r.evidence.collected.length, 1);
  assert.equal(r.evidence.collected[0].file, "tests/test_selected.py");
  assert.equal(
    r.evidence.reports.filter(
      (v) => v.when === "call" && v.outcome === "passed",
    ).length,
    1,
  );
  assert.equal(r.coverage.files["api/untouched.py"].summary.covered_lines, 0);
  assert.ok(r.coverage.files["api/untouched.py"].summary.num_statements > 0);
});
test("empty partition uses real coverage zero without pytest discovery", () => {
  const r = fixture("raise RuntimeError('MUST NOT COLLECT')\n", true);
  assert.equal(r.status, 2, r.log);
  assert.equal(r.evidence.mode, "empty");
  assert.deepEqual(r.evidence.collected, []);
  assert.equal(r.evidence.sessionExitCode, null);
  assert.equal(r.coverage.files["api/untouched.py"].summary.covered_lines, 0);
});
test("native failure and skip records are retained", () => {
  const r = fixture(
    "import pytest\ndef test_fail():\n    assert False\n@pytest.mark.skip(reason='fixture')\ndef test_skip():\n    pass\n",
  );
  assert.equal(r.status, 1, r.log);
  assert.ok(r.evidence.reports.some((v) => v.outcome === "failed"));
  assert.ok(r.evidence.reports.some((v) => v.outcome === "skipped"));
});

test("validated same-checkout artifact drives Python offline runner and rejects stale inputs", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "python-unit-artifact-"));
  const put = (file, bytes) => {
    mkdirSync(resolve(root, file, ".."), { recursive: true });
    writeFileSync(resolve(root, file), bytes);
  };
  try {
    for (const file of readdirSync(resolve(repo, "scripts")).filter(
      (f) => /^coverage-.*\.mjs$/.test(f) && !f.endsWith(".test.mjs"),
    ))
      put("scripts/" + file, readFileSync(resolve(repo, "scripts", file)));
    for (const file of [
      "scripts/quality/test_layers.py",
      "scripts/quality/unit_pytest_evidence.py",
      "scripts/quality/coverage-python.ini",
      "scripts/offline_pytest.py",
    ])
      put(file, readFileSync(resolve(repo, file)));
    put("open_notebook/__init__.py", "");
    put("api/untouched.py", "def untouched():\n    return 7\n");
    const filename = "tests/test_selected.py",
      body = "def test_pass():\n    assert 1 + 1 == 2\n";
    put(filename, body);
    put("package.json", '{"type":"module"}');
    put(".gitignore", "coverage/\n__pycache__/\n*.pyc\n");
    put(
      "scripts/quality/test-layers.json",
      JSON.stringify({
        version: 1,
        entries: [
          {
            path: filename,
            layer: "unit",
            targets: ["api/untouched.py"],
            reason: "Synthetic fixture only.",
            sha256: createHash("sha256").update(body).digest("hex"),
          },
        ],
      }),
    );
    const git = (...args) => {
      const r = spawnSync("/usr/bin/git", args, {
        cwd: root,
        encoding: "utf8",
      });
      assert.equal(r.status, 0, r.stderr);
    };
    git("init");
    git("add", ".");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-m",
      "fixture",
    );
    const selector = await import(
      pathToFileURL(resolve(root, "scripts/coverage-unit-selection.mjs")).href
    );
    const artifact = selector.createUnitSelection(root);
    put("coverage/selection.json", JSON.stringify(artifact));
    put("coverage/python-mixed-marker", "untouched");
    const args = [
      resolve(root, "scripts/coverage-python-unit.mjs"),
      "--unit-selection=" + resolve(root, "coverage/selection.json"),
      "--python=" + python,
      "--tiktoken-cache=" + cache,
      "--parent-attempt=11111111-1111-4111-8111-111111111111",
    ];
    const r = spawnSync(process.execPath, args, {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
    });
    const manifest = resolve(root, "coverage/unit/run-python.json");
    assert.ok(
      existsSync(manifest),
      "Trusted Python manifest missing: " + r.stdout + r.stderr,
    );
    const row = JSON.parse(readFileSync(manifest, "utf8")).partitions[0];
    assert.equal(row.testExitCode, 1);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.equal(row.parentRunId, "11111111-1111-4111-8111-111111111111");
    assert.equal(row.layer, "unit");
    assert.deepEqual(row.executedTestFiles, [filename]);
    assert.deepEqual(row.audit.missing, []);
    assert.deepEqual(row.audit.unexpected, []);
    assert.equal(row.sourceChangedDuringRun, false);
    assert.equal(row.inputChangedDuringRun, false);
    assert.equal(
      readFileSync(resolve(root, "coverage/python-mixed-marker"), "utf8"),
      "untouched",
    );
    put("coverage/invalid-selection.json", JSON.stringify({}));
    const oldManifest = readFileSync(manifest, "utf8");
    for (const invalidArgs of [
      args.map((value) =>
        value.startsWith("--unit-selection=")
          ? "--unit-selection=" +
            resolve(root, "coverage/absent-selection.json")
          : value,
      ),
      args.map((value) =>
        value.startsWith("--unit-selection=")
          ? "--unit-selection=" +
            resolve(root, "coverage/invalid-selection.json")
          : value,
      ),
      [...args, "--unsupported-option=true"],
    ]) {
      writeFileSync(manifest, oldManifest);
      const rejected = spawnSync(process.execPath, invalidArgs, {
        cwd: root,
        encoding: "utf8",
        timeout: 10000,
      });
      assert.notEqual(rejected.status, 0);
      const current = JSON.parse(readFileSync(manifest, "utf8")).partitions[0];
      assert.equal(
        current.phase,
        "failed",
        "rejected selection/options must invalidate prior complete measurement",
      );
      assert.equal(typeof current.runId, "string");
      assert.notEqual(current.runId, row.runId);
      assert.equal(current.nativeExitCode, null);
    }
    const foreignRoot = resolve(root, "foreign");
    mkdirSync(foreignRoot);
    const entry = pathToFileURL(
      resolve(root, "scripts/coverage-python-unit.mjs"),
    ).href;
    const wrongRoot = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import {runPythonUnit} from ${JSON.stringify(entry)}; process.exitCode=runPythonUnit(${JSON.stringify(foreignRoot)},${JSON.stringify(args.slice(1))});`,
      ],
      { cwd: root, encoding: "utf8", timeout: 10000 },
    );
    assert.notEqual(wrongRoot.status, 0);
    assert.equal(
      existsSync(resolve(foreignRoot, "coverage")),
      false,
      "untrusted root must not receive output",
    );
    assert.equal(
      JSON.parse(readFileSync(manifest, "utf8")).partitions[0].phase,
      "failed",
    );
    const badInterpreter = spawnSync(
      process.execPath,
      args.map((value) =>
        value.startsWith("--python=")
          ? "--python=" + resolve(root, "missing-python")
          : value,
      ),
      { cwd: root, encoding: "utf8", timeout: 10000 },
    );
    assert.notEqual(badInterpreter.status, 0);
    const failedStartup = JSON.parse(readFileSync(manifest, "utf8"))
      .partitions[0];
    assert.equal(
      failedStartup.phase,
      "failed",
      "failed startup must invalidate prior complete measurement",
    );
    assert.equal(failedStartup.testExitCode, null);
    const jsFile = "scripts/example.test.mjs",
      jsBody =
        "import test from 'node:test';import assert from 'node:assert/strict';import {add} from './coverage-example.mjs';test('add',()=>assert.equal(add(1,1),2));";
    put("scripts/coverage-example.mjs", "export const add=(a,b)=>a+b;");
    put(jsFile, jsBody);
    put(
      "scripts/quality/test-layers.json",
      JSON.stringify({
        version: 1,
        entries: [
          {
            path: filename,
            layer: "tool-integration",
            targets: ["api/untouched.py"],
            reason: "Not selected for this empty-partition fixture.",
            sha256: createHash("sha256").update(body).digest("hex"),
          },
          {
            path: jsFile,
            layer: "unit",
            targets: ["scripts/coverage-example.mjs"],
            reason: "Direct pure addition unit.",
            sha256: createHash("sha256").update(jsBody).digest("hex"),
          },
        ],
      }),
    );
    git("add", ".");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-m",
      "explicit empty Python partition",
    );
    put(
      "coverage/selection.json",
      JSON.stringify(selector.createUnitSelection(root)),
    );
    const zero = spawnSync(process.execPath, args, {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
    });
    const zeroRow = JSON.parse(readFileSync(manifest, "utf8")).partitions[0];
    assert.equal(zero.status, 2, zero.stdout + zero.stderr);
    assert.equal(zeroRow.testExitCode, null);
    assert.equal(zeroRow.nativeExitCode, 2);
    assert.deepEqual(zeroRow.executedTestFiles, []);
    assert.equal(zeroRow.coverage.covered_lines, 0);
    assert.deepEqual(zeroRow.audit.missing, []);
    assert.deepEqual(zeroRow.audit.unexpected, []);
    assert.equal(
      zeroRow.audit.expectedSourceFiles,
      row.audit.expectedSourceFiles,
    );
    const deleteBody =
      "from pathlib import Path\ndef test_delete_source():\n    Path('api/untouched.py').unlink()\n";
    put(filename, deleteBody);
    const reviewed = JSON.parse(
      readFileSync(resolve(root, "scripts/quality/test-layers.json"), "utf8"),
    );
    reviewed.entries[0].layer = "unit";
    reviewed.entries[0].sha256 = createHash("sha256")
      .update(deleteBody)
      .digest("hex");
    put("scripts/quality/test-layers.json", JSON.stringify(reviewed));
    git("add", ".");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-m",
      "source custody fixture",
    );
    put(
      "coverage/selection.json",
      JSON.stringify(selector.createUnitSelection(root)),
    );
    const changed = spawnSync(process.execPath, args, {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
    });
    const changedRow = JSON.parse(readFileSync(manifest, "utf8")).partitions[0];
    assert.notEqual(changed.status, 0);
    assert.equal(changedRow.phase, "failed");
    assert.equal(
      typeof changedRow.nativeExitCode,
      "number",
      "post-run failure must retain actual child exit",
    );
    assert.equal(typeof changedRow.runDirectory, "string");
    put(filename, body + "# stale classification\n");
    const bad = spawnSync(process.execPath, args, {
      cwd: root,
      encoding: "utf8",
      timeout: 10000,
    });
    assert.notEqual(bad.status, 0);
    assert.match(bad.stdout + bad.stderr, /clean|changed|digest/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("native collection errors remain explicit evidence", () => {
  const r = fixture("raise RuntimeError('expected collection failure')\n");
  assert.notEqual(r.status, 0, r.log);
  assert.ok(r.evidence.collectionFailures.length > 0);
  assert.deepEqual(r.evidence.collected, []);
  assert.equal(r.coverage, null);
});
