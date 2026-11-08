import type { TurnView } from '@study/contracts';
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function hasUnknown(value: unknown): boolean {
    return Array.isArray(value) ? value.some(hasUnknown) : record(value) && (Object.hasOwn(value, 'projection_status') || Object.values(value).some(hasUnknown));
}
function sameValue(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, i) => sameValue(value, b[i]));
    if (!record(a) || !record(b)) return false;
    return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.hasOwn(b, key) && sameValue(a[key], b[key]));
}
function sameIdentity(a: TurnView, b: TurnView): boolean {
    return !hasUnknown(a) && !hasUnknown(b) && (['turn_id', 'notebook_id', 'chat_session_id', 'engine', 'message'] as const).every(key => typeof a[key] === 'string' && a[key]!.trim().length > 0 && a[key] === b[key]) && sameValue(a.idempotency_key, b.idempotency_key);
}
/** Only the producer's empty in-flight row may be replaced by its completed form.
 * Conflicting, incomplete-identity and unknown projections stay visible. This is display merging, never recovery proof. */
function completes(before: TurnView, after: TurnView): boolean {
    const state = before.status ?? before.state;
    if (!sameIdentity(before, after) || !['queued', 'running', 'waiting_remote'].includes(String(state)) || (before.status !== undefined && before.state !== undefined && before.status !== before.state) || before.generation_status !== undefined && before.generation_status !== state) return false;
    if (after.status !== 'succeeded' || after.state !== undefined && after.state !== 'succeeded' || after.generation_status !== undefined && after.generation_status !== 'succeeded' || typeof after.answer !== 'string' || !after.answer.trim()) return false;
    if (before.answer != null && before.answer !== '' || before.error != null || before.citations != null && (!Array.isArray(before.citations) || before.citations.length > 0) || before.evidence_ids != null && (!Array.isArray(before.evidence_ids) || before.evidence_ids.length > 0)) return false;
    const oldScope = before.scope_snapshot, newScope = after.scope_snapshot;
    if (!record(oldScope) || !record(newScope) || !['selection_origin', 'source_version_ids', 'remote_source_ids', 'remote_notebook_id'].every(key => Object.hasOwn(oldScope, key) && Object.hasOwn(newScope, key) && sameValue(oldScope[key], newScope[key]))) return false;
    if (!Object.keys(oldScope).every(key => Object.hasOwn(newScope, key) && sameValue(oldScope[key], newScope[key]))) return false;
    const evolving = new Set(['status', 'state', 'generation_status', 'answer', 'citations', 'evidence_ids', 'completed_at', 'scope_snapshot']);
    return Object.entries(before).every(([key, value]) => evolving.has(key) || sameValue(value, (after as Record<string, unknown>)[key]));
}
export function mergeTurnHistory(...groups: readonly (readonly TurnView[])[]): readonly TurnView[] {
    const rows: TurnView[] = [];
    for (const turn of groups.flat()) {
        const match = rows.findIndex(old => sameIdentity(old, turn) && (sameValue(old, turn) || completes(old, turn) || completes(turn, old)));
        if (match < 0) rows.push(turn);
        else if (completes(rows[match]!, turn)) rows[match] = turn;
    }
    return rows;
}
