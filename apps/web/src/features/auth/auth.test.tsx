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
it('keeps Google reauth separate from application reauth and freezes the old scope', async () => {
    server({ resource: () => json({ error: { code: 'NEEDS_REAUTH' } }, 401) });
    const session = createSessionController();
    await session.start();
    const before = readTurnContext()!;
    await session.transport.send({ method: 'GET', path: '/personal/notebooklm/capabilities', context: before });
    expect(session.getSnapshot()).toMatchObject({ phase: 'authenticated', issue: 'google', ready: false });
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
