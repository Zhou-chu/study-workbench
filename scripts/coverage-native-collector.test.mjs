import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  captureNativeSources,
  collectNativeUnion,
} from "./coverage-native-collector.mjs";
const repo = resolve(import.meta.dirname, "..");
async function fixture(change, useCli = false, emptyVitest = false) {
  const root = mkdtempSync(resolve(tmpdir(), "native-union-"));
  try {
    mkdirSync(resolve(root, "scripts"));
    mkdirSync(resolve(root, "tests"));
    writeFileSync(
      resolve(root, "scripts/coverage-branch.mjs"),
      "export function choose(flag) { if(flag) { return positive(); } else { return negative(); } }\nfunction positive() { return 1; }\nfunction negative() { return 2; }\n",
    );
    writeFileSync(
      resolve(root, "scripts/coverage-untouched.mjs"),
      "export function unused() { return 3; }\n",
    );
    writeFileSync(
      resolve(root, "tests/positive.test.mjs"),
      "import {test,expect} from '" +
        repo +
        "/node_modules/vitest/dist/index.js'; import {choose} from '../scripts/coverage-branch.mjs'; test('positive',()=>expect(choose(true)).toBe(1));",
    );
    writeFileSync(
      resolve(root, "tests/negative.test.mjs"),
      "import test from 'node:test'; import assert from 'node:assert/strict'; import {choose} from '../scripts/coverage-branch.mjs'; test('negative',()=>assert.equal(choose(false),2));",
    );
    writeFileSync(
      resolve(root, "config.mjs"),
      `export default {root:${JSON.stringify(root)},test:{include:${JSON.stringify(emptyVitest ? [] : ["tests/positive.test.mjs"])},passWithNoTests:true,reporters:['json'],outputFile:'vitest-tests.json',coverage:{enabled:true,provider:'v8',include:['scripts/coverage-*.mjs'],exclude:[],reportsDirectory:'base',reporter:['json']}}};`,
    );
    const sourcePaths = [
      "scripts/coverage-branch.mjs",
      "scripts/coverage-untouched.mjs",
    ];
    const snapshot = captureNativeSources(root, sourcePaths);
    const r = spawnSync(
      process.execPath,
      [
        resolve(repo, "node_modules/vitest/vitest.mjs"),
        "run",
        "--config",
        resolve(root, "config.mjs"),
        "--maxWorkers=1",
      ],
      { cwd: repo, encoding: "utf8", timeout: 30000 },
    );
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const args = {
      root,
      sourcePaths,
      snapshot,
      vitestFiles: emptyVitest ? [] : ["tests/positive.test.mjs"],
      nodeFiles: ["tests/negative.test.mjs"],
      vitestReport: resolve(root, "vitest-tests.json"),
      baseReport: resolve(root, "base/coverage-final.json"),
      output: resolve(root, "union"),
    };
    if (change) change(args);
    let result;
    if (useCli) {
      const request = resolve(root, "request.json");
      writeFileSync(request, JSON.stringify(args));
      const execution = spawnSync(
        process.execPath,
        [resolve(repo, "scripts/coverage-native-collector.mjs"), request],
        { cwd: root, encoding: "utf8", timeout: 30000 },
      );
      assert.equal(execution.status, 0, execution.stdout + execution.stderr);
      result = JSON.parse(
        readFileSync(resolve(root, "union/native-union-evidence.json"), "utf8"),
      );
    } else {
      result = await collectNativeUnion(args);
    }
    return {
      result,
      baseMap: JSON.parse(
        readFileSync(resolve(result.runDirectory, "vitest-base.json"), "utf8"),
      ),
      nodeMap: JSON.parse(
        readFileSync(resolve(result.runDirectory, "native-map.json"), "utf8"),
      ),
      map: JSON.parse(
        readFileSync(resolve(root, "union/coverage-final.json"), "utf8"),
      ),
      root,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
test("real native ESM execution joins opposite branches and retains untouched source", async () => {
  const { result, map, root, baseMap, nodeMap } = await fixture(
    undefined,
    true,
  );
  const source = resolve(root, "scripts/coverage-branch.mjs");
  for (const single of [baseMap[source], nodeMap[source]]) {
    assert.ok(
      Object.values(single.b)
        .flat()
        .some((n) => n === 0),
    );
    assert.ok(Object.values(single.f).some((n) => n === 0));
  }
  assert.deepEqual(result.executedNodeFiles, ["tests/negative.test.mjs"]);
  assert.equal(Object.keys(map).length, 2);
  assert.ok(
    Object.values(map[resolve(root, "scripts/coverage-branch.mjs")].b)
      .flat()
      .every((n) => n > 0),
  );
  assert.ok(
    Object.values(map[resolve(root, "scripts/coverage-branch.mjs")].f).every(
      (n) => n > 0,
    ),
  );
  assert.ok(
    Object.values(map[resolve(root, "scripts/coverage-untouched.mjs")].s).every(
      (n) => n === 0,
    ),
  );
});
test("source changes after Vitest are rejected before native execution", async () => {
  await assert.rejects(
    fixture((a) =>
      writeFileSync(
        resolve(a.root, "scripts/coverage-branch.mjs"),
        "export const changed=true;",
      ),
    ),
    /source|hash/i,
  );
});
test("native source-map annotations fail closed", async () => {
  await assert.rejects(
    fixture((a) => {
      const f = resolve(a.root, "scripts/coverage-branch.mjs");
      writeFileSync(
        f,
        readFileSync(f, "utf8") + "\n//# sourceMappingURL=other.map",
      );
      a.snapshot = captureNativeSources(a.root, a.sourcePaths);
    }),
    /source.map|transform/i,
  );
});

test("failed native assertions cannot publish a union", async () => {
  await assert.rejects(
    fixture((a) =>
      writeFileSync(
        resolve(a.root, "tests/negative.test.mjs"),
        "import test from 'node:test'; test('fails',()=>{throw Error('expected')});",
      ),
    ),
    /runner failed/,
  );
});
test("missing actual Vitest execution file is rejected", async () => {
  await assert.rejects(
    fixture((a) => (a.vitestFiles = ["tests/not-executed.test.mjs"])),
    /Executed files/,
  );
});
test("incompatible persisted maps are rejected", async () => {
  await assert.rejects(
    fixture((a) => {
      const base = JSON.parse(readFileSync(a.baseReport, "utf8"));
      const f = resolve(a.root, "scripts/coverage-branch.mjs");
      base[f].fnMap[0].name = "different";
      writeFileSync(a.baseReport, JSON.stringify(base));
    }),
  );
});
test("native imports outside the production denominator are rejected", async () => {
  await assert.rejects(
    fixture((a) => {
      writeFileSync(
        resolve(a.root, "scripts/extra.mjs"),
        "export const value=1;",
      );
      writeFileSync(
        resolve(a.root, "tests/negative.test.mjs"),
        "import '../scripts/extra.mjs'; import test from 'node:test'; test('extra',()=>{});",
      );
    }),
    /Uninventoried/,
  );
});
test("TypeScript production executes no implicit strip-types fallback", async () => {
  await assert.rejects(
    fixture((a) => {
      writeFileSync(
        resolve(a.root, "scripts/extra.ts"),
        "export const value: number=1;",
      );
      writeFileSync(
        resolve(a.root, "tests/negative.test.mjs"),
        "import '../scripts/extra.ts'; import test from 'node:test'; test('typescript',()=>{});",
      );
    }),
    /runner failed/,
  );
});

test("caller cannot omit an untested production source", async () => {
  await assert.rejects(
    fixture((a) => (a.sourcePaths = a.sourcePaths.slice(0, 1))),
    /inventory/,
  );
});
test("CJS production is not silently accepted as native ESM", async () => {
  await assert.rejects(
    fixture((a) => {
      writeFileSync(resolve(a.root, "scripts/extra.cjs"), "module.exports=1;");
      writeFileSync(
        resolve(a.root, "tests/negative.test.mjs"),
        "import '../scripts/extra.cjs'; import test from 'node:test'; test('cjs',()=>{});",
      );
    }),
    /Uninventoried|native ESM/,
  );
});

test("custom loader registration is blocked before transformed execution", async () => {
  await assert.rejects(
    fixture((a) => {
      writeFileSync(
        resolve(a.root, "tests/negative.test.mjs"),
        "import {registerHooks} from 'node:module'; registerHooks({load(url,ctx,next){return next(url,ctx)}}); import test from 'node:test'; test('loader',()=>{});",
      );
    }),
    /runner failed/,
  );
});

test("generated eval scripts fail closed rather than claiming native mapping", async () => {
  await assert.rejects(
    fixture((a) => {
      writeFileSync(
        resolve(a.root, "tests/negative.test.mjs"),
        "import test from 'node:test'; test('eval',()=>{eval('1+2')});",
      );
    }),
    /generated\/eval/,
  );
});

test("empty Vitest selection retains its real full zero denominator before native union", async () => {
  const { result, baseMap, map, root } = await fixture(undefined, true, true);
  assert.deepEqual(result.executedVitestFiles, []);
  assert.equal(Object.keys(baseMap).length, 2);
  for (const entry of Object.values(baseMap)) {
    assert.ok(Object.values(entry.s).every((n) => n === 0));
    assert.ok(Object.values(entry.f).every((n) => n === 0));
  }
  assert.equal(Object.keys(map).length, 2);
  assert.ok(
    Object.values(map[resolve(root, "scripts/coverage-branch.mjs")].b)
      .flat()
      .some((n) => n > 0),
  );
  assert.ok(
    Object.values(map[resolve(root, "scripts/coverage-branch.mjs")].b)
      .flat()
      .some((n) => n === 0),
  );
  assert.ok(
    Object.values(map[resolve(root, "scripts/coverage-untouched.mjs")].s).every(
      (n) => n === 0,
    ),
  );
});

test("actual native source mutation invalidates collection", async () => {
  await assert.rejects(
    fixture((a) => {
      writeFileSync(
        resolve(a.root, "tests/negative.test.mjs"),
        "import test from 'node:test'; import {appendFileSync} from 'node:fs'; import {choose} from '../scripts/coverage-branch.mjs'; test('mutates source',()=>{choose(false);appendFileSync(new URL('../scripts/coverage-branch.mjs',import.meta.url),'\\n// mutation');});",
      );
    }),
    /Source hash changed during native/,
  );
});
test("actual native test mutation invalidates execution evidence", async () => {
  await assert.rejects(
    fixture((a) => {
      writeFileSync(
        resolve(a.root, "tests/negative.test.mjs"),
        "import test from 'node:test'; import {appendFileSync} from 'node:fs'; test('mutates test',()=>{appendFileSync(new URL(import.meta.url),'\\n// mutation');});",
      );
    }),
    /test bytes changed/,
  );
});

test("ordinary outside-repository file imports are rejected", async () => {
  const outside = mkdtempSync(resolve(tmpdir(), "unreviewed-native-"));
  try {
    const module = resolve(outside, "external.mjs");
    writeFileSync(module, "export const value = 7;");
    await assert.rejects(
      fixture((a) => {
        writeFileSync(
          resolve(a.root, "tests/negative.test.mjs"),
          `import {value} from ${JSON.stringify(module)}; import test from 'node:test'; import assert from 'node:assert/strict'; test('outside',()=>assert.equal(value,7));`,
        );
      }),
      /Unknown external native module/,
    );
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test("an unrelated node_modules path is not a dependency allowlist", async () => {
  const outside = mkdtempSync(resolve(tmpdir(), "unreviewed-dependency-"));
  try {
    const directory = resolve(outside, "node_modules/fake-package");
    mkdirSync(directory, { recursive: true });
    const module = resolve(directory, "index.mjs");
    writeFileSync(module, "export const value = 7;");
    await assert.rejects(
      fixture((a) => {
        writeFileSync(
          resolve(a.root, "tests/negative.test.mjs"),
          `import {value} from ${JSON.stringify(module)}; import test from 'node:test'; import assert from 'node:assert/strict'; test('fake dependency',()=>assert.equal(value,7));`,
        );
      }),
      /Unknown external native module/,
    );
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});
test("locked installed dependencies work through the actual node_modules root symlink", async () => {
  const { result } = await fixture((a) => {
    const dependency = resolve(
      repo,
      "node_modules/istanbul-lib-coverage/index.js",
    );
    writeFileSync(
      resolve(a.root, "tests/negative.test.mjs"),
      `import coverage from ${JSON.stringify(dependency)}; import test from 'node:test'; import assert from 'node:assert/strict'; test('real dependency',()=>assert.equal(coverage.createCoverageMap({}).files().length,0));`,
    );
  });
  const rows = Object.values(result.observedDependencies);
  assert.ok(rows.length > 0);
  assert.ok(
    rows.every(
      (row) =>
        row.package === "istanbul-lib-coverage" && row.version === "3.2.2",
    ),
  );
});
