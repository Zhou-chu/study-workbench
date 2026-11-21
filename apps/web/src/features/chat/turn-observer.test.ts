import { afterEach, expect, it, vi } from 'vitest';
import { observeTurn } from './turn-observer';
import { sourceContext } from '../../test/source-fixtures';
import type { TurnApi } from '../../data/turn-api';
const receipt = { job_id: 'parent', turn_id: 'turn' };
function api(events: () => Promise<Response>, job = vi.fn(async () => ({ job_id: 'parent', turn_id: 'turn', state: 'running', operation: 'chat' }))) { return { events, job, submit: vi.fn(), cancel: vi.fn(), list: vi.fn(), check: vi.fn(), modelAvailable: vi.fn(), capabilities: vi.fn() } as unknown as TurnApi; }
afterEach(() => vi.useRealTimers());
it('falls back from a broken stream to only the existing parent, never submit or cancel', async () => {
    const a = api(async () => { throw new Error('broken stream'); });
    const states: string[] = [];
    const stop = observeTurn(a, receipt, sourceContext(), s => states.push(s), () => true);
    await vi.waitFor(() => expect(a.job).toHaveBeenCalledTimes(1));
    stop();
    expect(a.job).toHaveBeenCalledWith('parent', expect.anything(), expect.any(AbortSignal));
    expect(a.submit).not.toHaveBeenCalled();
    expect(a.cancel).not.toHaveBeenCalled();
    expect(states).toContain('running');
});
it('shows actual SSE stages, ignores token text and stops on final without job GET', async () => {
    const a = api(async () => new Response('event: stage\ndata: {"turn_id":"turn","state":"running"}\n\nevent: token\ndata: {"text":"fake"}\n\nevent: final\ndata: {"turn_id":"turn","status":"succeeded"}\n\n', { headers: { 'content-type': 'text/event-stream' } }));
    const states: string[] = [];
    observeTurn(a, receipt, sourceContext(), s => states.push(s), () => true);
    await vi.waitFor(() => expect(states).toEqual(['running', 'succeeded']));
    expect(a.job).not.toHaveBeenCalled();
});
it('a mismatching or unknown stage stops observation without generic job recovery', async () => {
    const a = api(async () => new Response('event: stage\ndata: {"turn_id":"other","state":"running"}\n\n', { headers: { 'content-type': 'text/event-stream' } }));
    const states: string[] = [];
    observeTurn(a, receipt, sourceContext(), s => states.push(s), () => true);
    await vi.waitFor(() => expect(states).toEqual(['unknown']));
    expect(a.job).not.toHaveBeenCalled();
});
it('unsubscribe suppresses a late stage and never cancels the remote task', async () => {
    let resolve!: (v: Response) => void;
    const a = api(() => new Promise(r => { resolve = r; }));
    const notify = vi.fn();
    const stop = observeTurn(a, receipt, sourceContext(), notify, () => true);
    stop();
    resolve(new Response('event: stage\ndata: {"turn_id":"turn","state":"running"}\n\n'));
    await Promise.resolve();
    expect(notify).not.toHaveBeenCalled();
    expect(a.cancel).not.toHaveBeenCalled();
    expect(a.job).not.toHaveBeenCalled();
});
it('serializes fallback polls and drops a response after the operation fence changes', async () => {
    let valid = true, resolve!: (v: unknown) => void;
    const job = vi.fn(() => new Promise(r => { resolve = r; }));
    const a = api(async () => { throw new Error(); }, job as never);
    const notify = vi.fn();
    const stop = observeTurn(a, receipt, sourceContext(), notify, () => valid);
    await vi.waitFor(() => expect(job).toHaveBeenCalledTimes(1));
    valid = false;
    resolve({ job_id: 'parent', turn_id: 'turn', state: 'succeeded' });
    await Promise.resolve();
    await Promise.resolve();
    expect(notify).not.toHaveBeenCalled();
    stop();
});
it('parses CRLF boundaries even when the two bytes arrive in separate chunks', async () => {
    const encoder = new TextEncoder();
    const a = api(async () => new Response(new ReadableStream({ start(c) {
            for (const s of ['event: stage\r', '\ndata: {"turn_id":"turn","state":"running"}\r', '\n\r', '\nevent: final\r', '\ndata: {"turn_id":"turn","status":"succeeded"}\r', '\n\r', '\n'])
                c.enqueue(encoder.encode(s));
            c.close();
        } }), { headers: { 'content-type': 'text/event-stream' } }));
    const states: string[] = [];
    const stop = observeTurn(a, receipt, sourceContext(), s => states.push(s), () => true);
    await vi.waitFor(() => expect(states).toEqual(['running', 'succeeded']));
    expect(a.job).not.toHaveBeenCalled();
    stop();
});
