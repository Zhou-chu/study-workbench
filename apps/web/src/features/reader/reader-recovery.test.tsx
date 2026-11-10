import { createHash } from 'node:crypto';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { getDocument } from 'pdfjs-dist';
import { sourceContext, sourceWorkspace } from '../../test/source-fixtures';
import { sourceServer, renderSourceFeature } from '../../test/source-harness';
import { suspendAndRecover } from '../../test/session-recovery';
import { json } from '../../test/notebook-fixtures';
import { readerDetail, deferred } from '../../test/reader-fixtures';
import { ReaderPane } from './ReaderPane';
import { useNotebookReader } from './use-notebook-reader';
vi.mock('pdfjs-dist', () => ({ getDocument: vi.fn(), GlobalWorkerOptions: { workerSrc: '' } }));
beforeEach(() => {
    sourceContext();
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
    Object.defineProperty(Blob.prototype, 'arrayBuffer', { configurable: true, value: function (this: Blob) { return new Promise<ArrayBuffer>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.readAsArrayBuffer(this); }); } });
    vi.mocked(getDocument).mockReturnValue({ promise: Promise.resolve({ getPage: async () => ({ getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }), render: () => ({ promise: Promise.resolve(), cancel() {} }) }) }), destroy: async () => {} } as never);
});
function Panel() {
    const reader = useNotebookReader('n', sourceWorkspace());
    return <><button onClick={() => reader.openSource({ source_version_id: 'v-old' })}>Open retained source</button>{reader.open && reader.intent && <ReaderPane intent={reader.intent} onClose={reader.close} onPositionChange={reader.onPositionChange}/>}</>;
}
it.each(['text', 'pdf'])('keeps mounted %s page, search, scroll and zoom across verified same-owner suspension', async format => {
    const pdf = '%PDF-synthetic-protected-bytes', detail = readerDetail();
    const value = { ...detail, version: { ...detail.version, ...(format === 'pdf' ? { mime_type: 'application/pdf', original_status: 'available', byte_size: pdf.length, sha256: createHash('sha256').update(pdf).digest('hex') } : {}) } };
    const requests = sourceServer(r => new URL(r.url).pathname.endsWith('/download') ? new Response(pdf, { headers: { 'content-type': 'application/pdf' } }) : r.url.includes('/source-versions/') ? json(value) : json({}));
    const h = await renderSourceFeature(<Panel/>, '/notebooks/n');
    fireEvent.click(screen.getByRole('button', { name: 'Open retained source' }));
    await screen.findByRole('searchbox');
    if (format === 'pdf') {
        await waitFor(() => expect(document.querySelector('canvas')).toHaveAttribute('data-render-state', 'ready'));
        fireEvent.click(screen.getByRole('button', { name: '100%' }));
        await waitFor(() => expect(document.querySelector('canvas')).toHaveStyle({ width: '600px' }));
    }
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '4' } });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'proof' } });
    await waitFor(() => expect(h.workbench.drafts.sources.getSnapshot().find(r => r.payload.kind === 'selection')?.operation.state).toBe('succeeded'));
    const scroll = document.querySelector<HTMLElement>('.reader-scroll')!, canvas = document.querySelector('canvas');
    scroll.scrollTop = 321; fireEvent.scroll(scroll);
    const reads = requests.filter(r => r.url.includes('/source-versions/')).length;
    await suspendAndRecover(h.workbench.controller);
    expect(document.querySelector('.reader-scroll')).toBe(scroll);
    expect(scroll.scrollTop).toBe(321);
    expect(screen.getByRole('searchbox')).toHaveValue('proof');
    expect(screen.getByRole('spinbutton')).toHaveValue(4);
    if (format === 'pdf') {
        expect(document.querySelector('canvas')).toBe(canvas);
        expect(canvas).toHaveStyle({ width: '600px' });
    }
    expect(requests.filter(r => r.url.includes('/source-versions/'))).toHaveLength(reads);
    expect(requests.filter(r => r.method === 'PATCH')).toHaveLength(1);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '5' } });
    await waitFor(() => expect(requests.filter(r => r.method === 'PATCH')).toHaveLength(2));
    expect(await requests.filter(r => r.method === 'PATCH')[1]!.clone().json()).toMatchObject({ source_version_ids: ['v-old'], reading: { source_version_id: 'v-old', page_index: 4 } });
    act(() => h.workbench.controller.retirePrivacyContext());
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(document.querySelector('canvas')).toBeNull();
});
it('fences a late pre-suspension read and only loads again on an explicit verified retry', async () => {
    const late = deferred<Response>(); let reads = 0;
    sourceServer(r => r.url.includes('/source-versions/') ? ++reads === 1 ? late.promise : json(readerDetail()) : json({}));
    const h = await renderSourceFeature(<Panel/>, '/notebooks/n');
    fireEvent.click(screen.getByRole('button', { name: 'Open retained source' }));
    await waitFor(() => expect(reads).toBe(1));
    await suspendAndRecover(h.workbench.controller);
    const old = readerDetail(); old.version.source_title = 'Obsolete response';
    await act(async () => late.resolve(json(old)));
    expect(reads).toBe(1);
    expect(screen.queryByText('Obsolete response')).not.toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Try again' });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);
    await screen.findByRole('searchbox');
    expect(reads).toBe(2);
    expect(screen.getByRole('heading', { name: 'Retained version' })).toBeInTheDocument();
});
