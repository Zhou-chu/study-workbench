import type { IncomingMessage, ServerResponse, RequestListener } from 'node:http';
import type { BffConfig } from './config.js';
import { validateBffConfig } from './config.js';
import { gateRequestTarget, isAllowedWebRead } from './policy.js';
export type BffHandler = (request: Request) => Promise<Response>;
function invalid(status = 400): Response {
    return Response.json({ error: { code: status >= 500 ? 'UPSTREAM_UNAVAILABLE' : 'AUTH_INVALID_REQUEST', message: 'Request could not be completed.' } }, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
function ingressHeaders(req: IncomingMessage): Headers | null {
    const counts = new Map<string, number>();
    const headers = new Headers();
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const name = req.rawHeaders[i]!.toLowerCase();
        counts.set(name, (counts.get(name) ?? 0) + 1);
        if (['host', 'origin', 'authorization'].includes(name) && counts.get(name)! > 1)
            return null;
        headers.append(name, req.rawHeaders[i + 1]!);
    }
    const host = headers.get('host');
    try {
        if (!host || host.includes('\\') || /[\/?#@,\s]/.test(host))
            return null;
        const parsed = new URL(`http://${host}`);
        if (!parsed.hostname || parsed.username || parsed.password || parsed.pathname !== '/')
            return null;
    }
    catch {
        return null;
    }
    return headers;
}
/** Pull-based bridge: rejected requests never attach a body reader. */
function requestBody(req: IncomingMessage): ReadableStream<Uint8Array> {
    let iterator: AsyncIterator<Buffer> | undefined;
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            iterator ??= req[Symbol.asyncIterator]();
            try {
                const chunk = await iterator.next();
                if (chunk.done)
                    controller.close();
                else
                    controller.enqueue(chunk.value);
            }
            catch (error) {
                controller.error(error);
            }
        },
        cancel() { req.destroy(); },
    }, { highWaterMark: 0 });
}
function drain(res: ServerResponse): Promise<void> {
    return new Promise((resolve, reject) => {
        const cleanup = () => { res.off('drain', ready); res.off('close', closed); res.off('error', closed); };
        const ready = () => { cleanup(); resolve(); };
        const closed = () => { cleanup(); reject(new Error('CLIENT_DISCONNECTED')); };
        res.once('drain', ready);
        res.once('close', closed);
        res.once('error', closed);
    });
}
async function writeResponse(res: ServerResponse, response: Response, signal: AbortSignal): Promise<void> {
    res.statusCode = response.status;
    for (const [name, value] of response.headers)
        if (name !== 'set-cookie')
            res.setHeader(name, value);
    const cookies = response.headers.getSetCookie();
    if (cookies.length)
        res.setHeader('set-cookie', cookies);
    if (!response.body) {
        res.end();
        return;
    }
    const reader = response.body.getReader();
    const cancel = () => { void reader.cancel().catch(() => { }); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
        while (!signal.aborted) {
            const chunk = await reader.read();
            if (chunk.done || signal.aborted)
                break;
            if (!res.write(chunk.value))
                await drain(res);
        }
        if (!signal.aborted)
            res.end();
    }
    finally {
        signal.removeEventListener('abort', cancel);
        if (signal.aborted)
            await reader.cancel().catch(() => { });
        reader.releaseLock();
    }
}
/** Authority comes from fixed config, never Host/Forwarded/X-Forwarded-* fields. */
export function createHttpAdapter(handler: BffHandler, inputConfig: BffConfig): RequestListener {
    const config = validateBffConfig(inputConfig);
    return (req, res) => {
        const controller = new AbortController();
        const abort = () => controller.abort();
        const closed = () => { if (!res.writableFinished)
            abort(); };
        req.once('aborted', abort);
        res.once('close', closed);
        void (async () => {
            try {
                const headers = ingressHeaders(req);
                if (!headers) {
                    await writeResponse(res, invalid(), controller.signal);
                    return;
                }
                // This gate examines the actual wire target before URL normalization or body creation.
                const gate = gateRequestTarget(req.method ?? '', req.url ?? '', headers);
                if (gate) {
                    const reply = gate.status === 204 && !isAllowedWebRead(headers, config.publicOrigin)
                        ? Response.json({ error: { code: 'CROSS_SITE_REQUEST', message: 'Cross-site request rejected.' } }, { status: 403 }) : gate;
                    await writeResponse(res, reply, controller.signal);
                    return;
                }
                const init: RequestInit & {
                    duplex?: 'half';
                } = { method: req.method!, headers, signal: controller.signal };
                if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method!)) {
                    init.body = requestBody(req);
                    init.duplex = 'half';
                }
                const request = new Request(`${config.publicOrigin}${req.url}`, init);
                await writeResponse(res, await handler(request), controller.signal);
            }
            catch {
                if (!res.headersSent && !res.destroyed) {
                    for (const name of res.getHeaderNames())
                        res.removeHeader(name);
                    await writeResponse(res, invalid(502), controller.signal).catch(() => { });
                }
                else if (!res.writableFinished)
                    res.destroy();
            }
            finally {
                req.off('aborted', abort);
                res.off('close', closed);
            }
        })();
    };
}
