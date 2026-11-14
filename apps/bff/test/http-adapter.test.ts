import { afterEach, describe, expect, it, vi } from 'vitest';
import { connect } from 'node:net';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { createBffHandler, createBffServer } from '../src/server.js';
import { createHttpAdapter } from '../src/http-adapter.js';
import { config, origin, rejectedTargets } from './fixtures.js';
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }))); });
async function listen(server: Server) { servers.push(server); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string')
    throw new Error('fixture listen'); return address.port; }
function raw(port: number, target: string, method = 'GET', headers = '', host = 'localhost'): Promise<string> {
    return new Promise((resolve, reject) => { const socket = connect(port, '127.0.0.1'); let data = ''; socket.on('error', reject); socket.on('data', chunk => { data += chunk.toString(); }); socket.on('end', () => resolve(data)); socket.on('connect', () => socket.end(`${method} ${target} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n${headers}\r\n`)); });
}
describe.each(['legacy_password', 'device_sessions'] as const)('real raw HTTP %s gate', mode => {
    it.each(rejectedTargets)('rejects %s %s before fetch or body', async (method, target, status) => {
        const fetcher = vi.fn();
        const handler = createBffHandler(config(mode), { fetch: fetcher });
        const port = await listen(createServer(createHttpAdapter(handler, config(mode))));
        expect(await raw(port, target, method)).toMatch(new RegExp(`^HTTP/1.1 ${status} `));
        expect(fetcher).not.toHaveBeenCalled();
    });
    it.each(['Host: duplicate.example', `Origin: ${origin}\r\nOrigin: ${origin}`, 'Authorization: Bearer one\r\nAuthorization: Bearer two'])('rejects duplicate authority %s', async (header) => {
        const fetcher = vi.fn();
        const port = await listen(createServer(createHttpAdapter(createBffHandler(config(mode), { fetch: fetcher }), config(mode))));
        expect(await raw(port, '/api/notebooks', 'GET', `${header}\r\n`)).toMatch(/^HTTP\/1.1 400 /);
        expect(fetcher).not.toHaveBeenCalled();
    });
});
it('keeps imports inert and serves only a fixed synthetic upstream despite spoofed authority', async () => {
    const received: Array<{
        url: string;
        headers: object;
        body: string;
    }> = [];
    const upstream = createServer(async (req, res) => { let body = ''; for await (const chunk of req)
        body += chunk; received.push({ url: req.url!, headers: req.headers, body }); res.setHeader('content-type', 'application/json'); res.end(req.url === '/api/auth/status' ? JSON.stringify({ auth_enabled: true, message: 'Authentication required' }) : '{"ok":true}'); });
    const upstreamPort = await listen(upstream);
    const cfg = { ...config(), internalOrigin: `http://127.0.0.1:${upstreamPort}` };
    const server = createBffServer(cfg);
    expect(server.listening).toBe(false);
    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/api/notebooks?q=a%2Fb`, { headers: { host: 'evil.example', origin, authorization: 'Bearer fixture', cookie: 'CF_Authorization=fixture', 'x-api-key': 'fixture', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https', 'forwarded': 'host=evil.example' } });
    expect(response.status).toBe(200);
    expect(received.map(x => x.url)).toEqual(['/api/auth/status', '/api/notebooks?q=a%2Fb']);
    expect(received[0]!.headers).not.toHaveProperty('authorization');
    expect(received[1]!.headers).toMatchObject({ authorization: 'Bearer fixture', origin });
    for (const name of ['cookie', 'x-api-key', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded'])
        expect(received[1]!.headers).not.toHaveProperty(name);
});
it('preserves separate Set-Cookie fields, streams response bytes and forwards request abort', async () => {
    let signal: AbortSignal | undefined;
    const headers = new Headers();
    headers.append('set-cookie', 'one=1; Path=/');
    headers.append('set-cookie', 'two=2; Path=/');
    const port = await listen(createServer(createHttpAdapter(async (req) => { signal = req.signal; return new Response('streamed', { headers }); }, config())));
    const result = await new Promise<{
        cookies: string[] | undefined;
        body: string;
    }>(resolve => { httpRequest({ host: '127.0.0.1', port, path: '/api/notebooks' }, res => { let body = ''; res.on('data', chunk => { body += chunk; }); res.on('end', () => resolve({ cookies: res.headers['set-cookie'], body })); }).end(); });
    expect(result).toEqual({ cookies: ['one=1; Path=/', 'two=2; Path=/'], body: 'streamed' });
    expect(signal?.aborted).toBe(false);
});
it('cancels the upstream response stream when the downstream disconnects', async () => {
    let cancelled!: () => void;
    const aborted = new Promise<void>(resolve => { cancelled = resolve; });
    let signal: AbortSignal | undefined;
    const port = await listen(createServer(createHttpAdapter(async (req) => { signal = req.signal; return new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('first')); }, cancel() { cancelled(); } })); }, config())));
    await new Promise<void>(resolve => { const req = httpRequest({ host: '127.0.0.1', port, path: '/api/notebooks' }, res => { res.once('data', () => { res.destroy(); resolve(); }); }); req.end(); });
    await aborted;
    expect(signal?.aborted).toBe(true);
});
it('stops pulling response chunks under downstream backpressure', async () => {
    let produced = 0;
    let cancelled!: () => void;
    const stopped = new Promise<void>(resolve => { cancelled = resolve; });
    const chunk = new Uint8Array(262144);
    const port = await listen(createServer(createHttpAdapter(async () => new Response(new ReadableStream<Uint8Array>({ pull(c) { produced++; c.enqueue(chunk); if (produced === 128)
            c.close(); }, cancel() { cancelled(); } }, { highWaterMark: 0 })), config())));
    const socket = connect(port, '127.0.0.1');
    socket.on('error', () => { });
    socket.pause();
    await new Promise<void>(resolve => socket.once('connect', () => { socket.write('GET /api/notebooks HTTP/1.1\r\nHost: localhost\r\n\r\n'); resolve(); }));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(produced).toBeGreaterThan(0);
    expect(produced).toBeLessThan(128);
    socket.destroy();
    await stopped;
});
it('drops stale resource headers when a stream fails before the first byte', async () => {
    const port = await listen(createServer(createHttpAdapter(async () => new Response(new ReadableStream<Uint8Array>({ start(c) { c.error(new Error('synthetic private failure')); } }), { headers: { 'content-length': '9999', 'content-disposition': 'attachment; filename="private.bin"', 'x-private': 'fixture' } }), config())));
    const response = await raw(port, '/api/notebooks');
    expect(response).toMatch(/^HTTP\/1.1 502 /);
    expect(response).not.toMatch(/content-length: 9999|content-disposition|x-private|synthetic private failure/i);
    expect(response).toContain('UPSTREAM_UNAVAILABLE');
});
it.each(['WORKBENCH.EXAMPLE:80', '[::1]:80'])('accepts a valid untrusted Host spelling %s without deriving authority', async (host) => {
    let target = '';
    const port = await listen(createServer(createHttpAdapter(async (req) => { target = req.url; return new Response('ok'); }, config())));
    expect(await raw(port, '/api/notebooks', 'GET', '', host)).toMatch(/^HTTP\/1.1 200 /);
    expect(target).toBe(origin + '/api/notebooks');
});
