import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { expect, it, vi } from 'vitest';
import { createHttpAdapter } from '../src/http-adapter.js';
import type { BffConfig } from '../src/config.js';

vi.mock('../src/config.js', () => ({ validateBffConfig: (value: unknown) => value }));
vi.mock('../src/policy.js', () => ({
    gateRequestTarget: (_method: string, url: string) => url === '/unavailable' ? new Response(null, { status: 404 }) : null,
    isAllowedWebRead: () => true,
}));

const config: BffConfig = {
    mode: 'legacy_password', publicOrigin: 'https://workbench.example',
    internalOrigin: 'http://synthetic.invalid', cookieName: '__Host-sw-session',
    secure: true, nativePassthrough: false, webSessionProtocol: null,
};

function adapterFixture(method = 'GET', url = '/api/notebooks') {
    const iterator = vi.fn(() => (async function* () {
        yield Buffer.from('input ');
        yield Buffer.from('document');
    })());
    const req = Object.assign(new EventEmitter(), {
        method, url, rawHeaders: ['Host', 'workbench.example', 'Content-Type', 'text/plain'],
        iterator,
    });
    const headers = new Map<string, string | string[]>();
    const chunks: Buffer[] = [];
    let finish!: () => void;
    const complete = new Promise<void>(resolve => { finish = resolve; });
    const res = Object.assign(new EventEmitter(), {
        headersSent: false, destroyed: false, writableFinished: false, statusCode: 0,
        setHeader: (name: string, value: string | string[]) => headers.set(name, value),
        getHeaderNames: () => [...headers.keys()],
        removeHeader: (name: string) => headers.delete(name),
        write: vi.fn((chunk: Uint8Array) => {
            res.headersSent = true;
            chunks.push(Buffer.from(chunk));
            return true;
        }),
        end: vi.fn(() => { res.writableFinished = true; queueMicrotask(finish); }),
        destroy: vi.fn(() => { res.destroyed = true; queueMicrotask(finish); }),
    });
    const run = (handler: (request: Request) => Promise<Response>) =>
        createHttpAdapter(handler, config)(req as unknown as IncomingMessage, res as unknown as ServerResponse);
    return { req, res, iterator, headers, chunks, run, complete };
}

it('passes a streamed upload body to its handler and returns separate response cookie fields', async () => {
    const f = adapterFixture('POST');
    const handler = vi.fn(async (request: Request) => {
        expect(request.method).toBe('POST');
        expect(request.url).toBe(config.publicOrigin + '/api/notebooks');
        expect(await request.text()).toBe('input document');
        const headers = new Headers();
        headers.append('Set-Cookie', 'one=1; Path=/');
        headers.append('Set-Cookie', 'two=2; Path=/');
        return new Response('accepted', { status: 201, headers });
    });
    f.run(handler);
    await f.complete;
    expect(handler).toHaveBeenCalledOnce();
    expect(f.iterator).toHaveBeenCalledOnce();
    expect(f.res.statusCode).toBe(201);
    expect(f.headers.get('set-cookie')).toEqual(['one=1; Path=/', 'two=2; Path=/']);
    expect(Buffer.concat(f.chunks).toString()).toBe('accepted');
    expect(f.req.listenerCount('aborted')).toBe(0);
    expect(f.res.listenerCount('close')).toBe(0);
});

it('does not read a body when the route declines to dispatch', async () => {
    const f = adapterFixture('POST', '/unavailable');
    const handler = vi.fn(async () => new Response());
    f.run(handler);
    await f.complete;
    expect(f.res.statusCode).toBe(404);
    expect(f.res.end).toHaveBeenCalledOnce();
    expect(f.res.write).not.toHaveBeenCalled();
    expect(f.iterator).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
});

it('waits for the output to drain before pulling the next chunk', async () => {
    const f = adapterFixture();
    const pulls = vi.fn();
    let observedBeforeDrain: readonly number[] = [];
    f.res.write.mockImplementationOnce((chunk: Uint8Array) => {
        f.chunks.push(Buffer.from(chunk));
        queueMicrotask(() => {
            observedBeforeDrain = [pulls.mock.calls.length, f.res.listenerCount('drain')];
            f.res.emit('drain');
        });
        return false;
    });
    f.run(async () => new Response(new ReadableStream({
        pull(controller) {
            pulls();
            controller.enqueue(new TextEncoder().encode(pulls.mock.calls.length === 1 ? 'a' : 'b'));
            if (pulls.mock.calls.length === 2) controller.close();
        },
    }, { highWaterMark: 0 })));
    await f.complete;
    expect(observedBeforeDrain).toEqual([1, 1]);
    expect(Buffer.concat(f.chunks).toString()).toBe('ab');
    expect(f.res.listenerCount('drain')).toBe(0);
    expect(f.res.listenerCount('error')).toBe(0);
});

it('returns a sanitized failure when the upstream stream breaks before any response bytes', async () => {
    const f = adapterFixture();
    f.run(async () => new Response(new ReadableStream({
        start(controller) { controller.error(new Error('synthetic provider detail')); },
    }), { headers: { 'Content-Disposition': 'attachment; filename="result.txt"' } }));
    await f.complete;
    expect(f.res.statusCode).toBe(502);
    expect(f.headers.has('content-disposition')).toBe(false);
    expect(f.headers.get('cache-control')).toBe('no-store');
    expect(JSON.parse(Buffer.concat(f.chunks).toString())).toEqual({
        error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Request could not be completed.' },
    });
    expect(f.res.destroy).not.toHaveBeenCalled();
});

it('ends an interrupted response without appending an error document to the streamed bytes', async () => {
    const f = adapterFixture();
    let started = false;
    f.run(async () => new Response(new ReadableStream({
        pull(controller) {
            if (started) controller.error(new Error('synthetic stream interruption'));
            else {
                started = true;
                controller.enqueue(new TextEncoder().encode('partial response'));
            }
        },
    }, { highWaterMark: 0 })));
    await f.complete;
    expect(Buffer.concat(f.chunks).toString()).toBe('partial response');
    expect(f.res.destroy).toHaveBeenCalledOnce();
    expect(f.res.end).not.toHaveBeenCalled();
});

it('cancels the stream and removes drain listeners on a disconnected client', async () => {
    const f = adapterFixture();
    const cancel = vi.fn();
    f.res.write.mockImplementationOnce(() => {
        f.res.headersSent = true;
        queueMicrotask(() => f.res.emit('close'));
        return false;
    });
    f.run(async () => new Response(new ReadableStream({
        pull(controller) { controller.enqueue(new Uint8Array([1])); },
        cancel,
    }, { highWaterMark: 0 })));
    await f.complete;
    expect(cancel).toHaveBeenCalledOnce();
    expect(f.res.destroy).toHaveBeenCalledOnce();
    expect(f.res.end).not.toHaveBeenCalled();
    expect(f.res.listenerCount('drain')).toBe(0);
    expect(f.res.listenerCount('close')).toBe(0);
    expect(f.req.listenerCount('aborted')).toBe(0);
});
