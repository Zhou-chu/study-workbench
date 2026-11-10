import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { beforeEach, expect, it } from 'vitest';
import type { WorkspaceViewV1 } from '@study/contracts';
import { sourceContext, sourceWorkspace } from '../../test/source-fixtures';
import { sourceServer, renderSourceFeature } from '../../test/source-harness';
import { json } from '../../test/notebook-fixtures';
import { deferred } from '../../test/reader-fixtures';
import { NotebookPage } from './NotebookPage';
import { readySources } from '../chat/chat-admission';
beforeEach(sourceContext);
const extracting = () => {
    const w = sourceWorkspace();
    w.sources = [{ source_id: 's', title: 'Extracting document', versions: [{ source_version_id: 'v-old', source_id: 's', notebook_id: 'n', status: 'extracting', extraction_status: 'extracting', origin: 'upload' }] }];
    return w;
};
it.each(['ready', 'error'])('observes extraction %s at the two-second workspace cadence without dispatching jobs or writes', async status => {
    let query!: QueryClient, calls = 0, received = false;
    const requests = sourceServer(r => {
        if (r.method === 'POST' && r.url.includes('/sources')) {
            received = true;
            return json({ source_id: 's', source_version_id: 'v-old', job_id: 'extract-1' });
        }
        return json({});
    }, () => {
        const w = extracting();
        if (!received) { w.sources = []; return json(w); }
        ++calls;
        if (calls > 1) w.sources = [{ source_id: 's', title: 'Observed ' + status, versions: [{ source_version_id: 'v-old', source_id: 's', notebook_id: 'n', status, extraction_status: status, origin: 'upload' }] }];
        return json(w);
    });
    function Panel() { query = useQueryClient(); return <NotebookPage/>; }
    const h = await renderSourceFeature(<Panel/>, '/notebooks/n');
    fireEvent.click(await screen.findByRole('button', { name: 'Add sources' }));
    fireEvent.change(screen.getByLabelText('Choose files'), { target: { files: [new File(['PDF'], 'extract.pdf', { type: 'application/pdf' })] } });
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Upload' })).toBeEnabled());
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(h.workbench.drafts.sources.getSnapshot()[0]?.operation.state).toBe('succeeded'));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    await screen.findByRole('button', { name: 'Extracting document' });
    expect(requests.filter(r => r.method === 'POST' && r.url.includes('/sources'))).toHaveLength(1);
    const cached = () => query.getQueriesData<WorkspaceViewV1>({ queryKey: ['workspace'] })[0]![1]!;
    expect(readySources(cached(), ['v-old'])).toBe(false);
    const baseline = requests.filter(r => r.method !== 'GET').length;
    await waitFor(() => expect(screen.getByRole('button', { name: 'Observed ' + status })).toBeVisible(), { timeout: 3000 });
    expect(calls).toBe(2);
    expect(readySources(cached(), ['v-old'])).toBe(status === 'ready');
    expect(requests.some(r => new URL(r.url).pathname.includes('/personal/jobs/'))).toBe(false);
    expect(requests.filter(r => r.method !== 'GET')).toHaveLength(baseline);
    h.unmount();
});
it('stops background observation and fences an old workspace completion across privacy retirement', async () => {
    const late = deferred<Response>(); let calls = 0;
    sourceServer(() => json({}), () => ++calls === 1 ? json(extracting()) : late.promise);
    const h = await renderSourceFeature(<NotebookPage/>, '/notebooks/n');
    await screen.findByRole('button', { name: 'Extracting document' });
    await waitFor(() => expect(calls).toBe(2), { timeout: 3000 });
    act(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 2100)); });
    expect(calls).toBe(2);
    act(() => h.workbench.controller.retirePrivacyContext());
    const old = extracting(); old.sources = [{ source_id: 'old', title: 'Late private content', versions: [] }];
    await act(async () => late.resolve(json(old)));
    expect(screen.queryByText('Late private content')).not.toBeInTheDocument();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    h.unmount();
});
