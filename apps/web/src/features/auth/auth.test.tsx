import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, createMemoryRouter, RouterProvider } from 'react-router';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { AppRoutes } from '../../app/router';
import { AppProviders } from '../../app/providers';
import { WorkbenchSession, useWorkbenchSession } from '../../app/WorkbenchSession';
import { createSessionController } from './session';
import { loadRuntimeConfig, parseSessionMetadata, parseWebStatus } from '../../data/config';
import { invalidateTurnContext, readTurnContext, sessionCoordinator } from '@study/web-transport';
const config = { apiUrl: '', auth_mode: 'legacy_password', web_session_protocol: null, client_contracts: ['workspace-view-v1'], ui_transport_protocol: 1 };
const capabilities = { contract_version: 'client-capabilities-v1', supported_contracts: ['workspace-view-v1'], limits: { source_upload_max_bytes: 50, portable: { max_archive_bytes: 10, max_expanded_bytes: 20, max_entity_bytes: 10, max_manifest_bytes: 10, max_request_bytes: 30, multipart_overhead_bytes: 10, max_entries: 2, max_compression_ratio: 5 } } };
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }); }
beforeEach(() => { invalidateTurnContext(); sessionCoordinator.begin(); sessionCoordinator.setPhase('bootstrapping'); });
function server(options: {
    enabled?: boolean;
    capStatus?: number;
    resource?: () => Response;
    status?: () => Response;
} = {}) {
    const requests: Request[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: Request | string) => {
        const request = input instanceof Request ? input : new Request(new URL(input, window.location.href));
        requests.push(request);
        const path = new URL(request.url).pathname;
        if (path === '/config')
            return json(config);
        if (path === '/api/auth/status')
            return options.status?.() ?? json({ auth_enabled: options.enabled ?? false });
        if (path === '/api/notebooks' && request.method === 'GET' && options.enabled)
            return request.headers.has('Authorization') ? json([]) : json({ detail: 'Invalid password' }, 401);
        if (path === '/api/personal/client-capabilities')
            return json(capabilities, options.capStatus ?? 200);
        return options.resource?.() ?? json({ ok: true });
    }));
    return requests;
}
it('validates both handshakes and gates every mutation until real API capability succeeds', async () => {
    const requests = server({ capStatus: 404 });
    const session = createSessionController();
    await session.start();
    expect(session.getSnapshot()).toMatchObject({ phase: 'authenticated', ready: false, issue: 'capabilities' });
    await expect(session.transport.send({ method: 'POST', path: '/notebooks', context: readTurnContext()! })).rejects.toThrow();
    expect(requests.some(r => r.method === 'POST')).toBe(false);
    session.dispose();
});
it.each([
    ['ingress', () => new Response('<html>access</html>', { headers: { 'content-type': 'text/html' } })],
    ['connection', () => { throw new TypeError('Failed to fetch'); }],
] as const)('distinguishes %s from application logout and never replays writes', async (issue, resource) => {
    const requests = server({ resource });
    const session = createSessionController();
    await session.start();
    await expect(session.transport.send({ method: 'POST', path: '/notebooks', context: readTurnContext()! })).rejects.toThrow();
    expect(session.getSnapshot().issue).toBe(issue);
    expect(session.getSnapshot().phase).not.toBe('anonymous');
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
    session.dispose();
});
it('keeps Google availability separate without suspending app readiness or retiring the scope', async () => {
    server({ resource: () => json({ error: { code: 'NEEDS_REAUTH' } }, 401) });
    const session = createSessionController();
    await session.start();
    const before = readTurnContext()!;
    await session.transport.send({ method: 'GET', path: '/personal/notebooklm/capabilities', context: before });
    expect(session.getSnapshot()).toMatchObject({ phase: 'authenticated', providerNeedsReauth: true, ready: true });
    expect(readTurnContext()?.epoch).toBe(before.epoch);
    session.dispose();
});
it('rejects non-same-origin config, incompatible protocol and malformed session metadata', async () => {
    for (const patch of [{ apiUrl: 'https://evil.test' }, { ui_transport_protocol: 2 }, { client_contracts: [] }, { auth_mode: 'future' }]) {
        vi.stubGlobal('fetch', vi.fn(async () => json({ ...config, ...patch })));
        await expect(loadRuntimeConfig()).rejects.toThrow();
    }
    expect(() => parseSessionMetadata({ session_id: 's', generation: 0, access_expires_at: 'bad', refresh_expires_at: 'bad' })).toThrow();
    expect(() => parseWebStatus({ auth_enabled: true, auth_mode: 'device_sessions', protocol_version: 1, web: { phase: 'authenticated', session: null } })).toThrow();
});
it('uses existing legacy custody only, empties password input, and does not store drafts or File', async () => {
    server({ enabled: true });
    render(<AppProviders locale="en-US"><MemoryRouter><WorkbenchSession><p>Workspace child</p></WorkbenchSession></MemoryRouter></AppProviders>);
    const input = await screen.findByLabelText('Password');
    fireEvent.change(input, { target: { value: 'synthetic-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('Workspace child');
    expect(Object.keys(localStorage)).toEqual(['auth-storage']);
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
});
it('preserves real child DOM, File and note across application reauthentication and capability outages', async () => {
    let bad = false;
    server({ resource: () => bad ? json({ error: { code: 'AUTH_REQUIRED' } }, 401) : json({}) });
    let current: ReturnType<typeof useWorkbenchSession> | undefined;
    function Child() { current = useWorkbenchSession(); return <><textarea aria-label="Note" defaultValue="草稿"/><input aria-label="File" type="file"/></>; }
    render(<AppProviders locale="en-US"><MemoryRouter><WorkbenchSession><Child /></WorkbenchSession></MemoryRouter></AppProviders>);
    const note = await screen.findByLabelText('Note');
    const field = screen.getByLabelText('File');
    const file = new File(['fixture'], 'notes.txt');
    fireEvent.change(field, { target: { files: [file] } });
    bad = true;
    await act(async () => { await current!.transport.send({ method: 'GET', path: '/notebooks', context: readTurnContext()! }); });
    expect(await screen.findByRole('dialog', { name: 'Sign in again' })).toBeVisible();
    expect(screen.getByLabelText('Note')).toBe(note);
    expect(note).toHaveValue('草稿');
    expect((field as HTMLInputElement).files?.[0]).toBe(file);
});
it('keeps device credentials absent and requires a stable-cookie status before authenticating', async () => {
    const metadata = { session_id: 's', generation: 1, access_expires_at: '2030-01-01T00:00:00Z', refresh_expires_at: '2031-01-01T00:00:00Z' };
    localStorage.setItem('auth-storage', 'synthetic legacy data');
    const requests: Request[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: Request) => {
        requests.push(input);
        const path = new URL(input.url).pathname;
        if (path === '/config')
            return json({ ...config, auth_mode: 'device_sessions', web_session_protocol: 'bff-memory-v1' });
        if (path === '/api/auth/sessions')
            return json(metadata, 201);
        return json({ auth_enabled: true, auth_mode: 'device_sessions', protocol_version: 1, web: { phase: 'pending', session: metadata } });
    }));
    const session = createSessionController();
    await session.start();
    await session.login('synthetic');
    expect(session.getSnapshot().ready).toBe(false);
    expect(session.getSnapshot().phase).toBe('pending');
    expect(localStorage.length).toBe(0);
    expect(requests.every(r => !r.headers.has('Authorization'))).toBe(true);
    session.dispose();
});
it('retires old epoch on a fresh legacy login, never treats same endpoint as identity', async () => {
    server();
    const session = createSessionController();
    await session.start();
    const old = readTurnContext();
    expect(old).not.toBeNull();
    await session.login('synthetic');
    expect(readTurnContext()!.epoch).not.toBe(old?.epoch);
    expect(session.getSnapshot().privacyChanged).toBe(true);
    session.dispose();
});
it('ignores late configuration after disposal', async () => {
    let resolve!: (r: Response) => void;
    vi.stubGlobal('fetch', () => new Promise<Response>(r => { resolve = r; }));
    const session = createSessionController();
    const promise = session.start();
    session.dispose();
    expect(resolve).toBeTypeOf('function');
    resolve(json(config));
    await promise;
    expect(session.getSnapshot().ready).toBe(false);
});
it('suspends on a cross-tab auth-storage change without reading or adopting its credentials', async () => {
    server();
    const session = createSessionController();
    await session.start();
    const old = readTurnContext()!;
    window.dispatchEvent(new StorageEvent('storage', { key: 'auth-storage', newValue: 'never inspect this credential' }));
    expect(session.getSnapshot()).toMatchObject({ ready: false, phase: 'reauth-required', privacyChanged: true });
    expect(readTurnContext()?.epoch).not.toBe(old.epoch);
    session.dispose();
});
it('does not resume an auth-loss boundary through Check connection with a different saved legacy identity', async () => {
    server({ resource: () => json({ error: { code: 'AUTH_REQUIRED' } }, 401) });
    const session = createSessionController();
    await session.start();
    await session.transport.send({ method: 'GET', path: '/other', context: readTurnContext()! });
    await session.check();
    expect(session.getSnapshot()).toMatchObject({ ready: false, phase: 'reauth-required' });
    session.dispose();
});
it('does not expose mutating transport while capability handshake is pending', async () => {
    const requests = server();
    const base = globalThis.fetch;
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', async (input: Request) => new URL(input.url).pathname === '/api/personal/client-capabilities' ? new Promise<Response>(resolve => { finish = resolve; }) : base(input));
    const session = createSessionController();
    const startup = session.start();
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    await expect(session.transport.send({ method: 'POST', path: '/notebooks', context: readTurnContext()! })).rejects.toThrow();
    expect(requests.some(r => r.method === 'POST')).toBe(false);
    finish(json(capabilities));
    await startup;
    expect(session.getSnapshot().ready).toBe(true);
    session.dispose();
});
it('recovers capability availability without retiring or reissuing the old mutation', async () => {
    let capStatus = 404;
    const requests = server();
    const base = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: Request) => new URL(input.url).pathname === '/api/personal/client-capabilities' ? json(capabilities, capStatus) : base(input));
    const session = createSessionController();
    await session.start();
    const epoch = readTurnContext()!.epoch;
    capStatus = 200;
    await session.check();
    expect(session.getSnapshot().ready).toBe(true);
    expect(readTurnContext()!.epoch).toBe(epoch);
    expect(requests.every(r => r.method === 'GET')).toBe(true);
    session.dispose();
});
it('protects a real notebook question on home navigation and preserves it through theme and settings', async () => {
    server();
    const router = createMemoryRouter([{ path: '*', element: <AppProviders locale="en-US"><WorkbenchSession><AppRoutes /></WorkbenchSession></AppProviders> }], { initialEntries: ['/notebooks/A'] });
    render(<RouterProvider router={router}/>);
    const question = await screen.findByLabelText('Question draft');
    fireEvent.change(question, { target: { value: 'unsent question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    fireEvent.click(screen.getByRole('button', { name: 'Appearance and language' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByLabelText('Question draft')).toBe(question);
    expect(question).toHaveValue('unsent question');
    fireEvent.click(screen.getByRole('link', { name: 'My notebooks' }));
    expect(await screen.findByRole('dialog', { name: 'Leave this draft?' })).toBeVisible();
    fireEvent.click(screen.getByText('Keep editing'));
    expect(router.state.location.pathname).toBe('/notebooks/A');
    expect(question).toHaveValue('unsent question');
    expect(Object.keys(localStorage)).toEqual(['study-workbench.appearance.v1']);
});
it('does not revive a locally signed-out screen from a late device login body', async () => {
    const metadata = { session_id: 's', generation: 1, access_expires_at: '2030-01-01T00:00:00Z', refresh_expires_at: '2031-01-01T00:00:00Z' };
    let body: ReadableStreamDefaultController<Uint8Array> | undefined;
    let authenticated = false;
    vi.stubGlobal('fetch', async (input: Request) => {
        const path = new URL(input.url).pathname;
        if (path === '/config')
            return json({ ...config, auth_mode: 'device_sessions', web_session_protocol: 'bff-memory-v1' });
        if (path === '/api/auth/status')
            return json({ auth_enabled: true, auth_mode: 'device_sessions', protocol_version: 1, web: { phase: authenticated ? 'authenticated' : 'anonymous', session: authenticated ? metadata : null } });
        if (path === '/api/auth/sessions')
            return new Response(new ReadableStream<Uint8Array>({ start(controller) { body = controller; } }), { status: 201, headers: { 'content-type': 'application/json' } });
        if (path === '/api/auth/web-signout-local')
            return json({ server_revocation: 'unconfirmed' });
        return json(capabilities);
    });
    const session = createSessionController();
    await session.start();
    const login = session.login('synthetic');
    await waitFor(() => expect(body).toBeDefined());
    await session.signoutLocal();
    authenticated = true;
    body!.enqueue(new TextEncoder().encode(JSON.stringify(metadata)));
    body!.close();
    await login;
    await session.check();
    expect(session.getSnapshot()).toMatchObject({ phase: 'anonymous', ready: false });
    session.dispose();
});
it('retires cached server data on fresh authentication while retaining mounted draft nodes', async () => {
    server();
    let controller: ReturnType<typeof useWorkbenchSession>['controller'] | undefined;
    let queries: QueryClient | undefined;
    function Child() { controller = useWorkbenchSession().controller; queries = useQueryClient(); return <textarea aria-label="Cached draft" defaultValue="keep"/>; }
    render(<AppProviders locale="en-US"><MemoryRouter><WorkbenchSession><Child /></WorkbenchSession></MemoryRouter></AppProviders>);
    const draft = await screen.findByLabelText('Cached draft');
    queries!.setQueryData(['private-workspace'], { private: 'old user' });
    await act(async () => { await controller!.login('synthetic'); });
    expect(queries!.getQueryData(['private-workspace'])).toBeUndefined();
    expect(screen.getByLabelText('Cached draft')).toBe(draft);
    expect(draft).toHaveValue('keep');
});
it.each([['AUTH_PENDING', 'pending'], ['ACCESS_EXPIRED', 'refresh-needed'], ['AUTH_REQUIRED', 'reauth-required']] as const)('preserves the precise %s recovery phase from an auth endpoint', async (code, expected) => {
    server({ status: () => json({ error: { code } }, 401) });
    const session = createSessionController();
    await session.start();
    expect(session.getSnapshot()).toMatchObject({ phase: expected, ready: false });
    session.dispose();
});
it('keeps repair routes usable and clears provider recovery only after explicit verified status', async () => {
    const requests = server();
    const base = globalThis.fetch;
    let providerState = 'needs_reauth';
    vi.stubGlobal('fetch', async (input: Request) => {
        const path = new URL(input.url).pathname;
        if (path === '/api/personal/notebooklm/notebooks') {
            requests.push(input);
            return json({ error: { code: 'NEEDS_REAUTH' } }, 401);
        }
        if (path === '/api/personal/connections/notebooklm') {
            requests.push(input);
            return json({ state: providerState, reason: null, last_verified_at: null, account_label: null, quota: null });
        }
        if (path === '/api/personal/connections/notebooklm/reconnect') {
            requests.push(input);
            return json({ flow_id: 'synthetic-flow', state: 'awaiting_user_login' });
        }
        if (path === '/api/personal/connections/notebooklm/connect/synthetic-flow') {
            requests.push(input);
            return json({ flow_id: 'synthetic-flow', state: 'awaiting_user_login' });
        }
        return base(input);
    });
    const session = createSessionController();
    await session.start();
    const epoch = readTurnContext()!.epoch;
    await session.transport.send({ method: 'GET', path: '/personal/notebooklm/notebooks', context: readTurnContext()! });
    expect(session.getSnapshot()).toMatchObject({ phase: 'authenticated', ready: true, providerNeedsReauth: true });
    for (const [method, path] of [['GET', '/personal/connections/notebooklm'], ['POST', '/personal/connections/notebooklm/reconnect'], ['GET', '/personal/connections/notebooklm/connect/synthetic-flow']] as const) {
        await expect(session.transport.send({ method, path, context: readTurnContext()! })).resolves.toBeInstanceOf(Response);
    }
    await session.check();
    expect(session.getSnapshot().providerNeedsReauth).toBe(true);
    expect(readTurnContext()!.epoch).toBe(epoch);
    providerState = 'connected';
    await session.transport.send({ method: 'GET', path: '/personal/connections/notebooklm', context: readTurnContext()! });
    expect(session.getSnapshot().providerNeedsReauth).toBe(true);
    await session.verifyProviderConnection();
    expect(session.getSnapshot().providerNeedsReauth).toBe(false);
    expect(readTurnContext()!.epoch).toBe(epoch);
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
    session.dispose();
});
it('keeps malformed or unavailable provider verification unresolved without revoking application readiness', async () => {
    let verification: unknown = { state: 'needs_reauth' };
    const requests = server();
    const base = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: Request) => new URL(input.url).pathname === '/api/personal/connections/notebooklm' ? (requests.push(input), json(verification)) : new URL(input.url).pathname === '/api/personal/notebooklm/notebooks' ? json({ error: { code: 'NEEDS_REAUTH' } }, 401) : base(input));
    const session = createSessionController();
    await session.start();
    await session.transport.send({ method: 'GET', path: '/personal/notebooklm/notebooks', context: readTurnContext()! });
    expect(session.getSnapshot().ready).toBe(true);
    for (const value of [{ state: 'connected', account_label: 7 }, { state: 'future' }, null, { state: 'unavailable', reason: null, last_verified_at: null, account_label: null, quota: null }]) {
        verification = value;
        await session.verifyProviderConnection();
        expect(session.getSnapshot()).toMatchObject({ ready: true, providerNeedsReauth: true });
    }
    await session.login('synthetic');
    expect(session.getSnapshot()).toMatchObject({ ready: true, providerNeedsReauth: true });
    session.retirePrivacyContext();
    await session.check();
    expect(session.getSnapshot().providerNeedsReauth).toBe(true);
    session.dispose();
});
it('does not let late Google decoding overwrite newer application-auth evidence', async () => {
    let release!: (value: unknown) => void;
    let decoding = false;
    const requests = server();
    const base = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: Request) => {
        const path = new URL(input.url).pathname;
        if (path === '/api/personal/notebooklm/notebooks') {
            requests.push(input);
            const response = json({ error: { code: 'NEEDS_REAUTH' } }, 401);
            const nativeClone = response.clone.bind(response);
            vi.spyOn(response, 'clone').mockImplementation(() => { const copy = nativeClone(); vi.spyOn(copy, 'json').mockImplementation(() => { decoding = true; return new Promise<unknown>(resolve => { release = resolve; }); }); return copy; });
            return response;
        }
        if (path === '/api/private-read') {
            requests.push(input);
            return json({ error: { code: 'AUTH_REQUIRED' } }, 401);
        }
        return base(input);
    });
    const session = createSessionController();
    await session.start();
    const context = readTurnContext()!;
    const google = session.transport.send({ method: 'GET', path: '/personal/notebooklm/notebooks', context });
    await waitFor(() => expect(decoding).toBe(true));
    await session.transport.send({ method: 'GET', path: '/private-read', context });
    expect(session.getSnapshot()).toMatchObject({ phase: 'reauth-required', ready: false });
    release({ error: { code: 'NEEDS_REAUTH' } });
    await google;
    expect(session.getSnapshot()).toMatchObject({ phase: 'reauth-required', ready: false });
    expect(session.getSnapshot().issue).not.toBe('google');
    expect(requests.every(r => r.method === 'GET')).toBe(true);
    session.dispose();
});
it('marks an untouched old-scope question read-only and opens a fresh editor only on explicit intent', async () => {
    server();
    let controller: ReturnType<typeof useWorkbenchSession>['controller'] | undefined;
    function Probe() { controller = useWorkbenchSession().controller; return <AppRoutes />; }
    render(<AppProviders locale="en-US"><MemoryRouter initialEntries={['/notebooks/A']}><WorkbenchSession><Probe /></WorkbenchSession></MemoryRouter></AppProviders>);
    const question = await screen.findByLabelText('Question draft');
    expect(question).not.toHaveAttribute('readonly');
    await act(async () => { await controller!.login('synthetic'); });
    expect(screen.getByLabelText('Question draft')).toBe(question);
    expect(question).toHaveAttribute('readonly');
    fireEvent.click(screen.getByRole('button', { name: 'Start a new question draft' }));
    expect(question).not.toHaveAttribute('readonly');
    fireEvent.change(question, { target: { value: 'first new-scope keystrokes' } });
    expect(question).toHaveValue('first new-scope keystrokes');
});
it('renders an actionable provider warning without making the workspace inert or prefetching verification', async () => {
    const requests = server();
    const base = globalThis.fetch;
    let controller: ReturnType<typeof useWorkbenchSession>['controller'] | undefined;
    vi.stubGlobal('fetch', async (input: Request) => {
        const path = new URL(input.url).pathname;
        if (path === '/api/personal/notebooklm/notebooks') {
            requests.push(input);
            return json({ error: { code: 'NEEDS_REAUTH' } }, 401);
        }
        if (path === '/api/personal/connections/notebooklm') {
            requests.push(input);
            return json({ state: 'connected', account_label: null, last_verified_at: null, reason: null, quota: null });
        }
        return base(input);
    });
    function Child() { controller = useWorkbenchSession().controller; return <textarea aria-label="Local draft"/>; }
    render(<AppProviders locale="en-US"><MemoryRouter><WorkbenchSession><Child /></WorkbenchSession></MemoryRouter></AppProviders>);
    const field = await screen.findByLabelText('Local draft');
    await act(async () => { await controller!.transport.send({ method: 'GET', path: '/personal/notebooklm/notebooks', context: readTurnContext()! }); });
    expect(document.querySelector('.session-workspace')).not.toHaveAttribute('inert');
    fireEvent.change(field, { target: { value: 'still editable' } });
    expect(field).toHaveValue('still editable');
    expect(requests.filter(r => new URL(r.url).pathname === '/api/personal/connections/notebooklm')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Verify Google connection' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Verify Google connection' })).not.toBeInTheDocument());
    expect(requests.filter(r => new URL(r.url).pathname === '/api/personal/connections/notebooklm')).toHaveLength(1);
    expect(requests.every(r => r.method === 'GET')).toBe(true);
});
it.each(['auth-loss', 'new-provider-error', 'new-auth-check'] as const)('does not accept late provider verification after %s', async (change) => {
    const requests = server();
    const base = globalThis.fetch;
    let body: ReadableStreamDefaultController<Uint8Array> | undefined;
    vi.stubGlobal('fetch', async (input: Request) => {
        const path = new URL(input.url).pathname;
        if (path === '/api/personal/notebooklm/notebooks')
            return json({ error: { code: 'NEEDS_REAUTH' } }, 401);
        if (path === '/api/private-read')
            return json({ error: { code: 'AUTH_REQUIRED' } }, 401);
        if (path === '/api/personal/connections/notebooklm') {
            requests.push(input);
            return new Response(new ReadableStream<Uint8Array>({ start(value) { body = value; } }), { headers: { 'content-type': 'application/json' } });
        }
        return base(input);
    });
    const session = createSessionController();
    await session.start();
    await session.transport.send({ method: 'GET', path: '/personal/notebooklm/notebooks', context: readTurnContext()! });
    const verify = session.verifyProviderConnection();
    const duplicate = session.verifyProviderConnection();
    await waitFor(() => expect(body).toBeDefined());
    if (change === 'new-auth-check')
        await session.check();
    else
        await session.transport.send({ method: 'GET', path: change === 'auth-loss' ? '/private-read' : '/personal/notebooklm/notebooks', context: readTurnContext()! });
    body!.enqueue(new TextEncoder().encode(JSON.stringify({ state: 'connected', reason: null, account_label: null, last_verified_at: null, quota: null })));
    body!.close();
    expect(await verify).toBe(false);
    expect(await duplicate).toBe(false);
    expect(session.getSnapshot().providerNeedsReauth).toBe(true);
    expect(requests.filter(r => new URL(r.url).pathname === '/api/personal/connections/notebooklm')).toHaveLength(1);
    session.dispose();
});
it('never bypasses application capability guards for explicit provider verification', async () => {
    const requests = server({ capStatus: 404 });
    const session = createSessionController();
    await session.start();
    expect(await session.verifyProviderConnection()).toBe(false);
    await expect(session.transport.send({ method: 'POST', path: '/personal/connections/notebooklm/reconnect', context: readTurnContext()! })).rejects.toThrow();
    expect(requests.some(r => new URL(r.url).pathname.startsWith('/api/personal/connections/'))).toBe(false);
    session.dispose();
});
it('keeps the original filled question in its retired registry entry when starting a new editor', async () => {
    server();
    let value: ReturnType<typeof useWorkbenchSession> | undefined;
    function Probe() { value = useWorkbenchSession(); return <AppRoutes />; }
    render(<AppProviders locale="en-US"><MemoryRouter initialEntries={['/notebooks/A']}><WorkbenchSession><Probe /></WorkbenchSession></MemoryRouter></AppProviders>);
    const question = await screen.findByLabelText('Question draft');
    const old = { epoch: readTurnContext()!.epoch, notebookId: 'A', editorSession: 'question' };
    fireEvent.change(question, { target: { value: 'original draft' } });
    await act(async () => { await value!.controller.login('synthetic'); });
    fireEvent.click(screen.getByRole('button', { name: 'Start a new question draft' }));
    fireEvent.change(question, { target: { value: 'new draft' } });
    expect(value!.drafts.get(old)).toMatchObject({ question: 'original draft', retired: true });
    expect(question).toHaveValue('new draft');
});

