import { expect, it, vi } from 'vitest';
import { readAskStream, askEvent } from './global-ask-stream';
it.each([{}, { type: 'complete' }, { type: 'complete', final_answer: 3 }, { type: 'strategy', reasoning: 'x', searches: [{ term: 'x' }] }, { type: 'error' }, { type: 'unknown' }])('rejects invalid Ask frame %#', v => expect(() => askEvent(v)).toThrow());
it('zero disables idle observation timeout and abort cancels/releases the reader', async () => {
    let c!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn(), signal = new AbortController(), body = new ReadableStream<Uint8Array>({ start(v) { c = v; }, cancel }), accepted: unknown[] = [];
    vi.useFakeTimers();
    try {
        const promise = readAskStream(new Response(body, { headers: { 'content-type': 'text/event-stream' } }), signal.signal, v => accepted.push(v), 0);
        await vi.advanceTimersByTimeAsync(700000);
        expect(cancel).not.toHaveBeenCalled();
        c.enqueue(new TextEncoder().encode('data: {"type":"complete","final_answer":null}\n\n'));
        await promise;
        expect(accepted).toEqual([{ type: 'complete', final_answer: null }]);
        expect(cancel).toHaveBeenCalledOnce();
        expect(body.locked).toBe(false);
    }
    finally {
        vi.useRealTimers();
    }
});
it.each(['data: {broken}\n\n', 'data: {"type":"complete"}\n\n', '', ':comment\n\n'])('invalid or absent terminal rejects and releases %#', async (data) => {
    const response = new Response(data, { headers: { 'content-type': 'text/event-stream' } });
    await expect(readAskStream(response, new AbortController().signal, () => { })).rejects.toThrow();
    expect(response.body?.locked).toBe(false);
});
it('configured zero preserves the disabled watchdog budget for the mounted reader default', async () => {
    let c!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn(), body = new ReadableStream<Uint8Array>({ start(v) { c = v; }, cancel });
    vi.stubEnv('VITE_API_TIMEOUT_MS', '0');
    vi.useFakeTimers();
    try {
        const result = readAskStream(new Response(body, { headers: { 'content-type': 'text/event-stream' } }), new AbortController().signal, () => { }).then(() => true, () => false);
        await vi.advanceTimersByTimeAsync(700000);
        expect(cancel).not.toHaveBeenCalled();
        c.enqueue(new TextEncoder().encode('data: {"type":"complete","final_answer":null}\n\n'));
        expect(await result).toBe(true);
    }
    finally {
        vi.useRealTimers();
        vi.unstubAllEnvs();
    }
});
