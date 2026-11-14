import { expect, it, vi } from 'vitest';
import { createTurnApi } from './turn-api';
import { sourceContext } from '../test/source-fixtures';
import { json } from '../test/notebook-fixtures';
import { sessionCoordinator, type RequestSpec } from '@study/web-transport';
const request = { task: 'question' as const, notebook_id: 'n', engine: 'independent' as const, selection_origin: 'local' as const, source_version_ids: ['v'], remote_source_ids: [], message: 'Q', idempotency_key: 'key' };
it('preserves real HTTP status and exact receipt validity instead of projecting away extra keys', async () => {
    const receipt = { dispatch_ack: 'unknown', job_id: 'parent', turn_id: 'turn', retry_safe: false };
    const send = vi.fn(async () => json({ detail: 'WORKER_UNAVAILABLE', dispatch_receipt: receipt }, 400));
    const api = createTurnApi({ send });
    const c = sourceContext();
    expect(await api.submit('v1_n', request, c)).toMatchObject({ kind: 'bound', dispatchUnknown: true, jobId: 'parent' });
    send.mockImplementation(async () => json({ detail: 'WORKER_UNAVAILABLE', dispatch_receipt: { ...receipt, extra: true } }, 400));
    expect(await api.submit('v1_n', request, c)).toEqual({ kind: 'unknown', reason: 'receipt' });
});
it('encodes session identities once and projects opaque history without leaking raw error fields', async () => {
    const send = vi.fn(async (_request: RequestSpec) => json([{ turn_id: 't', answer: 'Safe', error: { secret: 'hidden' } }]));
    const api = createTurnApi({ send });
    const turns = await api.list('v1_n/a%2F', sourceContext());
    expect(send.mock.calls[0]?.[0]).toMatchObject({ path: '/personal/chats/v1_n%2Fa%252F/turns' });
    expect(JSON.stringify(turns)).not.toContain('hidden');
});
it('rejects a late read after generation changes even when target epoch is unchanged', async () => {
    let resolve!: (r: Response) => void;
    const send = vi.fn(() => new Promise<Response>(r => { resolve = r; }));
    const api = createTurnApi({ send });
    const p = api.list('c', sourceContext());
    sessionCoordinator.begin();
    resolve(json([]));
    await expect(p).rejects.toMatchObject({ kind: 'retired' });
});
