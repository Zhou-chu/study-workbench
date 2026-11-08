import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderLibrary } from '../../test/library-harness';
import { classicServer, nativeSession, nativeMessages, sourceSession, stream } from '../../test/classic-fixtures';
import { json } from '../../test/notebook-fixtures';
const path = '/sources/source%3Aalpha%3Afull';
async function openClassic() { const h = await renderLibrary('/notebooks/n'); fireEvent.click(await screen.findByRole('button', { name: 'Classic conversation' })); await screen.findByLabelText('Classic message'); return h; }
async function selectNative() { fireEvent.change(await screen.findByLabelText('Native session'), { target: { value: nativeSession.id } }); await screen.findByText('Native one'); }
it('opens classic with explicit empty independent context and native history controls', async () => {
    const requests = classicServer();
    await openClassic();
    fireEvent.click(screen.getByRole('button', { name: 'Preview classic context' }));
    await waitFor(() => expect(requests.some(r => r.url.endsWith('/chat/context'))).toBe(true));
    expect(await requests.find(r => r.url.endsWith('/chat/context'))!.clone().json()).toEqual({ notebook_id: 'n', context_config: { sources: {}, notes: {} } });
    expect(requests.some(r => r.url.endsWith('/chat/execute'))).toBe(false);
});
it('source modes and bulk target only loaded IDs while note include/exclude maps stay explicit', async () => {
    const requests = classicServer();
    await openClassic();
    const source = await screen.findByLabelText('Source context · Historical paper');
    for (const mode of ['insights', 'full content', 'not in']) {
        fireEvent.change(source, { target: { value: mode } });
        expect(source).toHaveValue(mode);
    }
    fireEvent.change(screen.getByLabelText('All loaded sources'), { target: { value: 'insights' } });
    const note = await screen.findByLabelText('Note context · Notebook note');
    fireEvent.change(note, { target: { value: 'full content' } });
    fireEvent.change(note, { target: { value: 'not in' } });
    fireEvent.change(screen.getByLabelText('All loaded notes'), { target: { value: 'full content' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview classic context' }));
    await waitFor(() => expect(requests.some(r => r.url.endsWith('/chat/context'))).toBe(true));
    expect((await requests.find(r => r.url.endsWith('/chat/context'))!.clone().json()).context_config).toEqual({ sources: { 'source:alpha:full': 'insights' }, notes: { 'note:one:full': 'full content' } });
});
it('sends a synchronous full transcript once and refreshes the exact native session', async () => {
    let sent = false;
    const requests = classicServer(r => { if (r.url.endsWith('/chat/execute')) {
        sent = true;
        return json({ session_id: nativeSession.id, messages: nativeMessages });
    } if (sent && decodeURIComponent(r.url).endsWith('/chat/sessions/' + nativeSession.id))
        return json({ ...nativeSession, messages: nativeMessages }); });
    await openClassic();
    await selectNative();
    fireEvent.change(screen.getByLabelText('Classic message'), { target: { value: 'Question' } });
    const send = screen.getByRole('button', { name: 'Send classic message' });
    act(() => { fireEvent.click(send); fireEvent.click(send); });
    expect(await screen.findByText('Whole answer')).toBeVisible();
    expect(screen.getAllByText('Whole answer')).toHaveLength(1);
    expect(requests.filter(r => r.url.endsWith('/chat/execute'))).toHaveLength(1);
});
it('native session create rename model null clear and delete cancel/confirm use exact wires', async () => {
    const requests = classicServer();
    await openClassic();
    fireEvent.change(screen.getByLabelText('Session title'), { target: { value: 'Created explicitly' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create session' }));
    await waitFor(() => expect(requests.some(r => r.method === 'POST' && r.url.endsWith('/chat/sessions'))).toBe(true));
    await waitFor(() => expect(screen.getByLabelText('Native session')).toHaveValue(nativeSession.id));
    fireEvent.change(screen.getByLabelText('Session title'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename session' }));
    await waitFor(() => expect(requests.filter(r => r.method === 'PUT')).toHaveLength(1));
    fireEvent.change(screen.getByLabelText('Conversation model'), { target: { value: 'model:chosen' } });
    await waitFor(() => expect(requests.filter(r => r.method === 'PUT')).toHaveLength(2));
    fireEvent.change(screen.getByLabelText('Conversation model'), { target: { value: '' } });
    await waitFor(() => expect(requests.filter(r => r.method === 'PUT')).toHaveLength(3));
    expect(await requests.filter(r => r.method === 'PUT')[2]!.clone().json()).toEqual({ model_override: null });
    fireEvent.click(screen.getByRole('button', { name: 'Delete session' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(requests.some(r => r.method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Delete session' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(requests.filter(r => r.method === 'DELETE')).toHaveLength(1));
});
it('source chat opens from inspected source, streams whole answers and returns to retained origin', async () => {
    const requests = classicServer();
    const h = await renderLibrary('/sources?view=old#origin');
    fireEvent.click(await screen.findByRole('button', { name: 'Inspect source · Historical paper' }));
    fireEvent.click(await within(screen.getByRole('dialog')).findByRole('button', { name: 'Chat with source' }));
    await screen.findByLabelText('Source message');
    fireEvent.change(screen.getByLabelText('Native session'), { target: { value: sourceSession.id } });
    await waitFor(() => expect(screen.getByLabelText('Source message')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Source message'), { target: { value: 'Question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send source message' }));
    await screen.findByText('Whole answer');
    expect(requests.filter(r => r.url.endsWith('/messages'))).toHaveLength(1);
    fireEvent.click(screen.getByRole('link', { name: 'Back' }));
    await waitFor(() => expect(h.router.state.location.pathname).toBe('/sources'));
    expect(h.router.state.location.search).toBe('?view=old');
    expect(h.router.state.location.hash).toBe('#origin');
});
it('source session controls preserve parent pair and do not pretend null clears model', async () => {
    const requests = classicServer();
    await renderLibrary(path);
    fireEvent.click(await screen.findByRole('button', { name: 'Chat with source' }));
    fireEvent.change(screen.getByLabelText('Session title'), { target: { value: 'Source title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create session' }));
    await waitFor(() => expect(screen.getByLabelText('Native session')).toHaveValue(sourceSession.id));
    const create = requests.find(r => r.method === 'POST' && r.url.endsWith('/chat/sessions'))!;
    expect(await create.clone().json()).toMatchObject({ source_id: 'alpha:full', title: 'Source title' });
    fireEvent.change(screen.getByLabelText('Session title'), { target: { value: 'Renamed source' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename session' }));
    await waitFor(() => expect(requests.filter(r => r.method === 'PUT')).toHaveLength(1));
    fireEvent.change(screen.getByLabelText('Conversation model'), { target: { value: 'model:chosen' } });
    await waitFor(() => expect(requests.filter(r => r.method === 'PUT')).toHaveLength(2));
    expect(within(screen.getByLabelText('Conversation model')).getByRole('option', { name: 'Default model' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete session' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(requests.filter(r => r.method === 'DELETE')).toHaveLength(1));
});
it('copy and explicit AI-note save omit title and keep source-only saves unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const requests = classicServer(r => decodeURIComponent(r.url).endsWith('/chat/sessions/' + nativeSession.id) ? json({ ...nativeSession, messages: nativeMessages }) : undefined);
    await openClassic();
    await selectNative();
    await screen.findByText('Whole answer');
    fireEvent.click(screen.getAllByRole('button', { name: 'Copy message' }).at(-1)!);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Whole answer');
    fireEvent.click(screen.getAllByRole('button', { name: 'Save message to note' }).at(-1)!);
    await waitFor(() => expect(requests.some(r => r.method === 'POST' && r.url.endsWith('/notes'))).toBe(true));
    expect(await requests.find(r => r.method === 'POST' && r.url.endsWith('/notes'))!.clone().json()).toEqual({ content: 'Whole answer', note_type: 'ai', notebook_id: 'n' });
});
it('interrupted source EOF preserves partial text and locks resend through close/reopen', async () => {
    const requests = classicServer(r => r.url.endsWith('/messages') ? stream({ type: 'ai_message', content: 'Partial answer', timestamp: null }) : undefined);
    await renderLibrary(path);
    fireEvent.click(await screen.findByRole('button', { name: 'Chat with source' }));
    await waitFor(() => expect(screen.getByLabelText('Source message')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Source message'), { target: { value: 'Question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send source message' }));
    await screen.findByText('Partial answer');
    await screen.findByText('Outcome unknown. Check the original session; do not resend.');
    expect(screen.getByRole('button', { name: 'Send source message' })).toBeDisabled();
    expect(requests.filter(r => r.url.endsWith('/messages'))).toHaveLength(1);
});
it('notebooks.open_classic enters the actual classic panel directly from the notebook list', async () => {
    const requests = classicServer();
    await renderLibrary('/notebooks');
    fireEvent.click(await screen.findByRole('link', { name: 'Classic conversation' }));
    await screen.findByLabelText('Classic message');
    expect(requests.some(r => r.url.endsWith('/chat/execute'))).toBe(false);
});
