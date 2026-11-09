import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { sessionCoordinator } from '@study/web-transport';
import { renderLibrary } from '../../test/library-harness';
import { globalServer, askStream } from '../../test/global-fixtures';
async function ask() { const h = await renderLibrary('/search?q=Original&mode=ask'); fireEvent.click(await screen.findByRole('button', { name: 'Ask library' })); fireEvent.click(await within(screen.getByRole('dialog')).findByRole('button', { name: 'Start answer' })); return h; }
function controlled() { let c!: ReadableStreamDefaultController<Uint8Array>; const cancel = vi.fn(); return { response: new Response(new ReadableStream({ start(v) { c = v; }, cancel }), { headers: { 'content-type': 'text/event-stream' } }), write(v: unknown) { c.enqueue(new TextEncoder().encode('data: ' + JSON.stringify(v) + '\n\n')); }, cancel }; }
it('split UTF8 and CRLF append whole intermediates, replace final display and honor final completion', async () => {
    const bytes = new TextEncoder().encode([{ type: 'answer', content: '中间一' }, { type: 'answer', content: '中间二' }, { type: 'final_answer', content: 'Earlier final' }, { type: 'final_answer', content: 'Later final' }, { type: 'complete', final_answer: '确认答案' }].map(v => 'data: ' + JSON.stringify(v) + '\r\n\r\n').join(''));
    globalServer(r => r.url.endsWith('/search/ask') ? new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i++)
            c.enqueue(bytes.slice(i, i + 1)); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } }) : undefined);
    await ask();
    expect(await screen.findByText('确认答案')).toBeVisible();
    expect(screen.queryByText('Earlier final')).toBeNull();
    expect(screen.queryByText('Later final')).toBeNull();
    fireEvent.click(screen.getByText('Intermediate answers'));
    expect(screen.getByText('中间一')).toBeVisible();
    expect(screen.getByText('中间二')).toBeVisible();
});
it.each([null, ''])('valid terminal %s never adopts a provisional final as successful save', async (value) => {
    globalServer(r => r.url.endsWith('/search/ask') ? askStream([{ type: 'final_answer', content: 'Unconfirmed final' }, { type: 'complete', final_answer: value }]) : undefined);
    await ask();
    expect(await screen.findByText('Finished without an answer.')).toBeVisible();
    expect(screen.getByText('Unconfirmed final')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Save answer to notebooks' })).toBeNull();
});
it.each(['success', 'unknown'])('same submitted intent cannot be replayed after %s until a new question is explicit', async (variant) => {
    const requests = globalServer(r => variant === 'unknown' && r.url.endsWith('/search/ask') ? askStream([{ type: 'answer', content: 'Partial' }]) : undefined);
    await ask();
    await screen.findByText(variant === 'success' ? 'Final answer' : 'Outcome unknown. No automatic retry.');
    expect(screen.getByRole('button', { name: 'Ask library' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'New question' }));
    expect(screen.getByLabelText('Library question')).toHaveValue('');
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
});
it('readiness loss cancels the reader immediately and cannot apply later output to a new generation', async () => {
    const live = controlled(), requests = globalServer(r => r.url.endsWith('/search/ask') ? live.response : undefined);
    const h = await ask();
    await waitFor(() => expect(requests.some(r => r.url.endsWith('/search/ask'))).toBe(true));
    await act(async () => live.write({ type: 'answer', content: 'Retained original' }));
    const original = h.workbench.drafts.library.getSnapshot().find(r => r.input.kind === 'global-run')!;
    act(() => sessionCoordinator.report('reauth-required', sessionCoordinator.current()));
    await waitFor(() => expect(live.cancel).toHaveBeenCalledOnce());
    const retained = h.workbench.drafts.library.get(original.id)!;
    expect(retained.status).toBe('unknown');
    expect(retained.input).toBe(original.input);
    expect(retained.token).toBe(original.token);
    expect(retained.global?.answers).toEqual(['Retained original']);
    act(() => h.workbench.controller.retirePrivacyContext());
    expect(h.workbench.drafts.library.get(original.id)?.retired).toBe(true);
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
});
it('late response after retained navigation belongs only to the original operation and is disposed', async () => {
    let resolve!: (r: Response) => void;
    const requests = globalServer(r => r.url.endsWith('/search/ask') ? new Promise<Response>(yes => resolve = yes) : undefined), h = await ask();
    await waitFor(() => expect(resolve).toBeDefined());
    const original = h.workbench.drafts.library.getSnapshot().find(r => r.input.kind === 'global-run')!;
    act(() => { void h.router.navigate('/sources'); });
    fireEvent.click(await screen.findByRole('button', { name: 'Keep work and continue' }));
    await waitFor(() => expect(h.router.state.location.pathname).toBe('/sources'));
    const cancel = vi.fn();
    await act(async () => resolve(new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'text/event-stream' } })));
    await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    expect(h.workbench.drafts.library.get(original.id)?.status).toBe('unknown');
    expect(h.workbench.drafts.library.get(original.id)?.input).toBe(original.input);
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
});
it('IME and ordinary Enter do not submit; Ctrl Enter is one explicit submit', async () => {
    const requests = globalServer();
    await renderLibrary('/search');
    const input = await screen.findByLabelText('Library question');
    fireEvent.change(input, { target: { value: '多行\n问题' } });
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(0);
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    await screen.findByText('Raw source');
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
});
it('mounted byte-idle watchdog ends observation without retry', async () => {
    const live = controlled(), requests = globalServer(r => r.url.endsWith('/search/ask') ? live.response : undefined);
    // Install the timer after the app startup, before the explicit Ask dispatch.
    await renderLibrary('/search?q=Watchdog&mode=ask');
    fireEvent.click(await screen.findByRole('button', { name: 'Ask library' }));
    vi.useFakeTimers();
    try {
        await act(async () => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Start answer' })));
        await act(async () => vi.advanceTimersByTimeAsync(600001));
        expect(screen.getByText('Outcome unknown. No automatic retry.')).toBeVisible();
        expect(live.cancel).toHaveBeenCalledOnce();
    }
    finally {
        vi.useRealTimers();
    }
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
});
it('model confirmation cannot rebind a captured question after its original editor changes', async () => {
    const requests = globalServer();
    await renderLibrary('/search?q=Captured&mode=ask');
    fireEvent.click(await screen.findByRole('button', { name: 'Ask library' }));
    fireEvent.change(screen.getByLabelText('Library question'), { target: { value: 'Newer draft' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Start answer' }));
    await act(async () => { });
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(0);
    expect(screen.getByLabelText('Library question')).toHaveValue('Newer draft');
});
