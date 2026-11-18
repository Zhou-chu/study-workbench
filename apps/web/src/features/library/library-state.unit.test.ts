import type { ImportInput } from './library-store';
import { expect, it } from 'vitest';
import { createDraftRegistry } from '../../app/drafts';
import { sourceContext } from '../../test/source-fixtures';
import { sessionCoordinator } from '@study/web-transport';
const input = (): ImportInput => ({ kind: 'import', type: 'upload', title: '', text: '', urls: '', files: [new File(['one'], 'one.txt'), new File(['two'], 'two.txt')], notebooks: [], transformations: [], embed: false, step: 1 });

it('terminal partial receipts remain immutable and require a separate new editor intent', () => {
    const registry = createDraftRegistry(), c = sourceContext(), g = sessionCoordinator.current(), store = registry.library;
    const id = store.open({ kind: 'global' }, input(), c, g), op = store.begin(id, c, g)!;
    store.item(id, op.token!, 0, { state: 'accepted', resourceId: 'source:one' }, c, g);
    store.item(id, op.token!, 1, { state: 'rejected' }, c, g);
    store.finish(id, op.token!, 'failed', c, g);
    const previous = store.get(id);
    store.edit(id, { title: 'Cannot rewrite prior receipt' });
    expect(store.get(id)).toBe(previous);
    expect(store.begin(id, c, g)).toBeNull();
    const newer = store.open({ kind: 'global' }, input(), c, g);
    expect(newer).not.toBe(id);
    expect(store.get(id)?.receipts).toHaveLength(2);
});

it('canonical resource ownership ignores object property order', () => {
    const c = sourceContext(), g = sessionCoordinator.current(), store = createDraftRegistry().library;
    const id = store.open({ kind: 'source', sourceId: 'source:canonical' }, { kind: 'action', action: 'embed', sourceId: 'source:canonical' }, c, g);
    expect(store.open({ sourceId: 'source:canonical', kind: 'source' }, { kind: 'action', action: 'embed', sourceId: 'source:canonical' }, c, g)).toBe(id);
});

it('late original acknowledgments stay locked after a readiness uncertainty', () => {
    const c = sourceContext(), g = sessionCoordinator.current(), store = createDraftRegistry().library;
    const id = store.open({ kind: 'source', sourceId: 'source:canonical' }, { kind: 'action', action: 'embed', sourceId: 'source:canonical' }, c, g);
    const row = store.begin(id, c, g)!;
    store.refreshFences({ ...c, ready: false }, g);
    expect(store.get(id)?.status).toBe('unknown');
    store.item(id, row.token!, 0, { state: 'accepted', resourceId: 'source:canonical', commandId: 'command:late' }, c, g);
    store.finish(id, row.token!, 'succeeded', c, g);
    expect(store.get(id)?.status).toBe('unknown');
    expect(store.get(id)?.receipts).toEqual([{ state: 'unknown', resourceId: 'source:canonical', commandId: 'command:late' }]);
    expect(store.begin(id, c, g)).toBeNull();
});

it('I1 recovery cannot issue a current intent in an explicitly retired epoch', () => {
    const c = sourceContext(), g = sessionCoordinator.current(), store = createDraftRegistry().library;
    const originalInput = input(), id = store.open({ kind: 'global' }, originalInput, c, g);
    store.retire(c.epoch);
    const retained = store.get(id)!;
    expect(store.canFresh(retained, c, g)).toBe(false);
    expect(store.fresh(id, input(), c, g)).toBeNull();
    const next = { ...c, epoch: c.epoch + 1 };
    const newer = store.fresh(id, input(), next, g)!;
    expect(newer).not.toBe(id);
    expect(store.get(newer)?.context).toEqual(next);
    expect(store.get(id)).toBe(retained);
    expect(store.get(id)?.input).toBe(retained.input);
    expect((store.get(id)?.input as ImportInput).files[0]).toBe(originalInput.files[0]);
});

it.each(['accepted', 'unknown'] as const)('I1 fresh recovery never unlocks or copies %s operations', status => {
    const c = sourceContext(), g = sessionCoordinator.current(), store = createDraftRegistry().library;
    const originalInput = input(), id = store.open({ kind: 'global' }, originalInput, c, g), op = store.begin(id, c, g)!;
    store.item(id, op.token!, 0, { state: status === 'accepted' ? 'accepted' : 'unknown', resourceId: 'source:actual', commandId: 'command:actual' }, c, g);
    store.finish(id, op.token!, status, c, g, 'command:actual');
    const retained = store.get(id)!;
    const next = { ...c, epoch: c.epoch + 1 };
    expect(store.canFresh(retained, next, g + 1)).toBe(false);
    expect(store.fresh(id, input(), next, g + 1)).toBeNull();
    expect(store.open({ kind: 'global' }, input(), next, g + 1)).toBe(id);
    expect(store.begin(id, next, g + 1)).toBeNull();
    expect(store.get(id)).toBe(retained);
    expect((retained.input as ImportInput).files[0]).toBe(originalInput.files[0]);
});

it('I1 fresh ownership rejects late edits to the unchanged retained record', () => {
    const c = sourceContext(), g = sessionCoordinator.current(), store = createDraftRegistry().library;
    const id = store.open({ kind: 'global' }, input(), c, g);
    store.edit(id, { title: 'Retained title' });
    const retained = store.get(id)!;
    const newer = store.fresh(id, { ...input(), title: '', files: [] }, c, g + 1)!;
    expect(store.begin(id, c, g)).toBeNull();
    expect(store.canFresh(retained, c, g + 1)).toBe(false);
    store.edit(id, { title: 'Late old editor' });
    store.reset(id, { ...input(), title: 'Late reset' });
    expect(store.get(id)).toBe(retained);
    expect(store.get(id)?.input).toBe(retained.input);
    store.edit(newer, { title: 'Current editor' });
    expect(store.get(newer)?.input).toMatchObject({ title: 'Current editor' });
});
