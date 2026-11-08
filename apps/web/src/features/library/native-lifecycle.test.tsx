import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { sessionCoordinator } from '@study/web-transport';
import { renderLibrary } from '../../test/library-harness';
import { classicServer, nativeSession, nativeMessages, sourceSession, stream } from '../../test/classic-fixtures';
import { json } from '../../test/notebook-fixtures';
const sourcePath = '/sources/source%3Aalpha%3Afull';
async function source() { const h = await renderLibrary(sourcePath); fireEvent.click(await screen.findByRole('button', { name: 'Chat with source' })); await waitFor(() => expect(screen.getByLabelText('Source message')).toBeEnabled()); return h; }
async function classic() { const h = await renderLibrary('/notebooks/n'); fireEvent.click(await screen.findByRole('button', { name: 'Classic conversation' })); await waitFor(() => expect(screen.getByLabelText('Classic message')).toBeEnabled()); return h; }
function send(label = 'Source message') { fireEvent.change(screen.getByLabelText(label), { target: { value: 'Keep my original question' } }); fireEvent.click(screen.getByRole('button', { name: label === 'Source message' ? 'Send source message' : 'Send classic message' })); }
function controlled() { let controller!: ReadableStreamDefaultController<Uint8Array>; const cancel = vi.fn(); const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; }, cancel }); return { response: new Response(body, { headers: { 'content-type': 'text/event-stream' } }), write(v: unknown) { controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify(v) + '\n\n')); }, cancel }; }
it('replaces repeated whole answers, handles split UTF8/CRLF, and keeps confirmed output when follow-up read is empty', async () => {
    const bytes = new TextEncoder().encode('data: ' + JSON.stringify({ type: 'ai_message', content: 'First' }) + '\r\n\r\ndata: ' + JSON.stringify({ type: 'ai_message', content: 'Whole 答案' }) + '\r\n\r\ndata: ' + JSON.stringify({ type: 'complete' }) + '\r\n\r\n');
    const requests = classicServer(r => r.url.endsWith('/messages') ? new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 2)
            c.enqueue(bytes.slice(i, i + 2)); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } }) : undefined);
    await source();
    send();
    await screen.findByText('Whole 答案');
    await waitFor(() => expect(requests.filter(r => r.method === 'GET' && decodeURIComponent(r.url).endsWith('/' + sourceSession.id))).toHaveLength(2));
    expect(screen.getByText('Whole 答案')).toBeVisible();
    expect(screen.queryByText('First')).not.toBeInTheDocument();
});
it.each(['error', 'malformed', 'eof'])('retains partial source output and no replay after %s and close/reopen', async (variant) => {
    const response = variant === 'error' ? stream({ type: 'ai_message', content: 'Retained partial' }, { type: 'error', message: 'private provider detail' }) : variant === 'malformed' ? new Response('data: {"type":"ai_message","content":"Retained partial"}\n\ndata: {broken}\n\n', { headers: { 'content-type': 'text/event-stream' } }) : stream({ type: 'ai_message', content: 'Retained partial' });
    const requests = classicServer(r => r.url.endsWith('/messages') ? response : undefined);
    await source();
    send();
    await screen.findByText('Retained partial');
    await screen.findByText('Outcome unknown. Check the original session; do not resend.');
    fireEvent.click(screen.getByRole('button', { name: 'Chat with source' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chat with source' }));
    await screen.findByText('Retained partial');
    expect(screen.getByRole('button', { name: 'Send source message' })).toBeDisabled();
    expect(requests.filter(r => r.url.endsWith('/messages'))).toHaveLength(1);
    expect(screen.queryByText('private provider detail')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check original session' }));
    await act(async () => { });
    expect(screen.getByRole('button', { name: 'Send source message' })).toBeDisabled();
});
it('complete without AI does not invent an answer', async () => {
    const requests = classicServer(r => r.url.endsWith('/messages') ? stream({ type: 'user_message', content: 'Keep my original question', timestamp: null }, { type: 'complete' }) : undefined);
    await source();
    send();
    await waitFor(() => expect(requests.filter(r => r.method === 'GET' && decodeURIComponent(r.url).endsWith('/' + sourceSession.id))).toHaveLength(2));
    expect(screen.queryByText('Whole answer')).not.toBeInTheDocument();
    expect(screen.queryByText('Outcome unknown. Check the original session; do not resend.')).not.toBeInTheDocument();
});
it('switching native sessions cancels observation and preserves old unknown across A B A', async () => {
    const live = controlled(), second = { ...sourceSession, id: 'chat_session:second', title: 'Second' };
    const requests = classicServer(r => { const p = decodeURIComponent(new URL(r.url).pathname); if (p.endsWith('/chat/sessions') && r.method === 'GET')
        return json([sourceSession, second]); if (p.endsWith('/' + second.id))
        return json({ ...second, messages: [], context_indicators: null }); if (p.endsWith('/messages'))
        return live.response; });
    await source();
    send();
    await waitFor(() => expect(requests.some(r => r.url.endsWith('/messages'))).toBe(true));
    await act(async () => live.write({ type: 'ai_message', content: 'Old partial' }));
    await screen.findByText('Old partial');
    fireEvent.change(screen.getByLabelText('Native session'), { target: { value: second.id } });
    await waitFor(() => expect(live.cancel).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByLabelText('Source message')).toHaveValue(''));
    fireEvent.change(screen.getByLabelText('Source message'), { target: { value: 'Second draft' } });
    fireEvent.change(screen.getByLabelText('Native session'), { target: { value: sourceSession.id } });
    await screen.findByText('Old partial');
    expect(screen.getByLabelText('Source message')).toHaveValue('Keep my original question');
    expect(screen.getByRole('button', { name: 'Send source message' })).toBeDisabled();
    expect(requests.filter(r => r.url.endsWith('/messages'))).toHaveLength(1);
});
it('delete during source send tombstones the native target and retains the original operation', async () => {
    const live = controlled();
    const requests = classicServer(r => r.url.endsWith('/messages') ? live.response : undefined);
    const h = await source();
    send();
    await waitFor(() => expect(requests.some(r => r.url.endsWith('/messages'))).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Delete session' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(live.cancel).toHaveBeenCalledOnce());
    expect(within(screen.getByLabelText('Native session')).queryByRole('option', { name: 'Source one' })).not.toBeInTheDocument();
    const retained = h.workbench.drafts.library.getSnapshot().find(r => r.input.kind === 'native-chat' && r.input.message === 'Keep my original question');
    expect(retained).toMatchObject({ status: 'unknown', input: { sessionId: sourceSession.id } });
});
it('a late auto-create receipt remains with the original parent and cannot send after unmount', async () => {
    let resolve!: (r: Response) => void;
    const requests = classicServer(r => { if (r.url.endsWith('/chat/sessions') && r.method === 'GET')
        return json([]); if (r.url.endsWith('/chat/sessions') && r.method === 'POST')
        return new Promise<Response>(yes => resolve = yes); });
    const h = await source();
    send();
    await waitFor(() => expect(resolve).toBeTypeOf('function'));
    fireEvent.click(screen.getByRole('button', { name: 'Chat with source' }));
    await act(async () => resolve(json(sourceSession)));
    fireEvent.click(screen.getByRole('button', { name: 'Chat with source' }));
    await screen.findByText('Outcome unknown. Check the original session; do not resend.');
    expect(requests.some(r => r.url.endsWith('/messages'))).toBe(false);
    const retained = h.workbench.drafts.library.getSnapshot().find(r => r.input.kind === 'native-chat' && r.input.message);
    expect(retained?.owner).toEqual({ kind: 'source', sourceId: 'source:alpha:full' });
    expect(retained?.native?.session?.id).toBe(sourceSession.id);
});
it('holds unknown notebook sends through reauthentication and privacy retirement without replay', async () => {
    let resolve!: (r: Response) => void;
    const requests = classicServer(r => r.url.endsWith('/chat/execute') ? new Promise<Response>(yes => resolve = yes) : undefined);
    const h = await classic();
    send('Classic message');
    await waitFor(() => expect(resolve).toBeTypeOf('function'));
    const original = h.workbench.drafts.library.getSnapshot().find(r => r.input.kind === 'native-chat' && r.status === 'pending')!;
    act(() => sessionCoordinator.report('reauth-required', sessionCoordinator.current()));
    await act(async () => resolve(json({ session_id: nativeSession.id, messages: nativeMessages })));
    expect(h.workbench.drafts.library.get(original.id)?.status).toBe('unknown');
    expect(requests.filter(r => r.url.endsWith('/chat/execute'))).toHaveLength(1);
    act(() => h.workbench.controller.retirePrivacyContext());
    expect(h.workbench.drafts.library.get(original.id)?.retired).toBe(true);
});
it('IME and multiline Enter never submit, and duplicate source clicks dispatch once', async () => {
    const live = controlled();
    const requests = classicServer(r => r.url.endsWith('/messages') ? live.response : undefined);
    await source();
    const input = screen.getByLabelText('Source message');
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: '多行\n问题' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(requests.some(r => r.url.endsWith('/messages'))).toBe(false);
    const button = screen.getByRole('button', { name: 'Send source message' });
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    await waitFor(() => expect(requests.filter(r => r.url.endsWith('/messages'))).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Stop observing' }));
    await waitFor(() => expect(live.cancel).toHaveBeenCalledOnce());
});
it('a readiness loss tears down an active reader immediately without waiting for another chunk', async () => {
    const live = controlled();
    const requests = classicServer(r => r.url.endsWith('/messages') ? live.response : undefined);
    await source();
    send();
    await waitFor(() => expect(requests.some(r => r.url.endsWith('/messages'))).toBe(true));
    act(() => sessionCoordinator.report('reauth-required', sessionCoordinator.current()));
    await waitFor(() => expect(live.cancel).toHaveBeenCalledOnce());
    expect(requests.filter(r => r.url.endsWith('/messages'))).toHaveLength(1);
});
