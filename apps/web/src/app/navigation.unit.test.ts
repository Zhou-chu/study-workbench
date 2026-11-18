import { expect, it } from 'vitest';
import { createEditor } from '@study/domain';
import { createDraftRegistry } from './drafts';
const id = { epoch: 1, notebookId: 'A', editorSession: 'editor-1' };
const draft = () => createEditor('A', { title: 'Title', content: 'Unsaved', citations: [] });

it('separates notebook/editor sessions and retires epochs without losing retained File identity', () => {
    const registry = createDraftRegistry();
    const file = new File(['x'], 'x.txt');
    registry.update(id, { editor: draft(), file, question: 'q' });
    registry.update({ ...id, notebookId: 'B' }, { editor: createEditor('B', { title: '', content: 'B', citations: [] }) });
    expect(registry.get(id)?.file).toBe(file);
    expect(registry.get({ ...id, editorSession: 'other' })).toBeUndefined();
    registry.retireContext(1);
    expect(registry.get(id)?.retired).toBe(true);
    registry.update(id, { question: 'changed' });
    expect(registry.get(id)?.question).toBe('q');
});

it('exposes retired context even when no draft was ever created', () => {
    const registry = createDraftRegistry();
    expect(registry.get(id)).toBeUndefined();
    registry.retireContext(id.epoch);
    expect(registry.isRetired(id)).toBe(true);
    registry.update(id, { question: 'late write' });
    expect(registry.get(id)).toBeUndefined();
    const next = { ...id, epoch: 2, editorSession: 'new-explicit-editor' };
    registry.update(next, { question: 'new work' });
    expect(registry.isRetired(next)).toBe(false);
    expect(registry.get(next)?.question).toBe('new work');
});
