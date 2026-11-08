import { beforeEach, expect, it } from 'vitest';
import { invalidateTurnContext, publishTurnTarget, readTurnContext, type RequestSpec, type WebTransport } from '@study/web-transport';
import { createNotebookApi } from './notebook-api';
import { notebookRows, notebookWorkspace, json } from '../test/notebook-fixtures';
const target = { mode: 'legacy_password' as const, apiBase: 'http://localhost:3000/api', protocol: null };
beforeEach(() => { invalidateTurnContext(); publishTurnTarget(target, true); });
function harness(reply: (request: RequestSpec) => Response | Promise<Response>) { const requests: RequestSpec[] = []; const transport: WebTransport = { send: async (request) => { requests.push(request); return reply(request); } }; return { api: createNotebookApi(transport), requests }; }
it('uses the authorized transport and exact existing notebook list/create/recent DTO fields', async () => {
    const { api, requests } = harness(r => json(r.path.startsWith('/recently-viewed') ? [{ type: 'source', id: 'source:x', title: 'Source', last_viewed_at: '2026-11-08T01:02:03+00:00' }] : r.method === 'POST' ? notebookRows[0] : notebookRows));
    const context = readTurnContext()!;
    expect(await api.list(context)).toEqual(notebookRows);
    expect(await api.create({ name: 'Alpha feedback' }, context)).toEqual(notebookRows[0]);
    expect(await api.recent(context)).toEqual([{ type: 'source', id: 'source:x', title: 'Source', last_viewed_at: '2026-11-08T01:02:03+00:00' }]);
    expect(requests.map(r => [r.method, r.path])).toEqual([['GET', '/notebooks?order_by=updated%20desc'], ['POST', '/notebooks'], ['GET', '/recently-viewed?limit=12']]);
    expect(requests[1]?.body).toBe('{"name":"Alpha feedback"}');
    expect(requests.every(r => r.context.epoch === context.epoch)).toBe(true);
});
it('parses the A1 workspace and preserves raw/web/derived/classic/history and unknown scope without inventing versions', async () => {
    const wire = notebookWorkspace('notebook:opaque%2Fid');
    const { api, requests } = harness(() => json({ ...wire, secret: 'must disappear' }));
    const signal = new AbortController().signal;
    const result = await api.workspace('notebook:opaque%2Fid', readTurnContext()!, signal);
    expect(requests[0]?.path).toBe('/personal/notebooks/notebook%3Aopaque%252Fid/workspace-view');
    expect(requests[0]?.signal).toBe(signal);
    expect(result.sources).toHaveLength(4);
    expect(result.sources[3]).toEqual({ source_id: 'source:classic', title: 'Classic without versions', versions: [] });
    expect(result.legacy_history).toEqual(wire.legacy_history);
    expect(result.selection).toEqual(wire.selection);
    expect(result).not.toHaveProperty('secret');
});
it('records a deliberate open through the existing stamping GET, never browser document storage', async () => {
    const { api, requests } = harness(() => json(notebookRows[0]));
    await api.recordOpen('notebook:a/b', readTurnContext()!);
    expect(requests.map(r => [r.method, r.path])).toEqual([['GET', '/notebooks/notebook%3Aa%2Fb']]);
    expect(Object.keys(localStorage)).toEqual([]);
});
it('rejects malformed list, HTTP failure, malformed workspace and mismatched notebook identity rather than returning empty success', async () => {
    for (const reply of [json({}), json(notebookRows, 500), json([{ ...notebookRows[0], updated: 44 }])]) {
        const { api } = harness(() => reply);
        await expect(api.list(readTurnContext()!)).rejects.toThrow();
    }
    for (const value of [{}, notebookWorkspace('notebook:other')]) {
        const { api } = harness(() => json(value));
        await expect(api.workspace('notebook:alpha', readTurnContext()!)).rejects.toThrow();
    }
});
it('rejects stale dispatch and late JSON settlement after an epoch retirement', async () => {
    const old = readTurnContext()!;
    let finish!: (value: unknown) => void;
    const response = json([]);
    response.json = () => new Promise(resolve => { finish = resolve; });
    const { api, requests } = harness(() => response);
    const pending = api.list(old);
    void pending.catch(() => { });
    await Promise.resolve();
    invalidateTurnContext();
    if (finish)
        finish(notebookRows);
    await expect(pending).rejects.toThrow();
    await expect(api.list(old)).rejects.toThrow();
    expect(requests).toHaveLength(1);
});
