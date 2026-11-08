import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { invalidateTurnContext, publishTurnTarget, type RequestSpec, type WebTransport } from '@study/web-transport';
import { AppRoutes } from '../../app/router';
import { WorkbenchSession } from '../../app/WorkbenchSession';
import { AppProviders } from '../../app/providers';
import { notebookRows, notebookWorkspace, json } from '../../test/notebook-fixtures';
beforeEach(() => { invalidateTurnContext(); publishTurnTarget({ mode: 'legacy_password', apiBase: 'http://localhost:3000/api', protocol: null }, true); });
function mount(route = '/notebooks', reply?: (r: RequestSpec) => Response | undefined | Promise<Response | undefined>) {
    const requests: RequestSpec[] = [];
    const transport: WebTransport = { send: async (r) => { requests.push(r); if (reply) {
            const result = await reply(r);
            if (result)
                return result;
        } if (r.path.startsWith('/recently-viewed'))
            return json([{ type: 'notebook', id: 'notebook:beta', title: 'Recently opened Beta', last_viewed_at: '2026-11-08T02:03:04+00:00' }, { type: 'source', id: 'source:classic', title: 'Recent classic source', last_viewed_at: '2026-11-07' }]); if (r.path.startsWith('/notebooks?'))
            return json(notebookRows); if (r.path.endsWith('/workspace-view')) {
            const id = decodeURIComponent(r.path.split('/')[3]!);
            return json(notebookWorkspace(id));
        } return json(notebookRows[0]); } };
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
    const { router, requests } = mount('/notebooks', async (r) => { if (r.method === 'POST')
        return new Promise(resolve => { finish = resolve; }); return undefined; });
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
    mount('/notebooks', r => { if (fail)
        return Promise.resolve(json({}, 503)); return Promise.resolve(r.path.startsWith('/recently-viewed') ? json([{ type: 'notebook', id: 'notebook:beta', title: 'Keep recent Beta', last_viewed_at: '2026-11-08' }]) : json(notebookRows)); });
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
    const draft = screen.getByRole('textbox', { name: 'Question draft' });
    fireEvent.change(draft, { target: { value: 'Keep question' } });
    fail = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(screen.getByText('Classic without versions')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Question draft' })).toBe(draft);
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
