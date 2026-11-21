import { createServer, type Server } from 'node:http';
import { validateBffConfig, type BffConfig } from './config.js';
import { createHttpAdapter, type BffHandler } from './http-adapter.js';
import { gateRequestTarget, isAllowedWebRead } from './policy.js';
import { createSessionProxy, type ProxyOptions } from './proxy.js';
import { publicRuntimeConfig } from './public-config.js';
export type { BffConfig } from './config.js';
export type { BffHandler } from './http-adapter.js';
export { getWebSessionConfig } from './config.js';
/** Imports never listen; each handler owns its independent in-memory session store. */
export function createBffHandler(inputConfig: BffConfig, options: ProxyOptions = {}): BffHandler {
    const config = validateBffConfig(inputConfig);
    const proxy = createSessionProxy(config, options);
    return async (request) => {
        const target = /^https?:\/\/[^/]+(\/.*)$/.exec(request.url)?.[1] ?? '';
        const gate = gateRequestTarget(request.method, target, request.headers);
        if (gate) {
            if (gate.status === 204 && !isAllowedWebRead(request.headers, config.publicOrigin))
                return crossSite();
            return gate;
        }
        if (target === '/config') {
            if (!isAllowedWebRead(request.headers, config.publicOrigin))
                return crossSite();
            return Response.json(publicRuntimeConfig(config), { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
        }
        return proxy.dispatch(request);
    };
}
function crossSite(): Response {
    return Response.json({ error: { code: 'CROSS_SITE_REQUEST', message: 'Cross-site request rejected.' } }, { status: 403, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
export function createBffServer(config: BffConfig): Server {
    const handler = createBffHandler(config);
    return createServer(createHttpAdapter(handler, config));
}
