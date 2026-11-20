import { isRecord, type WorkbenchSelection, type SelectionView } from '@study/contracts';
export type SourceReadIntent = Readonly<{
    source_version_id: string;
    evidence_id?: string;
    page_index?: number;
}>;
export type SelectionIntent = WorkbenchSelection;
export function selectionFromView(value: SelectionView | null | unknown): SelectionIntent | null {
    if (!isRecord(value) || value.projection_status || !['independent', 'notebooklm'].includes(String(value.engine)) || !['local', 'remote'].includes(String(value.selection_origin)))
        return null;
    const ids = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string' && !!x) && new Set(v).size === v.length && v.length <= 20;
    if (!ids(value.source_version_ids) || !ids(value.remote_source_ids))
        return null;
    const reading = value.reading;
    if (reading !== undefined && reading !== null && (!isRecord(reading) || reading.projection_status || typeof reading.source_version_id !== 'string' || !Number.isSafeInteger(reading.page_index) || Number(reading.page_index) < 0 || reading.evidence_id !== undefined && typeof reading.evidence_id !== 'string'))
        return null;
    return { engine: value.engine as SelectionIntent['engine'], selection_origin: value.selection_origin as SelectionIntent['selection_origin'], source_version_ids: [...value.source_version_ids], remote_source_ids: [...value.remote_source_ids], ...(reading === undefined ? {} : { reading: reading === null ? null : { source_version_id: reading.source_version_id as string, page_index: reading.page_index as number, ...(reading.evidence_id === undefined ? {} : { evidence_id: reading.evidence_id as string }) } }) };
}
export function includeImported(current: SelectionIntent, ids: readonly string[]): SelectionIntent { const next = [...new Set([...current.source_version_ids, ...ids])]; if (next.length > 20 || ids.some(id => !id))
    throw new Error('Selection limit'); return { ...current, source_version_ids: next, remote_source_ids: [...current.remote_source_ids] }; }
export function sameSelection(a: SelectionIntent, b: SelectionIntent): boolean { return JSON.stringify(a) === JSON.stringify(b); }

function versionInstant(value: unknown): number {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value))
        return NaN;
    const day = value.slice(0, 10), midnight = new Date(day + 'T00:00:00Z');
    // Date.parse alone normalizes impossible calendar dates.
    return Number.isFinite(midnight.getTime()) && midnight.toISOString().slice(0, 10) === day ? Date.parse(value) : NaN;
}

function latestVersionId(versions: readonly unknown[]): string | null {
    const seen = new Set<string>();
    let latest: string | null = null, latestTime = -Infinity, tied = false;
    for (const version of versions) {
        if (isRecord(version) && version.projection_status) continue;
        if (!isRecord(version) || typeof version.source_version_id !== 'string' || !version.source_version_id.trim()) return null;
        const id = version.source_version_id, instant = versionInstant(version.created_at);
        // Do not treat stale known versions as current when another eligible row cannot be ordered.
        if (!Number.isFinite(instant) || seen.has(id)) return null;
        seen.add(id);
        if (instant > latestTime) {
            latest = id;
            latestTime = instant;
            tied = false;
        } else if (instant === latestTime) {
            tied = true;
        }
    }
    return tied ? null : latest;
}

/** Latest date-qualified version per eligible source; no inferred IDs or ordering. */
export function latestEligibleVersionIds(sources: readonly unknown[]): string[] {
    const ids = new Set<string>();
    for (const source of sources) {
        if (!isRecord(source) || source.projection_status || typeof source.source_id !== 'string' || !source.source_id.trim() || !Array.isArray(source.versions))
            continue;
        const id = latestVersionId(source.versions);
        if (id !== null) ids.add(id);
    }
    return [...ids];
}
