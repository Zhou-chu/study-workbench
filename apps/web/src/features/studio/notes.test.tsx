import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createStudioStore, compatibleNoteMetadata } from './studio-store';
import { NoteEditor } from './NoteEditor';
import { AppProviders } from '../../app/providers';
import { noteForEditor } from '../../data/studio-api';
import { sourceContext } from '../../test/source-fixtures';
import { sessionCoordinator } from '@study/web-transport';
const draft = { title: 'Base', content: 'Original', citations: [], scope_snapshot: { source_version_ids: ['v1'] } };
function setup(note = true) { const c = sourceContext(), g = sessionCoordinator.current(), store = createStudioStore(() => { }); const id = store.open('n', draft, c, g, note ? { id: 'note:1', revision: 7 } : undefined); return { store, id, c, g }; }
it('shows conflict and controlled draft without an automatic save or reload', () => { const { store, id, c, g } = setup(); store.edit(id, { content: 'Local' }); const a = store.beginSave(id, c, g)!; store.settleSave(id, a.operation.token!, { kind: 'conflict', status: 409 }, c, g); const save = vi.fn(); render(<AppProviders locale="en-US"><NoteEditor draft={store.get(id)!.editor} onEdit={() => { }} onSave={save} onClose={() => { }}/></AppProviders>); expect(screen.getByLabelText('Markdown note')).toHaveValue('Local'); expect(screen.getByText('This note changed elsewhere. Your draft is safe here. Compare before replacing it.')).toBeVisible(); expect(screen.getByRole('button', { name: 'Save note' })).toBeDisabled(); expect(save).not.toHaveBeenCalled(); });
it('edits nullable classic fields with partial CAS while retaining untouched null and absence', () => { const c = sourceContext(), g = sessionCoordinator.current(), store = createStudioStore(() => { }), raw = { id: 'note:classic', revision: 7, title: null, content: null }; const parsed = noteForEditor(raw)!; expect(parsed.draft).toMatchObject({ title: '', content: '' }); const id = store.open('n', parsed.draft, c, g, parsed.note, 'classic', null); expect(store.get(id)?.classic?.base).toEqual(raw); expect(store.beginSave(id, c, g)).toBeNull(); store.edit(id, { title: 'Named' }); const a = store.beginSave(id, c, g)!; expect(a.classic?.pending?.patch).toEqual({ title: 'Named', expected_revision: 7 }); store.edit(id, { content: 'Late body' }); store.settleSave(id, a.operation.token!, { kind: 'saved', note: { ...raw, revision: 8, title: 'Named' } }, c, g); expect(store.get(id)?.classic?.base?.content).toBeNull(); expect(store.get(id)?.editor).toMatchObject({ content: 'Late body', dirty: true, baseRevision: 8 }); const next = store.beginSave(id, c, g)!; expect(next.classic?.pending?.patch).toEqual({ content: 'Late body', expected_revision: 8 }); const absent = noteForEditor({ id: 'note:absent', revision: 1, title: null })!; expect(absent.note).not.toHaveProperty('content'); });
it('keeps untouched classic fields from the latest copy during explicit conflict re-edit', () => { const c = sourceContext(), g = sessionCoordinator.current(), store = createStudioStore(() => { }), raw = { id: 'note:classic', revision: 7, title: null, content: null }; const parsed = noteForEditor(raw)!; const id = store.open('n', parsed.draft, c, g, parsed.note, 'classic', null); store.edit(id, { title: 'Mine' }); const a = store.beginSave(id, c, g)!; store.settleSave(id, a.operation.token!, { kind: 'conflict', status: 409 }, c, g); store.compare(store.beginCompare(id, c, g)!, [{ ...raw, revision: 8, content: 'Server body' }], c, g); expect(store.reedit(id, store.get(id)!, c, g)).toBe(true); expect(store.get(id)?.editor.content).toBe('Server body'); expect(store.beginSave(id, c, g)?.classic?.pending?.patch).toEqual({ title: 'Mine', expected_revision: 8 }); });
it('clears only acknowledged per-field classic edits after a conflict re-edit resets the display revision', () => {
    const c = sourceContext(), g = sessionCoordinator.current(), store = createStudioStore(() => { }), raw = { id: 'note:classic', revision: 7, title: null, content: null };
    const parsed = noteForEditor(raw)!;
    const id = store.open('n', parsed.draft, c, g, parsed.note, 'classic');
    for (const title of ['M', 'My', 'Mine'])
        store.edit(id, { title });
    let a = store.beginSave(id, c, g)!;
    store.settleSave(id, a.operation.token!, { kind: 'conflict', status: 409 }, c, g);
    store.compare(store.beginCompare(id, c, g)!, [{ ...raw, revision: 8 }], c, g);
    store.reedit(id, store.get(id)!, c, g);
    a = store.beginSave(id, c, g)!;
    store.settleSave(id, a.operation.token!, { kind: 'saved', note: { ...raw, revision: 9, title: 'Mine' } }, c, g);
    expect(store.get(id)?.editor.dirty).toBe(false);
    expect(store.beginSave(id, c, g)).toBeNull();
});

