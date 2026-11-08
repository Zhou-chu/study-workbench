import { describe, expect, it } from 'vitest';
import { createBffHandler } from '../src/server.js';
import { config, origin } from './fixtures.js';
import { browserRoutes } from './route-corpus.js';
const id = '12345678-1234-1234-1234-123456789abc';
const refresh = 'swr1_' + Buffer.alloc(32, 2).toString('base64url');
const access = 'swa1_' + Buffer.alloc(32, 1).toString('base64url');
const examples = browserRoutes.flatMap(([methods, template, kind = 'json']) => methods.split(' ').map(method => ({ method, template, kind })));
it('freezes the full reviewed 153-entry corpus plus only two A1 additions', () => {
    expect(examples).toHaveLength(155);
    expect(examples.filter(x => x.template.endsWith('/workspace-view') || x.template === '/api/personal/client-capabilities')).toHaveLength(2);
});
describe.each(['legacy_password', 'device_sessions'] as const)('full handler corpus %s', mode => {
    it.each(examples)('$method $template $kind retains the reviewed dispatch', async ({ method, template, kind }) => {
        const calls: Array<{
            url: string;
            init: RequestInit | undefined;
        }> = [];
        const handler = createBffHandler({ ...config(mode), nativePassthrough: true }, { fetch: async (url, init) => {
                calls.push({ url, init });
                if (url.endsWith('/api/auth/status'))
                    return mode === 'legacy_password' ? Response.json({ auth_enabled: true, message: 'required' }) : Response.json({ auth_enabled: true, auth_mode: mode, protocol_version: 1 });
                if (url.endsWith('/api/config'))
                    return Response.json({ version: 'fixture' });
                if (init?.method === 'DELETE')
                    return new Response(null, { status: 204 });
                if (url.includes('/api/auth/sessions'))
                    return init?.method === 'GET' ? Response.json({ sessions: [] }) : Response.json({ session_id: id, access_token: access, refresh_token: refresh, access_expires_at: new Date(Date.now() + 600000).toISOString(), refresh_expires_at: new Date(Date.now() + 86400000).toISOString() }, { status: url.endsWith('/refresh') ? 200 : 201 });
                return new Response(method === 'HEAD' ? null : 'fixture');
            } });
        const path = template.replace(/\{[^}]+\}/g, id);
        const auth = kind === 'auth';
        const headers: Record<string, string> = { ...(mode === 'legacy_password' ? { origin } : {}), authorization: 'Bearer fixture', 'content-type': 'application/json' };
        let body: string | undefined;
        if (method === 'POST' && auth) {
            delete headers.authorization;
            body = template.endsWith('/refresh') ? JSON.stringify({ session_id: id, refresh_token: refresh }) : JSON.stringify({ password: 'fixture', device_name: 'Synthetic' });
        }
        else if (!['GET', 'HEAD', 'DELETE'].includes(method))
            body = '{}';
        const req = new Request(origin + path, { method, headers, ...(body === undefined ? {} : { body }) });
        const response = await handler(req);
        if (mode === 'legacy_password' && auth) {
            expect(response.status).toBe(503);
            expect(calls).toHaveLength(0);
            expect(req.bodyUsed).toBe(false);
        }
        else if (template === '/api/auth/web-signout-local') {
            expect(response.status).toBe(400);
            expect(calls).toHaveLength(0);
        }
        else {
            expect(response.status).toBe(method === 'DELETE' ? 204 : auth && method === 'POST' && !template.endsWith('/refresh') ? 201 : 200);
            expect(calls.at(-1)?.url).toBe(config(mode).internalOrigin + path);
            expect(calls.at(-1)?.init?.method).toBe(method);
        }
    });
});
