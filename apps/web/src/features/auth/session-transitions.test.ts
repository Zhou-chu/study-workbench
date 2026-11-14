import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invalidateTurnContext, readTurnContext, sessionCoordinator } from '@study/web-transport';
import { createSessionController, evaluateCompatibility, type SessionController } from './session';
import type { SpaArtifactManifest } from '../../data/artifact';
const manifest: SpaArtifactManifest = {
    schema_version: 'spa-artifact-v1', source_commit: 'a'.repeat(40), authored_digest: 'b'.repeat(64), asset_digest: 'c'.repeat(64), contract_digest: 'd'.repeat(64), ui_transport_protocol: 1, supported_contracts: ['workspace-view-v1']
};
const config = {
    apiUrl: '', auth_mode: 'device_sessions', web_session_protocol: 'bff-memory-v1', client_contracts: ['workspace-view-v1'], ui_transport_protocol: 1
};
const capabilities = {
    contract_version: 'client-capabilities-v1', supported_contracts: ['workspace-view-v1'], limits: {
        source_upload_max_bytes: 50, portable: {
            max_archive_bytes: 10, max_expanded_bytes: 20, max_entity_bytes: 10, max_manifest_bytes: 10, max_request_bytes: 30, multipart_overhead_bytes: 10, max_entries: 2, max_compression_ratio: 5
        }
    }
};
const metadata = (id = 'fixture') => ({
    session_id: id, generation: 1, access_expires_at: '2030-01-01T00:00:00Z', refresh_expires_at: '2031-01-01T00:00:00Z'
});
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), {
    status, headers: {
        'content-type': 'application/json'
    }
});
const status = (id = 'fixture') => json({
    auth_enabled: true, auth_mode: 'device_sessions', protocol_version: 1, web: {
        phase: 'authenticated', session: metadata(id)
    }
});
const controllers: SessionController[] = [];
function controller() {
    const retired = vi.fn();
    const session = createSessionController(retired, async () => manifest);
    controllers.push(session);
    return {
        session, retired
    };
}
function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>(r => {
        resolve = r;
    });
    return {
        promise, resolve
    };
}
function server(overrides: Record<string, () => Response | Promise<Response>> = {}) {
    const requests: Request[] = [];
    vi.stubGlobal('fetch', vi.fn(async (request: Request) => {
        requests.push(request);
        const path = new URL(request.url).pathname;
        if (overrides[path])
            return overrides[path]();
        if (path === '/config')
            return json(config);
        if (path === '/api/auth/status')
            return status();
        if (path === '/api/personal/client-capabilities')
            return json(capabilities);
        if (path === '/api/auth/sessions/refresh')
            return json(metadata());
        throw Error('Unexpected synthetic request ' + path);
    }));
    return requests;
}
beforeEach(() => {
    invalidateTurnContext();
    sessionCoordinator.begin();
    sessionCoordinator.setPhase('bootstrapping');
});
afterEach(() => {
    controllers.splice(0).forEach(s => s.dispose());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});
