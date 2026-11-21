import { expect, it } from 'vitest';
import { sessionCoordinator } from '@study/web-transport';
import { sourceContext } from '../../test/source-fixtures';
import { createSourceOperations } from './source-operations';

it('continues only proven-unsent captures after suspension, including an explicitly not-dispatched result', async () => {
    const c = sourceContext(), g = sessionCoordinator.current(), store = createSourceOperations(() => {});
    const id = await store.captureUpload('n', new File(['x'], 'x.txt'), c, g);
    const first = store.begin(id, c, g)!;
    store.settle(id, first.operation.token!, { kind: 'not-sent' }, c, g + 1);
    expect(store.get(id)?.operation.state).toBe('idle');
    const next = store.begin(id, c, g + 1)!;
    expect(next.operation.token?.sessionGeneration).toBe(g + 1);
    expect(store.get(id)?.notebookId).toBe('n');
});