it('publishes monotonic provider evidence fences for repeated invalidation and explicit verification without changing app scope', async () => {
    let invalid = true;
    const requests = server({ resource: () => invalid ? json({ error: { code: 'NEEDS_REAUTH' } }, 401) : json({ state: 'connected' }) });
    const controller = createSessionController();
    await controller.start();
    const context = readTurnContext()!, generation = sessionCoordinator.current();
    const initial = controller.getSnapshot().providerEvidenceRevision;
    await controller.transport.send({ method: 'GET', path: '/personal/jobs/mixed', context });
    const first = controller.getSnapshot().providerEvidenceRevision;
    expect(first).toBeGreaterThan(initial);
    await controller.transport.send({ method: 'GET', path: '/personal/jobs/mixed', context });
    expect(controller.getSnapshot().providerEvidenceRevision).toBeGreaterThan(first);
    invalid = false;
    const beforeVerify = controller.getSnapshot().providerEvidenceRevision;
    const verifying = controller.verifyProviderConnection();
    const duringVerify = controller.getSnapshot().providerEvidenceRevision;
    expect(duringVerify).toBeGreaterThan(beforeVerify);
    expect(controller.getSnapshot().providerChecking).toBe(true);
    expect(await verifying).toBe(true);
    const confirmed = controller.getSnapshot().providerEvidenceRevision;
    expect(confirmed).toBeGreaterThan(duringVerify);
    expect(controller.getSnapshot()).toMatchObject({ ready: true, providerNeedsReauth: false, providerChecking: false });
    await controller.verifyProviderConnection();
    expect(controller.getSnapshot().providerEvidenceRevision).toBeGreaterThan(confirmed);
    expect(readTurnContext()?.epoch).toBe(context.epoch);
    expect(sessionCoordinator.current()).toBe(generation);
    expect(requests.every(request => request.method === 'GET')).toBe(true);
    controller.dispose();
});

