/** Trusted artifact preparation and the wire checks preceding U003 Chromium. */
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ROOT, bytes, stageGateway, verifyArtifact, verifyGateway,
} from '../../../v1/spa-artifact-common.mjs';

const digest = data => createHash('sha256').update(data).digest('hex');
const shaPattern = /^[a-f0-9]{40}$/;

export async function prepareStaging({ sourceCommit, web, bff, gateway }) {
  if (!shaPattern.test(sourceCommit)) throw Error('Expected exact source commit');
  const contract = path.join(ROOT, 'contracts/v1/openapi.json');
  const webProof = await verifyArtifact(web, { kind: 'web', contract, source: true });
  const bffProof = await verifyArtifact(bff, { kind: 'bff', contract, source: true });
  if (webProof.manifest.source_commit !== sourceCommit ||
      bffProof.manifest.source_commit !== sourceCommit)
    throw Error('Expected exact Web and BFF artifact commit');
  await stageGateway(gateway, [web]);
  const releaseSlot = webProof.inventory.release_slot;
  if ((await verifyGateway(gateway, { contract })).current !== releaseSlot)
    throw Error('Incorrect staged release');
  const published = await bytes(path.join(web, 'spa-artifact-manifest.json'));
  return {
    sourceCommit, releaseSlot, staticFiles: webProof.inventory.assets,
    manifest: { size: published.data.length, sha256: digest(published.data) },
  };
}

function loopback(value) {
  const match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(value);
  if (!match || Number(match[1]) > 65535 || Number(match[1]) === 80)
    throw Error('Expected fixture-owned loopback origin');
  return value;
}

async function boundedBody(response, maximum) {
  if (!response.body) throw Error('Response body absent');
  const stream = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await stream.read();
      if (done) break;
      size += value.length;
      if (size > maximum) throw Error('Unexpected response size');
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    await stream.cancel().catch(() => {});
    stream.releaseLock();
  }
}

const requireCheck = (ok, name) => { if (!ok) throw Error('U003 preflight: ' + name); };
function requests(origin, call) {
  const base = loopback(origin);
  const request = (p, headers) => call(new URL(p, base), {
    headers, redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  async function json(p, name, headers) {
    try {
      const response = await request(p, headers);
      requireCheck(response.status === 200 && /^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || ''), name);
      return JSON.parse(await boundedBody(response, 65536));
    } catch { throw Error('U003 preflight: ' + name); }
  }
  return { request, json };
}
/** Check the disposable legacy BFF, with no Web artifact or Chromium claim. */
export async function inspectRuntime({ origin, password, call = globalThis.fetch }) {
  if (typeof password !== 'string' || !password || /\s/.test(password))
    throw Error('Expected disposable credential');
  const { request, json } = requests(origin, call);
  const config = await json('/config', 'runtime-config');
  requireCheck(config.apiUrl === '' && config.auth_mode === 'legacy_password' &&
    config.web_session_protocol === null && config.ui_transport_protocol === 1 &&
    Array.isArray(config.client_contracts) && config.client_contracts.includes('workspace-view-v1'), 'runtime-config');
  requireCheck((await json('/api/auth/status', 'auth-status')).auth_enabled === true, 'auth not enabled');
  const anonymous = await request('/api/models/defaults');
  await anonymous.body?.cancel().catch(() => {});
  requireCheck(anonymous.status === 401, 'settings are not protected for unauthenticated request');
  const auth = { authorization: 'Bearer ' + password };
  const defaults = await json('/api/models/defaults', 'defaults', auth);
  requireCheck(defaults.default_chat_model === '' || defaults.default_chat_model === null, 'expected fresh unassigned chat model');
  const credentials = await json('/api/credentials/status', 'credential-status', auth);
  requireCheck(credentials.encryption_configured === true, 'encryption unavailable');
  return { authenticationEnabled: true, encryptionConfigured: true, defaultUnassigned: true };
}
/**
 * Caller retains ownership of the loopback listener and supplies only a newly
 * generated disposable password. This helper never starts or discovers a service.
 */
export async function inspectOrigin({ origin, target, password, call = globalThis.fetch }) {
  const { request } = requests(origin, call);
  if (!shaPattern.test(target.sourceCommit) || !/^[a-z0-9][a-z0-9-]{15,79}$/.test(target.releaseSlot))
    throw Error('Invalid exact artifact target');
  const release = '/_spa/releases/' + target.releaseSlot + '/';
  const files = target.staticFiles;
  const index = files.find(row => row.path === 'index.html');
  const js = files.find(row => /^assets\/index-[-A-Za-z0-9_]+\.js$/.test(row.path));
  const pdf = files.find(row => /^pdfjs\/\d+\.\d+\.\d+\/pdf\.worker\.min\.mjs$/.test(row.path));
  requireCheck(index && js && pdf, 'verified artifact lacks index, app script or PDF worker');
  const staticProbes = [
    ['/notebooks', index, /^text\/html(?:\s*;|$)/i, 'notebooks HTML'],
    [release + js.path, js, /^(?:text|application)\/javascript(?:\s*;|$)/i, 'app script'],
    [release + 'spa-artifact-manifest.json', target.manifest, /^application\/json(?:\s*;|$)/i, 'release manifest'],
    ['/' + pdf.path, pdf, /^(?:text|application)\/javascript(?:\s*;|$)/i, 'PDF worker'],
  ];
  for (const [url, expected, mime, name] of staticProbes) {
    try {
      const response = await request(url);
      requireCheck(response.status === 200 && mime.test(response.headers.get('content-type') || ''), name);
      const body = await boundedBody(response, expected.size);
      requireCheck(body.length === expected.size && digest(body) === expected.sha256, name);
    } catch { throw Error('U003 preflight: ' + name); }
  }
  return { sourceCommit: target.sourceCommit, releaseSlot: target.releaseSlot, staticProbes: staticProbes.length,
    ...await inspectRuntime({ origin, password, call }) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [sourceCommit, web, bff, gateway, ...extra] = process.argv.slice(2);
  if (!sourceCommit || !web || !bff || !gateway || extra.length)
    throw Error('Usage: node release-preflight.mjs exact-sha web-artifact bff-artifact fresh-gateway');
  console.log(JSON.stringify(await prepareStaging({ sourceCommit, web, bff, gateway })));
}
