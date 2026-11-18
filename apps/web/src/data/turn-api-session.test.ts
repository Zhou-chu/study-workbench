import { expect, it, vi } from 'vitest';
import { sessionCoordinator } from '@study/web-transport';
import { createTurnApi } from './turn-api';
import { sourceContext } from '../test/source-fixtures';
import { json } from '../test/notebook-fixtures';
it('rejects a late read after generation changes even when target epoch is unchanged', async () => {
    let resolve!: (r: Response) => void;
    const send = vi.fn(() => new Promise<Response>(r => { resolve = r; }));
    const api = createTurnApi({ send });
    const p = api.list('c', sourceContext());
    sessionCoordinator.begin();
    resolve(json([]));
    await expect(p).rejects.toMatchObject({ kind: 'retired' });
});
