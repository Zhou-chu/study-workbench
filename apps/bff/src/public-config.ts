import type { RuntimeConfig } from '@study/contracts';
import type { BffConfig } from './config.js';
/** This is BFF support only. Authenticated API capability receipts are separate. */
export function publicRuntimeConfig(config: BffConfig): RuntimeConfig {
    return { apiUrl: '', auth_mode: config.mode, web_session_protocol: config.webSessionProtocol,
        client_contracts: ['workspace-view-v1'], ui_transport_protocol: 1 };
}

/** A hint about the response actually received at this hop, not proof of app
 * session loss. It cannot observe an ingress interception before this BFF.
 * Callers still apply the endpoint's media contract (opaque artifacts differ).
 */
export function classifyIngressResponse(status: number, contentType: string | null, location: string | null): 'expected' | 'ingress_reauth' | 'unavailable' {
    if (!Number.isInteger(status) || status < 200 || status > 599) return 'unavailable';
    if (status >= 300 && status < 400 && status !== 304) return location?.trim() ? 'ingress_reauth' : 'unavailable';
    const media = contentType?.split(';')[0]?.trim().toLowerCase();
    if (media === 'text/html' || media === 'application/xhtml+xml') return status >= 500 ? 'unavailable' : 'ingress_reauth';
    return 'expected';
}
