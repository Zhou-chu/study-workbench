import { useState } from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { sourceContext, sourceWorkspace } from '../../test/source-fixtures';
import { sourceServer, renderSourceFeature } from '../../test/source-harness';
import { json } from '../../test/notebook-fixtures';
import { readTurnContext, sessionCoordinator } from '@study/web-transport';
import { useStudio } from './use-studio';
import { StudioPanel } from './StudioPanel';
import { RemoteAudioControls } from './RemoteAudioControls';
import { PortableDialog } from './PortableDialog';
const workspace = sourceWorkspace();
beforeEach(sourceContext);
it('does not revive old audio confirmation or artifact page after A to B to A', async () => { let change!: (v: string) => void; const requests = sourceServer(r => json(r.url.endsWith('/capabilities') ? { operations: [{ name: 'generate_audio', support: 'available' }, { name: 'list_artifacts', support: 'available' }, { name: 'download_artifact', support: 'available' }] } : r.url.endsWith('/connections/notebooklm') ? { state: 'connected' } : [{ id: 'ra', title: 'Remote audio A', kind: 'audio', status: 'ready', remote_source_ids: ['rs'] }])); function Panel() { const [remote, setRemote] = useState('A'); change = setRemote; const c = useStudio('n'); return <RemoteAudioControls notebookId="n" workspace={{ ...workspace, selection: { engine: 'notebooklm', selection_origin: 'remote', source_version_ids: [], remote_source_ids: ['rs'] }, link: { remote_notebook_id: remote } }} connection={c}/>; } await renderSourceFeature(<Panel />); fireEvent.click(screen.getByRole('button', { name: 'Verify Google connection' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Generate audio overview' })).toBeEnabled()); fireEvent.click(screen.getByRole('button', { name: 'List Google artifacts' })); await screen.findByText('Remote audio A'); fireEvent.click(screen.getByRole('button', { name: 'Generate audio overview' })); await act(async () => change('B')); await act(async () => change('A')); expect(screen.queryByText('Remote audio A')).not.toBeInTheDocument(); expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' })).toBeDisabled(); expect(requests.some(r => r.method === 'POST')).toBe(false); });
it('opens editors on intent and preserves a dirty note across close, resume and tab changes', async () => { sourceServer(); await renderSourceFeature(<StudioPanel notebookId="n" workspace={workspace}/>); expect(screen.queryByLabelText('Markdown note')).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'New Note' })); fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'Synthetic draft' } }); fireEvent.change(screen.getByLabelText('Markdown note'), { target: { value: 'Retain me' } }); fireEvent.click(screen.getByRole('button', { name: 'Close' })); fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Keep draft and open' })); expect(screen.queryByLabelText('Markdown note')).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Resume draft' })); expect(screen.getByLabelText('Markdown note')).toHaveValue('Retain me'); fireEvent.click(screen.getByRole('button', { name: 'Tasks' })); fireEvent.click(screen.getByRole('button', { name: 'Notes' })); expect(screen.getByLabelText('Note title')).toHaveValue('Synthetic draft'); });
it('Save Answer keeps one unkeyed POST after lost ACK and repeated clicks', async () => { const requests = sourceServer(r => r.url.endsWith('/notes') && r.method === 'POST' ? Promise.reject(new Error('Synthetic lost ACK')) : json({})); function Panel() { const c = useStudio('n'); return <><button onClick={() => c.saveAnswer({ turn_id: 't', notebook_id: 'n', status: 'succeeded', message: 'Synthetic question', answer: 'Synthetic answer', citations: [], scope_snapshot: { source_version_ids: ['v-old'] } })}>Save synthetic answer</button><StudioPanel notebookId="n" workspace={workspace}/></>; } const h = await renderSourceFeature(<Panel />); fireEvent.click(screen.getByText('Save synthetic answer')); await waitFor(() => expect(h.workbench.drafts.studio.getSnapshot().notes[0]?.editor.saveResult).toBe('unknown')); fireEvent.click(screen.getByText('Save synthetic answer')); expect(requests.filter(r => r.method === 'POST' && r.url.endsWith('/notes'))).toHaveLength(1); expect(h.workbench.drafts.studio.getSnapshot().notes[0]?.editor.base.scope_snapshot).toEqual({ source_version_ids: ['v-old'] }); expect(h.workbench.navigation.requestNavigation({ destination: '/elsewhere' })).toBe('blocked'); });
it('retains one ZIP in application memory across unmount and blocks unknown import replay', async () => { let toggle!: (v: boolean) => void; const requests = sourceServer(r => r.url.endsWith('/imports/portable') ? Promise.reject(new Error('Synthetic lost ACK')) : json({})); function Panel() { const [show, setShow] = useState(true); toggle = setShow; const c = useStudio('n'); return show ? <PortableDialog notebookId="n" connection={c}/> : null; } const h = await renderSourceFeature(<Panel />); const file = new File(['ZIP'], 'synthetic.zip'); fireEvent.change(screen.getByLabelText('Restore project package'), { target: { files: [file] } }); await act(async () => toggle(false)); expect(h.workbench.drafts.studio.getSnapshot().operations[0]?.payload).toEqual({ kind: 'import', file }); await act(async () => toggle(true)); fireEvent.click(screen.getByRole('button', { name: 'Restore project package' })); fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' })); await waitFor(() => expect(h.workbench.drafts.studio.getSnapshot().operations[0]?.operation.state).toBe('unknown')); expect(screen.getByLabelText('Restore project package')).toBeDisabled(); expect(requests.filter(r => r.url.endsWith('/imports/portable'))).toHaveLength(1); const row = h.workbench.drafts.studio.getSnapshot().operations[0]!; expect(h.workbench.drafts.studio.begin(row.id, readTurnContext(), sessionCoordinator.current())).toBeNull(); });
it('renders a real controlled conflict comparison and only saves after explicit re-edit', async () => {
    const base = { id: 'note:1', note_id: 'note:1', notebook_id: 'n', revision: 7, title: 'Synthetic base', content: 'Original', citations: [], scope_snapshot: { source_version_ids: ['v-old'] } };
    let server = { ...base, revision: 8, content: 'External writer' };
    const requests = sourceServer(async (r) => {
        if (r.method === 'PATCH' && r.url.endsWith('/notes/note%3A1')) {
            const payload = await r.json();
            if (payload.expected_revision !== server.revision)
                return json({ detail: { code: 'NOTE_REVISION_CONFLICT', current_revision: server.revision } }, 409);
            server = { ...server, ...payload, revision: 9 };
            return json(server);
        }
        return json({});
    }, () => json({ ...workspace, notes: [server] }));
    await renderSourceFeature(<StudioPanel notebookId="n" workspace={{ ...workspace, notes: [base] }}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Markdown note'), { target: { value: 'My local draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await screen.findByText('This note changed elsewhere. Your draft is safe here. Compare before replacing it.');
    expect(screen.getByLabelText('Markdown note')).toHaveValue('My local draft');
    fireEvent.click(screen.getByRole('button', { name: 'Compare with server' }));
    await screen.findByText('External writer');
    expect(requests.filter(r => r.method === 'PATCH')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Edit my draft against this revision' }));
    expect(screen.getByLabelText('Markdown note')).toHaveValue('My local draft');
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await screen.findByText('Saved', { selector: 'p' });
    expect(requests.filter(r => r.method === 'PATCH')).toHaveLength(2);
    expect(server).toMatchObject({ revision: 9, content: 'My local draft', scope_snapshot: base.scope_snapshot });
    expect(requests.some(r => r.url.endsWith('/selection'))).toBe(false);
});
it('renders nullable classic notes and sends only an explicitly edited title on PUT', async () => {
    let body: unknown;
    const raw = { id: 'note:native', revision: 7, title: null, content: null, note_type: 'human' };
    const requests = sourceServer(async (r) => {
        if (r.method === 'PUT') {
            body = await r.json();
            return json({ ...raw, revision: 8, title: 'Named' });
        }
        return json({});
    });
    await renderSourceFeature(<StudioPanel notebookId="n" workspace={{ ...workspace, notes: [raw] }}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Markdown note')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Save note' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'Named' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await screen.findByText('Saved', { selector: 'p' });
    expect(body).toEqual({ title: 'Named', expected_revision: 7 });
    expect(requests.filter(r => r.method === 'PUT')).toHaveLength(1);
    expect(requests.some(r => r.method === 'PATCH')).toBe(false);
});
