import { expect, it, beforeEach } from 'vitest';
import { createDraftRegistry, createNavigationController } from '../../app/drafts';
import { sourceContext } from '../../test/source-fixtures';
import { readTurnContext } from '@study/web-transport';
import { configuredModels } from '../../test/configuration-fixtures';
beforeEach(() => sourceContext());
it('B9e acquires a single current models owner without selecting forms or navigation', () => {
    const d = createDraftRegistry(), s = d.configuration, c = readTurnContext()!, n = createNavigationController(d);
    expect(s).toHaveProperty('acquireModels');
    const a = s.acquireModels(c)!;
    expect(s.acquireModels(c)?.id).toBe(a.id);
    expect(s.getSnapshot()).toHaveLength(1);
    expect(n.requestNavigation({ destination: '/sources' })).toBe('allow');
    expect(s.open('models', c)).toBe(a.id);
    const revision = s.loading(a.id, 'models')!;
    s.publish(a.id, 'models', revision, configuredModels);
    expect(a.read()?.sources.models?.phase).toBe('ready');
    expect(s.acquireModels(c)?.read()?.data.models).toEqual(configuredModels);
});
