import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AppProviders } from '../app/providers';
import { WorkbenchSession, useWorkbenchSession } from '../app/WorkbenchSession';
import { sourceWorkspace } from './source-fixtures';
import { json } from './notebook-fixtures';
import type { ReactNode } from 'react';
export function sourceServer(resource: (request: Request) => Response | Promise<Response> = () => json({}), workspace: (request: Request) => Response | Promise<Response> = () => json(sourceWorkspace())) { const requests: Request[] = []; vi.stubGlobal('fetch', vi.fn(async (input: Request | string) => { const r = input instanceof Request ? input : new Request(new URL(input, window.location.href)); requests.push(r); const path = new URL(r.url).pathname; if (path === '/config')
    return json({ apiUrl: '', auth_mode: 'legacy_password', web_session_protocol: null, client_contracts: ['workspace-view-v1'], ui_transport_protocol: 1 }); if (path === '/api/auth/status')
    return json({ auth_enabled: false }); if (path === '/api/personal/client-capabilities')
    return json({ contract_version: 'client-capabilities-v1', supported_contracts: ['workspace-view-v1'], limits: { source_upload_max_bytes: 50, portable: { max_archive_bytes: 10, max_expanded_bytes: 20, max_entity_bytes: 10, max_manifest_bytes: 10, max_request_bytes: 30, multipart_overhead_bytes: 10, max_entries: 2, max_compression_ratio: 5 } } }); if (path.endsWith('/workspace-view'))
    return workspace(r); return resource(r); })); return requests; }
export async function renderSourceFeature(children: ReactNode, pathname = '/') {
    let workbench!: ReturnType<typeof useWorkbenchSession>;
    function Probe() { workbench = useWorkbenchSession(); return <><span>Source test ready</span>{children}</>; }
    const rendered = render(<AppProviders locale="en-US"><MemoryRouter initialEntries={[pathname]}><WorkbenchSession><Probe /></WorkbenchSession></MemoryRouter></AppProviders>);
    await screen.findByText('Source test ready');
    return { ...rendered, workbench };
}
