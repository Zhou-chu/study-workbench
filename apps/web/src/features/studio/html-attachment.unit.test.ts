import { beforeEach, expect, it, vi } from 'vitest';
import { createWebTransport, readTurnContext } from '@study/web-transport';
import { sourceContext } from '../../test/source-fixtures';
beforeEach(sourceContext);
const config = { apiUrl: '' as const, auth_mode: 'legacy_password' as const, web_session_protocol: null, client_contracts: ['workspace-view-v1'], ui_transport_protocol: 1 as const };
const html = '<!doctype html><html><body>Opaque artifact</body></html>';

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
