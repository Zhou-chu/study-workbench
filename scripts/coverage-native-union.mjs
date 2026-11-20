import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { compareCoverageKeys } from "./coverage-inventory.mjs";
const sortedKeys = (value) => Object.keys(value).sort(compareCoverageKeys);
function equal(a, b) {
  assert.deepStrictEqual(a, b);
}
function counts(entry) {
  for (const [map, key] of [
    ["statementMap", "s"],
    ["fnMap", "f"],
    ["branchMap", "b"],
  ]) {
    equal(sortedKeys(entry[map]), sortedKeys(entry[key]));
    for (const id of sortedKeys(entry[map])) {
      const values = key === "b" ? entry[key][id] : [entry[key][id]];
      assert.ok(Array.isArray(values));
      if (key === "b")
        assert.equal(values.length, entry[map][id].locations.length);
      for (const count of values)
        assert.ok(
          Number.isSafeInteger(count) && count >= 0,
          "Invalid coverage count",
        );
    }
  }
}
const maps = ["statementMap", "fnMap", "branchMap"];
const counterGroups = ["s", "f", "b"];
const mapFields = ["path", ...maps, ...counterGroups];
const hasDifferentGeometry = (native, transformed) =>
  maps.some((key) => !isDeepStrictEqual(native[key], transformed[key]));
export function nativeRebasedPaths(base, addition) {
  return Object.keys(addition).filter((path) =>
    hasDifferentGeometry(addition[path], base[path]),
  ).sort(compareCoverageKeys);
}
function requireKnownSchema(entry) {
  const fields = Object.hasOwn(entry, "meta") ? [...mapFields, "meta"] : mapFields;
  equal(sortedKeys(entry), [...fields].sort(compareCoverageKeys));
  if (Object.hasOwn(entry, "meta")) {
    equal(sortedKeys(entry.meta), ["fnNames", "lastBranch", "lastFunction", "lastStatement", "seen"]);
    for (const [last, map] of [["lastBranch", "branchMap"], ["lastFunction", "fnMap"], ["lastStatement", "statementMap"]])
      assert.equal(entry.meta[last], Object.keys(entry[map]).length);
  }
}
function requireUntouched(entry) {
  assert.ok(
    counterGroups.every((key) => Object.values(entry[key]).flat().every((count) => count === 0)),
    "Canonical baseline requires an entirely untouched file",
  );
}
function lineTopology(value) {
  if (Array.isArray(value)) return value.map(lineTopology);
  if (!value || typeof value !== "object") return value;
  if (Object.hasOwn(value, "column") ||
      (Object.hasOwn(value, "line") && Object.keys(value).length === 1)) {
    equal(sortedKeys(value), ["column", "line"]);
    assert.ok(Number.isSafeInteger(value.line) && value.line > 0);
    assert.ok(
      value.column === null ||
      (Number.isSafeInteger(value.column) && value.column >= 0),
      "Invalid source column",
    );
    return { line: value.line, endOfLine: value.column === null };
  }
  return Object.fromEntries(Object.entries(value).map(([key, row]) =>
    [key, lineTopology(row)],
  ));
}
function receipt(value, sources) {
  assert.equal(value.exitCode, 0);
  equal(value.before, sources);
  equal(value.after, sources);
  for (const files of [value.selected, value.executed]) {
    assert.ok(Array.isArray(files));
    assert.ok(files.every((f) => typeof f === "string" && f.length > 0));
    assert.equal(new Set(files).size, files.length);
  }
  equal([...value.selected].sort(compareCoverageKeys), [...value.executed].sort(compareCoverageKeys));
}
/** Pure arithmetic guard, not a trust boundary. The collector must verify receipts,
 * source bytes, native-ESM provenance, mapper versions and execution reports. */
export function mergeNativeCoverage({ base, addition, sources, left, right }) {
  assert.ok(sources && Object.keys(sources).length > 0);
  for (const hash of Object.values(sources))
    assert.match(hash, /^[a-f0-9]{64}$/);
  receipt(left, sources);
  receipt(right, sources);
  equal(sortedKeys(base), sortedKeys(sources));
  const result = structuredClone(base);
  for (const [path, entry] of Object.entries(base)) {
    assert.equal(entry.path, path);
    counts(entry);
  }
  for (const [path, entry] of Object.entries(addition)) {
    assert.ok(Object.hasOwn(base, path), "Unexpected source");
    assert.equal(entry.path, path);
    counts(entry);
    const baseline = base[path];
    if (hasDifferentGeometry(entry, baseline)) {
      // Never move or reinterpret a Vitest hit. The collector mapped actual,
      // verified V8 ranges against the hashed original native source. For an
      // entirely untouched Vitest file, take that native geometry wholesale
      // only when every counter ID, line bound and non-column map field agrees.
      assert.ok(path.endsWith(".mjs"), "Canonical baseline is native ESM only");
      equal(sortedKeys(entry), sortedKeys(baseline));
      requireKnownSchema(entry);
      requireKnownSchema(baseline);
      requireUntouched(baseline);
      for (const key of maps) {
        equal(lineTopology(entry[key]), lineTopology(baseline[key]));
      }
      result[path] = structuredClone(entry);
      continue;
    }
    for (const key of counterGroups)
      for (const id of Object.keys(entry[key])) {
        if (key === "b")
          result[path][key][id] = entry[key][id].map(
            (count, index) => count + baseline[key][id][index],
          );
        else result[path][key][id] = entry[key][id] + baseline[key][id];
      }
    counts(result[path]);
  }
  return result;
}
