import { expect, it } from 'vitest';
import { selection } from '../../test/source-fixtures';
import { includeImported, latestEligibleVersionIds, selectionFromView } from './source-selection';

it('explicit inclusion preserves reading and rejects more than twenty without truncation', () => { expect(includeImported(selection, ['v-new'])).toEqual({ ...selection, source_version_ids: ['v-old', 'v-new'] }); expect(() => includeImported({ ...selection, source_version_ids: Array.from({ length: 20 }, (_, i) => String(i)) }, ['new'])).toThrow(); expect(selectionFromView({ engine: 'future', selection_origin: 'local', source_version_ids: [], remote_source_ids: [] })).toBeNull(); });

const version = (id: string, created_at?: string) => ({ source_version_id: id, created_at });
const source = (id: string, versions: ReturnType<typeof version>[]) => ({ source_id: id, versions });

it('orders eligible versions by instant rather than wire order or ingestion state, in displayed source order', () => {
    const rows = [
        source('sB', [version('vB', '2026-11-08')]),
        { ...source('sA', [version('v-old', '2026-11-08T09:00:00+02:00')]), versions: [
            version('v-old', '2026-11-08T09:00:00+02:00'),
            { ...version('vA', '2026-11-08T08:00:00Z'), status: 'pending' },
            { ...version('ignored', '2026-11-09'), projection_status: 'invalid' as const },
        ] },
        { ...source('invalid-source', [version('ignored-source-version', '2026-11-09')]), projection_status: 'unknown' as const },
        source('classic', []),
    ];
    expect(latestEligibleVersionIds(rows)).toEqual(['vB', 'vA']);
    expect(latestEligibleVersionIds(rows.map(row => ({ ...row, versions: [...row.versions].reverse() })))).toEqual(['vB', 'vA']);
});

it.each([
    [version('undated')],
    [version('valid', '2026-11-08'), version('missing-date')],
    [version('valid', '2026-11-08'), version('broken-day', '2026-02-30')],
    [version('valid', '2026-11-08'), version('local-time', '2026-11-09T10:00:00')],
    [version('same', '2026-11-08T10:00:00Z'), version('tied', '2026-11-08T11:00:00+01:00')],
    [version('duplicate', '2026-11-08'), version('duplicate', '2026-11-09')],
    [version('  ', '2026-11-08')],
].map(versions => ({ versions })))('does not guess current identity from incomplete, duplicate or tied versions: $versions', ({ versions }) => {
    expect(latestEligibleVersionIds([source('ambiguous', versions)])).toEqual([]);
});
