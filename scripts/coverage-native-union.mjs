import assert from "node:assert/strict";
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
    for (const key of ["statementMap", "fnMap", "branchMap"])
      equal(entry[key], base[path][key]);
    for (const key of ["s", "f", "b"])
      for (const id of Object.keys(entry[key])) {
        if (key === "b")
          result[path][key][id] = entry[key][id].map(
            (count, index) => count + base[path][key][id][index],
          );
        else result[path][key][id] = entry[key][id] + base[path][key][id];
      }
    counts(result[path]);
  }
  return result;
}
