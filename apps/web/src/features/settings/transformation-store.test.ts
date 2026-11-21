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
