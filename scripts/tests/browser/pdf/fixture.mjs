import { createServer } from 'node:http';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { parseClientCapabilities, parseTurnView } from '@study/contracts';

const capabilities = parseClientCapabilities({ contract_version: 'client-capabilities-v1',
  supported_contracts: ['workspace-view-v1'], limits: { source_upload_max_bytes: 50, portable: {
  max_archive_bytes: 10, max_expanded_bytes: 20, max_entity_bytes: 10, max_manifest_bytes: 4,
  max_request_bytes: 30, multipart_overhead_bytes: 10, max_entries: 2, max_compression_ratio: 5 } } });
// This line is printed on physical page 3 of the committed A PDF.
const quote = '实验 A 的标准温度为二十五摄氏度。';
const locator = { page_index: 2, block_id: 'pdf-a-block-3', start_offset: 0, end_offset: Array.from(quote).length };
const evidenceA = { evidence_id: 'pdf-a-evidence-3', source_version_id: 'version-a', extraction_id: 'pdf-a-extraction',
  quote, locator, reference_validity: 'verified' };
const completedTurn = parseTurnView({
  turn_id: 'pdf-turn-1', notebook_id: 'synthetic', chat_session_id: 'v1_synthetic', engine: 'independent',
  status: 'succeeded', message: 'What is the standard temperature in experiment A?',
  answer: 'The standard temperature is 25 °C. [c1]',
  citations: [{ citation_id: 'c1', kind: 'local_evidence', source_version_id: evidenceA.source_version_id,
    evidence_id: evidenceA.evidence_id, source_title: 'PDF fixture A', quote, locator, reference_validity: 'verified' }],
});
const parsedCitation = completedTurn.citations?.[0];
if (completedTurn.status !== 'succeeded' || parsedCitation?.projection_status ||
    parsedCitation?.evidence_id !== evidenceA.evidence_id || parsedCitation?.source_version_id !== evidenceA.source_version_id ||
    parsedCitation?.locator?.page_index !== locator.page_index) throw new Error('Synthetic citation failed production projection');
const chatTurns = '/api/personal/chats/v1_synthetic/turns';
if (process.argv[2] === '--preflight') {
  console.log('Synthetic capabilities and completed citation accepted by production decoders');
  process.exit(0);
}

const [repository, artifact, sourceCommit, output] = process.argv.slice(2);
if (!repository || !artifact || !/^[a-f0-9]{40}$/.test(sourceCommit ?? '') || !output)
  throw new Error('Expected checkout, verified artifact, full source SHA and fixture ledger path');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const localFixture = join(repository, 'tests/fixtures/v1');
const fixtures = [
  ['a', 'PDF fixture A', '9d0cd69bbcc02c806f065d2e456b5a08f38c5822c342226d964125077b982032', 3],
  ['b', 'PDF fixture B', 'd94cea49810b0e3c132428b612ca886001fb5337cb13664e5f61323c10bc258c', 4],
].map(([key, title, expected, pages]) => {
  const bytes = readFileSync(join(localFixture, 'fixture_' + key + '.pdf'));
  if (hash(bytes) !== expected) throw new Error('Fixture bytes do not match the committed hash');
  return { bytes, pages, version: {
    source_id: 'source-' + key, source_version_id: 'version-' + key, notebook_id: 'synthetic',
    source_title: title, created_at: '2026-11-20T12:00:00Z', origin: 'upload', status: 'ready', original_status: 'available',
    mime_type: 'application/pdf', byte_size: bytes.length, sha256: expected,
  } };
});
const root = resolve(artifact);
const index = readFileSync(join(root, 'index.html'));
const manifest = JSON.parse(readFileSync(join(root, 'spa-artifact-manifest.json'), 'utf8'));
const identity = JSON.parse(readFileSync(join(root, 'artifact-identity.json'), 'utf8'));
if (manifest.source_commit !== sourceCommit || identity.source_commit !== sourceCommit ||
    !/^[a-z0-9][a-z0-9-]{15,79}$/.test(identity.release_slot)) throw new Error('Artifact does not match requested commit');
