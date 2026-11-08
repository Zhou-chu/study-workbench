import { useState } from 'react';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { RequestNotDispatchedError, sessionCoordinator } from '@study/web-transport';
import { createLibraryApi, parseLibrarySource, type LibrarySource } from '../../data/library-api';
import { createDraftRegistry } from '../../app/drafts';
import { sourceContext } from '../../test/source-fixtures';
import { sourceDetail } from '../../test/library-fixtures';
import { json } from '../../test/notebook-fixtures';
import { sourceServer, renderSourceFeature } from '../../test/source-harness';
import { SourceActionConfirm } from './SourceActionConfirm';
import { executeLibraryDraft } from './library-operations';
it('a proven undispatched first import may be manually submitted without losing its new accepted receipt', async () => {
    const c = sourceContext(), g = sessionCoordinator.current(), store = createDraftRegistry().library;
    let sent = 0;
    const api = createLibraryApi({ send: async () => {
            if (++sent === 1)
                throw new RequestNotDispatchedError('superseded');
            return json(sourceDetail);
        } });
    const file = new File(['unchanged'], 'same.txt');
    const id = store.open({ kind: 'global' }, { kind: 'import', type: 'upload', title: '', text: '', urls: '', files: [file], notebooks: [], transformations: [], embed: false, step: 3 }, c, g);
    await executeLibraryDraft(store, id, api);
    expect(store.get(id)?.status).toBe('not-sent');
    await executeLibraryDraft(store, id, api);
    expect(store.get(id)?.status).toBe('succeeded');
    expect(store.get(id)?.receipts).toEqual([{ state: 'accepted', resourceId: sourceDetail.id }]);
    expect(store.get(id)?.input.kind === 'import' && store.get(id)!.input).toMatchObject({ files: [file] });
});
it('a delayed destructive confirmation keeps its original label and rejects changed source metadata', async () => {
    const requests = sourceServer();
    let change!: (v: LibrarySource) => void;
    function Host() { const [source, setSource] = useState(parseLibrarySource(sourceDetail, true)); change = setSource; return <SourceActionConfirm source={source} action="delete"/>; }
    await renderSourceFeature(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Source' }));
    await act(async () => change(parseLibrarySource({ ...sourceDetail, title: 'Replacement label', updated: '2026-11-08T11:00:00Z' }, true)));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Historical paper')).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Confirm' })).toBeDisabled();
    expect(requests.some(r => r.method === 'DELETE')).toBe(false);
});
it('separate notebook unlink confirmations never reuse another parent association target', async () => {
    const requests = sourceServer(() => json({ message: 'Unlinked' }));
    const source = parseLibrarySource(sourceDetail, true);
    await renderSourceFeature(<><section aria-label="First parent"><SourceActionConfirm source={source} action="unlink" notebookId="n"/></section><section aria-label="Second parent"><SourceActionConfirm source={source} action="unlink" notebookId="n2"/></section></>);
    fireEvent.click(within(screen.getByRole('region', { name: 'First parent' })).getByRole('button', { name: 'Remove from Notebook' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(screen.getByRole('region', { name: 'Second parent' })).getByRole('button', { name: 'Remove from Notebook' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' }));
    await act(async () => { });
    expect(requests.filter(r => r.method === 'DELETE').map(r => new URL(r.url).pathname)).toEqual(['/api/notebooks/n2/sources/source%3Aalpha%3Afull']);
});
