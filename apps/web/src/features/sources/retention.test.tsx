import { useState } from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { sourceContext, sourceWorkspace, receipt } from '../../test/source-fixtures';
import { sourceServer, renderSourceFeature } from '../../test/source-harness';
import { json } from '../../test/notebook-fixtures';
import { SourcesPanel } from './SourcesPanel';
import { readTurnContext } from '@study/web-transport';
beforeEach(sourceContext);
async function pick(file: File) { fireEvent.click(screen.getByRole('button', { name: 'Add sources' })); fireEvent.change(screen.getByLabelText('Choose files'), { target: { files: [file] } }); const button = within(screen.getByRole('dialog')).getByRole('button', { name: 'Upload' }); await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button); }
it('retains File and check-only identity after source route unmount/remount and repick, with no replay on check', async () => {
    const requests = sourceServer(() => json({ detail: { code: 'UPLOAD_COMMIT_UNKNOWN', retry_safe: false } }, 500));
    function Shell() { const [show, setShow] = useState(true); return <><button onClick={() => setShow(!show)}>Toggle source route</button>{show && <SourcesPanel notebookId="n" workspace={sourceWorkspace()} onRead={() => { }}/>}</>; }
    const h = await renderSourceFeature(<Shell />);
    const file = new File(['original'], 'unknown.txt', { lastModified: 1, type: 'text/plain' });
    await pick(file);
    await waitFor(() => expect(h.workbench.drafts.sources.getSnapshot()[0]?.operation.state).toBe('unknown'));
    const before = h.workbench.drafts.sources.getSnapshot()[0]!;
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle source route' }));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle source route' }));
    expect(h.workbench.drafts.sources.get(before.id)?.file).toBe(file);
    fireEvent.click(screen.getByRole('button', { name: 'Check result' }));
    await waitFor(() => expect(requests.some(r => r.url.endsWith('/workspace-view'))).toBe(true));
    expect(h.workbench.drafts.sources.get(before.id)?.operation.state).toBe('unknown');
    fireEvent.click(screen.getByRole('button', { name: 'Add sources' }));
    fireEvent.change(screen.getByLabelText('Choose files'), { target: { files: [new File(['original'], 'unknown.txt', { lastModified: 1, type: 'text/plain' })] } });
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByText('unknown.txt')).toBeVisible());
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Upload' })).toBeDisabled();
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
    expect(requests.some(r => r.url.includes('/jobs/'))).toBe(false);
});
it('honors authenticated byte limits and keeps local upload available after provider reauthentication', async () => { const requests = sourceServer(r => r.url.includes('/jobs/') ? json({ error: { code: 'NEEDS_REAUTH' } }, 401) : json(receipt)); const h = await renderSourceFeature(<SourcesPanel notebookId="n" workspace={sourceWorkspace()} onRead={() => { }}/>); await act(async () => { await h.workbench.transport.send({ method: 'GET', path: '/personal/jobs/mixed', context: readTurnContext()! }); }); fireEvent.click(screen.getByRole('button', { name: 'Add sources' })); fireEvent.change(screen.getByLabelText('Choose files'), { target: { files: [new File(['x'.repeat(51)], 'too-large.txt')] } }); expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Upload' })).toBeDisabled(); expect(requests.some(r => r.method === 'POST')).toBe(false); fireEvent.change(screen.getByLabelText('Choose files'), { target: { files: [new File(['small'], 'local.txt')] } }); const button = within(screen.getByRole('dialog')).getByRole('button', { name: 'Upload' }); await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button); await waitFor(() => expect(requests.filter(r => r.method === 'POST')).toHaveLength(1)); expect(h.workbench.controller.getSnapshot()).toMatchObject({ ready: true, providerNeedsReauth: true }); });
it('synchronous selection admission prevents two competing PATCHes and preserves the original reading position', async () => { let finish!: (r: Response) => void; const requests = sourceServer(() => new Promise(resolve => { finish = resolve; })); const h = await renderSourceFeature(<SourcesPanel notebookId="n" workspace={sourceWorkspace()} onRead={() => { }}/>); fireEvent.click(screen.getByRole('button', { name: 'Same title' })); fireEvent.click(screen.getByRole('checkbox', { name: 'Select v-new' })); fireEvent.click(screen.getByRole('button', { name: 'Clear selection' })); await waitFor(() => expect(requests.filter(r => r.method === 'PATCH')).toHaveLength(1)); const body = await requests.find(r => r.method === 'PATCH')!.clone().json(); expect(body).toMatchObject({ source_version_ids: ['v-old', 'v-new'], reading: { source_version_id: 'v-old', page_index: 3 } }); await act(async () => finish(json({}))); expect(h.workbench.drafts.sources.getSnapshot().filter(r => r.payload.kind === 'selection')).toHaveLength(1); });
