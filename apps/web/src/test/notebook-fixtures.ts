import type { NotebookSummary } from '../data/notebook-api';
import { syntheticWorkspace } from './fixtures';
/** Synthetic only: literal existing API DTO names and timestamps. */
export const notebookRows: NotebookSummary[] = [
    { id: 'notebook:alpha', name: 'Alpha feedback', description: 'A synthetic study', archived: false, created: '2026-10-01T10:11:12+00:00', updated: '2026-11-08T01:02:03+00:00', source_count: 4, note_count: 2 },
    { id: 'notebook:beta', name: 'Beta systems', description: '', archived: false, created: '2026-09-01', updated: '2026-11-07', source_count: 1, note_count: 0 },
    { id: 'notebook:archive', name: 'Archived material', description: 'Kept', archived: true, created: '2025-01-01', updated: '2025-02-01', source_count: 1, note_count: 1 }
];
export function notebookWorkspace(id = 'notebook:alpha') {
    return { ...structuredClone(syntheticWorkspace), notebook: { id, name: id === 'notebook:alpha' ? 'Alpha feedback' : id }, sources: [
            { source_id: 'source:raw', title: 'Raw original', versions: [{ source_version_id: 'version:raw', origin: 'upload', created_at: '2026-11-01' }] },
            { source_id: 'source:web', title: 'Web snapshot', versions: [{ source_version_id: 'version:web', origin: 'web_snapshot', provenance: { kind: 'web', source_url: 'https://example.invalid/synthetic' } }] },
            { source_id: 'source:derived', title: 'Derived note', versions: [{ source_version_id: 'version:derived', origin: 'derived_snapshot', provenance: { kind: 'derived', origin_id: 'note:synthetic' } }] },
            { source_id: 'source:classic', title: 'Classic without versions', versions: [] }
        ] };
}
export function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }); }
