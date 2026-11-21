import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, lstatSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { saveManifest } from './coverage-integrity.mjs';
function fixture(run) {
    const root = mkdtempSync(resolve(tmpdir(), 'manifest-custody-'));
    const output = resolve(root, 'coverage');
    mkdirSync(output);
    const final = resolve(output, 'run-web.json');
    const temporary = final + '.' + process.pid + '.tmp';
    try { run({ root, final, temporary }); }
    finally { rmSync(root, { recursive: true, force: true }); }
}
test('pre-existing temporary symlink never overwrites its outside-output sentinel', () => fixture(({ root, final, temporary }) => {
    const sentinel = resolve(root, 'sentinel');
    writeFileSync(sentinel, 'KEEP');
    symlinkSync(sentinel, temporary);
    let failure;
    try { saveManifest(root, 'web', { partition: 'web' }); } catch (error) { failure = error; }
    assert.equal(readFileSync(sentinel, 'utf8'), 'KEEP');
    assert.equal(failure?.code, 'EEXIST');
    assert.ok(lstatSync(temporary).isSymbolicLink());
    assert.equal(existsSync(final), false);
}));
test('pre-existing regular temporary file is not overwritten or removed', () => fixture(({ root, final, temporary }) => {
    writeFileSync(temporary, 'OTHER OWNER');
    assert.throws(() => saveManifest(root, 'web', {}), { code: 'EEXIST' });
    assert.equal(readFileSync(temporary, 'utf8'), 'OTHER OWNER');
    assert.equal(existsSync(final), false);
}));
test('normal repeated save preserves shape and atomically replaces previous output', () => fixture(({ root, final, temporary }) => {
    saveManifest(root, 'web', { phase: 'pending' });
    saveManifest(root, 'web', { phase: 'complete', testExitCode: 0 });
    const result = JSON.parse(readFileSync(final, 'utf8'));
    assert.deepEqual(result.partitions, [{ phase: 'complete', testExitCode: 0 }]);
    assert.ok(Number.isFinite(Date.parse(result.generatedAt)));
    assert.equal(existsSync(temporary), false);
}));
test('final symlink is replaced rather than following its target', () => fixture(({ root, final }) => {
    const sentinel = resolve(root, 'final-target');
    writeFileSync(sentinel, 'KEEP'); symlinkSync(sentinel, final);
    saveManifest(root, 'web', {});
    assert.equal(readFileSync(sentinel, 'utf8'), 'KEEP');
    assert.equal(lstatSync(final).isSymbolicLink(), false);
}));
test('rename failure retains existing destination and cleans only newly owned temporary', () => fixture(({ root, final, temporary }) => {
    mkdirSync(final); writeFileSync(resolve(final, 'sentinel'), 'KEEP');
    assert.throws(() => saveManifest(root, 'web', {}));
    assert.equal(readFileSync(resolve(final, 'sentinel'), 'utf8'), 'KEEP');
    assert.equal(existsSync(temporary), false);
}));
test('serialization failure cannot damage the previous manifest or create a temporary', () => fixture(({ root, final, temporary }) => {
    writeFileSync(final, 'PREVIOUS');
    assert.throws(() => saveManifest(root, 'web', { value: 1n }));
    assert.equal(readFileSync(final, 'utf8'), 'PREVIOUS');
    assert.equal(existsSync(temporary), false);
}));
