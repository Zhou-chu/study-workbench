import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { invalidateTurnContext, readTurnContext, sessionCoordinator } from '@study/web-transport';
import { AppProviders } from '../../app/providers';
import { WorkbenchSession, useWorkbenchSession } from '../../app/WorkbenchSession';
import { createSessionController, type SessionController } from './session';

const legacyConfig = { apiUrl: '', auth_mode: 'legacy_password', web_session_protocol: null, client_contracts: ['workspace-view-v1'], ui_transport_protocol: 1 };
const deviceConfig = { ...legacyConfig, auth_mode: 'device_sessions', web_session_protocol: 'bff-memory-v1' };
const capabilities = { contract_version: 'client-capabilities-v1', supported_contracts: ['workspace-view-v1'], limits: { source_upload_max_bytes: 50, portable: { max_archive_bytes: 10, max_expanded_bytes: 20, max_entity_bytes: 10, max_manifest_bytes: 10, max_request_bytes: 30, multipart_overhead_bytes: 10, max_entries: 2, max_compression_ratio: 5 } } };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const missingHeader = () => json({ detail: 'Missing authorization header' }, 401);
const controllers: SessionController[] = [];
function controller() { const value = createSessionController(); controllers.push(value); return value; }
beforeEach(() => { localStorage.clear(); invalidateTurnContext(); sessionCoordinator.begin(); sessionCoordinator.setPhase('bootstrapping'); });
afterEach(() => { controllers.splice(0).forEach(value => value.dispose()); });

/** Only fetch is replaced: controller, session client, transport and admission are real. */
function handshake(probe: (request: Request) => Response | Promise<Response> = missingHeader, device = false, status?: () => Response) {
    const requests: Request[] = [];
    vi.stubGlobal('fetch', async (request: Request) => {
        requests.push(request);
        const path = new URL(request.url).pathname;
        if (path === '/config') return json(device ? deviceConfig : legacyConfig);
        if (path === '/api/auth/status') return status?.() ?? (device
            ? json({ auth_enabled: true, auth_mode: 'device_sessions', protocol_version: 1, web: { phase: 'anonymous', session: null } })
            : json({ auth_enabled: true, message: 'Authentication is required' }));
        if (path === '/api/notebooks' || path === '/api/auth/sessions') return probe(request);
        if (path === '/api/personal/client-capabilities') return json(capabilities);
        throw new Error('Unexpected synthetic request: ' + request.method + ' ' + path);
    });
    return requests;
}

it('admits the exact live legacy anonymous handshake without protected readiness or dispatch', async () => {
    const requests = handshake();
    const session = controller();
    await session.start();
    expect(session.getSnapshot()).toMatchObject({ phase: 'anonymous', ready: false, hasWorkspace: false, issue: null, capabilities: null, providerVerification: null, busy: false });
    expect(readTurnContext()?.ready).toBe(false);
    await expect(session.transport.send({ method: 'GET', path: '/notebooks', context: readTurnContext()! })).rejects.toThrow();
    await expect(session.transport.send({ method: 'POST', path: '/notebooks', context: readTurnContext()!, body: '{}' })).rejects.toThrow();
    expect(requests.map(request => [request.method, new URL(request.url).pathname])).toEqual([
        ['GET', '/config'], ['GET', '/api/auth/status'], ['GET', '/api/notebooks'],
    ]);
    expect(requests.every(request => !request.headers.has('Authorization'))).toBe(true);
    expect(localStorage.length).toBe(0);
});

