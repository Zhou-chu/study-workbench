import { expect, it } from 'vitest';
import { parseWorkbenchNote, noteForEditor } from './studio-api';



import { parseWorkspaceView } from '@study/contracts';
import { sourceWorkspace } from '../test/source-fixtures';
import { producerCitationRepresentations } from '../test/studio-fixtures';
it('preserves ACK nulls and persisted-workspace omissions through projection and note adapters', () => {
    const { withNulls, withoutNulls } = producerCitationRepresentations();
    const note = { id: 'note:wire', revision: 7, title: 'Cited', content: 'Body', scope_snapshot: { source_version_ids: ['v-old'] } };
    const ack = parseWorkbenchNote({ ...note, citations: [withNulls] });
    const projected = parseWorkspaceView({ ...sourceWorkspace(), notes: [{ ...note, citations: [withoutNulls] }] });
    const read = noteForEditor(projected.notes[0]!)!;
    expect(ack.citations).toEqual([withNulls]);
    expect(read.note.citations).toEqual([withoutNulls]);
    expect(read.draft.citations).toEqual([withoutNulls]);
    for (const key of ['remote_reference', 'independent_support', 'provenance', 'reason']) {
        expect(ack.citations?.[0]).toHaveProperty(key, null);
        expect(projected.notes[0] && 'citations' in projected.notes[0] ? projected.notes[0].citations : []).toEqual([withoutNulls]);
        expect(read.note.citations?.[0]).not.toHaveProperty(key);
    }
});
