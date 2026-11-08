import { expect, it, vi } from 'vitest';
import { createTurnRuntime } from './turn-runtime';
import { sourceContext } from '../../test/source-fixtures';
import { sessionCoordinator, readTurnContext, invalidateTurnContext } from '@study/web-transport';
import type { TurnApi } from '../../data/turn-api';
import type { TurnMatch } from '@study/domain';
function setup() {
    const context = sourceContext(), generation = sessionCoordinator.current();
    let provider = 1;
    const capture = { sessionId: 'v1_n', context, owner: { mountId: 'question', questionRevision: 1 }, request: { notebook_id: 'n', engine: 'independent' as const, selection_origin: 'local' as const, source_version_ids: ['v'], remote_source_ids: [], message: 'question', task: 'question' as const } };
    const api = { submit: vi.fn(async () => ({ kind: 'unknown', reason: 'transport' })), check: vi.fn(async () => ({ kind: 'unknown', reason: 'not-found' })), events: vi.fn(() => new Promise<Response>(() => { })), job: vi.fn(), cancel: vi.fn(), list: vi.fn(), modelAvailable: vi.fn(), capabilities: vi.fn() } as unknown as TurnApi;
    const runtime = createTurnRuntime(), accepted = vi.fn(), valid = () => generation === sessionCoordinator.current() && provider === 1 && context.epoch === readTurnContext()?.epoch;
    const readFence = () => { const g = sessionCoordinator.current(), p = provider; return () => g === sessionCoordinator.current() && p === provider && context.epoch === readTurnContext()?.epoch; };
    const start = () => runtime.start(capture, api, valid, accepted, readFence);
    return { runtime, api, capture, accepted, valid, start, provider: (p: number) => { provider = p; } };
}
it('keeps the original unknown lock across subscriber loss, rejects duplicate admission and never starts observation', async () => {
    const x = setup(), unsubscribe = x.runtime.subscribe(() => { });
    expect(x.start().ok).toBe(true);
    expect(x.start()).toEqual({ ok: false, reason: 'busy' });
    unsubscribe();
    await vi.waitFor(() => expect(x.runtime.getSnapshot('n').operation?.phase).toBe('unknown'));
    expect(x.api.submit).toHaveBeenCalledTimes(1);
    expect(x.api.events).not.toHaveBeenCalled();
    expect(x.api.job).not.toHaveBeenCalled();
    x.runtime.retry('n', () => true);
    expect(x.api.submit).toHaveBeenCalledTimes(1);
});
it('settles late POST conservatively and checks original capture under a fresh same-epoch generation', async () => {
    const x = setup();
    let resolve!: (v: unknown) => void;
    vi.mocked(x.api.submit).mockImplementation(() => new Promise(r => { resolve = r as typeof resolve; }));
    x.start();
    const original = x.runtime.getSnapshot('n').operation!.capture;
    sessionCoordinator.begin();
    resolve({ kind: 'bound', jobId: 'j', turnId: 't', state: 'queued', dispatchUnknown: false });
    await vi.waitFor(() => expect(x.runtime.getSnapshot('n').operation?.phase).toBe('unknown'));
    expect(x.accepted).not.toHaveBeenCalled();
    await x.runtime.check('n');
    expect(x.api.check).toHaveBeenCalledTimes(1);
    expect(vi.mocked(x.api.check).mock.calls[0]![0]).toBe(original);
    expect(x.api.job).not.toHaveBeenCalled();
    expect(x.api.events).not.toHaveBeenCalled();
});
it.each(['generation', 'provider'] as const)('rejects completion if %s changes during an explicit check', async (boundary) => {
    const x = setup();
    x.start();
    await vi.waitFor(() => expect(x.runtime.getSnapshot('n').operation?.phase).toBe('unknown'));
    x.provider(2);
    let resolve!: (v: TurnMatch) => void;
    vi.mocked(x.api.check).mockImplementation(() => new Promise(r => { resolve = r; }));
    const check = x.runtime.check('n');
    expect(x.api.check).toHaveBeenCalledTimes(1);
    if (boundary === 'provider')
        x.provider(3);
    else
        sessionCoordinator.begin();
    resolve({ kind: 'complete', jobId: 'j', turnId: 't', turn: { turn_id: 't', answer: 'stale' } });
    await check;
    expect(x.runtime.getSnapshot('n').operation?.phase).toBe('unknown');
    expect(x.runtime.getSnapshot('n').turns).toEqual([]);
});
it('privacy retirement never rebinds the original operation or permits read recovery', async () => {
    const x = setup();
    x.start();
    await vi.waitFor(() => expect(x.runtime.getSnapshot('n').operation?.phase).toBe('unknown'));
    x.runtime.retire(x.capture.context.epoch);
    invalidateTurnContext();
    await x.runtime.check('n');
    expect(x.api.check).not.toHaveBeenCalled();
    expect(x.runtime.getSnapshot('n').retired).toBe(true);
    expect(x.runtime.hasPending('n')).toBe(true);
});
it('only proven-unsent retry preserves exact DTO and operation key, then returns to check-only if outcome is uncertain', async () => {
    const x = setup();
    vi.mocked(x.api.submit).mockResolvedValueOnce({ kind: 'not-dispatched' });
    x.start();
    await vi.waitFor(() => expect(x.runtime.getSnapshot('n').operation?.phase).toBe('not-sent'));
    x.runtime.retry('n', () => true);
    await vi.waitFor(() => expect(x.runtime.getSnapshot('n').operation?.phase).toBe('unknown'));
    const calls = vi.mocked(x.api.submit).mock.calls;
    expect(calls[0]![1]).toBe(calls[1]![1]);
    x.runtime.retry('n', () => true);
    expect(x.api.submit).toHaveBeenCalledTimes(2);
});
it('only canonical completion releases the lock and the verified result survives a remount', async () => {
    const x = setup();
    x.start();
    await vi.waitFor(() => expect(x.runtime.getSnapshot('n').operation?.phase).toBe('unknown'));
    vi.mocked(x.api.check).mockResolvedValue({ kind: 'complete', jobId: 'j', turnId: 't', turn: { turn_id: 't', answer: 'verified' } });
    await x.runtime.check('n');
    expect(x.runtime.getSnapshot('n').operation).toBeNull();
    expect(x.runtime.getSnapshot('n').turns).toEqual([{ turn_id: 't', answer: 'verified' }]);
    x.runtime.retire(x.capture.context.epoch);
    expect(x.runtime.getSnapshot('n').turns).toEqual([]);
});
it('a failed explicit read retains its lock without an unhandled rejection', async () => {
    const x = setup();
    x.start();
    await vi.waitFor(() => expect(x.runtime.getSnapshot('n').operation?.phase).toBe('unknown'));
    vi.mocked(x.api.check).mockRejectedValue(new Error('read failed'));
    await expect(x.runtime.check('n')).resolves.toBeUndefined();
    expect(x.runtime.getSnapshot('n').operation?.busy).toBeNull();
    expect(x.runtime.getSnapshot('n').operation?.phase).toBe('unknown');
});
it('keeps retry disabled after provider evidence changes even when the same endpoint is ready again', async () => {
    const x = setup();
    vi.mocked(x.api.submit).mockResolvedValue({ kind: 'not-dispatched' });
    x.start();
    await vi.waitFor(() => expect(x.runtime.getSnapshot('n').operation?.phase).toBe('not-sent'));
    expect(x.runtime.canRetry('n', () => true)).toBe(true);
    x.provider(2);
    expect(x.runtime.canRetry('n', () => true)).toBe(false);
    x.runtime.retry('n', () => true);
    expect(x.api.submit).toHaveBeenCalledTimes(1);
    x.runtime.abandon('n');
    expect(x.runtime.hasPending('n')).toBe(false);
});
