import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { libraryServer, renderLibrary } from '../../test/library-harness';
import { legacySource, sourceDetail, insight } from '../../test/library-fixtures';
import { json } from '../../test/notebook-fixtures';
import { publishTurnTarget, readTurnContext, sessionCoordinator } from '@study/web-transport';
const detailPath = '/sources/' + encodeURIComponent(legacySource.id);
async function importStep3() { fireEvent.click(screen.getByRole('button', { name: 'Next' })); await screen.findByLabelText('Synthetic notebook'); fireEvent.click(screen.getByRole('button', { name: 'Next' })); await screen.findByLabelText('Summary'); }
it('serial multiple URLs stop on unknown with partial receipts, retain options, and never replay on reopen', async () => {
    let release!: (r: Response) => void, count = 0;
    const requests = libraryServer(r => r.method === 'POST' && new URL(r.url).pathname === '/api/sources' ? (++count === 1 ? new Promise<Response>(resolve => release = resolve) : json({ detail: { code: 'COMMAND_SUBMISSION_UNKNOWN', retry_safe: false } }, 409)) : undefined);
    const h = await renderLibrary();
    fireEvent.click(await screen.findByRole('button', { name: 'Add Source' }));
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    fireEvent.change(screen.getByLabelText('URL(s) *'), { target: { value: 'https://a.example/one\nhttps://b.example/two\nhttps://c.example/three' } });
    await importStep3();
    fireEvent.click(screen.getByRole('button', { name: 'Import sources' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import sources' }));
    await waitFor(() => expect(count).toBe(1));
    await act(async () => release(json({ ...sourceDetail, id: 'source:accepted', command_id: 'command:accepted', status: 'queued' })));
    await waitFor(() => expect(count).toBe(2));
    expect(await screen.findByText(/Work may already be running/)).toBeVisible();
    expect(h.workbench.drafts.library.getSnapshot().find(r => r.input.kind === 'import')?.receipts).toEqual([{ state: 'accepted', resourceId: 'source:accepted', commandId: 'command:accepted' }, { state: 'unknown' }]);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Source' }));
    expect(screen.getByRole('button', { name: 'Import sources' })).toBeDisabled();
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(2);
});
it('multi-file import preserves exact File objects, next/back, and cancellation stops unsent items', async () => {
    let release!: (r: Response) => void;
    const requests = libraryServer(r => r.method === 'POST' ? new Promise<Response>(resolve => release = resolve) : undefined);
    const h = await renderLibrary();
    fireEvent.click(await screen.findByRole('button', { name: 'Add Source' }));
    fireEvent.click(screen.getByRole('button', { name: 'Upload File' }));
    const files = [new File(['first'], 'first.txt', { type: 'text/plain' }), new File(['second'], 'second.txt', { type: 'text/plain' })];
    fireEvent.change(screen.getByLabelText('File(s) *'), { target: { files } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('first.txt')).toBeVisible();
    await importStep3();
    fireEvent.click(screen.getByRole('button', { name: 'Import sources' }));
    await waitFor(() => expect(requests.filter(r => r.method === 'POST')).toHaveLength(1));
    const record = h.workbench.drafts.library.getSnapshot().find(r => r.input.kind === 'import')!;
    expect(record.input.kind === 'import' && record.input.files[0]).toBe(files[0]);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await act(async () => release(json({ ...sourceDetail, id: 'source:first' })));
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
    expect(h.workbench.drafts.library.get(record.id)?.receipts[0]?.resourceId).toBe('source:first');
});
it('retry and refresh remain status-specific guarded controls, never source-create substitutes', async () => {
    const requests = libraryServer(r => r.method === 'GET' && new URL(r.url).pathname === '/api/sources' ? json([{ ...legacySource, status: 'completed', command_id: 'command:old' }]) : undefined);
    await renderLibrary('/notebooks/n');
    const panel = await screen.findByRole('region', { name: 'Classic sources' });
    expect(await within(panel).findByRole('button', { name: 'Retry Processing' })).toBeDisabled();
    expect(within(panel).getByRole('button', { name: 'Refresh content' })).toBeDisabled();
    expect(within(panel).getAllByText('Completed processing cannot be refreshed here.').length).toBeGreaterThan(0);
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(0);
});
it('eligible legacy refresh issues the real guarded retry and displays backend409 honestly', async () => {
    const requests = libraryServer(r => r.method === 'POST' && r.url.endsWith('/retry') ? json({ detail: 'Retry refused' }, 409) : undefined);
    await renderLibrary('/notebooks/n');
    const panel = await screen.findByRole('region', { name: 'Classic sources' });
    const refresh = await within(panel).findByRole('button', { name: 'Refresh content' });
    expect(refresh).toBeEnabled();
    fireEvent.click(refresh);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(requests.filter(r => r.method === 'POST')).toHaveLength(1));
    expect(requests.find(r => r.method === 'POST')!.url).toContain('/sources/source%3Aalpha%3Afull/retry');
    expect(await screen.findByText(/The save was rejected/)).toBeVisible();
});
it('contained download uses only ID and revokes its Blob URL; external media stays explicit', async () => {
    const requests = libraryServer(r => r.url.endsWith('/download') ? r.method === 'HEAD' ? new Response(null) : new Response('contents', { headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="../safe.txt"' } }) : undefined);
    const create = vi.fn(() => 'blob:owned'), revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this.download); });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
    await renderLibrary(detailPath);
    await screen.findByText('Original source body');
    expect(document.querySelector('iframe')).toBeNull();
    expect(document.querySelector('a[href="https://www.youtube.com/watch?v=abcdefghijk"]')).toHaveAttribute('rel', 'noopener noreferrer');
    expect(document.body.textContent).not.toContain('/private/upload');
    fireEvent.click(screen.getByRole('button', { name: 'Download File' }));
    await waitFor(() => expect(clicked).toEqual(['safe.txt']));
    expect(revoke).toHaveBeenCalledWith('blob:owned');
    expect(requests.filter(r => r.url.endsWith('/download')).map(r => r.method)).toEqual(['HEAD', 'GET']);
    expect(screen.getByRole('link', { name: 'Open original URL' })).toHaveAttribute('rel', 'noopener noreferrer');
    fireEvent.click(screen.getByRole('button', { name: 'Copy URL' }));
    expect(await screen.findByText('URL copied to clipboard')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Play YouTube video' }));
    expect(screen.getByTitle('YouTube video')).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/abcdefghijk');
});
it('embedding receipt starts exactly one observer and terminal unknown never enables resend', async () => {
    const requests = libraryServer(r => r.url.endsWith('/embed') ? json({ success: true, message: 'Queued', item_id: legacySource.id, item_type: 'source', command_id: 'command:embed' }) : r.url.includes('/commands/jobs/') ? json({ job_id: 'command:embed', status: 'unknown' }) : undefined);
    await renderLibrary(detailPath);
    await screen.findByText('Original source body');
    fireEvent.click(screen.getByRole('button', { name: 'Embed Content' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' }));
    await screen.findByText(/Work may already be running/);
    expect(requests.filter(r => r.url.includes('/commands/jobs/'))).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    expect(await requests.find(r => r.method === 'POST')!.clone().json()).toEqual({ item_id: legacySource.id, item_type: 'source', async_processing: false });
});
it('existing-source search uses real global text search and links only the explicitly selected verified source', async () => {
    const requests = libraryServer(r => r.url.endsWith('/search') ? json({ results: [{ id: 'source:extra', parent_id: 'source:extra', title: 'Extra source' }, { id: 'chunk:x', parent_id: 'source:extra', title: 'Extra source' }], search_type: 'text', total_count: 2 }) : r.url.endsWith('/sources/source%3Aextra') && r.method === 'GET' ? json({ ...sourceDetail, id: 'source:extra' }) : r.method === 'POST' ? json({ message: 'Linked' }) : undefined);
    await renderLibrary('/notebooks/n');
    const panel = await screen.findByRole('region', { name: 'Classic sources' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Add Existing Source' }));
    fireEvent.change(await screen.findByLabelText('Search sources by name or URL...'), { target: { value: 'Extra' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Search...' }));
    fireEvent.click(await screen.findByLabelText('Extra source'));
    fireEvent.click(screen.getByRole('button', { name: 'Add Selected' }));
    await waitFor(() => expect(requests.some(r => r.method === 'POST' && r.url.includes('/notebooks/n/sources/source%3Aextra'))).toBe(true));
    const search = requests.find(r => r.url.endsWith('/search'))!;
    expect(await search.clone().json()).toEqual({ query: 'Extra', type: 'text', search_sources: true, search_notes: false, limit: 100, minimum_score: 0.01 });
    expect(requests.filter(r => r.method === 'POST' && r.url.includes('/notebooks/n/sources/'))).toHaveLength(1);
});
it('insight delete is confirmed, full reference opens source, and missing timestamps never display None', async () => {
    const requests = libraryServer(r => r.method === 'DELETE' ? json({ message: 'Deleted' }) : undefined);
    await renderLibrary(detailPath);
    await screen.findByText('Original source body');
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Insights' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Summary' }));
    await screen.findByText('Preserved insight');
    expect(screen.getByRole('link', { name: 'View Source' })).toHaveAttribute('href', detailPath);
    expect(document.body.textContent).not.toContain('None');
    fireEvent.click(screen.getByRole('button', { name: 'Delete Insight' }));
    expect(requests.filter(r => r.method === 'DELETE')).toHaveLength(0);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(requests.filter(r => r.method === 'DELETE')).toHaveLength(1));
    expect(requests.find(r => r.method === 'DELETE')!.url).toContain('/insights/' + encodeURIComponent(insight.id));
});
it('library keyboard navigation and notebook source collapse are real controls', async () => {
    libraryServer(r => r.method === 'GET' && new URL(r.url).pathname === '/api/sources' ? json([{ ...legacySource, id: 'source:one', title: 'One' }, { ...legacySource, id: 'source:two', title: 'Two' }]) : undefined);
    const h = await renderLibrary();
    const one = await screen.findByRole('link', { name: 'One' });
    one.focus();
    fireEvent.keyDown(one, { key: 'End' });
    expect(screen.getByRole('link', { name: 'Two' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(one).toHaveFocus();
    fireEvent.keyDown(one, { key: 'ArrowDown' });
    expect(screen.getByRole('link', { name: 'Two' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(one).toHaveFocus();
    await act(async () => h.router.navigate('/notebooks/n'));
    const section = await screen.findByRole('region', { name: 'Classic sources' });
    fireEvent.click(within(section).getByRole('button', { name: 'Classic sources' }));
    expect(within(section).getByRole('button', { name: 'Classic sources' })).toHaveAttribute('aria-expanded', 'false');
});
it('temporary readiness loss and return preserve an unsent import without automatic submission', async () => {
    const requests = libraryServer();
    const h = await renderLibrary();
    fireEvent.click(await screen.findByRole('button', { name: 'Add Source' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enter Text' }));
    fireEvent.change(screen.getByLabelText('Source text'), { target: { value: 'Still mine' } });
    const original = h.workbench.drafts.library.getSnapshot().find(r => r.input.kind === 'import')!, c = readTurnContext()!;
    await act(async () => publishTurnTarget(c.target, false));
    await act(async () => publishTurnTarget(c.target, true));
    expect(h.workbench.drafts.library.get(original.id)?.input).toMatchObject({ text: 'Still mine' });
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(0);
});
it('stopping command observation explains that remote processing may continue and never cancels it', async () => {
    const requests = libraryServer(r => r.url.endsWith('/embed') ? json({ success: true, item_id: legacySource.id, item_type: 'source', command_id: 'command:running' }) : r.url.includes('/commands/jobs/') ? json({ job_id: 'command:running', status: 'running' }) : undefined);
    const h = await renderLibrary(detailPath);
    await screen.findByText('Original source body');
    fireEvent.click(screen.getByRole('button', { name: 'Embed Content' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop checking' }));
    expect(await screen.findByText('Checking stopped. Processing may continue on the server.')).toBeVisible();
    expect(h.workbench.drafts.library.getSnapshot().find(r => r.input.kind === 'action' && r.input.action === 'embed')).toMatchObject({ status: 'accepted', stopRequested: true });
    expect(requests.filter(r => r.method === 'POST' || r.method === 'DELETE')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
});
it.each(['retry', 'embed', 'insight'] as const)('I3 %s uncertainty retains actual producer IDs across remount without another POST', async (action) => {
    const ids = { resource_id: legacySource.id, command_id: 'command:uncertain' };
    const requests = libraryServer(r => r.method === 'POST' ? json({ detail: { code: 'COMMAND_SUBMISSION_UNKNOWN', retry_safe: false, ...ids } }, 409) : undefined);
    const h = await renderLibrary(detailPath);
    await screen.findByText('Original source body');
    if (action === 'insight') {
        fireEvent.mouseDown(screen.getByRole('tab', { name: 'Insights' }));
        await screen.findByRole('option', { name: 'Summary' });
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'transformation:summary' } });
        fireEvent.click(screen.getByRole('button', { name: 'Generate New Insight' }));
    }
    else {
        fireEvent.click(screen.getByRole('button', { name: action === 'retry' ? 'Retry Processing' : 'Embed Content' }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' }));
    }
    await screen.findByText(/Work may already be running/);
    const original = h.workbench.drafts.library.getSnapshot().find(r => r.input.kind === 'action' && r.input.action === action)!;
    expect(original.receipts).toEqual([{ state: 'unknown', resourceId: legacySource.id, commandId: 'command:uncertain' }]);
    expect(original.commandId).toBe('command:uncertain');
    expect(screen.getByText('command:uncertain')).toBeVisible();
    if (action !== 'insight')
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    await act(async () => h.router.navigate('/sources'));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep work and continue' }));
    fireEvent.click(await screen.findByRole('link', { name: 'Historical paper' }));
    await screen.findByText('Original source body');
    if (action === 'insight') {
        fireEvent.mouseDown(screen.getByRole('tab', { name: 'Insights' }));
        expect(screen.getByRole('button', { name: 'Generate New Insight' })).toBeDisabled();
    }
    else {
        fireEvent.click(screen.getByRole('button', { name: action === 'retry' ? 'Retry Processing' : 'Embed Content' }));
        expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' })).toBeDisabled();
    }
    expect(screen.getByText('command:uncertain')).toBeVisible();
    expect(h.workbench.drafts.library.get(original.id)).toBe(original);
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
    expect(requests.some(r => r.url.includes('/commands/jobs/'))).toBe(false);
});
it.each(['retry', 'embed', 'insight'] as const)('I3 %s uncertainty without IDs never invents an inspection identity', async (action) => {
    const requests = libraryServer(r => r.method === 'POST' ? json({ detail: { code: 'COMMAND_SUBMISSION_UNKNOWN', retry_safe: false } }, 409) : undefined);
    const h = await renderLibrary(detailPath);
    await screen.findByText('Original source body');
    if (action === 'insight') {
        fireEvent.mouseDown(screen.getByRole('tab', { name: 'Insights' }));
        await screen.findByRole('option', { name: 'Summary' });
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'transformation:summary' } });
        fireEvent.click(screen.getByRole('button', { name: 'Generate New Insight' }));
    }
    else {
        fireEvent.click(screen.getByRole('button', { name: action === 'retry' ? 'Retry Processing' : 'Embed Content' }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' }));
    }
    await screen.findByText(/Work may already be running/);
    const original = h.workbench.drafts.library.getSnapshot().find(r => r.input.kind === 'action' && r.input.action === action)!;
    expect(original.receipts).toEqual([{ state: 'unknown' }]);
    expect(original.commandId).toBeUndefined();
    expect(h.workbench.drafts.library.begin(original.id, readTurnContext(), sessionCoordinator.current())).toBeNull();
    if (action !== 'insight')
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    await act(async () => h.router.navigate('/sources'));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep work and continue' }));
    fireEvent.click(await screen.findByRole('link', { name: 'Historical paper' }));
    await screen.findByText('Original source body');
    if (action === 'insight') {
        fireEvent.mouseDown(screen.getByRole('tab', { name: 'Insights' }));
        expect(screen.getByRole('button', { name: 'Generate New Insight' })).toBeDisabled();
    }
    else {
        fireEvent.click(screen.getByRole('button', { name: action === 'retry' ? 'Retry Processing' : 'Embed Content' }));
        expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' })).toBeDisabled();
    }
    expect(h.workbench.drafts.library.get(original.id)).toBe(original);
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
    expect(requests.some(r => r.url.includes('/commands/jobs/'))).toBe(false);
});
it.each([1, 2])('I4 implicit submit at import step %s cannot dispatch before option review', async (step) => {
    const requests = libraryServer(r => r.method === 'POST' ? json(sourceDetail) : undefined);
    const h = await renderLibrary();
    fireEvent.click(await screen.findByRole('button', { name: 'Add Source' }));
    fireEvent.change(screen.getByLabelText('URL(s) *'), { target: { value: 'https://source.example/review' } });
    if (step === 2)
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    const form = screen.getByRole('dialog').querySelector('form')!;
    fireEvent.keyDown(form, { key: 'Enter' });
    fireEvent.submit(form);
    await act(async () => { });
    expect(requests.some(r => r.method === 'POST')).toBe(false);
    expect(h.workbench.drafts.library.getSnapshot().find(r => r.input.kind === 'import')?.attempt).toBe(0);
});
it('I4 final review rejects composing and over-limit submissions, then latches one reviewed request', async () => {
    let release!: (r: Response) => void;
    const requests = libraryServer(r => r.method === 'POST' ? new Promise<Response>(resolve => release = resolve) : undefined);
    const h = await renderLibrary();
    fireEvent.click(await screen.findByRole('button', { name: 'Add Source' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enter Text' }));
    fireEvent.change(screen.getByLabelText('Source text'), { target: { value: 'Reviewed text' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(await screen.findByLabelText('Synthetic notebook'));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(await screen.findByLabelText('Summary'));
    fireEvent.click(screen.getByLabelText('Embed Content'));
    const form = screen.getByRole('dialog').querySelector('form')!;
    fireEvent.compositionStart(form);
    fireEvent.keyDown(form, { key: 'Enter', isComposing: true, keyCode: 229 });
    fireEvent.submit(form);
    await act(async () => { });
    expect(requests.some(r => r.method === 'POST')).toBe(false);
    fireEvent.compositionEnd(form);
    const row = h.workbench.drafts.library.getSnapshot().find(r => r.input.kind === 'import')!;
    await act(async () => h.workbench.drafts.library.edit(row.id, { transformations: Array.from({ length: 51 }, (_, i) => 'transformation:' + i) }));
    fireEvent.submit(form);
    await act(async () => { });
    expect(requests.some(r => r.method === 'POST')).toBe(false);
    expect(h.workbench.drafts.library.get(row.id)?.attempt).toBe(0);
    await act(async () => h.workbench.drafts.library.edit(row.id, { transformations: ['transformation:summary'] }));
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(requests.filter(r => r.method === 'POST')).toHaveLength(1));
    const body = await requests.find(r => r.method === 'POST')!.clone().formData();
    expect(body.get('notebooks')).toBe('["n"]');
    expect(body.get('transformations')).toBe('["transformation:summary"]');
    expect(body.get('embed')).toBe('true');
    await act(async () => release(json(sourceDetail)));
});
