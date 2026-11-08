import { expect, it, vi } from 'vitest';
import { createLibraryApi, parseLibrarySource } from './library-api';
import { sourceContext } from '../test/source-fixtures';
import { legacySource, sourceDetail } from '../test/library-fixtures';
import { json } from '../test/notebook-fixtures';
import { sessionCoordinator, type RequestSpec } from '@study/web-transport';
it('parses nullable producer fields without exposing server paths or inventing evidence', () => {
    const row = parseLibrarySource({ ...sourceDetail, title: null, topics: null, full_text: null, notebooks: null, command_id: null, processing_info: { submission_unknown: true } }, true);
    expect(row).toMatchObject({ title: null, topics: null, full_text: null, notebooks: null, submissionUnknown: true, asset: { hasFile: true } });
    expect(JSON.stringify(row)).not.toContain('/private/');
    expect(row).not.toHaveProperty('versions');
});
it('narrows metadata PUT and preserves complete opaque source identity', async () => {
    const c = sourceContext(), sent: RequestSpec[] = [], api = createLibraryApi({ send: async (r) => { sent.push(r); return json(sourceDetail); } });
    await api.sources.update(legacySource.id, { title: 'Changed', topics: [], content: 'forbidden' } as {
        title: string;
        topics: string[];
    }, c, 'one');
    expect(sent[0]).toMatchObject({ method: 'PUT', path: '/sources/source%3Aalpha%3Afull' });
    expect(JSON.parse(String(sent[0]!.body))).toEqual({ title: 'Changed', topics: [] });
});
it('uses the exact retained File in multipart without a filesystem path or a manual content-type', async () => {
    const c = sourceContext(), sent: RequestSpec[] = [], file = new File(['body'], 'paper.txt'), api = createLibraryApi({ send: async (r) => { sent.push(r); return json(sourceDetail); } });
    await api.sources.create({ type: 'upload', file, notebooks: [], transformations: [], embed: false }, c, 'one');
    const body = sent[0]!.body as FormData;
    expect(body.get('file')).toBe(file);
    expect(body.get('notebooks')).toBe('[]');
    expect(body.has('notebook_id')).toBe(false);
    expect(body.has('file_path')).toBe(false);
    expect(body.get('async_processing')).toBe('true');
    expect(body.get('embed')).toBe('false');
});
it.each([false, true])('retains submission-unknown classification with optional real IDs (%s)', async (ids) => {
    const api = createLibraryApi({ send: async () => json({ detail: { code: 'COMMAND_SUBMISSION_UNKNOWN', retry_safe: false, ...(ids ? { resource_id: 'source:known', command_id: 'command:known' } : {}) } }, 409) }), c = sourceContext();
    await expect(api.sources.create({ type: 'text', content: 'body', notebooks: [], transformations: [], embed: false }, c, 'one')).rejects.toMatchObject({ kind: 'unknown', resourceId: ids ? 'source:known' : undefined, commandId: ids ? 'command:known' : undefined });
});
it('fences a delayed JSON body across session generation changes', async () => {
    const c = sourceContext();
    let finish!: (v: unknown) => void;
    const response = json(sourceDetail);
    vi.spyOn(response, 'json').mockImplementation(() => new Promise(resolve => finish = resolve));
    const api = createLibraryApi({ send: async () => response }), promise = api.sources.get(legacySource.id, c);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    sessionCoordinator.confirmed();
    finish(sourceDetail);
    await expect(promise).rejects.toMatchObject({ kind: 'retired' });
});
it('rejects a mismatching insight parent and exact command identity', async () => {
    const c = sourceContext(), api = createLibraryApi({ send: async (r) => r.path.includes('/insights') ? json([{ id: 'source_insight:x', source_id: 'source:other', insight_type: 'x', content: 'x', created: null, updated: null }]) : json({ job_id: 'command:other', status: 'completed' }) });
    await expect(api.insights.list(legacySource.id, c)).rejects.toMatchObject({ kind: 'invalid' });
    await expect(api.command('command:expected', c)).rejects.toMatchObject({ kind: 'invalid' });
});
it('does not convert HTTP read errors into an empty list', async () => {
    const api = createLibraryApi({ send: async () => json({ detail: 'failure' }, 503) });
    await expect(api.sources.list({ limit: 30 }, sourceContext())).rejects.toMatchObject({ kind: 'unknown' });
});
