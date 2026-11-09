import { RequestNotDispatchedError, sessionCoordinator } from '@study/web-transport';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderLibrary } from '../../test/library-harness';
import { globalServer } from '../../test/global-fixtures';
import { json } from '../../test/notebook-fixtures';
async function answer() { const h = await renderLibrary('/search?q=Original question&mode=ask'); fireEvent.click(await screen.findByRole('button', { name: 'Ask library' })); fireEvent.click(await within(screen.getByRole('dialog')).findByRole('button', { name: 'Start answer' })); await screen.findByRole('button', { name: 'Save answer to notebooks' }); return h; }
async function select() { fireEvent.click(screen.getByRole('button', { name: 'Save answer to notebooks' })); const d = await screen.findByRole('dialog'); for (const label of ['Alpha', 'Beta', 'Gamma'])
    fireEvent.click(within(d).getByLabelText('Save destination · ' + label)); return d; }
it('explicit selected notebooks save question-titled AI notes once through Studio and preserve each receipt', async () => {
    const requests = globalServer();
    const h = await answer();
    const d = await select();
    const b = within(d).getByRole('button', { name: 'Save' });
    act(() => { fireEvent.click(b); fireEvent.click(b); });
    await waitFor(() => expect(requests.filter(r => r.method === 'POST' && r.url.endsWith('/notes'))).toHaveLength(3));
    await waitFor(() => expect(h.workbench.drafts.studio.getSnapshot().notes.filter(n => n.editor.saveResult === 'saved')).toHaveLength(3));
    for (const [i, n] of ['alpha', 'beta', 'gamma'].entries())
        expect(await requests.filter(r => r.method === 'POST' && r.url.endsWith('/notes'))[i]!.clone().json()).toEqual({ title: 'Original question', content: 'Final answer [source:alpha:full]', note_type: 'ai', notebook_id: 'notebook:' + n + ':full' });
    expect(requests.some(r => r.url.includes('/chat/sessions'))).toBe(false);
    expect(h.workbench.drafts.library.getSnapshot().find(r => r.input.kind === 'global-save')?.receipts).toHaveLength(3);
});
it('partial save retains accepted, unknown and unsent destinations and cannot resume on reopen', async () => {
    let count = 0;
    const requests = globalServer(r => { if (r.method === 'POST' && r.url.endsWith('/notes') && ++count === 2)
        return Promise.reject(new Error('Lost acknowledgement')); });
    const h = await answer();
    const d = await select();
    fireEvent.click(within(d).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.workbench.drafts.library.getSnapshot().find(r => r.input.kind === 'global-save')?.status).toBe('unknown'));
    expect(requests.filter(r => r.url.endsWith('/notes') && r.method === 'POST')).toHaveLength(2);
    const before = h.workbench.drafts.library.getSnapshot().find(r => r.input.kind === 'global-save')!;
    expect(before.receipts.map(r => r.state)).toEqual(['accepted', 'unknown']);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save answer to notebooks' }));
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(h.workbench.drafts.library.get(before.id)?.input).toBe(before.input);
    expect(requests.filter(r => r.url.endsWith('/notes') && r.method === 'POST')).toHaveLength(2);
});
it('cancel before save dispatches nothing and selection never comes from search scope', async () => {
    const requests = globalServer();
    await answer();
    fireEvent.click(screen.getByLabelText('Search scope · Alpha'));
    fireEvent.click(screen.getByRole('button', { name: 'Save answer to notebooks' }));
    const d = screen.getByRole('dialog');
    expect(within(d).getByLabelText('Save destination · Alpha')).not.toBeChecked();
    fireEvent.click(within(d).getByLabelText('Save destination · Beta'));
    fireEvent.click(within(d).getByRole('button', { name: 'Cancel' }));
    expect(requests.filter(r => r.url.endsWith('/notes') && r.method === 'POST')).toHaveLength(0);
});
it('cancel during first save preserves its actual receipt and stops the remaining targets', async () => {
    let resolve!: (r: Response) => void;
    const requests = globalServer(r => r.url.endsWith('/notes') && r.method === 'POST' ? new Promise<Response>(r => { resolve = r; }) : undefined);
    const h = await answer();
    const d = await select();
    fireEvent.click(within(d).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(resolve).toBeDefined());
    fireEvent.click(within(d).getByRole('button', { name: 'Cancel' }));
    await act(async () => resolve(json({ id: 'note:saved:alpha', title: 'Original question', content: 'Final answer [source:alpha:full]', note_type: 'ai', revision: 1, created: '2026-11-08', updated: '2026-11-08', command_id: null })));
    await waitFor(() => expect(h.workbench.drafts.studio.getSnapshot().notes.some(n => n.editor.saveResult === 'saved')).toBe(true));
    expect(requests.filter(r => r.url.endsWith('/notes') && r.method === 'POST')).toHaveLength(1);
    expect(h.workbench.drafts.library.getSnapshot().find(r => r.input.kind === 'global-save')?.receipts[0]?.state).toBe('accepted');
});
it.each(['rejected', 'not-sent'])('serial save stops on %s without dispatching later destinations', async (outcome) => {
    const requests = globalServer(r => r.url.endsWith('/notes') && r.method === 'POST' ? json({ detail: 'Rejected' }, 400) : undefined);
    const h = await answer();
    const d = await select();
    if (outcome === 'not-sent') {
        const NativeRequest = Request;
        vi.stubGlobal('Request', class extends NativeRequest {
            constructor(input: RequestInfo | URL, init?: RequestInit) { if (String(input).endsWith('/api/notes'))
                throw new RequestNotDispatchedError('configuration'); super(input, init); }
        });
    }
    fireEvent.click(within(d).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.workbench.drafts.library.getSnapshot().find(r => r.input.kind === 'global-save')?.status).toBe(outcome));
    expect(requests.filter(r => r.url.endsWith('/notes') && r.method === 'POST')).toHaveLength(outcome === 'not-sent' ? 0 : 1);
    expect(h.workbench.drafts.library.getSnapshot().find(r => r.input.kind === 'global-save')?.receipts).toHaveLength(1);
});
it('reauth during first create locks original targets and cannot advance or replay', async () => {
    let resolve!: (r: Response) => void;
    const requests = globalServer(r => r.url.endsWith('/notes') && r.method === 'POST' ? new Promise<Response>(yes => resolve = yes) : undefined);
    const h = await answer();
    const d = await select();
    fireEvent.click(within(d).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(resolve).toBeDefined());
    const original = h.workbench.drafts.library.getSnapshot().find(r => r.input.kind === 'global-save')!;
    act(() => sessionCoordinator.report('reauth-required', sessionCoordinator.current()));
    await act(async () => resolve(json({ id: 'note:late:alpha', title: 'Original question', content: 'Final answer [source:alpha:full]', note_type: 'ai', revision: 1, created: '', updated: '', command_id: null })));
    expect(h.workbench.drafts.library.get(original.id)?.status).toBe('unknown');
    expect(h.workbench.drafts.library.get(original.id)?.input).toBe(original.input);
    expect(requests.filter(r => r.url.endsWith('/notes') && r.method === 'POST')).toHaveLength(1);
    expect(h.workbench.drafts.studio.getSnapshot().notes.filter(n => n.editor.saveResult === 'unknown')).toHaveLength(1);
});
