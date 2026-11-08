import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { readTurnContext, sessionCoordinator } from '@study/web-transport';
import { createDraftRegistry } from '../../app/drafts';
import { sourceContext, sourceWorkspace, selection } from '../../test/source-fixtures';
import { renderSourceFeature, sourceServer } from '../../test/source-harness';
import { json } from '../../test/notebook-fixtures';
import { NotebookPage } from '../notebooks/NotebookPage';
import { SourcesPanel } from './SourcesPanel';

beforeEach(sourceContext);
it('releases a succeeded scope overlay after a fresh authoritative read and preserves newer fields in the next edit', async () => {
    let workspace = sourceWorkspace();
    let reads = 0;
    const requests = sourceServer(async request => {
        if (request.method === 'PATCH') workspace = { ...workspace, selection: await request.clone().json() };
        return json({});
    }, () => { reads++; return json(workspace); });
    const h = await renderSourceFeature(<NotebookPage />, '/notebooks/n');
    fireEvent.click(await screen.findByRole('button', { name: 'Same title' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select v-new' }));
    await waitFor(() => expect(h.workbench.drafts.sources.getSnapshot().some(row => row.operation.state === 'succeeded')).toBe(true));
    await waitFor(() => expect(reads).toBeGreaterThanOrEqual(2));
    const newer = { engine: 'notebooklm' as const, selection_origin: 'remote' as const, source_version_ids: ['v-new'], remote_source_ids: ['remote-later'], reading: { source_version_id: 'v-new', page_index: 8, evidence_id: 'e-later' } };
    workspace = { ...workspace, selection: newer };
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Select v-old' })).not.toBeChecked());
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select v-old' }));
    await waitFor(() => expect(requests.filter(r => r.method === 'PATCH')).toHaveLength(2));
    expect(await requests.filter(r => r.method === 'PATCH')[1]!.clone().json()).toEqual({ ...newer, source_version_ids: ['v-new', 'v-old'] });
});

it('rejects a workspace read that began before a new selection intent or before its settlement', () => {
    const store = createDraftRegistry().sources, c = readTurnContext()!, g = sessionCoordinator.current();
    const beforeIntent = store.beginWorkspaceRead('n', c, g);
    const id = store.capture('n', { kind: 'selection', selection: { ...selection, source_version_ids: ['v-new'] } }, c, g);
    expect(store.acceptWorkspaceRead(beforeIntent, sourceWorkspace(), c, g)).toBe(false);
    const active = store.begin(id, c, g)!;
    const duringWrite = store.beginWorkspaceRead('n', c, g);
    store.settle(id, active.operation.token!, { kind: 'succeeded' }, c, g);
    expect(store.acceptWorkspaceRead(beforeIntent, sourceWorkspace(), c, g)).toBe(false);
    expect(store.acceptWorkspaceRead(duringWrite, sourceWorkspace(), c, g)).toBe(false);
    const afterWrite = store.beginWorkspaceRead('n', c, g);
    const newer = { ...sourceWorkspace(), selection: { ...selection, source_version_ids: [], reading: { source_version_id: 'v-new', page_index: 9 } } };
    expect(store.acceptWorkspaceRead(afterWrite, newer, c, g)).toBe(true);
    expect(store.getSelectionRead('n')?.selection).toEqual(newer.selection);
});

it('never releases an unknown selection through a background workspace refresh', () => {
    const store = createDraftRegistry().sources, c = readTurnContext()!, g = sessionCoordinator.current();
    const id = store.capture('n', { kind: 'selection', selection }, c, g);
    const active = store.begin(id, c, g)!;
    store.settle(id, active.operation.token!, { kind: 'unknown' }, c, g);
    const read = store.beginWorkspaceRead('n', c, g);
    expect(store.acceptWorkspaceRead(read, sourceWorkspace(), c, g)).toBe(false);
    expect(store.get(id)?.operation.state).toBe('unknown');
    expect(store.begin(id, c, g)).toBeNull();
});

it('does not revive an older succeeded payload when accepted selection survives a same-scope app refresh', async () => {
    const requests = sourceServer(() => json({}));
    const h = await renderSourceFeature(<SourcesPanel notebookId="n" workspace={sourceWorkspace()} onRead={() => { }} />);
    const store = h.workbench.drafts.sources, c = readTurnContext()!, g = sessionCoordinator.current();
    const newer = { ...selection, source_version_ids: ['v-new'], reading: { source_version_id: 'v-new', page_index: 12 } };
    act(() => {
        const id = store.capture('n', { kind: 'selection', selection }, c, g);
        const active = store.begin(id, c, g)!;
        store.settle(id, active.operation.token!, { kind: 'succeeded' }, c, g);
        const read = store.beginWorkspaceRead('n', c, g);
        expect(store.acceptWorkspaceRead(read, { ...sourceWorkspace(), selection: newer }, c, g)).toBe(true);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Same title' }));
    expect(screen.getByRole('checkbox', { name: 'Select v-old' })).not.toBeChecked();
    await act(async () => { await h.workbench.controller.check(); });
    expect(readTurnContext()?.epoch).toBe(c.epoch);
    expect(sessionCoordinator.current()).not.toBe(g);
    expect(screen.getByRole('checkbox', { name: 'Select v-old' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select v-old' }));
    await waitFor(() => expect(requests.filter(r => r.method === 'PATCH')).toHaveLength(1));
    expect(await requests.find(r => r.method === 'PATCH')!.clone().json()).toEqual({ ...newer, source_version_ids: ['v-new', 'v-old'] });
});
