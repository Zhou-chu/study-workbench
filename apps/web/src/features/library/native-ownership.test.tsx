import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { classicServer, nativeSession, nativeMessages, sourceSession } from '../../test/classic-fixtures';
import { renderLibrary } from '../../test/library-harness';
import { json } from '../../test/notebook-fixtures';
async function classic() { const h = await renderLibrary('/notebooks/n'); fireEvent.click(await screen.findByRole('button', { name: 'Classic conversation' })); await waitFor(() => expect(screen.getByLabelText('Classic message')).toBeEnabled()); return h; }
it('context changes while its builder is pending never dispatch execute and permit only explicit unsent retry', async () => {
    let resolve!: (r: Response) => void;
    const requests = classicServer(r => r.url.endsWith('/chat/context') ? new Promise<Response>(yes => resolve = yes) : undefined);
    const h = await classic();
    fireEvent.change(screen.getByLabelText('Classic message'), { target: { value: 'Do not send changed context' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send classic message' }));
    await waitFor(() => expect(resolve).toBeTypeOf('function'));
    fireEvent.change(screen.getByLabelText('All loaded sources'), { target: { value: 'full content' } });
    await act(async () => resolve(json({ context: { sources: [], notes: [] }, token_count: 0, char_count: 0 })));
    expect(requests.some(r => r.url.endsWith('/chat/execute'))).toBe(false);
    const row = h.workbench.drafts.library.getSnapshot().find(r => r.input.kind === 'native-chat' && r.input.message);
    expect(row?.status).toBe('not-sent');
    expect(screen.getByRole('button', { name: 'Send classic message' })).toBeEnabled();
});
it('late notebook send output cannot replace another selected session or its draft', async () => {
    let resolve!: (r: Response) => void;
    const b = { ...nativeSession, id: 'chat_session:two', title: 'Two' };
    const requests = classicServer(r => {
        const p = decodeURIComponent(new URL(r.url).pathname);
        if (p === '/api/chat/sessions' && r.method === 'GET')
            return json([nativeSession, b]);
        if (p.endsWith('/' + b.id))
            return json({ ...b, messages: [] });
        if (p.endsWith('/chat/execute'))
            return new Promise<Response>(yes => resolve = yes);
    });
    const h = await classic();
    fireEvent.change(screen.getByLabelText('Classic message'), { target: { value: 'Original send' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send classic message' }));
    await waitFor(() => expect(resolve).toBeTypeOf('function'));
    fireEvent.change(screen.getByLabelText('Native session'), { target: { value: b.id } });
    await waitFor(() => expect(screen.getByLabelText('Classic message')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Classic message'), { target: { value: 'Second untouched' } });
    await act(async () => resolve(json({ session_id: nativeSession.id, messages: nativeMessages })));
    expect(screen.getByLabelText('Classic message')).toHaveValue('Second untouched');
    expect(screen.queryByText('Whole answer')).not.toBeInTheDocument();
    expect(h.workbench.drafts.library.getSnapshot().find(r => r.input.kind === 'native-chat' && r.input.message === 'Original send')?.status).toBe('unknown');
    expect(requests.filter(r => r.url.endsWith('/chat/execute'))).toHaveLength(1);
});
it.each([null, 'other'])('does not allow a notebook session with %s parent to send or save', async (notebook_id) => {
    const requests = classicServer(r => decodeURIComponent(r.url).endsWith('/chat/sessions/' + nativeSession.id) ? json({ ...nativeSession, notebook_id, messages: nativeMessages }) : undefined);
    await renderLibrary('/notebooks/n');
    fireEvent.click(await screen.findByRole('button', { name: 'Classic conversation' }));
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: 'Send classic message' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save message to note' })).not.toBeInTheDocument();
    expect(requests.some(r => r.url.endsWith('/chat/execute'))).toBe(false);
});
it('exact default-model omission is preserved for source sends and nonexistent metadata models are not invented', async () => {
    const requests = classicServer();
    await renderLibrary('/sources/source%3Aalpha%3Afull');
    fireEvent.click(await screen.findByRole('button', { name: 'Chat with source' }));
    await waitFor(() => expect(screen.getByLabelText('Source message')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Source message'), { target: { value: 'Default intentionally' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send source message' }));
    await waitFor(() => expect(requests.some(r => r.url.endsWith('/messages'))).toBe(true));
    expect(await requests.find(r => r.url.endsWith('/messages'))!.clone().json()).toEqual({ message: 'Default intentionally' });
    expect(screen.queryByRole('button', { name: 'Save message to note' })).not.toBeInTheDocument();
});
it('pending source-origin note save stays in the existing navigation guard even after a successful source send', async () => {
    let save!: (r: Response) => void;
    const requests = classicServer(r => r.method === 'POST' && r.url.endsWith('/notes') ? new Promise<Response>(yes => save = yes) : undefined);
    const h = await renderLibrary('/notebooks/n');
    fireEvent.click(await screen.findByRole('button', { name: 'Inspect source · Historical paper' }));
    fireEvent.click(await within(screen.getByRole('dialog')).findByRole('button', { name: 'Chat with source' }));
    await waitFor(() => expect(screen.getByLabelText('Source message')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Source message'), { target: { value: 'Save this source answer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send source message' }));
    await waitFor(() => expect(requests.filter(r => r.method === 'GET' && decodeURIComponent(r.url).endsWith('/' + sourceSession.id)).length).toBeGreaterThanOrEqual(2));
    fireEvent.click(screen.getByRole('button', { name: 'Save message to note' }));
    await waitFor(() => expect(save).toBeTypeOf('function'));
    fireEvent.click(screen.getByRole('link', { name: 'Back' }));
    await screen.findByRole('dialog');
    expect(h.router.state.location.pathname).toBe('/sources/source%3Aalpha%3Afull');
    expect(h.workbench.navigation.getSnapshot().status).toBe('blocked');
    expect(requests.filter(r => r.method === 'POST' && r.url.endsWith('/notes'))).toHaveLength(1);
    await act(async () => save(json({ id: 'note:created', revision: 1, title: 'Generated', content: 'Whole answer', note_type: 'ai' })));
});
it('a source-session parent mismatch is visible and never enables message sends', async () => {
    const requests = classicServer(r => decodeURIComponent(r.url).endsWith('/chat/sessions/' + sourceSession.id) ? json({ ...sourceSession, source_id: 'source:foreign', messages: nativeMessages }) : undefined);
    await renderLibrary('/sources/source%3Aalpha%3Afull');
    fireEvent.click(await screen.findByRole('button', { name: 'Chat with source' }));
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: 'Send source message' })).toBeDisabled();
    expect(requests.some(r => r.url.endsWith('/messages'))).toBe(false);
});
it('an auto-created source session accepts a new explicit message after confirmed completion without replaying the first', async () => {
    const requests = classicServer(r => r.method === 'GET' && r.url.endsWith('/chat/sessions') ? json([]) : undefined);
    await renderLibrary('/sources/source%3Aalpha%3Afull');
    fireEvent.click(await screen.findByRole('button', { name: 'Chat with source' }));
    await waitFor(() => expect(screen.getByLabelText('Source message')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Source message'), { target: { value: 'First explicit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send source message' }));
    await screen.findByText('Whole answer');
    await waitFor(() => expect(screen.getByLabelText('Source message')).toHaveValue(''));
    fireEvent.change(screen.getByLabelText('Source message'), { target: { value: 'Second explicit' } });
    expect(screen.getByRole('button', { name: 'Send source message' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Send source message' }));
    await waitFor(() => expect(requests.filter(r => r.url.endsWith('/messages'))).toHaveLength(2));
    expect(requests.filter(r => r.method === 'POST' && r.url.endsWith('/chat/sessions'))).toHaveLength(1);
    expect(await requests.filter(r => r.url.endsWith('/messages'))[1]!.clone().json()).toEqual({ message: 'Second explicit' });
});
it('clearing notebook model after a completed send omits the previous override from the next explicit message', async () => {
    const requests = classicServer();
    await classic();
    fireEvent.change(screen.getByLabelText('Conversation model'), { target: { value: 'model:chosen' } });
    await waitFor(() => expect(requests.filter(r => r.method === 'PUT')).toHaveLength(1));
    fireEvent.change(screen.getByLabelText('Classic message'), { target: { value: 'First' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send classic message' }));
    await screen.findByText('Whole answer');
    fireEvent.change(screen.getByLabelText('Conversation model'), { target: { value: '' } });
    await waitFor(() => expect(requests.filter(r => r.method === 'PUT')).toHaveLength(2));
    await waitFor(() => expect(screen.getByLabelText('Conversation model')).toHaveValue(''));
    fireEvent.change(screen.getByLabelText('Classic message'), { target: { value: 'Second' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send classic message' }));
    await waitFor(() => expect(requests.filter(r => r.url.endsWith('/chat/execute'))).toHaveLength(2));
    expect(await requests.filter(r => r.url.endsWith('/chat/execute'))[1]!.clone().json()).not.toHaveProperty('model_override');
});
it('a confirmed late delete tombstones only its original native session after the user switches', async () => {
    let finish!: (r: Response) => void;
    const second = { ...sourceSession, id: 'chat_session:second', title: 'Second' };
    classicServer(r => {
        const p = decodeURIComponent(new URL(r.url).pathname);
        if (p.endsWith('/chat/sessions') && r.method === 'GET')
            return json([sourceSession, second]);
        if (p.endsWith('/' + second.id))
            return json({ ...second, messages: [] });
        if (r.method === 'DELETE')
            return new Promise<Response>(yes => finish = yes);
    });
    await renderLibrary('/sources/source%3Aalpha%3Afull');
    fireEvent.click(await screen.findByRole('button', { name: 'Chat with source' }));
    await waitFor(() => expect(screen.getByLabelText('Source message')).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Delete session' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    fireEvent.change(screen.getByLabelText('Native session'), { target: { value: second.id } });
    await waitFor(() => expect(screen.getByLabelText('Source message')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Source message'), { target: { value: 'Keep second draft' } });
    await act(async () => finish(json({ success: true, message: 'Source chat session deleted successfully' })));
    expect(screen.getByLabelText('Source message')).toHaveValue('Keep second draft');
    expect(within(screen.getByLabelText('Native session')).queryByRole('option', { name: 'Source one' })).not.toBeInTheDocument();
});
it('an existing unlisted native model remains explicit instead of appearing as the default', async () => {
    classicServer(r => decodeURIComponent(r.url).endsWith('/chat/sessions/' + nativeSession.id) ? json({ ...nativeSession, model_override: 'model:unlisted', messages: [] }) : undefined);
    await classic();
    expect(screen.getByLabelText('Conversation model')).toHaveValue('model:unlisted');
    expect(within(screen.getByLabelText('Conversation model')).getByRole('option', { name: 'model:unlisted · Unknown' })).toHaveProperty('selected', true);
});
it('I3 displays null-parent notebook history as explained inspection only, never as mutation authority', async () => {
    const historical = nativeMessages.map((m, i) => ({ ...m, timestamp: '2026-11-08T10:0' + i + ':00Z' }));
    const requests = classicServer(r => decodeURIComponent(r.url).endsWith('/chat/sessions/' + nativeSession.id) ? json({ ...nativeSession, notebook_id: null, messages: historical }) : undefined);
    await renderLibrary('/notebooks/n');
    fireEvent.click(await screen.findByRole('button', { name: 'Classic conversation' }));
    await screen.findByText('Whole answer');
    expect(screen.getByText('Question')).toBeVisible();
    expect(screen.getByText(/human.*2026-11-08T10:00:00Z/)).toBeVisible();
    expect(screen.getByText(/ai.*2026-11-08T10:01:00Z/)).toBeVisible();
    expect(screen.getByText('Notebook ownership is unavailable. This session is read-only.')).toBeVisible();
    for (const name of ['Send classic message', 'Rename session', 'Delete session'])
        expect(screen.getByRole('button', { name })).toBeDisabled();
    expect(screen.getByLabelText('Conversation model')).toBeDisabled();
    expect(screen.getByLabelText('Classic message')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save message to note' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Personal conversation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Classic conversation' }));
    await screen.findByText('Whole answer');
    expect(requests.filter(r => r.method === 'PUT' || r.method === 'DELETE' || r.url.endsWith('/chat/execute') || r.method === 'POST' && r.url.endsWith('/notes'))).toHaveLength(0);
});

it.each(['foreign-session','malformed-message'] as const)('I3 null parent never admits a %s inspection', async variant => {
    const detail={...nativeSession,notebook_id:null,messages:nativeMessages};
    classicServer(r => decodeURIComponent(r.url).endsWith('/chat/sessions/'+nativeSession.id) ? json(variant === 'foreign-session' ? {...detail,id:'chat_session:foreign'} : {...detail,messages:[{...nativeMessages[1],id:null}]}) : undefined);
    await renderLibrary('/notebooks/n');
    fireEvent.click(await screen.findByRole('button',{name:'Classic conversation'}));
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(screen.queryByText('Whole answer')).not.toBeInTheDocument();
    expect(screen.queryByText('Notebook ownership is unavailable. This session is read-only.')).not.toBeInTheDocument();
    for(const name of ['Send classic message','Rename session','Delete session']) expect(screen.getByRole('button',{name})).toBeDisabled();
    expect(screen.getByLabelText('Conversation model')).toBeDisabled();
    expect(screen.queryByRole('button',{name:'Save message to note'})).not.toBeInTheDocument();
});