const release = '/_spa/releases/' + identity.release_slot + '/';
const notebook = { id: 'synthetic', name: 'PDF pagination synthetic notebook', description: '', archived: false };
let selection = { engine: 'independent', selection_origin: 'local', source_version_ids: [], remote_source_ids: [], reading: null };
const workspace = () => ({
  schema_version: 'workspace-view-v1', notebook, selection: { ...selection, notebook_id: notebook.id },
  sources: fixtures.map(({ version }) => ({ source_id: version.source_id, title: version.source_title, versions: [version] })),
  jobs: [], notes: [], turns: [], link: null, legacy_history: [],
});
const methods = [];
const evidenceRoutes = new Set([
  '/config', '/api/auth/status', '/api/personal/client-capabilities',
  '/api/personal/notebooks/synthetic/workspace-view', '/api/personal/notebooks/synthetic/selection',
  chatTurns, '/api/notebooks/synthetic', '/api/models/defaults', '/pdfjs/6.4.299/pdf.worker.min.mjs',
  ...fixtures.flatMap(({ version }) => {
    const path = '/api/personal/source-versions/' + version.source_version_id;
    return [path, path + '/download'];
  }),
]);
const summary = () => ({
  expectedSourceCommit: sourceCommit, artifactKind: 'verified-release-manifests',
  indexSha256: hash(index), artifact: manifest, fixtureBytes: fixtures.map(({ version, pages }) => ({
    id: version.source_version_id, sha256: version.sha256, bytes: version.byte_size, pages,
  })), requests: methods, current: selection,
});
const record = (req, path, status, extra = undefined) => {
  if (evidenceRoutes.has(path)) {
    methods.push({ method: req.method === 'GET' || req.method === 'PATCH' ? req.method : 'other', path, status, ...(extra ?? {}) });
    writeFileSync(output, JSON.stringify(summary(), null, 2) + '\n', { mode: 0o600 });
  }
};
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.pdf': 'application/pdf', '.wasm': 'application/wasm', '.json': 'application/json', '.woff': 'font/woff', '.woff2': 'font/woff2' };
createServer(async (req, res) => {
  const requestUrl = new URL(req.url, 'http://127.0.0.1');
  const path = requestUrl.pathname;
  const send = (status, body, type = 'application/json', extra) => {
    const bytes = type === 'application/json' ? Buffer.from(JSON.stringify(body)) : Buffer.from(body);
    res.writeHead(status, { 'content-type': type, 'content-length': bytes.length, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' });
    res.end(bytes);
    record(req, path, status, extra);
  };
  if (req.method === 'GET' && path === '/__fixture_evidence') return send(200, summary());
  const method = req.method;
  if (method === 'GET') {
    if (path === '/config') return send(200, { apiUrl: '', auth_mode: 'legacy_password', web_session_protocol: null,
      client_contracts: ['workspace-view-v1'], ui_transport_protocol: 1 });
    if (path === '/api/auth/status') return send(200, { auth_enabled: false });
    if (path === '/api/personal/client-capabilities') return send(200, capabilities);
    if (path === '/api/personal/notebooks/synthetic/workspace-view') return send(200, workspace());
    if (path === '/api/notebooks/synthetic') return send(200, notebook);
    if (path === chatTurns) return send(200, [completedTurn]);
    if (path === '/api/models/defaults') return send(200, { default_chat_model: null });
    for (const { bytes, version } of fixtures) {
      const p = '/api/personal/source-versions/' + version.source_version_id;
      if (path === p) {
        if (!requestUrl.search) return send(200, { version, extraction: null, evidence: [] });
        if (version.source_version_id !== evidenceA.source_version_id ||
            requestUrl.searchParams.size !== 1 || requestUrl.searchParams.get('evidence_id') !== evidenceA.evidence_id)
          return send(404, {});
        const extraction = { extraction_id: evidenceA.extraction_id, source_version_id: evidenceA.source_version_id,
          status: 'ready', page_count: 3, text: quote, blocks: [{ block_id: locator.block_id, page_index: locator.page_index, text: quote }] };
        return send(200, { version, extraction, evidence: [evidenceA] }, 'application/json',
          { citationTarget: 'a-page-3' });
      }
      if (path === p + '/download') return send(200, bytes, 'application/pdf', { sha256: version.sha256, bytes: bytes.length });
    }
    if (/^\/api\/(?:personal\/notebooks\/synthetic\/(?:turns|notes)|models|notebooks|recently-viewed)$/.test(path)) return send(200, []);
  }
  if (method === 'PATCH' && path === '/api/personal/notebooks/synthetic/selection') {
    try {
      const chunks = []; let length = 0;
      for await (const part of req) { length += part.length; if (length > 2000) return send(413, {}); chunks.push(part); }
      const next = JSON.parse(Buffer.concat(chunks).toString());
      const allowed = fixtures.map(({ version }) => version.source_version_id);
      const reader = next.reading == null ? null : fixtures.find(({ version }) => version.source_version_id === next.reading.source_version_id);
      if (next.engine !== 'independent' || next.selection_origin !== 'local' || !Array.isArray(next.source_version_ids) ||
          !next.source_version_ids.every(id => allowed.includes(id)) || !Array.isArray(next.remote_source_ids) || next.remote_source_ids.length ||
          next.reading != null && (!reader || !Number.isSafeInteger(next.reading.page_index) || next.reading.page_index < 0 || next.reading.page_index >= reader.pages)) return send(422, {});
      selection = { engine: next.engine, selection_origin: next.selection_origin,
        source_version_ids: next.source_version_ids, remote_source_ids: [], reading: reader ? { source_version_id: reader.version.source_version_id, page_index: next.reading.page_index } : null };
      return send(200, {}, 'application/json', { syntheticSelected: selection.source_version_ids, syntheticReading: selection.reading });
    } catch { return send(400, {}); }
  }
  if (path.startsWith('/api/') || method !== 'GET') return send(404, {});
  if (path === '/' || path === '/notebooks/synthetic') return send(200, index, 'text/html');
  const relativePath = path.startsWith(release) ? path.slice(release.length) : path.slice(1);
  if (relativePath !== 'spa-artifact-manifest.json' && !relativePath.startsWith('assets/') && !relativePath.startsWith('pdfjs/')) return send(404, {});
  const candidate = resolve(root, relativePath), file = relative(root, candidate);
  if (!file || file === '..' || file.startsWith('../')) return send(404, {});
  try { if (statSync(candidate).isFile()) { const type = types[extname(candidate)] ?? 'application/octet-stream'; return type === 'application/json' ? send(200, JSON.parse(readFileSync(candidate, 'utf8'))) : send(200, readFileSync(candidate), type); } }
  catch (e) { if (e.code !== 'ENOENT') return send(500, {}); }
  return send(404, {});
}).listen(Number(process.env.PORT ?? 0), '127.0.0.1', function () {
  writeFileSync(output, JSON.stringify(summary(), null, 2) + '\n', { mode: 0o600 });
  process.stdout.write('http://127.0.0.1:' + this.address().port + '\n');
});
