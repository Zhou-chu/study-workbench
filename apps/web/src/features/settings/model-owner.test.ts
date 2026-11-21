import { expect, it, beforeEach } from 'vitest';
import { createDraftRegistry } from '../../app/drafts';
import { sourceContext } from '../../test/source-fixtures';
import { readTurnContext } from '@study/web-transport';
import { configuredModels } from '../../test/configuration-fixtures';
beforeEach(() => sourceContext());
it('B9e preserves selected historical forms while fresh explicitly reuses the metadata owner', () => {
    const d = createDraftRegistry(), s = d.configuration, c = readTurnContext()!;
    const old = s.open('models', c)!;
    s.retire(c.epoch);
    const next = sourceContext();
    expect(s).toHaveProperty('acquireModels');
    const current = s.acquireModels(next)!;
    expect(current.id).not.toBe(old);
    expect(s.open('models', next)).toBe(old);
    expect(s.fresh(old, next)).toBe(current.id);
    expect(s.open('models', next)).toBe(current.id);
    expect(s.get(old)?.retired).toBe(true);
});
it('B9e publication uses the existing F52 visible fingerprint and monotonically invalidates equal and A-B-A values', () => {
    const s = createDraftRegistry().configuration, c = readTurnContext()!;
    expect(s).toHaveProperty('acquireModels');
    const h = s.acquireModels(c)!;
    const versions: number[] = [];
    for (const value of [configuredModels, configuredModels, [], configuredModels, null]) {
        const rev = h.loading(c)!;
        versions.push(h.read()!.metadataRevision);
        h.publish(rev, value, c);
        versions.push(h.read()!.metadataRevision);
        expect(s.getSnapshot().find(r => r.id === h.id)?.metadataRevision).toBe(versions.at(-1));
    }
    expect(new Set(versions).size).toBe(versions.length);
    expect(h.read()?.sources.models?.phase).toBe('error');
    expect(h.read()?.data.models).toEqual(configuredModels);
    s.retire(c.epoch);
    expect(h.loading(c)).toBeNull();
});
it('B9e model handle exposes only the one models source, never a selected form or unrelated metadata', () => {
    const s = createDraftRegistry().configuration, c = readTurnContext()!;
    const h = s.acquireModels(c)!, v = h.read()!;
    expect(Object.keys(v).sort()).toEqual(['context', 'data', 'id', 'metadataRevision', 'retired', 'sources']);
    expect(Object.keys(v.data)).toEqual([]);
    expect(Object.keys(h).sort()).toEqual(['context', 'id', 'loading', 'publish', 'read']);
});
