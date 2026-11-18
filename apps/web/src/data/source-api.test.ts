import { beforeEach, expect, it } from 'vitest';
import { invalidateTurnContext, readTurnContext, sessionCoordinator, type RequestSpec, type WebTransport } from '@study/web-transport';
import { createSourceApi } from './source-api';
import { json } from '../test/notebook-fixtures';
import { sourceContext, sourceWorkspace, receipt } from '../test/source-fixtures';
beforeEach(sourceContext);
function harness(reply: (r: RequestSpec) => Response | Promise<Response>) { const requests: RequestSpec[] = []; const transport: WebTransport = { send: async (r) => { requests.push(r); return reply(r); } }; return { api: createSourceApi(transport), requests }; }
it('rejects missing receipt identity and late JSON settlement after session generation changes', async () => { const { api } = harness(() => json({ ...receipt, job_id: '' })); await expect(api.upload({ notebookId: 'n', file: new File(['x'], 'x.txt'), idempotencyKey: 'k' }, readTurnContext()!)).rejects.toThrow(); let finish!: (v: unknown) => void; const response = json({}); response.json = () => new Promise(r => { finish = r; }); const delayed = harness(() => response); const pending = delayed.api.workspace('n', readTurnContext()!); await Promise.resolve(); await Promise.resolve(); sessionCoordinator.begin(); finish(sourceWorkspace()); await expect(pending).rejects.toThrow(); });
it('does not dispatch retired captures and preserves unsafe error classification across status/envelopes', async () => { const old = readTurnContext()!; invalidateTurnContext(); const h = harness(() => json(receipt)); await expect(h.api.upload({ notebookId: 'n', file: new File(['x'], 'x.txt'), idempotencyKey: 'k' }, old)).rejects.toThrow(); expect(h.requests).toHaveLength(0); sourceContext(); for (const status of [400, 409, 422, 500]) {
    const a = harness(() => json({ detail: { code: 'UPLOAD_COMMIT_UNKNOWN', retry_safe: false } }, status));
    await expect(a.api.upload({ notebookId: 'n', file: new File(['x'], 'x.txt'), idempotencyKey: 'k' }, readTurnContext()!)).rejects.toMatchObject({ code: 'UPLOAD_COMMIT_UNKNOWN' });
} });
