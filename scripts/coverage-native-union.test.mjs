import test from "node:test";
import assert from "node:assert/strict";
import { mergeNativeCoverage } from "./coverage-native-union.mjs";
const path = "/repo/source.mjs",
  unused = "/repo/unused.mjs";
const entry = (p, hits) => ({
  path: p,
  statementMap: {
    0: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
  },
  fnMap: {},
  branchMap: {
    0: {
      type: "if",
      line: 1,
      loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
      locations: [
        { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
        { start: { line: 1, column: 3 }, end: { line: 1, column: 4 } },
      ],
    },
  },
  s: { 0: 1 },
  f: {},
  b: { 0: hits },
});
function input() {
  return {
    base: {
      [path]: entry(path, [1, 0]),
      [unused]: { ...entry(unused, [0, 0]), s: { 0: 0 } },
    },
    addition: { [path]: entry(path, [0, 1]) },
    sources: { [path]: "a".repeat(64), [unused]: "b".repeat(64) },
    left: {
      exitCode: 0,
      before: { [path]: "a".repeat(64), [unused]: "b".repeat(64) },
      after: { [path]: "a".repeat(64), [unused]: "b".repeat(64) },
      selected: ["positive.test.ts"],
      executed: ["positive.test.ts"],
    },
    right: {
      exitCode: 0,
      before: { [path]: "a".repeat(64), [unused]: "b".repeat(64) },
      after: { [path]: "a".repeat(64), [unused]: "b".repeat(64) },
      selected: ["negative.test.mjs"],
      executed: ["negative.test.mjs"],
    },
  };
}
test("combines counters while preserving complete untouched denominator", () => {
  const v = input();
  const out = mergeNativeCoverage(v);
  assert.deepEqual(out[path].b[0], [1, 1]);
  assert.deepEqual(out[unused], v.base[unused]);
  assert.deepEqual(v.base[path].b[0], [1, 0]);
});
for (const [name, mutate] of Object.entries({
  "missing source": (v) => delete v.base[unused],
  "extra source": (v) =>
    (v.addition["/repo/extra.mjs"] = entry("/repo/extra.mjs", [1, 0])),
  "changed source": (v) => (v.right.after[path] = "c".repeat(64)),
  "failed runner": (v) => (v.right.exitCode = 1),
  "missing execution": (v) => (v.right.executed = []),
  "extra execution": (v) => v.left.executed.push("extra.test.ts"),
  "duplicate execution": (v) => v.left.executed.push("positive.test.ts"),
  "incompatible maps": (v) =>
    (v.addition[path].branchMap[0].type = "cond-expr"),
  "negative counts": (v) => (v.addition[path].b[0][0] = -1),
  "noninteger counts": (v) => (v.addition[path].s[0] = 0.5),
  "missing counter": (v) => delete v.addition[path].s[0],
  "extra counter": (v) => (v.addition[path].s[1] = 1),
  "wrong branch arity": (v) => v.addition[path].b[0].push(1),
  "wrong path": (v) => (v.addition[path].path = "/other.mjs"),
  "missing hash": (v) => (v.sources[path] = ""),
  overflow: (v) => {
    v.base[path].s[0] = Number.MAX_SAFE_INTEGER;
    v.addition[path].s[0] = 1;
  },
})) {
  test("rejects " + name, () => {
    const v = input();
    mutate(v);
    assert.throws(() => mergeNativeCoverage(v));
  });
}

function untouchedInput() {
  const v = input();
  v.base[path].s[0] = 0;
  v.base[path].b[0] = [0, 0];
  v.base[path].statementMap[0].start.column = 1;
  return v;
}

test("replaces only untouched transformed columns with authenticated native-source geometry", () => {
  const v = untouchedInput();
  const report = mergeNativeCoverage(v);
  assert.deepEqual(report[path], v.addition[path]);
  assert.deepEqual(report[unused], v.base[unused]);
  assert.equal(v.base[path].statementMap[0].start.column, 1);
});

for (const [label, mutate] of Object.entries({
  "any Vitest hit": (v) => { v.base[path].b[0][1] = 1; },
  "missing original column": (v) => { delete v.base[path].statementMap[0].end.column; },
  "missing original span": (v) => { delete v.base[path].statementMap[0].end; },
  "changed end-of-line sentinel": (v) => { v.base[path].statementMap[0].end.column = null; },
  "extra counter group": (v) => { v.addition[path].bT = { 0: [0, 0] }; },
  "changed original line": (v) => { v.base[path].statementMap[0].start.line = 2; },
  "changed branch shape": (v) => { v.base[path].branchMap[0].type = "cond-expr"; },
  "dropped statement denominator": (v) => {
    delete v.base[path].s[0];
    delete v.base[path].statementMap[0];
  },
  "dropped branch arm": (v) => {
    v.base[path].b[0].pop();
    v.base[path].branchMap[0].locations.pop();
  },
  "source line cardinality reduction": (v) => {
    const loc = { start: { line: 2, column: 0 }, end: { line: 2, column: 5 } };
    v.base[path].statementMap[1] = loc;
    v.base[path].s[1] = 0;
    v.addition[path].statementMap[1] = v.addition[path].statementMap[0];
    v.addition[path].s[1] = 1;
  },
  "non-native source": (v) => {
    const replacement = "/repo/source.ts";
    for (const obj of [v.base, v.addition, v.sources]) {
      obj[replacement] = obj[path];
      delete obj[path];
    }
    v.base[replacement].path = replacement;
    v.addition[replacement].path = replacement;
    for (const side of [v.left, v.right]) {
      for (const field of ["before", "after"]) {
        side[field][replacement] = side[field][path];
        delete side[field][path];
      }
    }
  },
})) {
  test("canonical replacement rejects " + label, () => {
    const v = untouchedInput();
    mutate(v);
    assert.throws(() => mergeNativeCoverage(v));
  });
}
