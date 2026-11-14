import { useState } from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { sourceContext, sourceWorkspace, selection } from '../../test/source-fixtures';
import { sourceServer, renderSourceFeature } from '../../test/source-harness';
import { json } from '../../test/notebook-fixtures';
import { DiscoveryPanel } from './DiscoveryPanel';
import { RemoteImportPanel } from './RemoteImportPanel';
import { readTurnContext } from '@study/web-transport';
const webStatus = { state: 'ready', provider: 'firecrawl', configured: true, max_results: 6, access_mode: 'keyless_trial' };
const webResults = { provider: 'firecrawl', searched_at: '2026-11-08T10:11:12Z', results: [{ id: 'r', title: 'Synthetic web title', url: 'https://example.invalid/x', snippet: 'Synthetic snippet', domain: 'example.invalid' }], total_count: 1 };
beforeEach(sourceContext);
it('web search is explicit and IME-safe, imports only after captured confirmation, and never selects imported content', async () => { const requests = sourceServer(r => json(r.url.endsWith('/status') ? webStatus : r.url.endsWith('/web-search') ? webResults : { state: 'saved', source_id: 's-web', source_version_id: 'v-web', job_id: null, url: 'https://example.invalid/x', warning: null })); await renderSourceFeature(<DiscoveryPanel notebookId="n" onChanged={() => { }}/>); expect(requests.some(r => r.url.includes('web-search'))).toBe(false); fireEvent.click(screen.getByRole('button', { name: 'Discover sources on the web' })); fireEvent.click(screen.getByRole('button', { name: 'Check again' })); const input = screen.getByLabelText('What would you like to learn?'); await waitFor(() => expect(screen.getByRole('button', { name: 'Search the web' })).toBeDisabled()); fireEvent.compositionStart(input); fireEvent.change(input, { target: { value: 'Synthetic query' } }); fireEvent.keyDown(input, { key: 'Enter', isComposing: true }); fireEvent.submit(input.closest('form')!); expect(requests.filter(r => r.method === 'POST')).toHaveLength(0); fireEvent.compositionEnd(input); fireEvent.click(screen.getByRole('button', { name: 'Search the web' })); await screen.findByText('Synthetic web title'); fireEvent.click(screen.getByRole('checkbox', { name: 'Synthetic web title' })); fireEvent.click(screen.getByRole('button', { name: 'Import selected (1)' })); expect(requests.filter(r => r.url.endsWith('/web-import'))).toHaveLength(0); fireEvent.click(within(screen.getAllByRole('dialog').at(-1)!).getByRole('button', { name: 'Confirm' })); await waitFor(() => expect(requests.filter(r => r.url.endsWith('/web-import'))).toHaveLength(1)); expect(requests.some(r => r.method === 'PATCH')).toBe(false); expect(screen.getByText('2026-11-08T10:11:12Z')).toBeVisible(); });
it('provider reauth on a mixed job path disables Google work without disabling local authenticated repair', async () => { const requests = sourceServer(r => json(r.url.includes('/jobs/') ? { error: { code: 'NEEDS_REAUTH' } } : r.url.endsWith('/capabilities') ? { operations: [{ name: 'list_sources', support: 'available' }, { name: 'upload_source', support: 'available' }, { name: 'fetch_source_text', support: 'available' }] } : r.url.endsWith('/connections/notebooklm') ? { state: 'connected' } : { items: [{ id: 'rs', title: 'Remote source' }], next_cursor: null, listing_complete: true }, r.url.includes('/jobs/') ? 401 : 200)); const h = await renderSourceFeature(<RemoteImportPanel notebookId="n" workspace={{ ...sourceWorkspace(), link: { remote_notebook_id: 'remote-n' } }} selection={selection} onRemoteSelection={() => { }} onChanged={() => { }}/>); expect(requests.some(r => r.url.includes('/connections/notebooklm'))).toBe(false); fireEvent.click(screen.getByRole('button', { name: 'Verify Google connection' })); await waitFor(() => expect(screen.getByRole('button', { name: 'List linked notebook sources' })).toBeEnabled()); await act(async () => { await h.workbench.transport.send({ method: 'GET', path: '/personal/jobs/mixed', context: readTurnContext()! }); }); expect(h.workbench.controller.getSnapshot()).toMatchObject({ ready: true, providerNeedsReauth: true }); expect(screen.getByRole('button', { name: 'List linked notebook sources' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Sync selected originals to Google' })).toBeDisabled(); expect(requests.filter(r => r.url.includes('/connections/notebooklm'))).toHaveLength(1); });
it('unknown or missing per-operation capability cannot be replaced by app readiness', async () => { sourceServer(r => json(r.url.endsWith('/capabilities') ? { operations: [{ name: 'list_sources', support: 'unverified' }] } : { state: 'connected' })); await renderSourceFeature(<RemoteImportPanel notebookId="n" workspace={{ ...sourceWorkspace(), link: { remote_notebook_id: 'remote-n' } }} selection={selection} onRemoteSelection={() => { }} onChanged={() => { }}/>); fireEvent.click(screen.getByRole('button', { name: 'Verify Google connection' })); await screen.findByText('List linked notebook sources: Unverified'); expect(screen.getByRole('button', { name: 'List linked notebook sources' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Sync selected originals to Google' })).toBeDisabled(); });
it('a changed linked notebook retires the loaded remote source page and its pending confirmation', async () => { let change!: (id: string) => void; const requests = sourceServer(r => json(r.url.endsWith('/capabilities') ? { operations: [{ name: 'list_sources', support: 'available' }, { name: 'upload_source', support: 'available' }, { name: 'fetch_source_text', support: 'available' }] } : r.url.endsWith('/connections/notebooklm') ? { state: 'connected' } : { items: [{ id: 'rs', title: 'Remote source A' }], next_cursor: 'cursor-a', listing_complete: false })); function Panel() { const [remote, setRemote] = useState('A'); change = setRemote; return <RemoteImportPanel notebookId="n" workspace={{ ...sourceWorkspace(), link: { remote_notebook_id: remote } }} selection={selection} onRemoteSelection={() => { }} onChanged={() => { }}/>; } await renderSourceFeature(<Panel />); fireEvent.click(screen.getByRole('button', { name: 'Verify Google connection' })); await waitFor(() => expect(screen.getByRole('button', { name: 'List linked notebook sources' })).toBeEnabled()); fireEvent.click(screen.getByRole('button', { name: 'List linked notebook sources' })); await screen.findByText('Remote source A'); fireEvent.click(screen.getByRole('button', { name: 'Sync selected originals to Google' })); await act(async () => change('B')); expect(screen.queryByText('Remote source A')).not.toBeInTheDocument(); await act(async () => change('A')); expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' })).toBeDisabled(); expect(requests.some(r => r.method === 'POST')).toBe(false); });
it('selecting one remote source keeps the authoritative page available for selecting the next', async () => { sourceServer(r => json(r.url.endsWith('/capabilities') ? { operations: [{ name: 'list_sources', support: 'available' }, { name: 'fetch_source_text', support: 'available' }] } : r.url.endsWith('/connections/notebooklm') ? { state: 'connected' } : { items: [{ id: 'r1', title: 'Remote one' }, { id: 'r2', title: 'Remote two' }], next_cursor: null, listing_complete: true })); function Panel() { const [value, setValue] = useState(selection); return <RemoteImportPanel notebookId="n" workspace={{ ...sourceWorkspace(), link: { remote_notebook_id: 'A' } }} selection={value} onRemoteSelection={ids => setValue({ ...value, remote_source_ids: ids })} onChanged={() => { }}/>; } await renderSourceFeature(<Panel />); fireEvent.click(screen.getByRole('button', { name: 'Verify Google connection' })); await waitFor(() => expect(screen.getByRole('button', { name: 'List linked notebook sources' })).toBeEnabled()); fireEvent.click(screen.getByRole('button', { name: 'List linked notebook sources' })); await screen.findByRole('checkbox', { name: 'Remote one' }); fireEvent.click(screen.getByRole('checkbox', { name: 'Remote one' })); fireEvent.click(screen.getByRole('checkbox', { name: 'Remote two' })); expect(screen.getByRole('checkbox', { name: 'Remote one' })).toBeChecked(); expect(screen.getByRole('checkbox', { name: 'Remote two' })).toBeChecked(); });

const remoteCapabilities = { operations: [{ name: 'list_sources', support: 'available' }, { name: 'upload_source', support: 'available' }, { name: 'fetch_source_text', support: 'available' }] };
const remotePanel = <RemoteImportPanel notebookId="n" workspace={{ ...sourceWorkspace(), link: { remote_notebook_id: 'remote-n' } }} selection={{ ...selection, remote_source_ids: ['rs'] }} onRemoteSelection={() => { }} onChanged={() => { }} />;
const remoteRegion = () => within(screen.getByRole('region', { name: 'Google connection' }));
async function verifyRemote() {
    fireEvent.click(remoteRegion().getByRole('button', { name: 'Verify Google connection' }));
    await waitFor(() => expect(remoteRegion().getByRole('button', { name: 'List linked notebook sources' })).toBeEnabled());
}
it.each(['reauth', 'explicit-reverify'] as const)('retires loaded Google data and an open confirmation across %s, even with rapid flag recovery', async change => {
    const requests = sourceServer(request => json(request.url.includes('/jobs/') ? { error: { code: 'NEEDS_REAUTH' } } : request.url.endsWith('/capabilities') ? remoteCapabilities : request.url.endsWith('/connections/notebooklm') ? { state: 'connected' } : { items: [{ id: 'rs', title: 'Original remote page' }], next_cursor: null, listing_complete: true }, request.url.includes('/jobs/') ? 401 : 200));
    const h = await renderSourceFeature(remotePanel);
    await verifyRemote();
    fireEvent.click(remoteRegion().getByRole('button', { name: 'List linked notebook sources' }));
    await screen.findByText('Original remote page');
    fireEvent.click(screen.getByRole('button', { name: 'Sync selected originals to Google' }));
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' })).toBeEnabled();
    await act(async () => {
        if (change === 'reauth') {
            await h.workbench.transport.send({ method: 'GET', path: '/personal/jobs/mixed', context: readTurnContext()! });
            await h.workbench.transport.send({ method: 'GET', path: '/personal/jobs/mixed', context: readTurnContext()! });
        }
        expect(await h.workbench.controller.verifyProviderConnection()).toBe(true);
    });
    expect(h.workbench.controller.getSnapshot()).toMatchObject({ ready: true, providerNeedsReauth: false });
    expect(screen.queryByText('Original remote page')).not.toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' })).toBeDisabled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' }));
    expect(requests.some(request => request.method === 'POST')).toBe(false);
});

it('rejects an outstanding pre-reauth source list after verification and requires a fresh listing', async () => {
    let finish!: (response: Response) => void, lists = 0;
    const requests = sourceServer(request => {
        if (request.url.includes('/jobs/')) return json({ error: { code: 'NEEDS_REAUTH' } }, 401);
        if (request.url.endsWith('/capabilities')) return json(remoteCapabilities);
        if (request.url.endsWith('/connections/notebooklm')) return json({ state: 'connected' });
        lists++;
        return lists === 1 ? new Promise(resolve => { finish = resolve; }) : json({ items: [{ id: 'fresh', title: 'Fresh remote page' }], next_cursor: null, listing_complete: true });
    });
    const h = await renderSourceFeature(remotePanel);
    await verifyRemote();
    fireEvent.click(remoteRegion().getByRole('button', { name: 'List linked notebook sources' }));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    await act(async () => {
        await h.workbench.transport.send({ method: 'GET', path: '/personal/jobs/mixed', context: readTurnContext()! });
        expect(await h.workbench.controller.verifyProviderConnection()).toBe(true);
        finish(json({ items: [{ id: 'rs', title: 'Stale remote page' }], next_cursor: null, listing_complete: true }));
    });
    await waitFor(() => expect(remoteRegion().getByRole('button', { name: 'Verify Google connection' })).toBeEnabled());
    expect(screen.queryByText('Stale remote page')).not.toBeInTheDocument();
    expect(lists).toBe(1);
    await verifyRemote();
    expect(remoteRegion().getByRole('button', { name: 'Import selected Google text' })).toBeDisabled();
    fireEvent.click(remoteRegion().getByRole('button', { name: 'List linked notebook sources' }));
    await screen.findByText('Fresh remote page');
    expect(remoteRegion().getByRole('button', { name: 'Import selected Google text' })).toBeDisabled();
    expect(lists).toBe(2);
    expect(requests.some(request => request.method === 'POST')).toBe(false);
});

it('keeps a remote mutation unknown if its provider evidence retires before the receipt', async () => {
    let finish!: (response: Response) => void;
    sourceServer(request => request.method === 'POST' ? new Promise(resolve => { finish = resolve; }) : json(request.url.includes('/jobs/') ? { error: { code: 'NEEDS_REAUTH' } } : request.url.endsWith('/capabilities') ? remoteCapabilities : { state: 'connected' }, request.url.includes('/jobs/') ? 401 : 200));
    const h = await renderSourceFeature(remotePanel);
    await verifyRemote();
    fireEvent.click(screen.getByRole('button', { name: 'Sync selected originals to Google' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    await act(async () => {
        await h.workbench.transport.send({ method: 'GET', path: '/personal/jobs/mixed', context: readTurnContext()! });
        await h.workbench.controller.verifyProviderConnection();
        finish(json({ job_id: 'accepted-old', state: 'queued' }));
    });
    await waitFor(() => expect(h.workbench.drafts.sources.getSnapshot()[0]?.operation.state).toBe('unknown'));
    expect(h.workbench.controller.getSnapshot().ready).toBe(true);
});
