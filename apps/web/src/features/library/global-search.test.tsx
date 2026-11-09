import { readTurnContext, sessionCoordinator } from '@study/web-transport';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { renderLibrary } from '../../test/library-harness';
import { globalServer } from '../../test/global-fixtures';
import { json } from '../../test/notebook-fixtures';
it.each(['search', 'ask'])('route %s prefills only; modes and whole library scope do not submit', async (mode) => {
    const requests = globalServer();
    await renderLibrary('/search?q=Prefill&mode=' + mode);
    expect(await screen.findByLabelText('Library question')).toHaveValue('Prefill');
    expect(screen.getByLabelText('Mode')).toHaveValue(mode);
    fireEvent.change(screen.getByLabelText('Mode'), { target: { value: mode === 'ask' ? 'search' : 'ask' } });
    fireEvent.click(await screen.findByLabelText('Search scope · Alpha'));
    fireEvent.click(screen.getByRole('button', { name: 'Whole library' }));
    expect(screen.getByLabelText('Search scope · Alpha')).not.toBeChecked();
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(0);
});
it('search switches dispatch exact independent scope and raw identity results with score and matches', async () => {
    const requests = globalServer();
    await renderLibrary('/search');
    fireEvent.change(await screen.findByLabelText('Library question'), { target: { value: 'Proof' } });
    fireEvent.click(await screen.findByLabelText('Search scope · Alpha'));
    fireEvent.change(screen.getByLabelText('Search type'), { target: { value: 'vector' } });
    fireEvent.click(screen.getByLabelText('Include sources'));
    fireEvent.click(screen.getByLabelText('Include notes'));
    fireEvent.click(screen.getByLabelText('Include notes'));
    fireEvent.click(screen.getByRole('button', { name: 'Search library' }));
    expect(await screen.findByText('Raw note')).toBeVisible();
    const sent = requests.filter(r => new URL(r.url).pathname === '/api/search');
    expect(sent).toHaveLength(1);
    expect(await sent[0]!.clone().json()).toEqual({ query: 'Proof', type: 'vector', search_sources: false, search_notes: true, limit: 100, minimum_score: .2, notebook_ids: ['notebook:alpha:full'] });
    expect(screen.getByText('Score: 2')).toBeVisible();
    fireEvent.click(screen.getByText('Matches'));
    expect(screen.getByText('Found passage')).toBeVisible();
    expect(screen.getByText('Unknown result')).toBeVisible();
    for (const [id, text] of [['note:one:full', 'Detached body'], ['source_insight:one:full', 'Insight body']]) {
        fireEvent.click(screen.getByRole('button', { name: 'Open reference · ' + id }));
        expect(await within(screen.getByRole('dialog')).findByText(text!)).toBeVisible();
        expect(within(screen.getByRole('dialog')).queryByRole('button', { name: /save/i })).toBeNull();
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Open reference · source:alpha:full' }));
    expect(await within(screen.getByRole('dialog')).findByRole('button', { name: 'Chat with source' })).toBeVisible();
    expect(requests.some(r => r.url.includes('unknown:full'))).toBe(false);
});
it('missing scope remains selected and rejected rather than widened; no implicit resubmit', async () => {
    const requests = globalServer(r => new URL(r.url).pathname === '/api/search' ? json({ detail: 'Notebook not found' }, 404) : undefined);
    await renderLibrary('/search');
    fireEvent.change(await screen.findByLabelText('Library question'), { target: { value: 'Missing' } });
    fireEvent.click(await screen.findByLabelText('Search scope · Alpha'));
    fireEvent.click(screen.getByRole('button', { name: 'Search library' }));
    await screen.findByText('Request rejected. The original request is retained.');
    expect(screen.getByLabelText('Search scope · Alpha')).toBeChecked();
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
});
it('command search and Ask navigate real routes without submitting', async () => {
    const requests = globalServer();
    const h = await renderLibrary('/sources');
    fireEvent.click(await screen.findByRole('button', { name: 'Commands' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Ask library' }));
    await waitFor(() => expect(h.router.state.location.search).toBe('?mode=ask'));
    expect(await screen.findByLabelText('Mode')).toHaveValue('ask');
    fireEvent.click(screen.getByRole('button', { name: 'Commands' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Search library' }));
    await waitFor(() => expect(h.router.state.location.search).toBe('?mode=search'));
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(0);
});
it('text works without embedding metadata but vector and Ask remain explicit unavailable', async () => {
    const requests = globalServer(r => r.url.endsWith('/models/defaults') ? json({ default_chat_model: null, default_embedding_model: null }) : undefined);
    await renderLibrary('/search?q=Text only');
    fireEvent.change(await screen.findByLabelText('Search type'), { target: { value: 'vector' } });
    expect(screen.getByRole('button', { name: 'Search library' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'ask' } });
    expect(screen.getByRole('button', { name: 'Ask library' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'search' } });
    fireEvent.change(screen.getByLabelText('Search type'), { target: { value: 'text' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search library' }));
    await screen.findByText('Raw source');
    expect((await requests.find(r => new URL(r.url).pathname === '/api/search')!.clone().json()).type).toBe('text');
});
it('malformed selected notebook IDs block submission instead of widening to whole library', async () => {
    const requests = globalServer(r => new URL(r.url).pathname === '/api/notebooks' ? json([{ id: 'notebook:bad/path', name: 'Malformed', description: '', archived: false, created: '', updated: '', source_count: 0, note_count: 0 }]) : undefined);
    await renderLibrary('/search?q=Keep scope');
    fireEvent.click(await screen.findByLabelText('Search scope · Malformed'));
    expect(screen.getByRole('button', { name: 'Search library' })).toBeDisabled();
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(0);
});
it('note inspection shows nullable title fallback and actual revision without save authority', async () => {
    globalServer();
    await renderLibrary('/search?q=Read only');
    fireEvent.click(await screen.findByRole('button', { name: 'Search library' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open reference · note:one:full' }));
    expect(await within(screen.getByRole('dialog')).findByText('Version: 3')).toBeVisible();
    expect(within(screen.getByRole('dialog')).getByRole('heading', { name: 'Untitled Note' })).toBeVisible();
});
it('source origin returns to retained exact global query without a notebook save grant', async () => {
    globalServer();
    const h = await renderLibrary('/search?q=Origin&mode=search#matches');
    fireEvent.click(await screen.findByRole('button', { name: 'Search library' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open reference · source:alpha:full' }));
    fireEvent.click(await within(screen.getByRole('dialog')).findByRole('button', { name: 'Chat with source' }));
    // Explicitly retain the editor if navigation requests a decision.
    const leave = screen.queryByRole('button', { name: 'Leave without saving' });
    if (leave)
        fireEvent.click(leave);
    await waitFor(() => expect(h.router.state.location.pathname).toBe('/sources/source%3Aalpha%3Afull'));
    expect(h.router.state.location.state?.sourceNotebookGrant).toBeUndefined();
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/search?q=Origin&mode=search#matches');
});
it('shell Search link and retained global scope do not mutate classic/personal selections or File identity', async () => {
    const requests = globalServer();
    const h = await renderLibrary('/sources');
    fireEvent.click(await screen.findByRole('link', { name: 'Search library' }));
    await screen.findByLabelText('Library question');
    const c = readTurnContext()!, file = new File(['synthetic'], 'retained.txt'), personal = { epoch: c.epoch, notebookId: 'notebook:alpha:full', editorSession: 'personal-test' };
    h.workbench.drafts.update(personal, { question: 'Personal question', file });
    const classic = h.workbench.drafts.library.open({ kind: 'notebook', notebookId: 'notebook:alpha:full' }, { kind: 'classic-context', parent: { kind: 'notebook', notebookId: 'notebook:alpha:full' }, config: { sources: { 'source:alpha:full': 'full content' }, notes: {} } }, c, sessionCoordinator.current());
    const before = h.workbench.drafts.library.get(classic)!.input;
    fireEvent.click(await screen.findByLabelText('Search scope · Beta'));
    fireEvent.change(screen.getByLabelText('Library question'), { target: { value: 'Global only' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search library' }));
    await screen.findByText('Raw source');
    expect(h.workbench.drafts.library.get(classic)!.input).toBe(before);
    expect(h.workbench.drafts.get(personal)?.file).toBe(file);
    expect(h.workbench.drafts.get(personal)?.question).toBe('Personal question');
    expect(requests.some(r => r.url.endsWith('/chat/context') || r.url.endsWith('/chat/execute'))).toBe(false);
});
