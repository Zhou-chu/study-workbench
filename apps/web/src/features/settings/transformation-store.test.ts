import { beforeEach, expect, it } from 'vitest';
import { createDraftRegistry, createNavigationController } from '../../app/drafts';
import { readTurnContext } from '@study/web-transport';
import { sourceContext } from '../../test/source-fixtures';
import { transformationFixture as fixture } from '../../test/transformation-fixtures';
import { configuredModels } from '../../test/configuration-fixtures';
beforeEach(() => sourceContext());
function setup() {
    const d = createDraftRegistry(), s = d.transformations, c = readTurnContext()!, id = s.open(c)!;
    const list = s.loading(id, 'list')!;
    s.publishList(id, list.revision, [fixture]);
    const instructions = s.loading(id, 'instructions')!;
    s.publishInstructions(id, instructions, 'Global');
    s.playground(id, { transformationId: fixture.id, modelId: 'model:chat', input: 'Original' });
    const model = Object.freeze({ ownerId: 'configuration:synthetic', metadataRevision: 1, sourceRevision: 1, model: configuredModels[0]! });
    const intent = { kind: 'execute' as const, input: { transformation_id: fixture.id, model_id: 'model:chat', input_text: 'Original' }, title: fixture.title };
    return { d, s, c, id, model, intent };
}
it('cannot replay the same original token after a confirmed result', () => {
    const { s, c, id, model, intent } = setup(), token = s.capture(id, intent, c, 1, 1, model)!;
    expect(s.begin(token, c, 1, 1, model)).toBe(true);
    s.settle(token, 'confirmed', c, 1, { output: 'Result', transformation_id: fixture.id, model_id: 'model:chat' });
    expect(s.begin(token, c, 1, 1, model)).toBe(false);
    expect(s.get(id)?.attempts).toHaveLength(1);
});
it('cannot replay an original token even with definitely-unsent evidence; a fresh explicit intent is required', () => {
    const { s, c, id, model, intent } = setup(), token = s.capture(id, intent, c, 1, 1, model)!;
    expect(s.begin(token, c, 1, 1, model)).toBe(true);
    s.settle(token, 'not-sent', c, 1);
    expect(s.begin(token, c, 1, 1, model)).toBe(false);
    const fresh = s.capture(id, intent, c, 1, 1, model)!;
    expect(fresh.id).not.toBe(token.id);
    expect(s.begin(fresh, c, 1, 1, model)).toBe(true);
});
it('does not stamp current revisions on an intent constructed from stale input or instructions', () => {
    const { s, c, id, model, intent } = setup();
    s.playground(id, { input: 'New' });
    expect(s.capture(id, intent, c, 1, 1, model)).toBeNull();
    s.instructions(id, 'Changed');
    expect(s.capture(id, { kind: 'instructions', value: 'Old' }, c, 1, 1, null)).toBeNull();
});
it('does not bind stale create/update bodies to current editor revisions', () => {
    const { s, c, id } = setup();
    s.editor(id, null);
    s.edit(id, { name: 'n', title: 'T', prompt: 'P' });
    const editor = s.get(id)!.editor!;
    const stale = { ...editor.fields };
    s.edit(id, { prompt: 'New' });
    expect(s.capture(id, { kind: 'create', editorId: editor.id, input: stale }, c, 1, 1, null)).toBeNull();
    s.discardEditor(id);
    s.editor(id, fixture.id);
    const current = s.get(id)!.editor!;
    s.detail(id, current.id, fixture);
    s.edit(id, { description: 'New' });
    expect(s.capture(id, { kind: 'update', editorId: current.id, target: fixture.id, input: { description: 'Old' } }, c, 1, 1, null)).toBeNull();
});
it('registers transformation dirty and unknown state in both navigation lookups without weakening retrieval dirty', () => {
    const { d, s, c, id, model, intent } = setup(), n = createNavigationController(d);
    const release = n.holdResource(id);
    expect(n.requestNavigation({ destination: '/settings' })).toBe('confirm');
    release();
    n.activateResource(id);
    expect(n.requestNavigation({ destination: '/settings' })).toBe('confirm');
    expect(d.hasUnsaved()).toBe(true);
    const settings = d.settings.open('n', c, 1);
    d.settings.retrieval(settings, state => ({ ...state, dirty: true }));
    n.holdResource(settings);
    const token = s.capture(id, intent, c, 1, 1, model)!;
    s.begin(token, c, 1, 1, model);
    s.settle(token, 'unknown', c, 1);
    expect(n.requestNavigation({ destination: '/settings' })).toBe('retain');
    d.retireContext(c.epoch);
    expect(s.get(id)?.attempts[0]?.phase).toBe('unknown');
    expect(s.get(id)?.playground.input).toBe('Original');
    expect(d.settings.get(settings)?.retrieval.dirty).toBe(true);
});
it('preserves independent instructions and execute pending identities without allowing a disposable editor to bypass unknown', () => {
    const { s, c, id, model, intent } = setup();
    s.instructions(id, 'Changed');
    const a = s.capture(id, { kind: 'instructions', value: 'Changed' }, c, 1, 1, null)!, b = s.capture(id, intent, c, 1, 1, model)!;
    expect(a.resourceId).not.toBe(b.resourceId);
    s.begin(a, c, 1, 1, null);
    s.begin(b, c, 1, 1, model);
    expect(s.get(id)?.attempts).toHaveLength(2);
    s.settle(a, 'unknown', c, 1);
    s.settle(b, 'unknown', c, 1);
    expect(s.capture(id, intent, c, 1, 1, model)).toBeNull();
    expect(s.capture(id, { kind: 'instructions', value: 'Changed' }, c, 1, 1, null)).toBeNull();
    expect(Object.isFrozen(b.intent)).toBe(true);
    expect(Object.isFrozen(b.intent.kind === 'execute' && b.intent.input)).toBe(true);
});
it('a delayed initial instructions read advances the baseline without erasing edits, so later clearing remains dirty', () => {
    const d = createDraftRegistry(), s = d.transformations, c = readTurnContext()!, id = s.open(c)!;
    const read = s.loading(id, 'instructions')!;
    s.instructions(id, 'Typed before read');
    s.publishInstructions(id, read, 'Saved server instructions');
    expect(s.get(id)?.instructions).toMatchObject({ value: 'Typed before read', baseline: 'Saved server instructions' });
    s.instructions(id, '');
    expect(s.get(id)?.dirty).toBe(true);
});

it.each(['loading', 'error', 'equal'] as const)('invalidates original instruction confirmation after %s read state', phase => {
    const {s,c,id}=setup();
    s.instructions(id,'Edited');
    const token=s.capture(id,{kind:'instructions',value:'Edited'},c,1,1,null)!;
    expect(s.canBegin(token,c,1,1,null)).toBe(true);
    const read=s.loading(id,'instructions')!;
    if(phase!=='loading')s.publishInstructions(id,read,phase==='error'?null:'Global');
    expect(s.canBegin(token,c,1,1,null)).toBe(false);
    expect(s.get(id)?.instructions.value).toBe('Edited');
});