import { producerScope } from '../../test/studio-fixtures';

import { parseWorkspaceView, type EvidenceCitation } from '@study/contracts';
import { producerCitationRepresentations } from '../../test/studio-fixtures';
import { sourceWorkspace } from '../../test/source-fixtures';
function conflictWithCitations(citations: EvidenceCitation[], scope = producerScope()) {
    const c = sourceContext(), g = sessionCoordinator.current(), store = createStudioStore(() => {});
    const base = { title: 'Cited base', content: 'Original body', citations, scope_snapshot: scope };
    const id = store.open('n', base, c, g, { id: 'note:1', revision: 7 });
    store.edit(id, { content: 'Retained reasoning' });
    const attempt = store.beginSave(id, c, g)!;
    store.settleSave(id, attempt.operation.token!, { kind: 'conflict', status: 409 }, c, g);
    return { store, id, c, g, base };
}


const unchangedCitation = producerCitationRepresentations().withNulls;
const strictCitationChanges: [string, Record<string, unknown>][] = [
    ['independent support false', { independent_support: false }],
    ['independent support true', { independent_support: true }],
    ['reason string', { reason: 'Restored archive evidence' }],
    ['reason empty string', { reason: '' }],
    ['remote reference object', { remote_reference: {} }],
    ['provenance object', { provenance: { kind: 'web', source_url: null, retrieved_at: '2026-11-08', provider: 'firecrawl' } }],
    ['validity', { reference_validity: 'unverified' }],
    ['kind', { kind: 'derived_snapshot' }],
    ['citation identity', { citation_id: 'different' }],
    ['evidence identity', { evidence_id: 'different' }],
    ['version identity', { source_version_id: 'different' }],
    ['source title', { source_title: 'Different title' }],
    ['quote', { quote: 'Different quote' }],
    ['locator', { locator: { ...unchangedCitation.locator, page_label: null } }],
    ['unknown citation key', { unexpected: null }],
    ['unknown citation marker', { projection_status: 'unknown' }],
    ['unknown provenance marker', { provenance: { projection_status: 'unknown' } }]
];
it.each(strictCitationChanges)('keeps %s strict despite optional-null equivalence', (_label, patch) => {
    const { store, id, c, g, base } = conflictWithCitations([unchangedCitation]);
    const raw = { id: 'note:1', revision: 8, ...base, citations: [{ ...unchangedCitation, ...patch }] };
    const view = parseWorkspaceView({ ...sourceWorkspace(), notes: [raw] }).notes[0]!;
    const parsed = noteForEditor(view);
    store.compare(store.beginCompare(id, c, g)!, parsed ? [parsed.note] : [], c, g);
    const before = store.get(id)!;
    expect(compatibleNoteMetadata(before)).toBe(false);
    expect(store.reedit(id, before, c, g)).toBe(false);
    expect(store.get(id)?.editor.base).toEqual(base);
});