it.each([null, {}, {
        ...manifest, ui_transport_protocol: 2
    }])('rejects absent or invalid local artifact %j', local => {
    expect(evaluateCompatibility(local, config, capabilities)).toBe(local === null ? 'unavailable' : 'blocked');
});
it.each([{
        ...config, apiUrl: 'https://other.invalid'
    }, {
        ...config, auth_mode: 'future'
    }, {
        ...config, web_session_protocol: null
    }])('rejects incompatible runtime %j', runtime => {
    expect(evaluateCompatibility(manifest, runtime, capabilities)).toBe('blocked');
});
it('rejects malformed API capabilities rather than assuming compatibility', () => {
    expect(evaluateCompatibility(manifest, config, {})).toBe('blocked');
});
it('refreshes the same device identity without retiring the workspace', async () => {
    const requests = server();
    const { session, retired } = controller();
    await session.start();
    const epoch = readTurnContext()!.epoch;
    await session.refresh();
    expect(session.getSnapshot()).toMatchObject({
        ready: true, phase: 'authenticated', busy: false
    });
    expect(readTurnContext()!.epoch).toBe(epoch);
    expect(retired).not.toHaveBeenCalled();
    expect(requests.filter(r => new URL(r.url).pathname === '/api/auth/sessions/refresh')).toHaveLength(1);
});
it('retires identity when refresh returns a new session and checks its status', async () => {
    let changed = false;
    server({
        '/api/auth/sessions/refresh': () => {
            changed = true;
            return json(metadata('new'));
        }, '/api/auth/status': () => status(changed ? 'new' : 'fixture')
    });
    const { session, retired } = controller();
    await session.start();
    const epoch = readTurnContext()!.epoch;
    await session.refresh();
    expect(retired).toHaveBeenCalledWith(epoch);
    expect(readTurnContext()!.epoch).not.toBe(epoch);
    expect(session.getSnapshot()).toMatchObject({
        ready: true, privacyChanged: true
    });
});
it.each([['AUTH_REQUIRED', 'reauth-required'], ['ACCESS_EXPIRED', 'refresh-needed'], ['AUTH_PENDING', 'pending']] as const)('refresh failure %s preserves precise recovery state', async (code, phase) => {
    server({
        '/api/auth/sessions/refresh': () => json({
            error: {
                code
            }
        }, 401)
    });
    const { session } = controller();
    await session.start();
    await session.refresh();
    expect(session.getSnapshot()).toMatchObject({
        ready: false, phase, busy: false
    });
});
it.each([() => json({
        error: {
            code: 'UNKNOWN'
        }
    }, 409), () => json(metadata(), 201), () => json({
        invalid: 'metadata'
    })])('rejects unexpected refresh receipts', async (receipt) => {
    server({
        '/api/auth/sessions/refresh': receipt
    });
    const { session } = controller();
    await session.start();
    await session.refresh();
    expect(session.getSnapshot()).toMatchObject({
        ready: false, phase: 'unavailable', compatibility: 'blocked', issue: 'connection', busy: false
    });
});
it('does not accept a refresh response after privacy retirement', async () => {
    const pending = deferred<Response>();
    const requests = server({
        '/api/auth/sessions/refresh': () => pending.promise
    });
    const { session } = controller();
    await session.start();
    const task = session.refresh();
    await vi.waitFor(() => expect(requests.some(r => new URL(r.url).pathname.endsWith('/refresh'))).toBe(true));
    session.retirePrivacyContext();
    pending.resolve(json(metadata('late')));
    await task;
    expect(session.getSnapshot()).toMatchObject({
        ready: false, privacyChanged: true, busy: false
    });
    expect(requests.filter(r => new URL(r.url).pathname === '/api/auth/status')).toHaveLength(1);
});
it('deduplicates concurrent refresh without replaying caller work', async () => {
    const pending = deferred<Response>();
    const requests = server({
        '/api/auth/sessions/refresh': () => pending.promise
    });
    const { session } = controller();
    await session.start();
    const first = session.refresh();
    const second = session.refresh();
    await vi.waitFor(() => expect(requests.filter(r => new URL(r.url).pathname.endsWith('/refresh'))).toHaveLength(1));
    pending.resolve(json(metadata()));
    await Promise.all([first, second]);
    expect(session.getSnapshot().ready).toBe(true);
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
});
it('ignores delayed status when the controller is disposed', async () => {
    const pending = deferred<Response>();
    const requests = server({
        '/api/auth/status': () => pending.promise
    });
    const { session } = controller();
    const task = session.start();
    await vi.waitFor(() => expect(requests.some(r => new URL(r.url).pathname === '/api/auth/status')).toBe(true));
    session.dispose();
    pending.resolve(status());
    await task;
    expect(session.getSnapshot().ready).toBe(false);
    expect(requests.some(r => new URL(r.url).pathname.includes('client-capabilities'))).toBe(false);
});
it('ignores a stale capability success after scope retirement', async () => {
    const pending = deferred<Response>();
    const requests = server({
        '/api/personal/client-capabilities': () => pending.promise
    });
    const { session } = controller();
    const task = session.start();
    await vi.waitFor(() => expect(requests.some(r => new URL(r.url).pathname.includes('client-capabilities'))).toBe(true));
    session.retirePrivacyContext();
    pending.resolve(json(capabilities));
    await task;
    expect(session.getSnapshot()).toMatchObject({
        ready: false, capabilities: null
    });
});
it('ignores unrelated storage changes in device mode', async () => {
    server();
    const { session, retired } = controller();
    await session.start();
    window.dispatchEvent(new StorageEvent('storage', {
        key: null
    }));
    expect(session.getSnapshot().ready).toBe(true);
    expect(retired).not.toHaveBeenCalled();
});
it('unsubscribes listeners and ignores provider checks after disposal', async () => {
    server();
    const { session } = controller();
    const changed = vi.fn();
    const unsubscribe = session.subscribe(changed);
    await session.start();
    unsubscribe();
    changed.mockClear();
    session.openReauth();
    expect(changed).not.toHaveBeenCalled();
    session.dispose();
    expect(await session.verifyProviderConnection()).toBe(false);
});
it('treats stale application response as retired without changing a newer handshake', async () => {
    const pending = deferred<Response>();
    server({
        '/api/notebooks': () => pending.promise
    });
    const { session } = controller();
    await session.start();
    const request = session.transport.send({
        method: 'GET', path: '/notebooks', context: readTurnContext()!
    });
    await session.check();
    pending.resolve(json([]));
    await expect(request).rejects.toMatchObject({
        kind: 'retired'
    });
    expect(session.getSnapshot()).toMatchObject({
        ready: true, phase: 'authenticated'
    });
});
it('suspends expired admission and never replays the rejected mutation', async () => {
    let now = 100000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const requests = server();
    const { session } = controller();
    await session.start();
    const context = readTurnContext()!;
    now += 60000;
    await expect(session.transport.send({
        method: 'POST', path: '/notebooks', context, body: '{}'
    })).rejects.toMatchObject({
        reason: 'configuration'
    });
    await vi.waitFor(() => expect(session.getSnapshot().ready).toBe(true));
    expect(requests.filter(r => new URL(r.url).pathname === '/api/notebooks')).toHaveLength(0);
});
it.each([() => json(metadata(), 200), () => json({
        invalid: 'metadata'
    }, 201), () => json({
        error: {
            code: 'UNKNOWN'
        }
    }, 409)])('device login rejects malformed or unrecognized success/error receipts', async (receipt) => {
    server({
        '/api/auth/sessions': receipt
    });
    const { session } = controller();
    await session.start();
    await session.login('fixture-not-a-credential');
    expect(session.getSnapshot()).toMatchObject({
        ready: false, phase: 'unavailable', compatibility: 'blocked', busy: false
    });
});
it('local signout is idempotent and cannot be undone by check or reauth toggles', async () => {
    const requests = server({
        '/api/auth/web-signout-local': () => json({
            server_revocation: 'unconfirmed'
        })
    });
    const { session } = controller();
    await session.start();
    await session.signoutLocal();
    expect(session.getSnapshot()).toMatchObject({
        ready: false, phase: 'anonymous', signedOutLocally: true, localSignoutConfirmed: true, serverRevocation: 'unconfirmed'
    });
    const before = requests.length;
    await session.signoutLocal();
    await session.check();
    session.closeReauth();
    session.openReauth();
    expect(requests).toHaveLength(before);
    expect(session.getSnapshot().reauthOpen).toBe(true);
});
it('deduplicates pending signout and blocks refresh while its receipt is uncertain', async () => {
    const pending = deferred<Response>();
    const requests = server({
        '/api/auth/web-signout-local': () => pending.promise
    });
    const { session } = controller();
    await session.start();
    const first = session.signoutLocal();
    const second = session.signoutLocal();
    const refresh = session.refresh();
    expect(first).toBe(second);
    expect(session.getSnapshot()).toMatchObject({
        ready: false, busy: true, localSignoutConfirmed: false
    });
    pending.resolve(json({
        server_revocation: 'unconfirmed'
    }));
    await Promise.all([first, second, refresh]);
    expect(requests.filter(r => new URL(r.url).pathname === '/api/auth/web-signout-local')).toHaveLength(1);
    expect(requests.some(r => new URL(r.url).pathname.endsWith('/refresh'))).toBe(false);
});
it('failed local signout stays locked and allows only an explicit retry', async () => {
    let attempts = 0;
    const requests = server({
        '/api/auth/web-signout-local': () => {
            attempts++;
            if (attempts === 1)
                throw new TypeError('fixture connection failed');
            return json({
                error: {
                    code: 'AUTH_REQUIRED'
                }
            }, 401);
        }
    });
    const { session, retired } = controller();
    await session.start();
    await session.signoutLocal();
    expect(session.getSnapshot()).toMatchObject({
        ready: false, signedOutLocally: true, localSignoutConfirmed: false, issue: 'connection', busy: false
    });
    await session.signoutLocal();
    expect(session.getSnapshot()).toMatchObject({
        ready: false, localSignoutConfirmed: true, issue: null
    });
    expect(retired).toHaveBeenCalledTimes(1);
    expect(requests.filter(r => new URL(r.url).pathname === '/api/auth/web-signout-local')).toHaveLength(2);
});
it('late signout confirmation cannot mutate a disposed controller snapshot', async () => {
    const pending = deferred<Response>();
    server({
        '/api/auth/web-signout-local': () => pending.promise
    });
    const { session } = controller();
    await session.start();
    const task = session.signoutLocal();
    session.dispose();
    const before = session.getSnapshot();
    pending.resolve(json({
        server_revocation: 'unconfirmed'
    }));
    await task;
    expect(session.getSnapshot()).toBe(before);
    expect(session.getSnapshot().localSignoutConfirmed).toBe(false);
});
