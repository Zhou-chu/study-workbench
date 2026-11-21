import { expect, it, vi, afterEach } from 'vitest';
import { createLibraryStore } from './library-store';
import { createLibraryApi } from '../../data/library-api';
import { sourceContext } from '../../test/source-fixtures';
import { json } from '../../test/notebook-fixtures';
import { sessionCoordinator, readTurnContext } from '@study/web-transport';
import { observeCommand } from './library-operations';
afterEach(() => vi.useRealTimers());
function fixture() { const c = sourceContext(), g = sessionCoordinator.current(), store = createLibraryStore(() => { }), id = store.open({ kind: 'source', sourceId: 'source:x' }, { kind: 'action', action: 'embed', sourceId: 'source:x' }, c, g), r = store.begin(id, c, g)!; store.finish(id, r.token!, 'accepted', c, g, 'command:exact'); return { store, id, row: store.get(id)! }; }
it.each([['completed', 'succeeded'], ['failed', 'failed'], ['canceled', 'failed'], ['cancelled', 'failed'], ['error', 'failed'], ['unknown', 'unknown']])('settles exact terminal command %s as %s without any write', async (status, want) => {
    const { store, id, row } = fixture(), methods: string[] = [], api = createLibraryApi({ send: async (r) => { methods.push(r.method); return json({ job_id: 'command:exact', status }); } });
    await observeCommand(api, row, store, new AbortController().signal, () => { });
    expect(store.get(id)?.status).toBe(want);
    expect(methods).toEqual(['GET']);
});
it('three failed status reads stop as unknown, never successful or replayed', async () => {
    vi.useFakeTimers();
    const { store, id, row } = fixture();
    let reads = 0;
    const api = createLibraryApi({ send: async () => { reads++; return json({}, 503); } });
    const pending = observeCommand(api, row, store, new AbortController().signal, () => { });
    await vi.advanceTimersByTimeAsync(4100);
    await pending;
    expect(reads).toBe(3);
    expect(store.get(id)?.status).toBe('unknown');
    expect(store.begin(id, readTurnContext(), sessionCoordinator.current())).toBeNull();
});
it('aborting observation keeps the accepted original command and never claims remote cancellation', async () => {
    vi.useFakeTimers();
    const { store, id, row } = fixture(), controller = new AbortController();
    let reads = 0;
    const api = createLibraryApi({ send: async () => { reads++; return json({ job_id: 'command:exact', status: 'running' }); } });
    const pending = observeCommand(api, row, store, controller.signal, () => { });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await pending;
    expect(reads).toBe(1);
    expect(store.get(id)).toMatchObject({ status: 'accepted', commandId: 'command:exact' });
    expect(store.get(id)).not.toHaveProperty('remoteCanceled');
});
