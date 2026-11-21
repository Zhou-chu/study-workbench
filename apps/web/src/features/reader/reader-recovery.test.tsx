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
    vi.mocked(getDocument).mockReset().mockReturnValue({ promise: Promise.resolve({ numPages: 10, getPage: async () => ({ getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }), render: () => ({ promise: Promise.resolve(), cancel() {} }) }) }), destroy: async () => {} } as never);
});
function Panel() {
    const reader = useNotebookReader('n', sourceWorkspace());
    return <><button onClick={() => reader.openSource({ source_version_id: 'v-old' })}>Open retained source</button><button onClick={() => reader.openSource({ source_version_id: "v-new" })}>Open newer source</button><button onClick={() => reader.openSource({ source_version_id: "v-new", page_index: 8 })}>Open retained position</button>{reader.open && reader.intent && <ReaderPane intent={reader.intent} onClose={reader.close} onPositionChange={reader.onPositionChange}/>}</>;
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

function fixturePdf(id: string, extractedPages: number | null) {
    const bytes = '%PDF-synthetic-' + id;
    const detail = readerDetail();
    return {
        bytes,
        value: {
            version: { ...detail.version, source_version_id: id, source_title: id === 'v-old' ? 'Old PDF' : 'New PDF',
                mime_type: 'application/pdf', original_status: 'available', byte_size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
            extraction: { ...detail.extraction, source_version_id: id, page_count: extractedPages, blocks: [], text: '' },
            evidence: [],
        },
    };
}
function pdfReaderServer(extractedPages: number | null, detailDelay?: Promise<void>) {
    const old = fixturePdf('v-old', extractedPages), fresh = fixturePdf('v-new', extractedPages);
    return sourceServer(async request => {
        const path = new URL(request.url).pathname;
        const fixture = path.includes('v-new') ? fresh : old;
        if (path.endsWith('/download')) return new Response(fixture.bytes, { headers: { 'content-type': 'application/pdf' } });
        if (path.includes('/source-versions/')) {
            await detailDelay;
            return json(fixture.value);
        }
        return json({});
    });
}
function documentFixture(numPages: number) {
    return { numPages, getPage: vi.fn(async () => ({ getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }), render: () => ({ promise: Promise.resolve(), cancel() {} }) })) };
}

it.each([null, 1])('uses physical PDF page count independently of extraction count %s and persists only valid explicit navigation', async extractedPages => {
    const parsed = documentFixture(2), pending = deferred<typeof parsed>();
    vi.mocked(getDocument).mockReturnValueOnce({ promise: pending.promise, destroy: vi.fn(async () => {}) } as never);
    const details = deferred<void>();
    const requests = pdfReaderServer(extractedPages, details.promise);
    await renderSourceFeature(<Panel/>, '/notebooks/n');
    fireEvent.click(screen.getByRole('button', { name: 'Open newer source' }));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '9' } });
    expect(requests.filter(r => r.method === 'PATCH')).toHaveLength(0);
    await act(async () => details.resolve());
    await waitFor(() => expect(getDocument).toHaveBeenCalled());
    const input = screen.getByRole('spinbutton');
    const next = screen.getByRole('button', { name: 'Next' });
    expect(input).toHaveValue(1);
    expect(next).toBeDisabled();
    fireEvent.change(input, { target: { value: '9' } });
    expect(requests.filter(r => r.method === 'PATCH')).toHaveLength(0);
    await act(async () => pending.resolve(parsed));
    await waitFor(() => expect(input).toHaveAttribute('max', '2'));
    expect(screen.getByText('/ 2')).toBeVisible();
    expect(input).toHaveValue(1);
    fireEvent.click(next);
    await waitFor(() => expect(requests.filter(r => r.method === 'PATCH')).toHaveLength(1));
    expect(await requests.find(r => r.method === 'PATCH')!.clone().json()).toMatchObject({
        source_version_ids: ['v-old'], reading: { source_version_id: 'v-new', page_index: 1 },
    });
    expect(next).toBeDisabled();
    fireEvent.change(input, { target: { value: '3' } });
    expect(input).toHaveValue(2);
    expect(requests.filter(r => r.method === 'PATCH')).toHaveLength(1);
    await waitFor(() => expect(parsed.getPage.mock.calls).toEqual([[1], [2]]));
});

