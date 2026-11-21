import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { inspectOrigin } from '../../../scripts/tests/browser/u003/release-preflight.mjs';

const head = 'a'.repeat(40);
const slot = 'artifact-fixture-01';
const asset = 'assets/index-BswPFGz0.js';
const pdf = 'pdfjs/6.4.299/pdf.worker.min.mjs';
const manifest = JSON.stringify({ source_commit: head });
const index = '<!DOCTYPE html><html></html>';
function entry(path, body) {
  return { path, size: Buffer.byteLength(body), sha256: createHash('sha256').update(body).digest('hex') };
}

function fixture({ replace = {}, bodies = {} } = {}) {
  const release = '/_spa/releases/' + slot + '/';
  const responses = new Map([
    ['/notebooks', () => new Response(index, { headers: { 'content-type': 'text/html' } })],
    [release + asset, () => new Response('binary js', { headers: { 'content-type': 'text/javascript' } })],
    [release + 'spa-artifact-manifest.json', () => new Response(manifest, { headers: { 'content-type': 'application/json' } })],
    ['/' + pdf, () => new Response('worker js', { headers: { 'content-type': 'application/javascript' } })],
    ['/config', () => Response.json({ apiUrl: '', auth_mode: 'legacy_password', client_contracts: ['workspace-view-v1'], web_session_protocol: null, ui_transport_protocol: 1 })],
    ['/api/auth/status', () => Response.json({ auth_enabled: true, message: 'Authentication enabled' })],
    ['/api/models/defaults', options => options.headers?.authorization
      ? Response.json({ default_chat_model: '', ...bodies.defaults })
      : Response.json({}, { status: 401 })],
    ['/api/credentials/status', () => Response.json({ encryption_configured: true, ...bodies.credentials })],
  ]);
  const target = { releaseSlot: slot, sourceCommit: head, manifest: entry('spa-artifact-manifest.json', manifest), staticFiles: [entry('index.html', index), entry(asset, 'binary js'), entry(pdf, 'worker js')] };
  const origin = 'http://127.0.0.1:41017';
  return { origin, target, call: (url, options) => {
    assert.equal(url.origin, origin);
    assert.equal(options.redirect, 'error');
    const impl = replace[url.pathname] ?? responses.get(url.pathname);
    assert.ok(impl, 'unexpected preflight route');
    return impl(options);
  } };
}

test('serves exact static artifacts and an authenticated fresh runtime with inactive default', async () => {
  const { origin, target, call } = fixture();
  assert.deepEqual(await inspectOrigin({ origin, target, password: 'disposable-test', call }), {
    sourceCommit: head, releaseSlot: slot, staticProbes: 4, authenticationEnabled: true, encryptionConfigured: true, defaultUnassigned: true,
  });
});

test('rejects changed static bytes and incorrect browser JS MIME type', async () => {
  const p = '/' + pdf;
  for (const [text, type] of [['another payload', 'application/javascript'], ['worker js', 'text/html']]) {
    const { origin, target, call } = fixture({ replace: { [p]: () => new Response(text, { headers: { 'content-type': type } }) } });
    await assert.rejects(inspectOrigin({ origin, target, password: 'fixture', call }), /PDF worker/);
  }
});

test('rejects an already configured runtime and unusable encryption', async () => {
  for (const bodies of [{ defaults: { default_chat_model: 'model:already' } }, { credentials: { encryption_configured: false } }]) {
    const { origin, target, call } = fixture({ bodies });
    await assert.rejects(inspectOrigin({ origin, target, password: 'fixture', call }), /fresh unassigned|encryption/);
  }
});

test('rejects nonloopback, proxy redirects, or unprotected settings before any credential use', async () => {
  const { origin, target, call } = fixture({
    replace: { '/api/models/defaults': options => (() => {
      assert.equal(options.headers?.authorization, undefined);
      return Response.json({ default_chat_model: '' });
    })() },
  });
  await assert.rejects(inspectOrigin({ origin: 'https://example.test', target, password: 'fixture', call }), /loopback/);
  await assert.rejects(inspectOrigin({ origin, target, password: 'fixture', call }), /unauthenticated/);
  const redirection = fixture({ replace: { '/api/auth/status': () => Response.redirect('https://example.test') } });
  await assert.rejects(inspectOrigin({ origin, target, password: 'fixture', call: redirection.call }), /auth-status/);
});