it.each(['/sources?q=fixture#item','//evil.example/path','/login','/%2f%2fevil','/bad%zz'])('uses one validated in-memory cold return after explicit login: %s',async destination=>{
 server({enabled:true});
 const router=createMemoryRouter([{path:'*',element:<AppProviders locale="en-US"><WorkbenchSession><AppRoutes/></WorkbenchSession></AppProviders>}],{initialEntries:['/login?returnTo='+encodeURIComponent(destination)]});
 render(<RouterProvider router={router}/>);
 fireEvent.change(await screen.findByLabelText('Password'),{target:{value:'synthetic'}});
 fireEvent.click(screen.getByRole('button',{name:'Sign in'}));
 const expected=destination==='/sources?q=fixture#item'?destination:'/notebooks';
 await waitFor(()=>expect(router.state.location.pathname+router.state.location.search+router.state.location.hash).toBe(expected));
 expect(router.state.historyAction).toBe('REPLACE');expect(sessionStorage.getItem('redirectAfterLogin')).toBeNull();
});
it('a newer cold navigation invalidates the return captured by an earlier login',async()=>{
 const requests=server({enabled:true});const original=globalThis.fetch;let resolve!:(r:Response)=>void;
 vi.stubGlobal('fetch',vi.fn(async(input:Request|string)=>{const r=input instanceof Request?input:new Request(new URL(input,window.location.href));if(r.url.endsWith('/api/notebooks')&&r.headers.has('Authorization'))return new Promise<Response>(yes=>resolve=yes);return original(input)}));
 const router=createMemoryRouter([{path:'*',element:<AppProviders locale="en-US"><WorkbenchSession><AppRoutes/></WorkbenchSession></AppProviders>}],{initialEntries:['/login?returnTo=%2Fsources']});
 render(<RouterProvider router={router}/>);fireEvent.change(await screen.findByLabelText('Password'),{target:{value:'synthetic'}});fireEvent.click(screen.getByRole('button',{name:'Sign in'}));await waitFor(()=>expect(resolve).toBeDefined());
 await act(async()=>router.navigate('/notebooks'));await act(async()=>resolve(json([])));await waitFor(()=>expect(router.state.location.pathname).toBe('/notebooks'));expect(requests.some(r=>r.method==='POST')).toBe(false);
});
it('failed legacy local removal remains locked and explicitly retryable without changing the original target',async()=>{
 server();const controller=createSessionController();await controller.start();
 const remove=vi.spyOn(Storage.prototype,'removeItem').mockImplementation(()=>{throw Error('synthetic failure')});
 await controller.signoutLocal();expect(controller.getSnapshot()).toMatchObject({signedOutLocally:true,localSignoutConfirmed:false,ready:false,serverRevocation:'not-performed'});
 controller.closeReauth();expect(controller.getSnapshot().reauthOpen).toBe(true);await controller.check();expect(controller.getSnapshot().ready).toBe(false);
 remove.mockRestore();await controller.signoutLocal();expect(controller.getSnapshot()).toMatchObject({localSignoutConfirmed:true,ready:false});controller.dispose();
});

