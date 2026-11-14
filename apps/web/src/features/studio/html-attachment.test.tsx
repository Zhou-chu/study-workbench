import { createHash } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { createWebTransport, readTurnContext } from '@study/web-transport';
import { createStudioApi } from '../../data/studio-api';
import { sourceContext } from '../../test/source-fixtures';

beforeEach(sourceContext);
const config = { apiUrl: '' as const, auth_mode: 'legacy_password' as const, web_session_protocol: null, client_contracts: ['workspace-view-v1'], ui_transport_protocol: 1 as const };
const html = '<!doctype html><html><body>Opaque artifact</body></html>';
const artifact = { artifact_id: 'artifact:html', notebook_id: 'n', mime_type: 'text/html', byte_size: new TextEncoder().encode(html).length, sha256: createHash('sha256').update(html).digest('hex') };
const readBlob = (blob: Blob) => new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });

it.each([200, 206])('verifies exact opaque HTML bytes through real transport and Studio (%s)', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(html, { status, headers: { 'content-type': 'text/html', 'content-disposition': 'attachment; filename="report.html"', 'content-length': String(artifact.byte_size) } })));
    const blob = await createStudioApi(createWebTransport(config)).downloadArtifact(artifact, 'n', readTurnContext()!);
    expect(await readBlob(blob)).toBe(html);
    expect(blob.type).toBe('text/html');
    expect(readTurnContext()?.ready).toBe(true);
    expect(document.querySelector('iframe,object,embed')).toBeNull();
});
it.each([
    ['auth', '/personal/artifacts/a/download', 'text/html', null, null, 200],
    ['inline', '/personal/artifacts/a/download', 'text/html', 'inline; filename="a.html"', null, 200],
    ['duplicate', '/personal/artifacts/a/download', 'text/html', 'attachment; filename=a; filename=b', null, 200],
    ['combined', '/personal/artifacts/a/download', 'text/html', 'attachment, attachment', null, 200],
    ['malformed', '/personal/artifacts/a/download', 'text/html', 'attachment; filename="a', null, 200],
    ['bad extended', '/personal/artifacts/a/download', 'text/html', "attachment; filename*=UTF-8''bad%ZZ", null, 200],
    ['location', '/personal/artifacts/a/download', 'text/html', 'attachment', '/login', 200],
    ['redirect', '/personal/artifacts/a/download', 'text/html', 'attachment', '/login', 302],
    ['encoded slash', '/personal/artifacts/a%2Fextra/download', 'text/html', 'attachment', null, 200],
    ['unrelated', '/sources/a/download', 'text/html', 'attachment', null, 200],
    ['error', '/personal/artifacts/a/download', 'text/html', 'attachment', null, 401],
] as const)('rejects %s HTML at the shared boundary', async (_name, path, mime, disposition, location, status) => {
    const headers = new Headers({ 'content-type': mime });
    if (disposition) headers.set('content-disposition', disposition);
    if (location) headers.set('location', location);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(html, { status, headers })));
    await expect(createWebTransport(config).send({ method: 'GET', path, context: readTurnContext()! })).rejects.toMatchObject({ kind: 'ingress-unavailable' });
});
it('rejects attachment bytes whose declared artifact digest does not match', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(html, { headers: { 'content-type': 'text/html', 'content-disposition': 'attachment' } })));
    await expect(createStudioApi(createWebTransport(config)).downloadArtifact({ ...artifact, sha256: '0'.repeat(64) }, 'n', readTurnContext()!)).rejects.toMatchObject({ kind: 'invalid' });
});
