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

function googleHistory(origin: 'local' | 'remote') {
    const scope = { selection_origin: origin, source_version_ids: origin === 'local' ? ['v'] : [], remote_source_ids: origin === 'remote' ? ['r'] : [], remote_notebook_id: 'rn' };
    const before: TurnView = { ...pending, engine: 'notebooklm', scope_snapshot: scope };
    const resolved = { ...scope, engine: 'notebooklm', source_version_ids: ['v'], remote_source_ids: ['r'], scope_hash: 'resolved', mappings: [{ source_link_id: 'link', source_version_id: 'v', remote_source_id: 'r', mapping_method: 'upload_hash', last_checked_at: null }] };
    const after: TurnView = { ...before, status: 'succeeded', answer: 'Mapped Google answer', scope_snapshot: resolved };
    return { before, after, scope, resolved };
}
it.each(['local', 'remote'] as const)('updates Google %s mapping enrichment in place before a following message', origin => {
    const { before, after, scope } = googleHistory(origin), following = { turn_id: 'following', answer: 'Following' };
    expect(mergeTurnHistory([before, following], [after], [before])).toEqual([after, following]);
    expect(before.scope_snapshot).toEqual(scope);
    expect(before.answer).toBeNull();
});
it.each(['local', 'remote'] as const)('preserves conflicting or unknown Google %s enrichment instead of hiding the old row', origin => {
    const { before, after, scope, resolved } = googleHistory(origin);
    const selectedKey = origin === 'local' ? 'source_version_ids' : 'remote_source_ids';
    const conflicts: TurnView[] = [
        { ...after, scope_snapshot: { ...resolved, [selectedKey]: ['different'] } },
        { ...after, scope_snapshot: { ...resolved, remote_notebook_id: 'different' } },
        { ...after, scope_snapshot: { ...resolved, selection_origin: origin === 'local' ? 'remote' : 'local' } },
        { ...after, scope_snapshot: { ...resolved, mappings: [] } },
        { ...after, scope_snapshot: { ...resolved, mappings: [{ ...resolved.mappings[0], remote_source_id: 'foreign' }] } },
        { ...after, scope_snapshot: { ...resolved, mappings: [{ projection_status: 'unknown' }] } },
        { ...after, scope_snapshot: { ...resolved, engine: 'independent' } },
    ];
    for (const conflict of conflicts) expect(mergeTurnHistory([before], [conflict])).toEqual([before, conflict]);
    const alreadyPopulated = { ...before, scope_snapshot: { ...scope, [origin === 'local' ? 'remote_source_ids' : 'source_version_ids']: ['conflicting-original'] } };
    expect(mergeTurnHistory([alreadyPopulated], [after])).toEqual([alreadyPopulated, after]);
});

it('accepts partial remote-to-local mappings without changing the selected remote IDs', () => {
    const { before, after, scope, resolved } = googleHistory('remote');
    const old = { ...before, scope_snapshot: { ...scope, remote_source_ids: ['r', 'r-unmapped'] } };
    const done = { ...after, scope_snapshot: { ...resolved, remote_source_ids: ['r', 'r-unmapped'], mappings: [...resolved.mappings, { source_link_id: 'metadata-only', remote_source_id: 'r-unmapped', source_version_id: null, mapping_method: null, last_checked_at: null }] } };
    const following = { turn_id: 'following' };
    expect(mergeTurnHistory([old, following], [done])).toEqual([done, following]);
});
it('accepts producer-deduplicated remote IDs for multiple selected local mappings', () => {
    const { before, after, scope, resolved } = googleHistory('local');
    const old = { ...before, scope_snapshot: { ...scope, source_version_ids: ['v', 'v2'] } };
    const done = { ...after, scope_snapshot: { ...resolved, source_version_ids: ['v', 'v2'], mappings: [...resolved.mappings, { ...resolved.mappings[0]!, source_link_id: 'second-link', source_version_id: 'v2' }] } };
    const following = { turn_id: 'following' };
    expect(mergeTurnHistory([old, following], [done])).toEqual([done, following]);
});
