import { expect, it, vi } from 'vitest';
import { loadRuntimeConfig, parseSessionMetadata, parseWebStatus } from '../../data/config';
const config = { apiUrl: '', auth_mode: 'legacy_password', web_session_protocol: null, client_contracts: ['workspace-view-v1'], ui_transport_protocol: 1 };
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }); }

it('rejects non-same-origin config, incompatible protocol and malformed session metadata', async () => {
    for (const patch of [{ apiUrl: 'https://evil.test' }, { ui_transport_protocol: 2 }, { client_contracts: [] }, { auth_mode: 'future' }]) {
        vi.stubGlobal('fetch', vi.fn(async () => json({ ...config, ...patch })));
        await expect(loadRuntimeConfig()).rejects.toThrow();
    }
    expect(() => parseSessionMetadata({ session_id: 's', generation: 0, access_expires_at: 'bad', refresh_expires_at: 'bad' })).toThrow();
    expect(() => parseWebStatus({ auth_enabled: true, auth_mode: 'device_sessions', protocol_version: 1, web: { phase: 'authenticated', session: null } })).toThrow();
});
