import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { browserBoundaries, sourceReceipt } from './browser-setup.mjs';
import { createFixtureGateway, routeTarget, servingInventory } from './gateway.mjs';

const slot = 'fixture-release-01';
const release = '_spa/releases/' + slot + '/';
const app = 'assets/index-abcdefgh.js';
const pdf = 'pdfjs/6.4.299/pdf.worker.min.mjs';
const sha = s => createHash('sha256').update(s).digest('hex');
const row = (path, value) => ({ path, size: Buffer.byteLength(value), sha256: sha(value) });
const target = {
  releaseSlot: slot, manifest: row('spa-artifact-manifest.json', '{}'),
  staticFiles: [row('index.html', '<html/>'), row(app, 'app'), row(pdf, 'worker'),
    row('unexposed.txt', 'not registered')],
};

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

test('owned gateway serves verified bytes and preserves BFF request path/body without fabricating API', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nb-u003-gateway-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const [name, content] of [
    ['index.html', '<html/>'], [release + app, 'app'], [pdf, 'worker'],
    ['unexposed.txt', 'not registered'],
  ]) {
    const file = path.join(dir, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  const calls = [];
  const gateway = createFixtureGateway({ target, gateway: dir, adapter: async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    calls.push({ method: req.method, path: req.url, body });
    res.writeHead(409, { 'Content-Type': 'application/json' });
    res.end('{"origin":"test-adapter"}');
  } });
  gateway.listen(0, '127.0.0.1');
  await once(gateway, 'listening');
  t.after(() => new Promise((resolve, reject) => gateway.close(err => err ? reject(err) : resolve())));
  const origin = 'http://127.0.0.1:' + gateway.address().port;
  assert.equal(await (await fetch(origin + '/notebooks/notebook%3Aexample')).text(), '<html/>');
  assert.equal(await (await fetch(origin + '/' + release + app)).text(), 'app');
  const worker = await fetch(origin + '/' + pdf);
  assert.equal(worker.headers.get('content-type'), 'application/javascript');
  assert.equal(await worker.text(), 'worker');
  assert.equal((await fetch(origin + '/unexposed.txt')).status, 404);
  const api = await fetch(origin + '/api/credentials/credential%3Afixture/discover?mode=x%20a', { method: 'POST', body: 'wire-request' });
  assert.equal(api.status, 409);
  assert.deepEqual(await api.json(), { origin: 'test-adapter' });
  assert.deepEqual(calls, [{ method: 'POST', path: '/api/credentials/credential%3Afixture/discover?mode=x%20a', body: 'wire-request' }]);
  await writeFile(path.join(dir, pdf), 'wrong!');
  assert.equal((await fetch(origin + '/' + pdf)).status, 500);
  assert.equal(routeTarget('/api%20/credentials', servingInventory(target)), null);
});
