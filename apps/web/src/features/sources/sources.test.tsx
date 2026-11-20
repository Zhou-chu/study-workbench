import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { WorkbenchSession } from '../../app/WorkbenchSession';
import { AppProviders } from '../../app/providers';
import { SourcesPanel } from './SourcesPanel';
import { sourceContext, sourceWorkspace, selection, receipt } from '../../test/source-fixtures';
import { json } from '../../test/notebook-fixtures';
beforeEach(sourceContext);
function harness(workspace = sourceWorkspace()) { const requests: Request[] = []; const read: unknown[] = []; vi.stubGlobal('fetch', vi.fn(async (input: Request | string) => { const r = input instanceof Request ? input : new Request(new URL(input, window.location.href)); requests.push(r); const path = new URL(r.url).pathname; if (path === '/config')
    return json({ apiUrl: '', auth_mode: 'legacy_password', web_session_protocol: null, client_contracts: ['workspace-view-v1'], ui_transport_protocol: 1 }); if (path === '/api/auth/status')
    return json({ auth_enabled: false }); if (path === '/api/personal/client-capabilities')
    return json({ contract_version: 'client-capabilities-v1', supported_contracts: ['workspace-view-v1'], limits: { source_upload_max_bytes: 50, portable: { max_archive_bytes: 10, max_expanded_bytes: 20, max_entity_bytes: 10, max_manifest_bytes: 10, max_request_bytes: 30, multipart_overhead_bytes: 10, max_entries: 2, max_compression_ratio: 5 } } }); return json(path.endsWith('/upload') ? receipt : path.endsWith('/selection') ? selection : workspace); })); render(<AppProviders locale="en-US"><MemoryRouter><WorkbenchSession><SourcesPanel notebookId="n" workspace={workspace} onRead={intent => read.push(intent)}/></WorkbenchSession></MemoryRouter></AppProviders>); return { requests, read, workspace }; }
it('distinguishes same-name same-day versions and reads without selecting', async () => { const h = harness(); await screen.findByRole('button', { name: 'Current question scope' }); fireEvent.click(screen.getByRole('button', { name: 'Current question scope' })); expect(screen.getByText('Version 1')).toBeVisible(); expect(screen.getByText('Version 2')).toBeVisible(); fireEvent.click(screen.getByRole('button', { name: 'Read Same title · Version 2' })); expect(h.read.at(-1)).toEqual({ source_version_id: 'v-new' }); expect(h.requests.filter(r => r.method === 'PATCH')).toHaveLength(0); });
it('uploads once on duplicate clicks and leaves question scope unchanged until explicit include', async () => { const h = harness(); fireEvent.click(await screen.findByRole('button', { name: 'Add sources' })); fireEvent.change(screen.getByLabelText('Choose files'), { target: { files: [new File(['synthetic'], 'upload.txt', { type: 'text/plain' })] } }); const button = within(screen.getByRole('dialog')).getByRole('button', { name: 'Upload' }); await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button); fireEvent.click(button); await waitFor(() => expect(h.requests.filter(r => r.method === 'POST')).toHaveLength(1)); expect(h.requests.filter(r => r.method === 'PATCH')).toHaveLength(0); fireEvent.click(screen.getByRole('button', { name: 'Close' })); await screen.findByRole('button', { name: 'Include in question scope' }); });

it.each([false, true])('selects latest eligible versions without replacing the historical scope (reversed: %s)', async reverse => {
    const workspace = sourceWorkspace();
    const old = { source_version_id: 'v-old', created_at: '2026-11-07T10:00:00Z' };
    const latest = { source_version_id: 'v-new', created_at: '2026-11-08T10:00:00Z' };
    const invalid = { source_version_id: 'v-invalid', created_at: '2026-11-09T10:00:00Z', projection_status: 'invalid' as const };
    const versions = [old, latest, invalid];
    workspace.sources = [
        { source_id: 'classic', title: 'Classic only' },
        { source_id: 's', title: 'Research notes', versions: reverse ? [...versions].reverse() : versions },
    ];
    const current = { ...selection, remote_source_ids: ['remote-kept'] };
    workspace.selection = current;
    const h = harness(workspace);
    fireEvent.click(await screen.findByRole('button', { name: 'Select all current versions' }));
    await waitFor(() => expect(h.requests.filter(r => r.method === 'PATCH')).toHaveLength(1));
    expect(await h.requests.find(r => r.method === 'PATCH')!.clone().json()).toEqual({
        engine: current.engine, selection_origin: current.selection_origin,
        source_version_ids: ['v-old', 'v-new'], remote_source_ids: ['remote-kept'], reading: current.reading,
    });
    expect(h.read).toEqual([]);
});

it('refuses the entire Select All change when it would exceed twenty versions', async () => {
    const workspace = sourceWorkspace();
    const existing = Array.from({ length: 19 }, (_, index) => 'manual-' + index);
    workspace.selection = { ...selection, source_version_ids: existing };
    workspace.sources = [
        { source_id: 'a', versions: [{ source_version_id: 'a-latest', created_at: '2026-11-08' }] },
        { source_id: 'b', versions: [{ source_version_id: 'b-latest', created_at: '2026-11-08' }] },
    ];
    const h = harness(workspace);
    fireEvent.click(await screen.findByRole('button', { name: 'Select all current versions' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/20/);
    expect(h.requests.filter(r => r.method === 'PATCH')).toHaveLength(0);
    expect(h.read).toEqual([]);
});
