import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { invalidateTurnContext, publishTurnTarget, readTurnContext, type RequestSpec, type WebTransport } from '@study/web-transport';
import { AppRoutes } from '../../app/router';
import { WorkbenchSession, useWorkbenchSession } from '../../app/WorkbenchSession';
import { AppProviders } from '../../app/providers';
import { notebookRows, notebookWorkspace, json } from '../../test/notebook-fixtures';
beforeEach(() => { invalidateTurnContext(); publishTurnTarget({ mode: 'legacy_password', apiBase: 'http://localhost:3000/api', protocol: null }, true); });
function mount(route = '/notebooks', reply?: (r: RequestSpec) => Response | undefined | Promise<Response | undefined>) {
    const requests: RequestSpec[] = [];
    const transport: WebTransport = { send: async (r) => {
            requests.push(r);
            if (reply) {
                const result = await reply(r);
                if (result)
                    return result;
            }
            if (r.path.startsWith('/recently-viewed'))
                return json([{ type: 'notebook', id: 'notebook:beta', title: 'Recently opened Beta', last_viewed_at: '2026-11-08T02:03:04+00:00' }, { type: 'source', id: 'source:classic', title: 'Recent classic source', last_viewed_at: '2026-11-07' }]);
            if (r.path.startsWith('/notebooks?'))
                return json(notebookRows);
            if (r.path.endsWith('/workspace-view')) {
                const id = decodeURIComponent(r.path.split('/')[3]!);
                return json(notebookWorkspace(id));
            }
            return json(notebookRows[0]);
        } };
    const router = createMemoryRouter([{ path: '*', element: <AppProviders transport={transport} locale="en-US"><AppRoutes /></AppProviders> }], { initialEntries: [route] });
    render(<RouterProvider router={router}/>);
    return { router, requests };
}
it('loads literal-ID cards, searches only names, expands archived and changes tile/list view without disk caches', async () => {
    mount();
    await screen.findByRole('link', { name: 'Alpha feedback' });
    expect(screen.queryByRole('link', { name: 'Archived material' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search notebooks' }), { target: { value: 'BETA' } });
    expect(screen.getByRole('link', { name: 'Beta systems' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Alpha feedback' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'synthetic' } });
    expect(screen.getByText('No matches found')).toBeVisible();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Archived Notebooks/ }));
    expect(screen.getByRole('link', { name: 'Archived material' })).toHaveAttribute('href', '/notebooks/notebook%3Aarchive');
    fireEvent.click(screen.getByRole('button', { name: 'List view' }));
    expect(document.querySelector('.notebook-collection')).toHaveAttribute('data-view', 'list');
    expect(Object.keys(localStorage)).toEqual([]);
});
it('uses server recent notebook/source identities and supports collapse without rewriting timestamps', async () => {
    mount();
    const recent = await screen.findByRole('link', { name: /Recently opened Beta/ });
    expect(recent).toHaveAttribute('href', '/notebooks/notebook%3Abeta');
    expect(screen.getByRole('link', { name: /Recent classic source/ })).toHaveAttribute('href', '/sources/source%3Aclassic');
    expect(document.querySelector('time[datetime="2026-11-08T02:03:04+00:00"]')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle recently viewed' }));
    expect(screen.queryByRole('link', { name: /Recently opened Beta/ })).not.toBeInTheDocument();
});
it('creates with only a name, latches repeated submit and enters the exact returned notebook ID', async () => {
    let finish!: (r: Response) => void;
    const { router, requests } = mount('/notebooks', async (r) => {
        if (r.method === 'POST')
            return new Promise(resolve => { finish = resolve; });
        return undefined;
    });
    await screen.findByRole('link', { name: 'Alpha feedback' });
    fireEvent.click(screen.getByRole('button', { name: 'New Notebook' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), { target: { value: 'Only a name' } });
    const form = within(dialog).getByRole('button', { name: 'New' }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(requests.filter(r => r.method === 'POST')).toHaveLength(1));
    await act(async () => finish(json({ ...notebookRows[0], id: 'notebook:new%2Fid', name: 'Only a name' })));
    await waitFor(() => expect(router.state.location.pathname).toBe('/notebooks/notebook%3Anew%252Fid'));
    expect(JSON.parse(requests.find(r => r.method === 'POST')!.body as string)).toEqual({ name: 'Only a name' });
});
it('preserves last good active/archive/recent data after explicit refresh failure', async () => {
    let fail = false;
    mount('/notebooks', r => {
        if (fail)
            return Promise.resolve(json({}, 503));
        return Promise.resolve(r.path.startsWith('/recently-viewed') ? json([{ type: 'notebook', id: 'notebook:beta', title: 'Keep recent Beta', last_viewed_at: '2026-11-08' }]) : json(notebookRows));
    });
    await screen.findByRole('link', { name: 'Alpha feedback' });
    fail = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findAllByRole('alert')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Alpha feedback' })).toBeVisible();
    expect(screen.getByRole('link', { name: /Keep recent Beta/ })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Archived Notebooks/ }));
    expect(screen.getByRole('link', { name: 'Archived material' })).toBeVisible();
});
it('shows an empty state only after a successful empty list, with creation still available', async () => {
    mount('/notebooks', () => json([]));
    await screen.findByText('Your notebooks will appear here.');
    expect(screen.getByRole('button', { name: 'New Notebook' })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('keeps creation content across theme/preferences and blocks uncertain create from replay on reopen', async () => {
    const { requests } = mount('/notebooks', r => r.method === 'POST' ? Promise.resolve(json({}, 503)) : Promise.resolve(undefined));
    await screen.findByRole('link', { name: 'Alpha feedback' });
    fireEvent.click(screen.getByRole('button', { name: 'New Notebook' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Keep this name' } });
    fireEvent.submit(screen.getByRole('textbox', { name: 'Name' }).closest('form')!);
    await screen.findByText(/Creation could not be confirmed/);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    fireEvent.click(screen.getByRole('button', { name: 'New Notebook' }));
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Keep this name');
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'New' })).toBeDisabled();
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
});
it.each(['/notebooks/notebook%3Aalpha', '/notebooks/notebook%3Aalpha/study'])('loads %s without hiding raw/web/derived/classic sources or old history and does not grant unknown scope', async (route) => {
    const { router, requests } = mount(route);
    await screen.findByText('Raw original');
    expect(screen.getByText('Web snapshot')).toBeInTheDocument();
    expect(screen.getByText('Derived note')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Classic without versions' })).toHaveAttribute('href', '/sources/source%3Aclassic');
    expect(screen.getByText('Synthetic older archive')).toBeInTheDocument();
    expect(screen.getByText('future-engine')).toBeInTheDocument();
    expect(screen.getByText('Unsupported engine')).toBeInTheDocument();
    expect(requests.some(r => r.method !== 'GET')).toBe(false);
    expect(requests.some(r => r.path === '/notebooks/notebook%3Aalpha')).toBe(true);
    expect(router.state.location.pathname).toBe('/notebooks/notebook%3Aalpha');
});
it('retains workspace and the same question node on refresh failure and theme changes', async () => {
    let fail = false;
    mount('/notebooks/notebook%3Aalpha', r => r.path.endsWith('/workspace-view') && fail ? Promise.resolve(json({}, 503)) : Promise.resolve(undefined));
    await screen.findByText('Raw original');
    const draft = screen.getByRole('textbox', { name: 'Question' });
    fireEvent.change(draft, { target: { value: 'Keep question' } });
    fail = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(screen.getByText('Classic without versions')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Question' })).toBe(draft);
    expect(draft).toHaveValue('Keep question');
});
it('keeps every retained pending route and search deep link instead of falling back to home or issuing provider work', async () => {
    const { router, requests } = mount('/search?q=synthetic&mode=ask');
    expect(await screen.findByRole('heading', { name: 'Ask and Search', level: 1 })).toBeVisible();
    expect(router.state.location.search).toBe('?q=synthetic&mode=ask');
    expect(requests).toHaveLength(0);
    for (const route of ['/sources', '/sources/source%3Aclassic', '/podcasts', '/settings', '/settings/models', '/transformations', '/advanced']) {
        await act(async () => router.navigate(route));
        expect(screen.getByText(/This page is being rebuilt/)).toBeVisible();
        expect(router.state.location.pathname).toBe(route);
    }
    expect(requests).toHaveLength(0);
});
it('does not show a late A response after newer B navigation', async () => {
    let finish!: (r: Response) => void;
    const { router } = mount('/notebooks/notebook%3Aalpha', r => r.path.includes('notebook%3Aalpha') && r.path.endsWith('/workspace-view') ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(undefined));
    await act(async () => router.navigate('/notebooks/notebook%3Abeta'));
    await screen.findByRole('heading', { name: 'notebook:beta', level: 1 });
    await act(async () => finish(json(notebookWorkspace())));
    expect(screen.getByRole('heading', { name: 'notebook:beta', level: 1 })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Alpha feedback', level: 1 })).not.toBeInTheDocument();
});
it('does not let a late create redirect away from newer navigation', async () => {
    let finish!: (r: Response) => void;
    const { router, requests } = mount('/notebooks', r => r.method === 'POST' ? new Promise(resolve => { finish = resolve; }) : undefined);
    await screen.findByRole('link', { name: 'Alpha feedback' });
    fireEvent.click(screen.getByRole('button', { name: 'New Notebook' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Late create' } });
    fireEvent.submit(screen.getByRole('textbox', { name: 'Name' }).closest('form')!);
    await waitFor(() => expect(requests.filter(r => r.method === 'POST')).toHaveLength(1));
    await act(async () => router.navigate('/search?q=newer&mode=search'));
    await act(async () => finish(json({ ...notebookRows[0], id: 'notebook:late' })));
    expect(router.state.location.pathname).toBe('/search');
    expect(router.state.location.search).toBe('?q=newer&mode=search');
});
it('displays unsupported source-origin values without replacing them with a fabricated authorized scope', async () => {
    mount('/notebooks/notebook%3Aalpha', r => r.path.endsWith('/workspace-view') ? json({ ...notebookWorkspace(), selection: { engine: 'independent', selection_origin: 'future-origin', source_version_ids: ['version:missing'], remote_source_ids: [] } }) : undefined);
    await screen.findByText('future-origin');
    expect(screen.getByText('Unsupported source origin')).toBeVisible();
    expect(screen.getByText('version:missing')).toBeVisible();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});
it('retains a creation form but freezes its original epoch after privacy retirement', async () => {
    const { requests } = mount();
    await screen.findByRole('link', { name: 'Alpha feedback' });
    fireEvent.click(screen.getByRole('button', { name: 'New Notebook' }));
    const name = screen.getByRole('textbox', { name: 'Name' });
    fireEvent.change(name, { target: { value: 'Old scoped draft' } });
    await act(async () => invalidateTurnContext());
    expect(screen.getByRole('textbox', { name: 'Name' })).toBe(name);
    expect(name).toHaveValue('Old scoped draft');
    expect(name).toHaveAttribute('readonly');
    fireEvent.submit(name.closest('form')!);
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(0);
});
it('aliases encoded opaque IDs exactly once and preserves query/hash on the study entry', async () => {
    const { router, requests } = mount('/notebooks/notebook%3Aopaque%252Fid/study?panel=history#retained');
    await screen.findByRole('heading', { name: 'notebook:opaque%2Fid', level: 1 });
    expect(router.state.location.pathname).toBe('/notebooks/notebook%3Aopaque%252Fid');
    expect(router.state.location.search).toBe('?panel=history');
    expect(router.state.location.hash).toBe('#retained');
    expect(requests.some(r => r.path === '/personal/notebooks/notebook%3Aopaque%252Fid/workspace-view')).toBe(true);
});
it('does not represent an initial list failure as a successful empty list or a retained last-good list', async () => {
    mount('/notebooks', r => r.path.startsWith('/notebooks?') ? json({}, 500) : json([]));
    await screen.findByRole('alert');
    expect(screen.queryByText('Your notebooks will appear here.')).not.toBeInTheDocument();
    expect(screen.queryByText('Refresh failed. The last loaded notebooks are kept.')).not.toBeInTheDocument();
});
it('connects the real B2 capability-gated session and A4 transport to home and A1 workspace reads', async () => {
    const requests: Request[] = [];
    vi.stubGlobal('fetch', async (input: Request | string) => {
        const request = input instanceof Request ? input : new Request(new URL(input, window.location.href));
        requests.push(request);
        const path = new URL(request.url).pathname;
        if (path === '/config')
            return json({ apiUrl: '', auth_mode: 'legacy_password', web_session_protocol: null, client_contracts: ['workspace-view-v1'], ui_transport_protocol: 1 });
        if (path === '/api/auth/status')
            return json({ auth_enabled: false });
        if (path === '/api/personal/client-capabilities')
            return json({ contract_version: 'client-capabilities-v1', supported_contracts: ['workspace-view-v1'], limits: { source_upload_max_bytes: 50, portable: { max_archive_bytes: 10, max_expanded_bytes: 20, max_entity_bytes: 10, max_manifest_bytes: 10, max_request_bytes: 30, multipart_overhead_bytes: 10, max_entries: 2, max_compression_ratio: 5 } } });
        if (path === '/api/notebooks')
            return json(notebookRows);
        // Live B5 entry reads only configuration and canonical history.
        if (path === '/api/models/defaults') return json({default_chat_model:null});
        if (path.startsWith('/api/personal/chats/') && path.endsWith('/turns') && request.method==='GET') return json([]);
        if (path === '/api/recently-viewed')
            return json([]);
        if (path === '/api/personal/notebooks/notebook%3Aalpha/workspace-view')
            return json(notebookWorkspace());
        if (path === '/api/notebooks/notebook%3Aalpha')
            return json(notebookRows[0]);
        throw new Error(`Unexpected synthetic request ${request.method} ${path}`);
    });
    const router = createMemoryRouter([{ path: '*', element: <AppProviders locale="en-US"><WorkbenchSession><AppRoutes /></WorkbenchSession></AppProviders> }], { initialEntries: ['/notebooks'] });
    render(<RouterProvider router={router}/>);
    fireEvent.click(await screen.findByRole('link', { name: 'Alpha feedback' }));
    await screen.findByText('Raw original');
    expect(screen.getByText('Synthetic human archive')).toBeVisible();
    expect(requests.every(r => r.method === 'GET')).toBe(true);
    expect(requests.findIndex(r => new URL(r.url).pathname === '/api/personal/client-capabilities')).toBeLessThan(requests.findIndex(r => new URL(r.url).pathname === '/api/personal/notebooks/notebook%3Aalpha/workspace-view'));
    expect(requests.filter(r => new URL(r.url).pathname.includes('notebooklm'))).toHaveLength(0);
});
it('does not show the prior privacy-epoch notebook list while a new authorized list is still loading', async () => {
    let later = false;
    let finish!: (r: Response) => void;
    mount('/notebooks', r => later && r.path.startsWith('/notebooks?') ? new Promise(resolve => { finish = resolve; }) : undefined);
    await screen.findByRole('link', { name: 'Alpha feedback' });
    later = true;
    await act(async () => invalidateTurnContext());
    expect(screen.queryByRole('link', { name: 'Alpha feedback' })).not.toBeInTheDocument();
    await act(async () => finish(json([])));
    await screen.findByText('Your notebooks will appear here.');
});
it('starts only an explicit new blank creation intent after retirement and retains the earlier input', async () => {
    const { requests } = mount();
    await screen.findByRole('link', { name: 'Alpha feedback' });
    fireEvent.click(screen.getByRole('button', { name: 'New Notebook' }));
    const oldEpoch = readTurnContext()!.epoch;
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Retired notebook name' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Description (Optional)' }), { target: { value: 'Retired description' } });
    await act(async () => invalidateTurnContext());
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Retired notebook name');
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveAttribute('readonly');
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Start a new notebook draft' }));
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Name' })).not.toHaveAttribute('readonly');
    expect(screen.getByRole('textbox', { name: 'Description (Optional)' })).toHaveValue('');
    expect(screen.getByText('Retired notebook name')).toBeVisible();
    expect(screen.getByText('Retired description')).toBeVisible();
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(0);
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Independent new notebook' } });
    fireEvent.submit(screen.getByRole('textbox', { name: 'Name' }).closest('form')!);
    await waitFor(() => expect(requests.filter(r => r.method === 'POST')).toHaveLength(1));
    const sent = requests.find(r => r.method === 'POST')!;
    expect(sent.context.epoch).not.toBe(oldEpoch);
    expect(sent.context.epoch).toBe(readTurnContext()!.epoch);
    expect(JSON.parse(sent.body as string)).toEqual({ name: 'Independent new notebook' });
});
it('never unlocks or retries an uncertain creation while a new retired-scope intent is started and cancelled', async () => {
    const { requests } = mount('/notebooks', r => r.method === 'POST' ? json({}, 503) : undefined);
    await screen.findByRole('link', { name: 'Alpha feedback' });
    fireEvent.click(screen.getByRole('button', { name: 'New Notebook' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Uncertain original' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Description (Optional)' }), { target: { value: 'Original uncertain description' } });
    fireEvent.submit(screen.getByRole('textbox', { name: 'Name' }).closest('form')!);
    await screen.findByText(/Creation could not be confirmed/);
    const original = requests.find(r => r.method === 'POST')!;
    await act(async () => invalidateTurnContext());
    fireEvent.click(screen.getByRole('button', { name: 'Start a new notebook draft' }));
    expect(screen.getByText('Uncertain original')).toBeVisible();
    expect(screen.getByText('Original uncertain description')).toBeVisible();
    expect(screen.getByText(/Creation could not be confirmed/)).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('');
    fireEvent.submit(screen.getByRole('textbox', { name: 'Name' }).closest('form')!);
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'New Notebook' }));
    expect(screen.getByText('Uncertain original')).toBeVisible();
    expect(screen.getByText(/Creation could not be confirmed/)).toBeVisible();
    expect(requests.filter(r => r.method === 'POST')).toEqual([original]);
});
it('does not let a delayed retired create settle into or navigate away from the deliberate fresh intent', async () => {
    let finish!: (r: Response) => void;
    const { requests, router } = mount('/notebooks', r => r.method === 'POST' ? new Promise(resolve => { finish = resolve; }) : undefined);
    await screen.findByRole('link', { name: 'Alpha feedback' });
    fireEvent.click(screen.getByRole('button', { name: 'New Notebook' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Pending old intent' } });
    fireEvent.submit(screen.getByRole('textbox', { name: 'Name' }).closest('form')!);
    await waitFor(() => expect(requests.filter(r => r.method === 'POST')).toHaveLength(1));
    await act(async () => invalidateTurnContext());
    fireEvent.click(screen.getByRole('button', { name: 'Start a new notebook draft' }));
    const name = screen.getByRole('textbox', { name: 'Name' });
    fireEvent.change(name, { target: { value: 'Fresh unsent intent' } });
    await act(async () => finish(json({ ...notebookRows[0], id: 'notebook:old-result' })));
    expect(router.state.location.pathname).toBe('/notebooks');
    expect(name).toHaveValue('Fresh unsent intent');
    expect(name).not.toHaveAttribute('readonly');
    expect(screen.getByText('Pending old intent')).toBeVisible();
    expect(screen.getByText(/Creation could not be confirmed/)).toBeVisible();
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
});
it('makes the old form usable as a new blank intent only after actual B2 application reauthentication', async () => {
    let failRead = false;
    const requests: Request[] = [];
    vi.stubGlobal('fetch', async (input: Request | string) => {
        const request = input instanceof Request ? input : new Request(new URL(input, window.location.href));
        requests.push(request);
        const path = new URL(request.url).pathname;
        if (path === '/config')
            return json({ apiUrl: '', auth_mode: 'legacy_password', web_session_protocol: null, client_contracts: ['workspace-view-v1'], ui_transport_protocol: 1 });
        if (path === '/api/auth/status')
            return json({ auth_enabled: false });
        if (path === '/api/personal/client-capabilities')
            return json({ contract_version: 'client-capabilities-v1', supported_contracts: ['workspace-view-v1'], limits: { source_upload_max_bytes: 50, portable: { max_archive_bytes: 10, max_expanded_bytes: 20, max_entity_bytes: 10, max_manifest_bytes: 10, max_request_bytes: 30, multipart_overhead_bytes: 10, max_entries: 2, max_compression_ratio: 5 } } });
        if (path === '/api/notebooks')
            return failRead ? json({ error: { code: 'AUTH_REQUIRED' } }, 401) : json(notebookRows);
        // Live B5 entry reads only configuration and canonical history.
        if (path === '/api/models/defaults') return json({default_chat_model:null});
        if (path.startsWith('/api/personal/chats/') && path.endsWith('/turns') && request.method==='GET') return json([]);
        if (path === '/api/recently-viewed')
            return json([]);
        throw new Error(`Unexpected ${request.method} ${path}`);
    });
    let session: ReturnType<typeof useWorkbenchSession> | undefined;
    function Observe() { session = useWorkbenchSession(); return <AppRoutes />; }
    const router = createMemoryRouter([{ path: '*', element: <AppProviders locale="en-US"><WorkbenchSession><Observe /></WorkbenchSession></AppProviders> }], { initialEntries: ['/notebooks'] });
    render(<RouterProvider router={router}/>);
    await screen.findByRole('link', { name: 'Alpha feedback' });
    fireEvent.click(screen.getByRole('button', { name: 'New Notebook' }));
    const field = screen.getByRole('textbox', { name: 'Name' });
    fireEvent.change(field, { target: { value: 'Before actual reauth' } });
    const old = readTurnContext()!;
    failRead = true;
    await act(async () => { await session!.transport.send({ method: 'GET', path: '/notebooks', context: old }); });
    await screen.findByRole('dialog', { name: 'Sign in again' });
    expect(field).toHaveValue('Before actual reauth');
    failRead = false;
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'synthetic-only' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sign in again' })).not.toBeInTheDocument());
    expect(readTurnContext()!.epoch).not.toBe(old.epoch);
    expect(screen.getByRole('textbox', { name: 'Name' })).toBe(field);
    expect(field).toHaveAttribute('readonly');
    fireEvent.click(screen.getByRole('button', { name: 'Start a new notebook draft' }));
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Name' })).not.toHaveAttribute('readonly');
    expect(screen.getByText('Before actual reauth')).toBeVisible();
    expect(requests.some(r => r.method === 'POST')).toBe(false);
});
function mountRealCreation(initialEntries = ['/notebooks'], initialIndex = initialEntries.length - 1, post?: (request: Request) => Response | Promise<Response>) {
    const requests: Request[] = [];
    let workbench: ReturnType<typeof useWorkbenchSession> | undefined;
    vi.stubGlobal('fetch', async (input: Request | string) => {
        const request = input instanceof Request ? input : new Request(new URL(input, window.location.href));
        requests.push(request);
        const path = new URL(request.url).pathname;
        if (path === '/config')
            return json({ apiUrl: '', auth_mode: 'legacy_password', web_session_protocol: null, client_contracts: ['workspace-view-v1'], ui_transport_protocol: 1 });
        if (path === '/api/auth/status')
            return json({ auth_enabled: false });
        if (path === '/api/personal/client-capabilities')
            return json({ contract_version: 'client-capabilities-v1', supported_contracts: ['workspace-view-v1'], limits: { source_upload_max_bytes: 50, portable: { max_archive_bytes: 10, max_expanded_bytes: 20, max_entity_bytes: 10, max_manifest_bytes: 10, max_request_bytes: 30, multipart_overhead_bytes: 10, max_entries: 2, max_compression_ratio: 5 } } });
        if (path === '/api/notebooks')
            return request.method === 'POST' ? (post ? post(request) : json({ ...notebookRows[0], id: 'notebook:fresh-result' })) : json(notebookRows);
        // Live B5 entry reads only configuration and canonical history.
        if (path === '/api/models/defaults') return json({default_chat_model:null});
        if (path.startsWith('/api/personal/chats/') && path.endsWith('/turns') && request.method==='GET') return json([]);
        if (path === '/api/recently-viewed')
            return json([]);
        if (path.endsWith('/workspace-view'))
            return json(notebookWorkspace(decodeURIComponent(path.split('/')[4]!)));
        if (path.startsWith('/api/notebooks/'))
            return json(notebookRows[0]);
        throw new Error(`Unexpected ${request.method} ${path}`);
    });
    function Observe() { workbench = useWorkbenchSession(); return <AppRoutes />; }
    const router = createMemoryRouter([{ path: '*', element: <AppProviders locale="en-US"><WorkbenchSession><Observe /></WorkbenchSession></AppProviders> }], { initialEntries, initialIndex });
    render(<RouterProvider router={router}/>);
    return { router, requests, workbench: () => workbench! };
}
it('protects real B2 Back and Forward and keeps an unsent creation across an allowed route unmount', async () => {
    const { router, requests } = mountRealCreation(['/search', '/notebooks', '/advanced'], 1);
    await screen.findByRole('link', { name: 'Alpha feedback' });
    fireEvent.click(screen.getByRole('button', { name: 'New Notebook' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Keep across route unmount' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Description (Optional)' }), { target: { value: 'Remember description' } });
    await act(async () => router.navigate(-1));
    await screen.findByRole('dialog', { name: 'Leave this draft?' });
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(router.state.location.pathname).toBe('/notebooks');
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Keep across route unmount');
    await act(async () => router.navigate(1));
    await screen.findByRole('dialog', { name: 'Leave this draft?' });
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(router.state.location.pathname).toBe('/notebooks');
    await act(async () => router.navigate(-1));
    await screen.findByRole('dialog', { name: 'Leave this draft?' });
    fireEvent.click(screen.getByRole('button', { name: 'Leave without saving' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/search'));
    await act(async () => router.navigate(1));
    await screen.findByRole('link', { name: 'Alpha feedback' });
    fireEvent.click(screen.getByRole('button', { name: 'New Notebook' }));
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Keep across route unmount');
    expect(screen.getByRole('textbox', { name: 'Description (Optional)' })).toHaveValue('Remember description');
    expect(requests.some(r => r.method === 'POST')).toBe(false);
});
it('does not discard an unknown creation on Cancel or force-unlock it through real B2 navigation', async () => {
    const { router, requests } = mountRealCreation(['/notebooks'], 0, () => json({}, 503));
    await screen.findByRole('link', { name: 'Alpha feedback' });
    fireEvent.click(screen.getByRole('button', { name: 'New Notebook' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Unknown route-owned input' } });
    fireEvent.submit(screen.getByRole('textbox', { name: 'Name' }).closest('form')!);
    await screen.findByText(/Creation could not be confirmed/);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('link', { name: 'Alpha feedback' }));
    await screen.findByRole('dialog', { name: 'Leave this draft?' });
    expect(screen.queryByRole('button', { name: 'Leave without saving' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep creation and continue' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/notebooks/notebook%3Aalpha'));
    await screen.findByRole('heading', { name: 'Alpha feedback', level: 1 });
    await act(async () => router.navigate(-1));
    await screen.findByRole('link', { name: 'Alpha feedback' });
    fireEvent.click(screen.getByRole('button', { name: 'New Notebook' }));
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Unknown route-owned input');
    expect(within(screen.getByRole('dialog', { name: 'Create New Notebook' })).getByRole('button', { name: 'New' })).toBeDisabled();
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
});
it('keeps an older unknown creation across a successful different fresh creation and notebook-to-home navigation', async () => {
    let posts = 0;
    const { router, requests, workbench } = mountRealCreation(['/notebooks'], 0, () => ++posts === 1 ? json({}, 503) : json({ ...notebookRows[0], id: 'notebook:fresh-result' }));
    await screen.findByRole('link', { name: 'Alpha feedback' });
    fireEvent.click(screen.getByRole('button', { name: 'New Notebook' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Retained unknown after success' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Description (Optional)' }), { target: { value: 'Original retained description' } });
    fireEvent.submit(screen.getByRole('textbox', { name: 'Name' }).closest('form')!);
    await screen.findByText(/Creation could not be confirmed/);
    await act(async () => workbench().controller.login('synthetic-only'));
    fireEvent.click(screen.getByRole('button', { name: 'Start a new notebook draft' }));
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('');
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Separate successful notebook' } });
    fireEvent.submit(screen.getByRole('textbox', { name: 'Name' }).closest('form')!);
    await waitFor(() => expect(router.state.location.pathname).toBe('/notebooks/notebook%3Afresh-result'));
    await screen.findByRole('heading', { name: 'notebook:fresh-result', level: 1 });
    await act(async () => router.navigate(-1));
    await screen.findByRole('link', { name: 'Alpha feedback' });
    fireEvent.click(screen.getByRole('button', { name: 'New Notebook' }));
    expect(screen.getByText('Retained unknown after success')).toBeVisible();
    expect(screen.getByText('Original retained description')).toBeVisible();
    expect(screen.getByText(/Creation could not be confirmed/)).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('');
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(2);
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
});
it('blocks real B2 navigation while creation is pending and does not turn waiting into discard', async () => {
    let finish!: (r: Response) => void;
    const { router, requests } = mountRealCreation(['/search', '/notebooks'], 1, () => new Promise(resolve => { finish = resolve; }));
    await screen.findByRole('link', { name: 'Alpha feedback' });
    fireEvent.click(screen.getByRole('button', { name: 'New Notebook' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Pending protected creation' } });
    fireEvent.submit(screen.getByRole('textbox', { name: 'Name' }).closest('form')!);
    await waitFor(() => expect(requests.filter(r => r.method === 'POST')).toHaveLength(1));
    await act(async () => router.navigate(-1));
    await screen.findByRole('dialog', { name: 'Leave this draft?' });
    expect(screen.queryByRole('button', { name: 'Leave without saving' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(router.state.location.pathname).toBe('/notebooks');
    await act(async () => router.navigate(-1));
    await screen.findByRole('dialog', { name: 'Leave this draft?' });
    fireEvent.click(screen.getByRole('button', { name: 'Keep creation and continue' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/search'));
    await act(async () => finish(json({}, 503)));
    expect(router.state.location.pathname).toBe('/search');
    await act(async () => router.navigate(1));
    await screen.findByRole('link', { name: 'Alpha feedback' });
    fireEvent.click(screen.getByRole('button', { name: 'New Notebook' }));
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Pending protected creation');
    await screen.findByText(/Creation could not be confirmed/);
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
});
it('does not let creation success hijack a newer navigation awaiting retention confirmation', async () => {
    let finish!: (r: Response) => void;
    const { router, requests } = mountRealCreation(['/search', '/notebooks'], 1, () => new Promise(resolve => { finish = resolve; }));
    await screen.findByRole('link', { name: 'Alpha feedback' });
    fireEvent.click(screen.getByRole('button', { name: 'New Notebook' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Success with newer navigation' } });
    fireEvent.submit(screen.getByRole('textbox', { name: 'Name' }).closest('form')!);
    await waitFor(() => expect(requests.filter(r => r.method === 'POST')).toHaveLength(1));
    await act(async () => router.navigate(-1));
    await screen.findByRole('dialog', { name: 'Leave this draft?' });
    await act(async () => finish(json({ ...notebookRows[0], id: 'notebook:late-success' })));
    expect(router.state.location.pathname).toBe('/notebooks');
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
});
