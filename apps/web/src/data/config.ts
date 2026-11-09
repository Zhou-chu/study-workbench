import { parseClientCapabilities, type ClientCapabilitiesV1, type RuntimeConfig } from '@study/contracts';
import { classifyIngressResponse, createWebTransport, TransportResponseError, type AuthPhase, type DispatchContext } from '@study/web-transport';
export class ConfigurationError extends Error {
    constructor() { super('Incompatible application configuration'); }
}
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ConfigurationError(); return value as Record<string, unknown>; }
export async function loadRuntimeConfig(signal?: AbortSignal): Promise<RuntimeConfig> {
    let response: Response;
    try {
        response = await fetch(new Request(new URL('/config', window.location.href), { credentials: 'same-origin', redirect: 'error', cache: 'no-store', ...(signal ? { signal } : {}) }));
    }
    catch {
        throw new TransportResponseError('unavailable');
    }
    const ingress = classifyIngressResponse(response, '/config');
    if (ingress)
        throw new TransportResponseError(ingress, response.status);
    if (!response.ok)
        throw new TransportResponseError('unavailable',response.status);
    const value = record(await response.json());
    if (value.apiUrl !== '' || value.ui_transport_protocol !== 1 || !Array.isArray(value.client_contracts) || !value.client_contracts.every(item => typeof item === 'string') || !value.client_contracts.includes('workspace-view-v1') || !['legacy_password', 'device_sessions'].includes(String(value.auth_mode)) || (value.auth_mode === 'device_sessions' ? value.web_session_protocol !== 'bff-memory-v1' : value.web_session_protocol !== null))
        throw new ConfigurationError();
    return Object.freeze({ apiUrl: '', auth_mode: value.auth_mode as RuntimeConfig['auth_mode'], web_session_protocol: value.web_session_protocol as RuntimeConfig['web_session_protocol'], client_contracts: Object.freeze([...value.client_contracts] as string[]), ui_transport_protocol: 1 });
}
/** The config authorizes transport selection, never API feature readiness. */
export async function loadClientCapabilities(context: DispatchContext, signal?: AbortSignal): Promise<ClientCapabilitiesV1> {
    const config: RuntimeConfig = { apiUrl: '', auth_mode: context.target.mode, web_session_protocol: context.target.protocol as RuntimeConfig['web_session_protocol'], client_contracts: ['workspace-view-v1'], ui_transport_protocol: 1 };
    const response = await createWebTransport(config).send({ method: 'GET', path: '/personal/client-capabilities', context, ...(signal ? { signal } : {}) });
    if (!response.ok)
        throw new TransportResponseError('unavailable',response.status);
    const value:unknown=await response.json();
    try { return parseClientCapabilities(value); } catch { throw new ConfigurationError(); }
}
export type SessionMetadata = Readonly<{
    session_id: string;
    generation: number;
    access_expires_at: string;
    refresh_expires_at: string;
}>;
export function parseSessionMetadata(value: unknown): SessionMetadata {
    const data = record(value);
    if (Object.keys(data).sort().join(',') !== 'access_expires_at,generation,refresh_expires_at,session_id' || typeof data.session_id !== 'string' || !data.session_id || data.session_id.length > 80 || typeof data.access_expires_at !== 'string' || !Number.isFinite(Date.parse(data.access_expires_at)) || typeof data.refresh_expires_at !== 'string' || !Number.isFinite(Date.parse(data.refresh_expires_at)) || !Number.isSafeInteger(data.generation) || (data.generation as number) < 0)
        throw new ConfigurationError();
    return Object.freeze({ session_id: data.session_id, generation: data.generation as number, access_expires_at: data.access_expires_at, refresh_expires_at: data.refresh_expires_at });
}
export function parseWebStatus(value: unknown): {
    phase: Exclude<AuthPhase, 'bootstrapping'>;
    session: SessionMetadata | null;
} {
    const data = record(value);
    const web = record(data.web);
    if (data.auth_enabled !== true || data.auth_mode !== 'device_sessions' || data.protocol_version !== 1 || !['anonymous', 'pending', 'authenticated', 'refresh-needed', 'reauth-required', 'unavailable'].includes(String(web.phase)))
        throw new ConfigurationError();
    const session = web.session === null ? null : parseSessionMetadata(web.session);
    if (web.phase === 'authenticated' && !session)
        throw new ConfigurationError();
    return { phase: web.phase as Exclude<AuthPhase, 'bootstrapping'>, session };
}
export async function errorCode(response: Response): Promise<string | null> {
    try {
        const body = record(await response.clone().json());
        if (Object.keys(body).length === 1 && body.detail === 'Invalid password')
            return 'LEGACY_INVALID_PASSWORD';
        return typeof record(body.error).code === 'string' ? String(record(body.error).code) : null;
    }
    catch {
        return null;
    }
}
