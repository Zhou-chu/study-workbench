import { expect, it, vi } from 'vitest';
import { sessionCoordinator } from '@study/web-transport';
import { createLibraryApi } from './library-api';
import { sourceContext } from '../test/source-fixtures';
import { legacySource, sourceDetail } from '../test/library-fixtures';
import { json } from '../test/notebook-fixtures';
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
