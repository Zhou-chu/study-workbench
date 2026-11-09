import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AppProviders } from '../app/providers';
import { WorkbenchSession, useWorkbenchSession } from '../app/WorkbenchSession';
import { AppRoutes } from '../app/router';
import { sourceServer } from './source-harness';
import { json } from './notebook-fixtures';
import { legacySource, sourceDetail, insight, notebook, libraryWorkspace } from './library-fixtures';
export function libraryServer(handler?: (request: Request) => Response | undefined | Promise<Response | undefined>, workspace: () => Response = () => json(libraryWorkspace())) {
    return sourceServer(async (r) => {
        const custom = await handler?.(r);
        if (custom !== undefined)
            return custom;
        const u = new URL(r.url), p = decodeURIComponent(u.pathname);
        if (p === '/api/notebooks')
            return json([notebook]);
        if (p === '/api/recently-viewed')
            return json([{ type: 'source', id: legacySource.id, title: legacySource.title, last_viewed_at: '2026-11-08' }]);
        if (p === '/api/sources' && r.method === 'GET')
            return json([legacySource]);
        if (p === `/api/sources/${legacySource.id}`)
            return json(sourceDetail);
        if (p.endsWith('/insights'))
            return json([insight]);
        if (p === `/api/insights/${insight.id}`)
            return json(insight);
        if (p === '/api/transformations')
            return json([{ id: 'transformation:summary', name: 'Summary', title: 'Summary', description: 'Summarize source', prompt: 'Synthetic', apply_default: false, created: '2026-11-08', updated: '2026-11-08' }]);
        if (p === '/api/models')
            return json([]);
        if (p === '/api/models/defaults')
            return json({});
        if (p === '/api/settings')
            return json({ default_embedding_option: 'no' });
        if (p.endsWith('/status'))
            return json({ status: null, message: 'Legacy source', command_id: null, processing_info: null });
        return json({});
    }, workspace);
}
export async function renderLibrary(route = '/sources', history?: {
    entries: string[];
    index: number;
}) {
    let workbench!: ReturnType<typeof useWorkbenchSession>;
    let queries!: QueryClient;
    function Probe() { queries = useQueryClient(); workbench = useWorkbenchSession(); return <><span hidden>Library ready</span><AppRoutes /></>; }
    const router = createMemoryRouter([{ path: '*', element: <AppProviders locale="en-US"><WorkbenchSession><Probe /></WorkbenchSession></AppProviders> }], { initialEntries: history?.entries ?? [route], ...(history ? { initialIndex: history.index } : {}) });
    const result = render(<RouterProvider router={router}/>);
    await screen.findByText('Library ready');
    return { ...result, router, get queries() { return queries; }, get workbench() { return workbench; } };
}
