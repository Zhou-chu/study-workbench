import { expect, it } from 'vitest';
import type { TurnView } from '@study/contracts';
import { mergeTurnHistory } from './turn-history';
const pending: TurnView = { turn_id: 't', notebook_id: 'n', chat_session_id: 'v1_n', engine: 'independent', message: 'question', status: 'running', answer: null, citations: [], scope_snapshot: { engine: 'independent', selection_origin: 'local', source_version_ids: ['v'], remote_source_ids: [], remote_notebook_id: null } };
const complete: TurnView = { ...pending, status: 'succeeded', answer: 'Complete answer' };
it.each([
    { message: 'different question' }, { notebook_id: 'other' }, { chat_session_id: 'other' }, { engine: 'notebooklm' },
    { idempotency_key: 'different-key' }, { answer: 'Conflicting earlier answer' }, { status: 'succeeded', answer: 'Different completed answer' },
    { scope_snapshot: { ...pending.scope_snapshot, source_version_ids: ['other'] } }, { projection_status: 'unknown' as const },
    { citations: [{ projection_status: 'unknown' as const }] }, { turn_id: null }, { status: 'submission_unknown' }, { generation_status: 'failed' },
])('preserves a conflicting or unknown historical row: %j', patch => {
    const old: TurnView = { ...pending, ...patch };
    expect(mergeTurnHistory([old], [complete])).toEqual([old, complete]);
});
it('updates in place without regressing to stale pending data or changing its inputs', () => {
    const following = { turn_id: 'following', answer: 'Following' };
    expect(mergeTurnHistory([pending, following], [complete], [pending])).toEqual([complete, following]);
    expect(pending.answer).toBeNull();
});
