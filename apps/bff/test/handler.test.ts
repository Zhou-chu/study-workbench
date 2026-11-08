import { describe, expect, it, vi } from 'vitest';
import { createBffHandler, createBffServer } from '../src/server.js';
import { getWebSessionConfig } from '../src/config.js';
import { config, origin, rejectedTargets } from './fixtures.js';
for (const mode of ['legacy_password', 'device_sessions'] as const)
    describe(mode, () => {
        it.each(rejectedTargets.filter(([method, path]) => method !== 'TRACE' && !path.includes('/./') && !path.includes('/../') && !path.includes('%2E%2e') && !path.includes('.%2e') && !path.includes('\\') && !path.includes('#') && !path.startsWith('//')))('handler rejects %s %s before readiness/body', async (method, path, status) => {
            const fetcher = vi.fn();
            const handler = createBffHandler(config(mode), { fetch: fetcher });
            const req = new Request(origin + path, { method, headers: { origin }, ...(method === 'POST' ? { body: 'unread' } : {}) });
            expect((await handler(req)).status).toBe(status);
            expect(fetcher).not.toHaveBeenCalled();
            expect(req.bodyUsed).toBe(false);
        });
        it.each([{ origin: 'null' }, { origin: 'https://foreign.example' }, { origin: origin + ', ' + origin }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-origin, same-origin' }])('rejects bad supplied read origin/site %j', async (headers) => { const fetcher = vi.fn(); expect((await createBffHandler(config(mode), { fetch: fetcher })(new Request(origin + '/api/notebooks', { headers }))).status).toBe(403); expect(fetcher).not.toHaveBeenCalled(); });
        it('answers OPTIONS locally and rejects malformed requested method', async () => { const fetcher = vi.fn(); const handler = createBffHandler(config(mode), { fetch: fetcher }); expect((await handler(new Request(origin + '/api/notebooks', { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST' } }))).status).toBe(204); for (const value of ['TRACE', 'post', 'GET, POST', ''])
            expect((await handler(new Request(origin + '/api/notebooks', { method: 'OPTIONS', headers: { origin, 'access-control-request-method': value } }))).status).toBe(405); expect(fetcher).not.toHaveBeenCalled(); });
        it.each([null, '', 'https://x.example/', 'https://x.example,https://y.example', 'http://localhost:3000'])('rejects invalid trusted config before readiness %s', publicOrigin => { const cfg = { ...config(mode), publicOrigin } as ReturnType<typeof config>; expect(() => createBffHandler(cfg)).toThrow('AUTH_UNAVAILABLE'); expect(() => createBffServer(cfg)).toThrow('AUTH_UNAVAILABLE'); });
    });
it('returns only same-origin BFF self-report metadata without asserting API capability', async () => { const fetcher = vi.fn(); const response = await createBffHandler(config(), { fetch: fetcher })(new Request(origin + '/config', { headers: { cookie: 'CF_Authorization=fixture', authorization: 'Bearer fixture', 'x-forwarded-host': 'evil.example' } })); expect(await response.json()).toEqual({ apiUrl: '', auth_mode: 'legacy_password', web_session_protocol: null, client_contracts: ['workspace-view-v1'], ui_transport_protocol: 1 }); expect(response.headers.get('cache-control')).toBe('no-store'); expect(fetcher).not.toHaveBeenCalled(); });
it('legacy safe reads keep Cookie+Bearer compatibility, unsafe browser calls need exact Origin but no new CSRF', async () => { const calls: Array<[
    string,
    RequestInit | undefined
]> = []; const handler = createBffHandler(config(), { fetch: async (url, init) => { calls.push([url, init]); return url.endsWith('/status') ? Response.json({ auth_enabled: true, message: 'required' }) : Response.json({ ok: true }); } }); for (const method of ['GET', 'POST']) {
    const req = new Request(origin + '/api/notebooks', { method, headers: { cookie: 'CF_Authorization=fixture', authorization: 'Bearer fixture', ...(method === 'POST' ? { origin } : {}) }, ...(method === 'POST' ? { body: '{}' } : {}) });
    expect((await handler(req)).status).toBe(200);
    const headers = new Headers(calls.at(-1)![1]?.headers);
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('authorization')).toBe('Bearer fixture');
    expect(headers.get('x-studyworkbench-csrf')).toBeNull();
} });
it.each([{}, { 'sec-fetch-site': 'same-origin' }, { 'x-native': '1' }])('rejects origin-less unsafe legacy calls with disabled native flag %j', async (headers) => { const fetcher = vi.fn(); const req = new Request(origin + '/api/notes', { method: 'POST', headers: { authorization: 'Bearer fixture', ...headers }, body: 'unread' }); expect((await createBffHandler(config(), { fetch: fetcher })(req)).status).toBe(403); expect(fetcher).not.toHaveBeenCalled(); expect(req.bodyUsed).toBe(false); });
it('permits only a fully classified explicitly enabled synthetic native legacy write', async () => { const fetcher = vi.fn(async (url: string) => url.endsWith('/status') ? Response.json({ auth_enabled: true, message: 'required' }) : Response.json({ ok: true })); const handler = createBffHandler({ ...config(), nativePassthrough: true }, { fetch: fetcher }); const native = (headers: Record<string, string>) => new Request(origin + '/api/notes', { method: 'POST', headers, body: '{}' }); expect((await handler(native({ authorization: 'Bearer fixture' }))).status).toBe(200); expect(new Headers(fetcher.mock.calls.at(-1)?.[1]?.headers).has('origin')).toBe(false); for (const headers of [{ authorization: 'Bearer fixture', 'sec-fetch-mode': 'cors' }, { authorization: 'Bearer fixture', cookie: '__Host-sw-session=fixture' }, {}]) {
    fetcher.mockClear();
    expect((await handler(native(headers))).status).not.toBe(200);
    expect(fetcher).not.toHaveBeenCalled();
} });
it('requires explicit trusted legacy origin from environment without header inference', () => { vi.stubEnv('STUDY_WORKBENCH_AUTH_MODE', 'legacy_password'); vi.stubEnv('STUDY_WORKBENCH_WEB_ORIGIN', undefined); expect(() => getWebSessionConfig()).toThrow('AUTH_UNAVAILABLE'); vi.unstubAllEnvs(); });
it('never reads a rejected streamed upload or honors an extra legacy path argument', async () => {
    for (const mode of ['legacy_password', 'device_sessions'] as const) {
        let reads = 0;
        const body = new ReadableStream<Uint8Array>({ pull(c) { reads++; c.enqueue(new Uint8Array([1])); } }, { highWaterMark: 0 });
        const fetcher = vi.fn();
        const handler = createBffHandler(config(mode), { fetch: fetcher });
        const req = new Request(origin + '/api/unknown', { method: 'POST', headers: { origin }, body, duplex: 'half' } as RequestInit);
        const invoke = handler as unknown as (request: Request, alias: string) => Promise<Response>;
        expect((await invoke(req, '/api/notebooks')).status).toBe(404);
        expect(reads).toBe(0);
        expect(fetcher).not.toHaveBeenCalled();
    }
});
