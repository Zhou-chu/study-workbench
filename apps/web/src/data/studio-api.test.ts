import { expect, it } from 'vitest';
import { parseWorkbenchNote, parseScope, parseStudioJob, createStudioApi, noteForEditor } from './studio-api';
it('accepts and preserves only the exact legacy empty note scope sentinel', () => { expect(parseWorkbenchNote({ id: 'note:1', revision: 1, title: 'T', content: 'C', citations: [], scope_snapshot: {} }).scope_snapshot).toEqual({}); expect(() => parseScope({})).toThrow(); expect(() => parseWorkbenchNote({ id: 'note:1', revision: 1, scope_snapshot: { unexpected: true } })).toThrow(); });
import type { CreateWorkbenchNoteInput, ScopeSnapshot } from '@study/contracts';
import { sourceContext } from '../test/source-fixtures';
import { json } from '../test/notebook-fixtures';
it('keeps the note-only sentinel out of strict scope DTOs at compile time', () => {
    const note: CreateWorkbenchNoteInput = { title: 'T', content: 'C', citations: [], scope_snapshot: {} };
    expect(note.scope_snapshot).toEqual({});
    // @ts-expect-error A note-only legacy sentinel is not a turn/promotion scope.
    const scope: ScopeSnapshot = {};
    expect(scope).toEqual({});
});
it('accepts the actual read-only download success without claiming a remote-write ACK', () => { const a = { artifact_id: 'artifact_1', notebook_id: 'n', mime_type: 'audio/wav', sha256: 'a'.repeat(64), byte_size: 4 }; const result = parseStudioJob({ job_id: 'j', notebook_id: 'n', operation: 'download', idempotency_key: 'k', state: 'succeeded', submission_state: 'not_submitted', result: { downloaded: true, artifact: a } }, { jobId: 'j', notebookId: 'n', operation: 'download', idempotencyKey: 'k' }); expect(result).toMatchObject({ submissionState: 'not_submitted', downloaded: true, artifact: { artifact_id: 'artifact_1' } }); });
it('rejects a successful note write receipt for a different notebook', async () => { const c = sourceContext(); const api = createStudioApi({ send: async () => json({ id: 'note:1', revision: 1, title: 'T', content: 'C', citations: [], scope_snapshot: {}, notebook_id: 'other' }) }); await expect(api.createNote('n', { title: 'T', content: 'C', citations: [] }, c)).rejects.toThrow(); });
it('does not relabel an incomplete personal snapshot as a native classic note', () => { expect(noteForEditor({ id: 'note:1', note_id: 'note:1', revision: 1, title: 'Personal', content: 'Text' })).toBeNull(); expect(noteForEditor({ id: 'note:1', revision: 1, title: null, content: null, note_type: 'human' })).toMatchObject({ mode: 'classic' }); });
