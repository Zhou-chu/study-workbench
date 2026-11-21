import { beforeEach, expect, it } from 'vitest';
import { invalidateTurnContext, publishTurnTarget, readTurnContext, type RequestSpec, type WebTransport } from '@study/web-transport';
import { createNotebookApi } from './notebook-api';
import { notebookRows, json } from '../test/notebook-fixtures';
const target = { mode: 'legacy_password' as const, apiBase: 'http://localhost:3000/api', protocol: null };
beforeEach(() => { invalidateTurnContext(); publishTurnTarget(target, true); });
function harness(reply: (request: RequestSpec) => Response | Promise<Response>) { const requests: RequestSpec[] = []; const transport: WebTransport = { send: async (request) => { requests.push(request); return reply(request); } }; return { api: createNotebookApi(transport), requests }; }
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
