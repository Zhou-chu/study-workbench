import type { RuntimeConfig } from '@study/contracts';
import type { BffConfig } from './config.js';
/** This is BFF support only. Authenticated API capability receipts are separate. */
export function publicRuntimeConfig(config: BffConfig): RuntimeConfig {
    return { apiUrl: '', auth_mode: config.mode, web_session_protocol: config.webSessionProtocol,
        client_contracts: ['workspace-view-v1'], ui_transport_protocol: 1 };
}
