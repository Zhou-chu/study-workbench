import { expect, it, vi } from 'vitest';
import { createEditor, type DispatchContext } from '@study/domain';
import { createDraftRegistry, createNavigationController } from './drafts';
const id = { epoch: 1, notebookId: 'A', editorSession: 'editor-1' };
const draft = () => createEditor('A', { title: 'Title', content: 'Unsaved', citations: [] });

it('separates notebook/editor sessions and retires epochs without losing retained File identity', () => {
    const registry = createDraftRegistry();
    const file = new File(['x'], 'x.txt');
    registry.update(id, { editor: draft(), file, question: 'q' });
    registry.update({ ...id, notebookId: 'B' }, { editor: createEditor('B', { title: '', content: 'B', citations: [] }) });
    expect(registry.get(id)?.file).toBe(file);
    expect(registry.get({ ...id, editorSession: 'other' })).toBeUndefined();
    registry.retireContext(1);
    expect(registry.get(id)?.retired).toBe(true);
    registry.update(id, { question: 'changed' });
    expect(registry.get(id)?.question).toBe('q');
});

it('exposes retired context even when no draft was ever created', () => {
    const registry = createDraftRegistry();
    expect(registry.get(id)).toBeUndefined();
    registry.retireContext(id.epoch);
    expect(registry.isRetired(id)).toBe(true);
    registry.update(id, { question: 'late write' });
    expect(registry.get(id)).toBeUndefined();
    const next = { ...id, epoch: 2, editorSession: 'new-explicit-editor' };
    registry.update(next, { question: 'new work' });
    expect(registry.isRetired(next)).toBe(false);
    expect(registry.get(next)?.question).toBe('new work');
});

const context = (epoch=1, ready=true): DispatchContext => ({
    epoch, ready, target: {mode:'device_sessions',apiBase:'/api',protocol:'bff-memory-v1'},
});

