import { expect, it } from 'vitest';
import { createDraftRegistry } from '../../app/drafts';

it('clears only the exact captured revision on a genuinely accepted receipt', () => {
    const d = createDraftRegistry(), id = { epoch: 2, notebookId: 'n', editorSession: 'q' };
    d.update(id, { question: 'first' });
    const revision = d.get(id)!.questionRevision!;
    d.update(id, { question: 'second' });
    d.clearQuestion(id, revision);
    expect(d.get(id)?.question).toBe('second');
    d.clearQuestion(id, d.get(id)!.questionRevision!);
    expect(d.get(id)?.question).toBe('');
});
