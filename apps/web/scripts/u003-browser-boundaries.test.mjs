import assert from 'node:assert/strict';
import { test } from 'node:test';
import { browserBoundaries, sourceReceipt } from '../../../scripts/tests/browser/u003/browser-setup.mjs';

test('browser origin confinement rejects unsafe or shared ports and bypass targets', () => {
  const allows = browserBoundaries('http://127.0.0.1:12000', 'http://127.0.0.1:12001');
  for (const url of ['http://127.0.0.1:12000/api', 'blob:http://127.0.0.1:12000/read'])
    assert.equal(allows(url), true);
  for (const url of ['https://example.test/', 'http://127.0.0.1:12001/api/tags', 'file:///output'])
    assert.equal(allows(url), false);
  assert.throws(() => browserBoundaries('http://127.0.0.1:12000', 'http://127.0.0.1:12000'));
  assert.throws(() => browserBoundaries('http://localhost:12000', 'http://127.0.0.1:12001'));
});

test('source evidence requires independently ready selected versions with originals', () => {
  const version = key => ({ source_version_id: key, status: 'ready', original_status: 'available' });
  const a = { title: 'fixture_a.pdf', versions: [version('a')] };
  const b = { title: 'fixture_b.pdf', versions: [version('b')] };
  assert.deepEqual(sourceReceipt({ sources: [b, a] }), { a: 'a', b: 'b' });
  assert.equal(sourceReceipt({ sources: [a] }), null);
  assert.equal(sourceReceipt({ sources: [a, { ...b, versions: [{ ...version('b'), status: 'extracting' }] }] }), null);
  assert.equal(sourceReceipt({ sources: [a, { ...b, versions: [version('a')] }] }), null);
});
