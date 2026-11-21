import { expect, it, vi } from 'vitest';
import type { DispatchContext } from '@study/domain';
import type { NotebookSummary } from '../../data/notebook-api';
import type { CreateReceipt } from '../../data/settings-api';
import { createSettingsStore } from './settings-store';

const context: DispatchContext = {
    epoch: 1, ready: true, target: { mode: 'legacy_password', apiBase: '/api', protocol: null },
};
const entry: NotebookSummary = {
    id: 'notebook:research', name: 'Saved title', description: 'Saved description', archived: false,
    created: '2026-01-01', updated: '2026-01-02', source_count: 0, note_count: 0,
};
const receipt: CreateReceipt = {
    job_id: 'job:example', state: 'queued', submission_state: null, remote_notebook_id: null,
    request_hash: 'example', notebook_id: entry.id, idempotency_key: 'request-a', title: 'Remote notebook',
};

function setup() {
    const notify = vi.fn(), store = createSettingsStore(notify), id = store.open(entry.id, context, 1);
    return { notify, store, id };
}

it('opens one draft per notebook and does not seed it from another notebook', () => {
    const { notify, store, id } = setup();
    expect(store.open(entry.id, context, 1)).toBe(id);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(store.select('missing')).toBe(false);
    store.seed(id, { ...entry, id: 'notebook:different' });
    expect(store.get(id)?.baseline).toBeNull();
    store.seed(id, entry);
    store.seed(id, { ...entry, name: 'Late result' });
    expect(store.get(id)?.fields.name).toBe('Saved title');
    expect(store.hasUnsaved()).toBe(false);
    expect(store.select(id)).toBe(true);
    expect(store.selected(entry.id)).toBe(id);
    expect(Object.isFrozen(store.getSnapshot())).toBe(true);
    expect(Object.isFrozen(store.get(id)?.context.target)).toBe(true);
});

it('retains edits made before the initial read and clears dirty only when the baseline matches', () => {
    const { store, id } = setup();
    store.edit(id, { name: 'Typed before the read' });
    store.seed(id, entry);
    expect(store.get(id)?.fields.name).toBe('Typed before the read');
    expect(store.get(id)?.baseline?.name).toBe(entry.name);
    expect(store.hasUnsaved()).toBe(true);
    store.edit(id, { name: entry.name, description: entry.description, remoteId: 'remote:1' });
    expect(store.get(id)?.dirty).toBe(true);
    store.edit(id, { remoteId: '' });
    expect(store.hasUnsaved()).toBe(false);
});

it('keeps the sent command immutable and reconciles the returned baseline with newer edits', () => {
    const { store, id } = setup();
    store.seed(id, entry);
    store.edit(id, { name: 'Sent title' });
    const command = store.begin(id, 'save', context, 1, 3, 'model:one');
    expect(command).not.toBeNull();
    expect(command?.fields.name).toBe('Sent title');
    expect(command?.providerRevision).toBe(3);
    expect(command?.selectionId).toBe('model:one');
    expect(Object.isFrozen(command?.fields)).toBe(true);
    expect(store.begin(id, 'save', context, 1)).toBeNull();
    store.edit(id, { name: 'New edit' });
    store.settle(id, { ...command! }, 'succeeded', context, 1, entry);
    expect(store.get(id)?.status).toBe('pending');
    store.settle(id, command!, 'succeeded', context, 1, { ...entry, name: 'Sent title' }, 'job:save', 202);
    expect(store.get(id)?.command).toMatchObject({ status: 'succeeded', jobId: 'job:save', httpStatus: 202 });
    expect(store.get(id)?.baseline?.name).toBe('Sent title');
    expect(store.get(id)?.fields.name).toBe('New edit');
    expect(store.hasUnsaved()).toBe(true);
});

it('distinguishes confirmed unsent commands from a reply after the operation generation advanced', () => {
    const { store, id } = setup();
    expect(store.begin(id, 'save', null, 1)).toBeNull();
    const first = store.begin(id, 'save', context, 1)!;
    store.settle(id, first, 'not-sent', context, 1);
    expect(store.get(id)?.status).toBe('editing');
    expect(store.hasUnsaved()).toBe(false);
    const second = store.begin(id, 'save', context, 2)!;
    store.settle(id, second, 'succeeded', context, 3, entry);
    expect(store.get(id)?.baseline).toBeNull();
    expect(store.get(id)?.status).toBe('unknown');
    expect(store.begin(id, 'save', context, 3)).toBeNull();
    expect(store.hasUnsaved()).toBe(true);
});

it('does not discard queued or uncertain remote creation when opening a successor', () => {
    const { store, id } = setup();
    store.metadata(id, { create: receipt });
    expect(store.get(id)?.status).toBe('pending');
    expect(store.fresh(id, context, 2)).toBeNull();
    store.metadata(id, { create: { ...receipt, state: 'submission_unknown' } });
    expect(store.get(id)?.status).toBe('unknown');
    expect(store.fresh(id, context, 2)).toBeNull();
    store.metadata(id, { create: { ...receipt, state: 'succeeded', submission_state: 'confirmed' } });
    expect(store.fresh(id, { ...context, ready: false }, 2)).toBeNull();
    const next = store.fresh(id, context, 2);
    expect(next).not.toBeNull();
    expect(store.selected(entry.id)).toBe(next);
    expect(store.get(id)?.retired).toBe(true);
    expect(store.fresh(id, context, 3)).toBe(next);
    store.edit(id, { name: 'Ignored' });
    expect(store.get(id)?.fields.name).toBe('');
});

it('preserves unsaved retrieval edits and marks pending notebook work uncertain on retirement', () => {
    const { store, id } = setup();
    store.retrieval(id, state => ({ ...state, dirty: true, busy: true }));
    expect(store.get(id)?.status).toBe('pending');
    store.retrieval(id, state => ({ ...state, busy: false }));
    expect(store.get(id)?.status).toBe('editing');
    expect(store.hasUnsaved()).toBe(true);
    store.begin(id, 'save', context, 1);
    store.retire(0);
    expect(store.get(id)?.retired).toBe(false);
    store.retire(1);
    expect(store.get(id)).toMatchObject({ retired: true, status: 'unknown', command: { status: 'unknown' } });
    const next = store.fresh(id, { ...context, epoch: 2 }, 2);
    expect(store.get(next!)?.retrieval.dirty).toBe(false);
});
