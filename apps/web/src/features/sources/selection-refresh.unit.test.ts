import { beforeEach, expect, it } from 'vitest';
import { readTurnContext, sessionCoordinator } from '@study/web-transport';
import { createDraftRegistry } from '../../app/drafts';
import { sourceContext, sourceWorkspace, selection } from '../../test/source-fixtures';

beforeEach(sourceContext);

it('rejects a workspace read that began before a new selection intent or before its settlement', () => {
    const store = createDraftRegistry().sources, c = readTurnContext()!, g = sessionCoordinator.current();
    const beforeIntent = store.beginWorkspaceRead('n', c, g);
    const id = store.capture('n', { kind: 'selection', selection: { ...selection, source_version_ids: ['v-new'] } }, c, g);
    expect(store.acceptWorkspaceRead(beforeIntent, sourceWorkspace(), c, g)).toBe(false);
    const active = store.begin(id, c, g)!;
    const duringWrite = store.beginWorkspaceRead('n', c, g);
    store.settle(id, active.operation.token!, { kind: 'succeeded' }, c, g);
    expect(store.acceptWorkspaceRead(beforeIntent, sourceWorkspace(), c, g)).toBe(false);
    expect(store.acceptWorkspaceRead(duringWrite, sourceWorkspace(), c, g)).toBe(false);
    const afterWrite = store.beginWorkspaceRead('n', c, g);
    const newer = { ...sourceWorkspace(), selection: { ...selection, source_version_ids: [], reading: { source_version_id: 'v-new', page_index: 9 } } };
    expect(store.acceptWorkspaceRead(afterWrite, newer, c, g)).toBe(true);
    expect(store.getSelectionRead('n')?.selection).toEqual(newer.selection);
});

it('never releases an unknown selection through a background workspace refresh', () => {
    const store = createDraftRegistry().sources, c = readTurnContext()!, g = sessionCoordinator.current();
    const id = store.capture('n', { kind: 'selection', selection }, c, g);
    const active = store.begin(id, c, g)!;
    store.settle(id, active.operation.token!, { kind: 'unknown' }, c, g);
    const read = store.beginWorkspaceRead('n', c, g);
    expect(store.acceptWorkspaceRead(read, sourceWorkspace(), c, g)).toBe(false);
    expect(store.get(id)?.operation.state).toBe('unknown');
    expect(store.begin(id, c, g)).toBeNull();
});

it('blocks transaction admission until an exact post-settlement workspace is accepted, rejecting older and wrong-link projections',()=>{
 const store=createDraftRegistry().sources,c=readTurnContext()!,g=sessionCoordinator.current();
 const id=store.reserveSelection('n',selection,c,g,{providerRevision:7,remoteNotebookId:'B'})!;
 store.releaseSelection(id);const active=store.begin(id,c,g,7)!;
 const during=store.beginWorkspaceRead('n',c,g);
 store.settle(id,active.operation.token!,{kind:'succeeded'},c,g);
 expect(store.selectionUnconfirmed('n',c.epoch)).toBe(true);
 const target={...sourceWorkspace(),link:{remote_notebook_id:'B'}};
 expect(store.acceptWorkspaceRead(during,target,c,g)).toBe(false);
 const wrong=store.beginWorkspaceRead('n',c,g);
 expect(store.acceptWorkspaceRead(wrong,{...target,link:{remote_notebook_id:'A'}},c,g)).toBe(false);
 expect(store.selectionUnconfirmed('n',c.epoch)).toBe(true);
 const exact=store.beginWorkspaceRead('n',c,g);
 expect(store.acceptWorkspaceRead(exact,target,c,g)).toBe(true);
 expect(store.selectionUnconfirmed('n',c.epoch)).toBe(false);
 const later=store.beginWorkspaceRead('n',c,g);
 expect(store.acceptWorkspaceRead(later,{...target,selection:{...selection,source_version_ids:['v-new']}},c,g)).toBe(true);
});

it('admits first local choice only for a current exact-null, unlinked accepted read and known version', () => {
    const store = createDraftRegistry().sources, c = readTurnContext()!, g = sessionCoordinator.current();
    const workspace = { ...sourceWorkspace(), selection: null };
    expect(store.captureFirstLocalSelection('n', 'v-old', c, g)).toBeNull();
    const accepted = store.beginWorkspaceRead('n', c, g);
    expect(store.acceptWorkspaceRead(accepted, workspace, c, g)).toBe(true);
    expect(store.captureFirstLocalSelection('n', 'unknown', c, g)).toBeNull();
    expect(store.captureFirstLocalSelection('n', 'v-old', c, g + 1)).toBeNull();
    expect(store.captureFirstLocalSelection('n', 'v-old', { ...c, epoch: c.epoch + 1 }, g)).toBeNull();

    const updated = store.beginWorkspaceRead('n', c, g);
    expect(store.acceptWorkspaceRead(updated, { ...workspace, selection: { projection_status: 'invalid' } }, c, g)).toBe(true);
    expect(store.captureFirstLocalSelection('n', 'v-old', c, g)).toBeNull();
    const read = store.beginWorkspaceRead('n', c, g);
    expect(store.acceptWorkspaceRead(read, workspace, c, g)).toBe(true);
    const id = store.captureFirstLocalSelection('n', 'v-old', c, g)!;
    expect(store.get(id)?.payload).toEqual({
        kind: 'selection',
        selection: { engine: 'independent', selection_origin: 'local', source_version_ids: ['v-old'], remote_source_ids: [] },
    });
    expect(store.captureFirstLocalSelection('n', 'v-new', c, g)).toBeNull();
});