it('renders the real login form from the exact missing-header handshake without mounting a workspace', async () => {
    const requests = handshake();
    render(<AppProviders locale="en-US"><MemoryRouter><WorkbenchSession><p>Protected workspace</p></WorkbenchSession></MemoryRouter></AppProviders>);
    expect(await screen.findByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect(screen.queryByText('Protected workspace')).not.toBeInTheDocument();
    expect(requests.map(request => new URL(request.url).pathname)).toEqual(['/config', '/api/auth/status', '/api/notebooks']);
});

it.each([
    ['unknown detail', () => json({ detail: 'Unknown authentication error' }, 401)],
    ['extra field', () => json({ detail: 'Missing authorization header', extra: true }, 401)],
    ['wrong case', () => json({ detail: 'missing authorization header' }, 401)],
    ['extra whitespace', () => json({ detail: 'Missing authorization header ' }, 401)],
    ['non-string detail', () => json({ detail: ['Missing authorization header'] }, 401)],
    ['nested detail', () => json({ error: { detail: 'Missing authorization header' } }, 401)],
    ['unknown structured code', () => json({ error: { code: 'UNKNOWN' } }, 401)],
    ['unrecognized legacy structured code', () => json({ error: { code: 'LEGACY_MISSING_AUTHORIZATION' } }, 401)],
    ['null body', () => json(null, 401)],
    ['array body', () => json([{ detail: 'Missing authorization header' }], 401)],
    ['invalid JSON', () => new Response('{"detail":', { status: 401, headers: { 'content-type': 'application/json' } })],
    ['wrong HTTP status', () => json({ detail: 'Missing authorization header' }, 403)],
    ['server failure', () => json({ detail: 'Missing authorization header' }, 500)],
    ['ingress HTML', () => new Response('<html>Missing authorization header</html>', { status: 401, headers: { 'content-type': 'text/html' } })],
    ['network failure', () => { throw new TypeError('Failed to fetch'); }],
] as const)('keeps %s unavailable at the legacy probe', async (_name, response) => {
    const requests = handshake(response);
    const session = controller();
    await session.start();
    expect(session.getSnapshot()).toMatchObject({ phase: 'unavailable', ready: false, hasWorkspace: false, capabilities: null });
    expect(requests).toHaveLength(3);
    expect(requests.every(request => request.method === 'GET')).toBe(true);
});

it('does not normalize a device-session status failure into an anonymous login', async () => {
    const requests = handshake(missingHeader, true, missingHeader);
    const session = controller();
    await session.start();
    expect(session.getSnapshot()).toMatchObject({ phase: 'unavailable', ready: false, hasWorkspace: false });
    expect(requests.map(request => new URL(request.url).pathname)).toEqual(['/config', '/api/auth/status']);
});

it.each([false, true])('does not admit a missing-header failure from explicit login in device mode=%s or retry it', async device => {
    const requests = handshake(missingHeader, device);
    const session = controller();
    await session.start();
    await session.login('synthetic-password');
    expect(session.getSnapshot()).toMatchObject({ phase: 'unavailable', ready: false, hasWorkspace: false, capabilities: null });
    const loginRequests = requests.filter(request => new URL(request.url).pathname === (device ? '/api/auth/sessions' : '/api/notebooks'));
    expect(loginRequests).toHaveLength(device ? 1 : 2);
    expect(requests.filter(request => request.method === 'POST')).toHaveLength(device ? 1 : 0);
});

it.each([
    ['legacy invalid password', { detail: 'Invalid password' }],
    ['structured invalid credentials', { error: { code: 'AUTH_INVALID_CREDENTIALS' } }],
] as const)('preserves %s feedback after anonymous admission', async (_name, body) => {
    handshake(request => request.headers.has('Authorization') ? json(body, 401) : missingHeader());
    const session = controller();
    await session.start();
    await session.login('synthetic-wrong-password');
    expect(session.getSnapshot()).toMatchObject({ phase: 'anonymous', ready: false, hasWorkspace: false, issue: 'invalid-password' });
    expect(localStorage.length).toBe(0);
});

it.each([
    ['legacy invalid password', { detail: 'Invalid password' }],
    ['structured required', { error: { code: 'AUTH_REQUIRED' } }],
    ['structured invalid credentials', { error: { code: 'AUTH_INVALID_CREDENTIALS' } }],
] as const)('preserves anonymous admission for existing %s probe responses', async (_name, body) => {
    handshake(() => json(body, 401));
    const session = controller();
    await session.start();
    expect(session.getSnapshot()).toMatchObject({ phase: 'anonymous', ready: false, hasWorkspace: false, issue: null });
});

it('does not revive a locally signed-out session from a late missing-header probe', async () => {
    let finish: ((response: Response) => void) | undefined;
    const requests = handshake(() => new Promise<Response>(resolve => { finish = resolve; }));
    const session = controller();
    const startup = session.start();
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    await session.signoutLocal();
    finish!(missingHeader());
    await startup;
    await session.check();
    expect(session.getSnapshot()).toMatchObject({ phase: 'anonymous', ready: false, signedOutLocally: true, localSignoutConfirmed: true, serverRevocation: 'not-performed' });
    expect(requests).toHaveLength(3);
});

it('retains mounted note and File drafts when the legacy recheck needs missing-header reauthentication', async () => {
    let missing = false;
    const requests = handshake(() => missing ? missingHeader() : json([]));
    let current: ReturnType<typeof useWorkbenchSession> | undefined;
    function Child() { current = useWorkbenchSession(); return <><textarea aria-label="Retained note" defaultValue="unsent note"/><input aria-label="Retained file" type="file"/></>; }
    render(<AppProviders locale="en-US"><MemoryRouter><WorkbenchSession><Child/></WorkbenchSession></MemoryRouter></AppProviders>);
    const note = await screen.findByLabelText('Retained note');
    const field = screen.getByLabelText('Retained file');
    const file = new File(['synthetic draft'], 'draft.txt');
    fireEvent.change(field, { target: { files: [file] } });
    missing = true;
    await act(async () => { await current!.controller.check(); });
    expect(current!.controller.getSnapshot()).toMatchObject({ phase: 'reauth-required', ready: false, hasWorkspace: true, issue: null });
    expect(await screen.findByRole('dialog', { name: 'Sign in again' })).toBeVisible();
    expect(screen.getByLabelText('Retained note')).toBe(note);
    expect(note).toHaveValue('unsent note');
    expect(screen.getByLabelText('Retained file')).toBe(field);
    expect((field as HTMLInputElement).files?.[0]).toBe(file);
    expect(requests.filter(request => request.method !== 'GET')).toHaveLength(0);
});