it('invalidates an in-flight provider check without revoking app readiness and only publishes the new explicit check',async()=>{
 server();const base=globalThis.fetch;const ends:Array<(r:Response)=>void>=[];
 vi.stubGlobal('fetch',async(input:Request)=>new URL(input.url).pathname.endsWith('/connections/notebooklm')?new Promise<Response>(resolve=>ends.push(resolve)):base(input));
 const controller=createSessionController();await controller.start();const c=readTurnContext()!,g=sessionCoordinator.current();
 const old=controller.verifyProviderConnection();await waitFor(()=>expect(ends).toHaveLength(1));
 controller.invalidateProviderAdmission();const retired=controller.getSnapshot().providerEvidenceRevision;
 expect(controller.getSnapshot()).toMatchObject({ready:true,providerVerification:null,providerChecking:false});
 const fresh=controller.verifyProviderConnection();await waitFor(()=>expect(ends).toHaveLength(2));
 ends[0]!(json({state:'connected'}));expect(await old).toBe(false);
 expect(controller.getSnapshot().providerChecking).toBe(true);expect(controller.getSnapshot().providerVerification).toBeNull();
 ends[1]!(json({state:'connected'}));expect(await fresh).toBe(true);
 expect(controller.getSnapshot().providerVerification?.revision).toBeGreaterThan(retired);
 expect(readTurnContext()!.epoch).toBe(c.epoch);expect(sessionCoordinator.current()).toBe(g);controller.dispose();
});