it('never shows a retired PDF count after switching sources during PDF.js load', async () => {
    const old = documentFixture(41), fresh = documentFixture(3);
    const late = deferred<typeof old>(), active = deferred<typeof fresh>();
    const destroy = vi.fn(async () => {});
    vi.mocked(getDocument).mockReturnValueOnce({ promise: late.promise, destroy } as never)
        .mockReturnValueOnce({ promise: active.promise, destroy: vi.fn(async () => {}) } as never);
    const requests = pdfReaderServer(null);
    await renderSourceFeature(<Panel/>, '/notebooks/n');
    fireEvent.click(screen.getByRole('button', { name: 'Open retained source' }));
    await waitFor(() => expect(getDocument).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Open newer source' }));
    await waitFor(() => expect(getDocument).toHaveBeenCalledTimes(2));
    await act(async () => active.resolve(fresh));
    await waitFor(() => expect(screen.getByRole('spinbutton')).toHaveAttribute('max', '3'));
    await act(async () => late.resolve(old));
    expect(screen.getByText('/ 3')).toBeVisible();
    expect(screen.getByRole('spinbutton')).toHaveAttribute('max', '3');
    expect(old.getPage).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledOnce();
    expect(requests.filter(r => r.method === 'PATCH')).toHaveLength(0);
});

it('does not substitute or persist another page when a retained position is outside the physical PDF', async () => {
    const parsed = documentFixture(2);
    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve(parsed), destroy: vi.fn(async () => {}) } as never);
    const requests = pdfReaderServer(10);
    await renderSourceFeature(<Panel/>, '/notebooks/n');
    fireEvent.click(screen.getByRole('button', { name: 'Open retained position' }));
    expect(await screen.findByText('/ 2')).toBeVisible();
    expect(screen.getByRole('spinbutton')).toHaveValue(9);
    expect(document.querySelector('[data-pdf-fallback="true"]')).toBeVisible();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(parsed.getPage).not.toHaveBeenCalled();
    expect(requests.filter(r => r.method === 'PATCH')).toHaveLength(0);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2' } });
    await waitFor(() => expect(parsed.getPage).toHaveBeenCalledExactlyOnceWith(2));
    await waitFor(() => expect(requests.filter(r => r.method === 'PATCH')).toHaveLength(1));
});

it.each([null, 2])('does not guess PDF pagination after parse failure with extraction count %s', async extractedPages => {
    // Return a failed PDF.js task only once it is polled; no live provider or corrupt file is needed.
    const requests = pdfReaderServer(extractedPages);
    vi.mocked(getDocument).mockReset().mockImplementationOnce(() => ({
        promise: Promise.reject(new Error('Unavailable PDF renderer')), destroy: vi.fn(async () => {}),
    }) as never);
    await renderSourceFeature(<Panel/>, '/notebooks/n');
    fireEvent.click(screen.getByRole('button', { name: 'Open newer source' }));
    await screen.findByText('PDF rendering is unavailable. Extracted text for this physical page is shown instead.');
    const input = screen.getByRole('spinbutton');
    const next = screen.getByRole('button', { name: 'Next' });
    if (extractedPages === null) {
        expect(input).toBeDisabled();
        expect(next).toBeDisabled();
        fireEvent.change(input, { target: { value: '19' } });
        expect(requests.filter(r => r.method === 'PATCH')).toHaveLength(0);
    } else {
        expect(input).toHaveAttribute('max', String(extractedPages));
        fireEvent.click(next);
        await waitFor(() => expect(requests.filter(r => r.method === 'PATCH')).toHaveLength(1));
        expect(next).toBeDisabled();
    }
});
