import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { libraryServer, renderLibrary } from '../../test/library-harness';
import { legacySource } from '../../test/library-fixtures';
import { json } from '../../test/notebook-fixtures';
import { sessionCoordinator, publishTurnTarget, readTurnContext } from '@study/web-transport';
const detailPath = '/sources/' + encodeURIComponent(legacySource.id);
it('opens the empty-library import and preserves the notebook default without selecting question scope', async () => {
    const requests = libraryServer(r => r.method === 'GET' && new URL(r.url).pathname === '/api/sources' ? json([]) : undefined);
    const h = await renderLibrary();
    const empty = await screen.findByRole('region', { name: 'No sources yet' });
    fireEvent.click(within(empty).getByRole('button', { name: 'Add Source' }));
    expect(screen.getByRole('dialog', { name: 'Add Source' })).toBeVisible();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    await act(async () => h.router.navigate('/notebooks/n'));
    const panel = await screen.findByRole('region', { name: 'Classic sources' });
    fireEvent.click(within(panel).getAllByRole('button', { name: 'Add Source' })[0]!);
    const row = h.workbench.drafts.library.getSnapshot().find(r => r.owner.kind === 'notebook' && r.input.kind === 'import')!;
    expect(row.input).toMatchObject({ notebooks: ['n'], embed: false, transformations: [] });
    expect(requests.some(r => r.method === 'PATCH' || r.url.includes('/selection'))).toBe(false);
});
it('opens a focused source with Enter and returns to the library after confirmed global deletion', async () => {
    const requests = libraryServer(r => r.method === 'DELETE' ? json({ message: 'Deleted' }) : undefined);
    const h = await renderLibrary();
    const link = await screen.findByRole('link', { name: 'Historical paper' });
    link.focus();
    fireEvent.keyDown(link, { key: 'Enter' });
    await screen.findByText('Original source body');
    expect(h.router.state.location.pathname).toBe(detailPath);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Source' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(h.router.state.location.pathname).toBe('/sources'));
    expect(requests.filter(r => r.method === 'DELETE')).toHaveLength(1);
});
it('palette navigates real destinations and launches actual source/notebook forms', async () => {
    const requests = libraryServer(r => r.method === 'POST' && r.url.endsWith('/notebooks') ? json({ id: 'n', name: 'Palette notebook', description: '', archived: false, created: '2026-11-08', updated: '2026-11-08', source_count: 0, note_count: 0 }) : undefined);
    const h = await renderLibrary();
    await screen.findByRole('link', { name: 'Historical paper' });
    fireEvent.click(screen.getByRole('button', { name: 'Commands' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'New Source' }));
    expect(screen.getByRole('dialog', { name: 'Add Source' })).toBeVisible();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Commands' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'New Notebook' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Palette notebook' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'New' }));
    await waitFor(() => expect(requests.some(r => r.method === 'POST' && r.url.endsWith('/notebooks'))).toBe(true));
    await waitFor(() => expect(h.router.state.location.pathname).toBe('/notebooks/n'));
    await screen.findByRole('region', { name: 'Classic sources' });
    fireEvent.click(screen.getByRole('button', { name: 'Commands' }));
    fireEvent.click(await within(screen.getByRole('dialog')).findByRole('button', { name: 'Sources' }));
    await waitFor(() => expect(h.router.state.location.pathname).toBe('/sources'));
});
it('keeps palette shortcuts out of editable inputs and IME composition', async () => {
    libraryServer();
    await renderLibrary();
    await screen.findByRole('button', { name: 'Add Source' });
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: 'Commands' })).toBeVisible();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.queryByRole('dialog', { name: 'Commands' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add Source' }));
    const title = screen.getByLabelText('Import title');
    fireEvent.keyDown(title, { key: 'k', ctrlKey: true });
    expect(screen.queryByRole('dialog', { name: 'Commands' })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true, isComposing: true });
    expect(screen.queryByRole('dialog', { name: 'Commands' })).not.toBeInTheDocument();
});
it('retains transformation choice and unknown operation across source remount without resubmission', async () => {
    const requests = libraryServer(r => r.method === 'POST' && r.url.endsWith('/insights') ? json({ status: 'pending', source_id: legacySource.id, transformation_id: 'transformation:summary', command_id: null }, 202) : undefined);
    const h = await renderLibrary(detailPath);
    await screen.findByText('Original source body');
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Insights' }));
    const select = await screen.findByRole('combobox');
    await screen.findByRole('option', { name: 'Summary' });
    fireEvent.change(select, { target: { value: 'transformation:summary' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate New Insight' }));
    await screen.findByText(/Work may already be running/);
    await act(async () => h.router.navigate('/sources'));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep work and continue' }));
    await screen.findByRole('link', { name: 'Historical paper' });
    fireEvent.click(screen.getByRole('link', { name: 'Historical paper' }));
    await screen.findByText('Original source body');
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Insights' }));
    expect(await screen.findByText(/Work may already be running/)).toBeVisible();
    expect(screen.getByRole('combobox')).toHaveValue('transformation:summary');
    expect(screen.getByRole('button', { name: 'Generate New Insight' })).toBeDisabled();
    expect(requests.filter(r => r.method === 'POST' && r.url.endsWith('/insights'))).toHaveLength(1);
});
it('stale unsent imports explain retention and offer a separate blank intent without copying files', async () => {
    const requests = libraryServer();
    const h = await renderLibrary();
    fireEvent.click(await screen.findByRole('button', { name: 'Add Source' }));
    fireEvent.click(screen.getByRole('button', { name: 'Upload File' }));
    const file = new File(['private fixture'], 'keep.txt');
    fireEvent.change(screen.getByLabelText('File(s) *'), { target: { files: [file] } });
    const original = h.workbench.drafts.library.getSnapshot().find(r => r.input.kind === 'import')!;
    await act(async () => { sessionCoordinator.confirmed(); publishTurnTarget(readTurnContext()!.target, false); });
    await act(async () => publishTurnTarget(readTurnContext()!.target, true));
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    fireEvent.click(await screen.findByRole('button', { name: 'Start a separate new draft' }));
    const rows = h.workbench.drafts.library.getSnapshot().filter(r => r.input.kind === 'import');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.id).toBe(original.id);
    expect(rows[0]!.input.kind === 'import' && rows[0]!.input.files[0]).toBe(file);
    expect(rows[1]!.input).toMatchObject({ title: '', files: [], urls: '', text: '' });
    expect(requests.some(r => r.method === 'POST')).toBe(false);
});
it('late file bodies after route disposal never create or expose a Blob URL', async () => {
    let finish!: (b: Blob) => void;
    libraryServer(r => r.url.endsWith('/download') ? r.method === 'HEAD' ? new Response(null) : Object.assign(new Response('x'), { blob: () => new Promise<Blob>(resolve => finish = resolve) }) : undefined);
    const create = vi.fn(() => 'blob:late');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }));
    const h = await renderLibrary(detailPath);
    await screen.findByText('Original source body');
    fireEvent.click(screen.getByRole('button', { name: 'Download File' }));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    await act(async () => h.router.navigate('/sources'));
    await act(async () => finish(new Blob(['later'])));
    expect(create).not.toHaveBeenCalled();
});
it('notebook sources paginate in their original parent and distinguish global delete from unlink', async () => {
    const requests = libraryServer(r => {
        const u = new URL(r.url);
        if (r.method === 'GET' && u.pathname === '/api/sources')
            return json(u.searchParams.get('offset') === '30' ? [{ ...legacySource, id: 'source:later', title: 'Later source' }] : Array.from({ length: 30 }, (_, i) => ({ ...legacySource, id: 'source:' + i, title: 'Paper ' + i })));
        if (r.method === 'DELETE')
            return json({ message: 'Deleted' });
        return undefined;
    });
    const h = await renderLibrary('/notebooks/n');
    const panel = await screen.findByRole('region', { name: 'Classic sources' });
    fireEvent.click(await within(panel).findByRole('button', { name: 'Load more sources' }));
    expect(await within(panel).findByRole('link', { name: 'Later source' })).toBeVisible();
    const paged = requests.find(r => r.url.includes('offset=30'))!;
    expect(new URL(paged.url).searchParams.get('notebook_id')).toBe('n');
    fireEvent.click(within(panel).getAllByRole('button', { name: 'Delete Source' })[0]!);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(requests.filter(r => r.method === 'DELETE')).toHaveLength(1));
    expect(requests.find(r => r.method === 'DELETE')!.url).toContain('/api/sources/source%3A0');
    expect(h.router.state.location.pathname).toBe('/notebooks/n');
});
it.each([false, true])('import submission uncertainty retains actual producer identity when supplied: %s', async (identity) => {
    const requests = libraryServer(r => r.method === 'POST' ? json({ detail: { code: 'COMMAND_SUBMISSION_UNKNOWN', retry_safe: false, ...(identity ? { resource_id: 'source:maybe', command_id: 'command:maybe' } : {}) } }, 409) : undefined);
    const h = await renderLibrary();
    fireEvent.click(await screen.findByRole('button', { name: 'Add Source' }));
    fireEvent.change(screen.getByLabelText('URL(s) *'), { target: { value: 'https://source.example/one\nhttps://source.example/two' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Import sources' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Import sources' }));
    await screen.findByText(/Work may already be running/);
    const row = h.workbench.drafts.library.getSnapshot().find(r => r.input.kind === 'import')!;
    expect(row.receipts).toEqual([{ state: 'unknown', ...(identity ? { resourceId: 'source:maybe', commandId: 'command:maybe' } : {}) }]);
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Import sources' })).toBeDisabled();
});
it('association additions preserve partial receipts and stop before later notebook targets on unknown', async () => {
    let count = 0;
    const requests = libraryServer(r => {
        const p = new URL(r.url).pathname;
        if (p === '/api/notebooks')
            return json(['n', 'n2', 'n3'].map(id => ({ id, name: 'Book ' + id, description: '', archived: false, created: '2026-11-08', updated: '2026-11-08', source_count: 0, note_count: 0 })));
        if (r.method === 'POST' && p.includes('/notebooks/'))
            return ++count === 1 ? json({ message: 'Linked' }) : json({ detail: { code: 'COMMAND_SUBMISSION_UNKNOWN' } }, 409);
        if (r.method === 'GET' && p.includes('/sources/source%3Aalpha%3Afull'))
            return json({ ...legacySource, full_text: 'Original source body', notebooks: [] });
        return undefined;
    });
    const h = await renderLibrary(detailPath);
    await screen.findByText('Original source body');
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Details' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit notebook associations' }));
    for (const name of ['Book n', 'Book n2', 'Book n3'])
        fireEvent.click(await screen.findByLabelText(name));
    fireEvent.click(screen.getByRole('button', { name: 'Save associations' }));
    await screen.findByText(/Work may already be running/);
    expect(count).toBe(2);
    expect(requests.some(r => r.method === 'POST' && r.url.includes('/notebooks/n3/'))).toBe(false);
    expect(h.workbench.drafts.library.getSnapshot().find(r => r.input.kind === 'associations')?.receipts.map(r => r.state)).toEqual(['accepted', 'unknown']);
});
it('notebook source links preserve their return origin and the sidebar opens the actual library', async () => {
    const requests = libraryServer();
    const h = await renderLibrary('/notebooks/n');
    const panel = await screen.findByRole('region', { name: 'Classic sources' });
    fireEvent.click(await within(panel).findByRole('link', { name: 'Historical paper' }));
    await screen.findByText('Original source body');
    const back = screen.getByRole('link', { name: 'Back' });
    expect(back).toHaveAttribute('href', '/notebooks/n');
    fireEvent.click(back);
    await screen.findByRole('region', { name: 'Classic sources' });
    fireEvent.click(screen.getByRole('link', { name: 'Sources' }));
    await waitFor(() => expect(h.router.state.location.pathname).toBe('/sources'));
    expect(await screen.findByRole('heading', { name: 'Sources' })).toBeVisible();
    expect(requests.some(r => r.method === 'PATCH' || r.method === 'POST')).toBe(false);
});
async function changeLibraryIdentity(kind: 'reauth' | 'target') {
    const target = readTurnContext()!.target;
    await act(async () => {
        if (kind === 'reauth') {
            sessionCoordinator.confirmed();
            publishTurnTarget(target, false);
        }
        else
            publishTurnTarget({ ...target, apiBase: 'http://localhost:3000/other-api' }, true);
    });
    await act(async () => publishTurnTarget(target, true));
}
it.each([['reauth', false], ['reauth', true], ['target', false], ['target', true]] as const)('I1 source Details and Insights recover a separate current intent after %s; dirty=%s', async (kind, dirty) => {
    const requests = libraryServer(r => r.method === 'PUT' ? json({ ...legacySource, full_text: 'Original source body', notebooks: ['n'], title: 'Current edit' }) : r.method === 'POST' ? json({ status: 'pending', source_id: legacySource.id, transformation_id: 'transformation:summary', command_id: null }, 202) : undefined);
    const h = await renderLibrary(detailPath);
    await screen.findByText('Original source body');
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Details' }));
    const title = await screen.findByLabelText('Source title');
    if (dirty)
        fireEvent.change(title, { target: { value: 'Retained original edit' } });
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Insights' }));
    await screen.findByRole('option', { name: 'Summary' });
    if (dirty)
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'transformation:summary' } });
    const store = h.workbench.drafts.library, oldMetadata = store.getSnapshot().find(r => r.input.kind === 'metadata')!, oldInsight = store.getSnapshot().find(r => r.input.kind === 'action' && r.input.action === 'insight')!;
    await changeLibraryIdentity(kind);
    await screen.findByText('Original source body');
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Details' }));
    if (dirty) {
        expect(await screen.findByLabelText('Source title')).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Start a separate new draft' }));
    }
    await waitFor(() => expect(screen.getByLabelText('Source title')).toBeEnabled());
    expect(screen.getByLabelText('Source title')).not.toHaveValue('Retained original edit');
    expect(store.get(oldMetadata.id)).toBe(oldMetadata);
    fireEvent.change(screen.getByLabelText('Source title'), { target: { value: 'Current edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save source details' }));
    await waitFor(() => expect(requests.filter(r => r.method === 'PUT')).toHaveLength(1));
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Insights' }));
    await screen.findByRole('option', { name: 'Summary' });
    if (dirty) {
        expect(screen.getByRole('combobox')).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Start a separate new draft' }));
    }
    await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled());
    expect(screen.getByRole('combobox')).toHaveValue('');
    expect(store.get(oldInsight.id)).toBe(oldInsight);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'transformation:summary' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate New Insight' }));
    await screen.findByText(/Work may already be running/);
    const unknown = store.getSnapshot().find(r => r.status === 'unknown' && r.input.kind === 'action' && r.input.action === 'insight')!;
    await changeLibraryIdentity('reauth');
    await screen.findByText('Original source body');
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Insights' }));
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Start a separate new draft' })).not.toBeInTheDocument();
    expect(store.get(unknown.id)).toBe(unknown);
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
});
it.each([['reauth', false], ['reauth', true], ['target', false], ['target', true]] as const)('I1 stale association recovery after %s keeps original choices; dirty=%s', async (kind, dirty) => {
    const requests = libraryServer();
    const h = await renderLibrary(detailPath);
    await screen.findByText('Original source body');
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Details' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit notebook associations' }));
    const selection = await screen.findByLabelText('Synthetic notebook');
    if (dirty)
        fireEvent.click(selection);
    const store = h.workbench.drafts.library, old = store.getSnapshot().find(r => r.input.kind === 'associations')!;
    await changeLibraryIdentity(kind);
    await screen.findByText('Original source body');
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Details' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit notebook associations' }));
    if (dirty) {
        expect(await screen.findByLabelText('Synthetic notebook')).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Start a separate new draft' }));
    }
    expect(await screen.findByLabelText('Synthetic notebook')).toBeChecked();
    expect(screen.getByLabelText('Synthetic notebook')).toBeEnabled();
    expect(store.get(old.id)).toBe(old);
    expect(old.input).toMatchObject({ selected: dirty ? [] : ['n'] });
    expect(requests.some(r => r.method === 'POST' || r.method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByLabelText('Synthetic notebook'));
    fireEvent.click(screen.getByRole('button', { name: 'Save associations' }));
    await waitFor(() => expect(requests.filter(r => r.method === 'DELETE')).toHaveLength(1));
    expect(store.get(old.id)).toBe(old);
});
it.each([['reauth', false], ['reauth', true], ['target', false], ['target', true]] as const)('I1 stale existing-source recovery after %s keeps original search and selection; dirty=%s', async (kind, dirty) => {
    const requests = libraryServer(r => r.method === 'GET' && decodeURIComponent(new URL(r.url).pathname) === '/api/sources/source:extra' ? json({ ...legacySource, id: 'source:extra', title: 'Extra source', full_text: 'Extra body', notebooks: [] }) : r.method === 'GET' && new URL(r.url).pathname === '/api/sources' ? json(new URL(r.url).searchParams.has('notebook_id') ? [legacySource] : [legacySource, { ...legacySource, id: 'source:extra', title: 'Extra source' }]) : undefined);
    const h = await renderLibrary('/notebooks/n'), panel = await screen.findByRole('region', { name: 'Classic sources' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Add Existing Source' }));
    await screen.findByLabelText('Extra source');
    if (dirty) {
        fireEvent.click(screen.getByLabelText('Extra source'));
        fireEvent.change(screen.getByLabelText('Search sources by name or URL...'), { target: { value: 'Retained query' } });
    }
    const store = h.workbench.drafts.library, old = store.getSnapshot().find(r => r.input.kind === 'existing')!;
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    await changeLibraryIdentity(kind);
    fireEvent.click(within(await screen.findByRole('region', { name: 'Classic sources' })).getByRole('button', { name: 'Add Existing Source' }));
    if (dirty) {
        expect(await screen.findByLabelText('Search sources by name or URL...')).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Start a separate new draft' }));
    }
    expect(screen.getByLabelText('Search sources by name or URL...')).toHaveValue('');
    expect(await screen.findByLabelText('Extra source')).not.toBeChecked();
    expect(store.get(old.id)).toBe(old);
    expect(requests.some(r => r.method === 'POST')).toBe(false);
    fireEvent.click(screen.getByLabelText('Extra source'));
    fireEvent.click(screen.getByRole('button', { name: 'Add Selected' }));
    await waitFor(() => expect(requests.filter(r => r.method === 'POST')).toHaveLength(1));
    expect(store.get(old.id)).toBe(old);
});
it.each(['reauth', 'target'] as const)('I1 canceled pristine action opens a new current confirmation after %s', async (kind) => {
    const requests = libraryServer(r => r.method === 'DELETE' ? json({ message: 'Deleted' }) : undefined);
    const h = await renderLibrary(detailPath);
    await screen.findByText('Original source body');
    fireEvent.click(screen.getByRole('button', { name: 'Delete Source' }));
    const store = h.workbench.drafts.library, old = store.getSnapshot().find(r => r.input.kind === 'action' && r.input.action === 'delete')!;
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await changeLibraryIdentity(kind);
    await screen.findByText('Original source body');
    fireEvent.click(screen.getByRole('button', { name: 'Delete Source' }));
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' })).toBeEnabled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(requests.filter(r => r.method === 'DELETE')).toHaveLength(1));
    expect(store.get(old.id)).toBe(old);
    expect(store.getSnapshot().filter(r => r.input.kind === 'action' && r.input.action === 'delete')).toHaveLength(2);
});
it('I2 canceled clean action cannot hide a dirty source owner from sidebar or Back/Forward and stale confirmation', async () => {
    libraryServer();
    const h = await renderLibrary(detailPath, { entries: ['/notebooks', detailPath, '/sources'], index: 1 });
    await screen.findByText('Original source body');
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Details' }));
    const title = screen.getByLabelText('Source title');
    fireEvent.change(title, { target: { value: 'Dirty source' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete Source' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('link', { name: 'Sources' }));
    expect(await screen.findByRole('dialog', { name: 'Leave this draft?' })).toBeVisible();
    const captured = h.workbench.navigation.getSnapshot().capture;
    fireEvent.change(title, { target: { value: 'Newer dirty source' } });
    await act(async () => { expect(h.workbench.navigation.confirm(captured)).toBeNull(); });
    expect(h.router.state.location.pathname).toBe(detailPath);
    await act(async () => h.router.navigate(-1));
    expect(await screen.findByRole('dialog', { name: 'Leave this draft?' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await act(async () => h.router.navigate(1));
    expect(await screen.findByRole('dialog', { name: 'Leave this draft?' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(title).toHaveValue('Newer dirty source');
});
it('I2 a pending hidden import still requires keep-and-continue after a clean dialog closes', async () => {
    let release!: (r: Response) => void;
    const requests = libraryServer(r => r.method === 'POST' ? new Promise<Response>(resolve => release = resolve) : undefined);
    const h = await renderLibrary();
    fireEvent.click(await screen.findByRole('button', { name: 'Add Source' }));
    fireEvent.change(screen.getByLabelText('URL(s) *'), { target: { value: 'https://source.example/pending' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByLabelText('Summary');
    fireEvent.click(screen.getByRole('button', { name: 'Import sources' }));
    await waitFor(() => expect(requests.filter(r => r.method === 'POST')).toHaveLength(1));
    const original = h.workbench.drafts.library.getSnapshot().find(r => r.input.kind === 'import')!;
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Source' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('link', { name: 'Notebooks' }));
    expect(await screen.findByRole('button', { name: 'Keep work and continue' })).toBeVisible();
    expect(h.workbench.drafts.library.get(original.id)).toBe(original);
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await act(async () => release(json({ ...legacySource, full_text: null, notebooks: [] })));
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
});
