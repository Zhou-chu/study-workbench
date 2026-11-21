import { beforeEach, expect, it } from 'vitest';
import { sessionCoordinator } from '@study/web-transport';
import { sourceContext } from '../../test/source-fixtures';
import { createStudioStore } from './studio-store';
const note = { id: 'note:classic', revision: 7, title: 'Classic', content: 'Original', note_type: 'human' };
const draft = { title: note.title, content: note.content, citations: [] };
beforeEach(sourceContext);

it('does not begin a DELETE after a matching editor became dirty or began saving', () => {
    const c = sourceContext(), g = sessionCoordinator.current(), store = createStudioStore(() => {});
    const editor = store.open('n', draft, c, g, note, 'classic');
    const deletion = store.capture('n', { kind: 'delete', noteId: note.id }, c, g);
    store.edit(editor, { content: 'Changed after opening confirmation' });
    expect(store.begin(deletion, c, g)).toBeNull();
    expect(store.beginSave(editor, c, g)).not.toBeNull();
    expect(store.begin(deletion, c, g)).toBeNull();
});
