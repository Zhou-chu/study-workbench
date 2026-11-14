import { expect, it } from 'vitest';
import type { TurnView } from '@study/contracts';
import liveRecovery from '../../../../../packages/domain/src/fixtures/live-turn-recovery';
import { createStudioStore } from './studio-store';
import { parseScope } from '../../data/studio-api';
import { sourceContext } from '../../test/source-fixtures';
import { sessionCoordinator } from '@study/web-transport';
it('captures the real persisted answer as a note draft without dropping scope metadata', () => {
    const c = sourceContext(), g = sessionCoordinator.current(), store = createStudioStore(() => {});
    const turn = structuredClone(liveRecovery.history[0]!) as unknown as TurnView;
    const id = store.captureTurn(turn.notebook_id as string, turn, c, g, 'live-answer')!;
    expect(id).toBeTruthy();
    expect(store.get(id)?.editor.base.scope_snapshot).toEqual(turn.scope_snapshot);
    expect(store.get(id)?.editor.base.citations).toEqual(turn.citations);
});
it.each([0, 1, Number.MAX_SAFE_INTEGER])('preserves valid mapping version %s', value => {
    expect(parseScope({ source_version_ids: ['v1'], mapping_version: value })).toEqual({ source_version_ids: ['v1'], mapping_version: value });
});
it.each([null, undefined, '1', -1, 1.5, Number.MAX_SAFE_INTEGER + 1, { projection_status: 'unknown' }])('rejects present invalid mapping version %j', value => {
    expect(() => parseScope({ source_version_ids: ['v1'], mapping_version: value })).toThrow();
});
it('still rejects other unknown scope metadata', () => {
    expect(() => parseScope({ source_version_ids: ['v1'], mapping_version: 1, future: true })).toThrow();
});
