import { expect, it } from 'vitest';
import type { CreateWorkbenchNoteInput, ScopeSnapshot } from '@study/contracts';

it('keeps the note-only sentinel out of strict scope DTOs at compile time', () => {
    const note: CreateWorkbenchNoteInput = { title: 'T', content: 'C', citations: [], scope_snapshot: {} };
    expect(note.scope_snapshot).toEqual({});
    // @ts-expect-error A note-only legacy sentinel is not a turn/promotion scope.
    const scope: ScopeSnapshot = {};
    expect(scope).toEqual({});
});