it('only clears the question for the acknowledged revision and refuses a mismatched editor', () => {
    const registry=createDraftRegistry(), listener=vi.fn();
    const off=registry.subscribe(listener);
    registry.update(id,{question:'first'});
    const old=registry.get(id)!.questionRevision!;
    registry.update(id,{question:'current'});
    registry.clearQuestion(id,old);
    registry.clearQuestion({...id,editorSession:'another'},old);
    registry.update(id,{editor:createEditor('B',{title:'Different',content:'note',citations:[]})});
    expect(registry.get(id)?.question).toBe('current');
    expect(registry.get(id)?.editor).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    registry.clearQuestion(id,registry.get(id)!.questionRevision!);
    expect(registry.get(id)).toMatchObject({question:'',questionRevision:old+2});
    expect(registry.hasUnsaved()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
});

it('runs private clear callbacks once despite sibling exceptions and immediately clears late subscribers', () => {
    const registry=createDraftRegistry();
    const skipped=vi.fn(), deferred=vi.fn(), throws=vi.fn(()=>{throw Error('field cleanup failed')});
    registry.registerPrivateClear(1,throws);
    registry.registerPrivateClear(1,deferred);
    registry.registerPrivateClear(1,skipped)();
    registry.retireContext(1);
    registry.retireContext(1);
    registry.registerPrivateClear(1,deferred)();
    expect(throws).toHaveBeenCalledTimes(1);
    expect(deferred).toHaveBeenCalledTimes(2);
    expect(skipped).not.toHaveBeenCalled();
});

it('keeps one active creation, requires a current named draft and allows a not-sent retry', () => {
    const registry=createDraftRegistry();
    expect(registry.openNotebookCreation(context(1,false))).toBeNull();
    const draftId=registry.openNotebookCreation(context())!;
    expect(registry.openNotebookCreation(context())).toEqual(draftId);
    expect(registry.startFreshNotebookCreation(context())).toBeNull();
    expect(registry.beginNotebookCreation(draftId,context())).toBeNull();
    registry.editNotebookCreation(draftId,{name:'Study',description:'Draft notes'});
    expect(registry.beginNotebookCreation(draftId,context(2))).toBeNull();
    expect(registry.beginNotebookCreation(draftId,context())?.status).toBe('pending');
    registry.editNotebookCreation(draftId,{name:'cannot change during save'});
    expect(registry.beginNotebookCreation(draftId,context())).toBeNull();
    registry.settleNotebookCreation(draftId,'not-sent',context());
    expect(registry.getNotebookCreationSnapshot().active?.creation).toMatchObject({name:'Study',status:'not-sent'});
    expect(registry.beginNotebookCreation(draftId,context())?.status).toBe('pending');
    registry.settleNotebookCreation(draftId,{notebookId:'saved-id'},context());
    expect(registry.getNotebookCreationSnapshot().active?.creation).toMatchObject({status:'succeeded',notebookId:'saved-id'});
    expect(registry.hasUnsaved()).toBe(false);
    expect(registry.openNotebookCreation(context())).not.toEqual(draftId);
});

it('does not apply a late response over fresh creation in another epoch', () => {
    const registry=createDraftRegistry();
    const previous=registry.openNotebookCreation(context())!;
    registry.editNotebookCreation(previous,{name:'Old notes'});
    registry.beginNotebookCreation(previous,context());
    const fresh=registry.startFreshNotebookCreation(context(2))!;
    registry.settleNotebookCreation(previous,{notebookId:'late'},context(2));
    expect(registry.getNotebookCreationSnapshot().active?.id).toEqual(fresh);
    expect(registry.getNotebookCreationSnapshot().retained).toMatchObject([
        {id:previous,retired:true,creation:{name:'Old notes',status:'unknown'}},
    ]);
    expect(registry.hasUnsaved()).toBe(true);
    registry.editNotebookCreation(fresh,{name:'Current notes'});
    registry.beginNotebookCreation(fresh,context(2));
    registry.settleNotebookCreation(fresh,{notebookId:'  '},context(2));
    expect(registry.getNotebookCreationSnapshot().active?.creation.status).toBe('unknown');
});

it('revalidates a captured route intent after edit and only restores focus when cancelling its own intent', async () => {
    const registry=createDraftRegistry(), nav=createNavigationController(registry), focus=vi.fn();
    const next={destination:'/notebooks',opener:{focus} as unknown as HTMLElement};
    nav.activate(id);
    expect(nav.requestNavigation(next)).toBe('allow');
    registry.update(id,{question:'pending draft'});
    expect(nav.requestNavigation(next)).toBe('confirm');
    const stale=nav.getSnapshot().capture;
    registry.update(id,{question:'changed again'});
    expect(nav.confirm(stale)).toBeNull();
    expect(nav.requestNavigation(next)).toBe('confirm');
    nav.cancel(stale);
    expect(nav.getSnapshot().status).toBe('confirm');
    nav.cancel();
    await Promise.resolve();
    expect(focus).toHaveBeenCalledOnce();
    expect(nav.requestNavigation(next)).toBe('confirm');
    expect(nav.confirm()).toEqual(next);
    expect(nav.getSnapshot().status).toBeNull();
});

it('distinguishes waiting for a save, retention, and hard reload', () => {
    const registry=createDraftRegistry(), nav=createNavigationController(registry), reload=vi.fn();
    nav.activate(id);
    expect(nav.requestUpdate(reload)).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
    registry.update(id,{editor:{...draft(),saveResult:'unknown'}});
    expect(nav.requestNavigation({destination:'/next'})).toBe('blocked');
    expect(nav.confirm()).toBeNull();
    expect(nav.requestUpdate(reload)).toBe(false);
    nav.deactivate(id);
    const creation=registry.openNotebookCreation(context())!;
    registry.editNotebookCreation(creation,{name:'New notes'});
    registry.beginNotebookCreation(creation,context());
    nav.activate(creation);
    expect(nav.requestNavigation({destination:'/next'})).toBe('retain');
    expect(nav.requestUpdate(reload)).toBe(false);
    expect(nav.confirm()).toEqual({destination:'/next'});
    expect(reload).toHaveBeenCalledOnce();
});

it('holds an unsaved resource until its last owner releases and invalidates captured navigation on edits', () => {
    const registry=createDraftRegistry(), nav=createNavigationController(registry);
    const resource=registry.advanced.open(context())!;
    registry.advanced.edit(resource,{mode:'all'});
    const releaseFirst=nav.holdResource(resource), releaseLast=nav.holdResource(resource);
    expect(nav.requestNavigation({destination:'/next'})).toBe('confirm');
    const before=nav.getSnapshot().capture;
    registry.advanced.edit(resource,{include_notes:false});
    expect(nav.confirm(before)).toBeNull();
    // Re-open unsaved work to ensure the owner lease, not just the focused pane, guards navigation.
    registry.advanced.edit(resource,{mode:'all'});
    releaseFirst();
    expect(nav.requestNavigation({destination:'/next'})).toBe('confirm');
    expect(nav.confirm()).toEqual({destination:'/next'});
    releaseLast();
    expect(nav.requestNavigation({destination:'/next'})).toBe('allow');
});
