import { afterEach, describe, expect, it } from 'vitest';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { createBffServer } from '../src/server.js';
import { config, origin } from './fixtures.js';
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }))); });
async function listen(server: Server) { servers.push(server); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const a = server.address(); if (!a || typeof a === 'string')
    throw new Error('fixture listen'); return a.port; }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }
describe.each(['legacy_password', 'device_sessions'] as const)('real fixed-upstream streams %s', mode => {
    it('preserves encoded query/IDs, early SSE, Range download and chunked multipart', async () => {
        const captured: Array<{
            url: string;
            headers: Record<string, unknown>;
            body?: string;
        }> = [];
        const release = deferred();
        const uploadStarted = deferred();
        const upstreamClosed = deferred();
        const id = '12345678-1234-1234-1234-123456789abc';
        const upstream = createServer(async (req, res) => {
            const entry: {
                url: string;
                headers: Record<string, unknown>;
                body?: string;
            } = { url: req.url!, headers: req.headers };
            captured.push(entry);
            if (req.url === '/api/auth/status') {
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify(mode === 'legacy_password' ? { auth_enabled: true, message: 'required' } : { auth_enabled: true, auth_mode: mode, protocol_version: 1 }));
                return;
            }
            if (req.url === '/api/auth/sessions') {
                let body = '';
                for await (const chunk of req)
                    body += chunk;
                entry.body = body;
                res.setHeader('content-type', 'application/json');
                if (req.method === 'POST') {
                    res.statusCode = 201;
                    res.end(JSON.stringify({ session_id: id, access_token: 'swa1_' + Buffer.alloc(32, 1).toString('base64url'), refresh_token: 'swr1_' + Buffer.alloc(32, 2).toString('base64url'), access_expires_at: new Date(Date.now() + 600000).toISOString(), refresh_expires_at: new Date(Date.now() + 86400000).toISOString() }));
                }
                else
                    res.end('{"sessions":[]}');
                return;
            }
            if (req.url === '/api/notebooks') {
                res.writeHead(307, { location: '/redirect-target' });
                res.end('private redirect');
                return;
            }
            if (req.url!.includes('/download')) {
                res.writeHead(206, { 'content-type': 'application/octet-stream', 'content-range': 'bytes 1-3/5', 'content-disposition': 'attachment; filename="fixture.bin"', 'content-length': '3', 'set-cookie': 'upstream=never', 'x-secret': 'never' });
                res.end('bcd');
                return;
            }
            if (req.url!.includes('/messages?') || req.url === '/api/search/ask') {
                req.resume();
                res.writeHead(200, { 'content-type': 'text/event-stream' });
                res.write('data: 第一\n\n');
                if (req.url === '/api/search/ask') {
                    res.once('close', upstreamClosed.resolve);
                    return;
                }
                await release.promise;
                res.end('data: 第二\n\n');
                return;
            }
            if (req.url === '/api/personal/imports/portable') {
                const chunks: Buffer[] = [];
                req.on('data', () => uploadStarted.resolve());
                for await (const chunk of req)
                    chunks.push(Buffer.from(chunk));
                entry.body = Buffer.concat(chunks).toString();
                res.setHeader('content-type', 'application/json');
                res.end('{"ok":true}');
                return;
            }
            res.end('fixture');
        });
        const upstreamPort = await listen(upstream);
        const server = createBffServer({ ...config(mode), internalOrigin: `http://127.0.0.1:${upstreamPort}` });
        const port = await listen(server);
        const base = `http://127.0.0.1:${port}`;
        const headers: Record<string, string> = { origin, 'x-studyworkbench-csrf': '1', 'content-type': 'application/json', cookie: 'CF_Authorization=fixture' };
        if (mode === 'device_sessions') {
            const login = await fetch(base + '/api/auth/sessions', { method: 'POST', headers, body: '{"password":"fixture","device_name":"Browser"}' });
            expect(login.status).toBe(201);
            headers.cookie += '; ' + login.headers.getSetCookie()[0]!.split(';')[0];
            expect((await fetch(base + '/api/auth/status', { headers })).status).toBe(200);
        }
        else
            headers.authorization = 'Bearer fixture';
        const path = '/api/sources/source%3A%E8%B5%84%E6%96%99/chat/sessions/chat%3Aone/messages?q=a%2Fb%3Fc';
        const sse = await fetch(base + path, { method: 'POST', headers, body: '{}' });
        expect(sse.headers.get('content-type')).toContain('text/event-stream');
        const reader = sse.body!.getReader();
        const first = await reader.read();
        expect(new TextDecoder().decode(first.value)).toBe('data: 第一\n\n');
        release.resolve();
        let text = '';
        while (true) {
            const next = await reader.read();
            if (next.done)
                break;
            text += new TextDecoder().decode(next.value);
        }
        expect(text).toBe('data: 第二\n\n');
        expect(captured.some(x => x.url === path)).toBe(true);
        const download = await fetch(base + '/api/sources/source%3Aone/download', { headers: { ...headers, range: 'bytes=1-3', 'if-range': '"fixture"' } });
        expect(download.status).toBe(206);
        expect(await download.text()).toBe('bcd');
        expect(download.headers.get('content-range')).toBe('bytes 1-3/5');
        expect(download.headers.get('set-cookie')).toBeNull();
        expect(download.headers.get('x-secret')).toBeNull();
        expect(captured.find(x => x.url.includes('/download'))!.headers).toMatchObject({ range: 'bytes=1-3', 'if-range': '"fixture"' });
        const firstUpload = '--fixture\r\nContent-Disposition: form-data; name="file"; filename="synthetic.txt"\r\n\r\n' + 'x'.repeat(300000);
        const tail = 'y'.repeat(300000) + '\r\n--fixture--\r\n';
        const uploaded = new Promise<string>((resolve, reject) => { const req = httpRequest({ host: '127.0.0.1', port, path: '/api/personal/imports/portable', method: 'POST', headers: { ...headers, 'content-type': 'multipart/form-data; boundary=fixture' } }, res => { let body = ''; res.on('data', chunk => { body += chunk; }); res.on('end', () => resolve(body)); }); req.on('error', reject); req.write(firstUpload); void uploadStarted.promise.then(() => req.end(tail)); });
        expect(await uploaded).toBe('{"ok":true}');
        const upload = captured.find(x => x.url === '/api/personal/imports/portable')!;
        expect(upload.body).toBe(firstUpload + tail);
        expect(upload.headers['content-type']).toBe('multipart/form-data; boundary=fixture');
        expect(upload.headers['transfer-encoding']).toBe('chunked');
        const redirected = await fetch(base + '/api/notebooks', { headers });
        expect(redirected.status).toBe(502);
        expect(redirected.headers.get('location')).toBeNull();
        expect(await redirected.text()).not.toContain('private redirect');
        expect(captured.some(entry => entry.url === '/redirect-target')).toBe(false);
        const abort = new AbortController();
        const stream = await fetch(base + '/api/search/ask', { method: 'POST', headers, body: '{}', signal: abort.signal });
        await stream.body!.getReader().read();
        abort.abort();
        await upstreamClosed.promise;
        for (const entry of captured) {
            expect(entry.headers).not.toHaveProperty('cookie');
            if (entry.url === '/api/auth/status')
                expect(entry.headers).not.toHaveProperty('authorization');
        }
    });
});
