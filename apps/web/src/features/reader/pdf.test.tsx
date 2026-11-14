import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PdfView as PdfCanvas } from './PdfView';
import { I18nProvider } from '../../i18n';
import { render as rtlRender } from '@testing-library/react';
import type { PdfZoom } from './pdf-render-sizing';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
vi.mock('pdfjs-dist', () => ({ getDocument: vi.fn(), GlobalWorkerOptions: { workerSrc: '' } }));
const renderPage = vi.fn();
const getPage = vi.fn();
const destroy = vi.fn();
const cancel = vi.fn();
const blob = new Blob(['%PDF-fixture']);
Object.defineProperty(blob, 'arrayBuffer', { value: async () => new Uint8Array([37, 80, 68, 70]).buffer });
const page = { getViewport: ({ scale }: {
        scale: number;
    }) => ({ width: 600 * scale, height: 800 * scale }), render: renderPage };
function deferred<T = void>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function pendingRender() {
    const result = deferred();
    const cancellation = deferred();
    // Like PDF.js, cancellation rejects only after rendering has actually stopped.
    return { promise: result.promise, cancel: vi.fn(() => { void cancellation.promise.then(() => result.reject(new Error('Rendering cancelled'))); }), settleCancellation: () => cancellation.resolve(), resolve: () => result.resolve() };
}
let initialWidth = 300;
let resizeCallback: ResizeObserverCallback;
let disconnect: ReturnType<typeof vi.fn>;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
function observeWidth(width: number) { expect(resizeCallback).toBeTypeOf('function'); act(() => resizeCallback([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver)); }
function flushFrames() { act(() => { const scheduled = [...frames.values()]; frames.clear(); scheduled.forEach(callback => callback(0)); }); }
function resize(width: number) { observeWidth(width); flushFrames(); }
function Harness({ pageIndex = 0, initialZoom = 'fit' }: {
    pageIndex?: number;
    initialZoom?: PdfZoom;
}) {
    const [zoom, setZoom] = useState<PdfZoom>(initialZoom);
    return <PdfCanvas blob={blob} pageIndex={pageIndex} fallbackText={`page ${pageIndex + 1}`} zoom={zoom} onZoomChange={setZoom}/>;
}
function render(node: React.ReactNode) { return rtlRender(node, { wrapper: ({ children }) => <I18nProvider initialLocale="en-US">{children}</I18nProvider> }); }
function props(pageIndex = 0, zoom: PdfZoom = 'fit') { return { blob, pageIndex, zoom, onZoomChange: vi.fn(), fallbackText: 'Selected page text' }; }
function canvasElement() { return document.querySelector('canvas')!; }
async function ready() { await waitFor(() => expect(canvasElement()).toHaveAttribute('data-render-state', 'ready')); return canvasElement(); }
describe('PdfCanvas', () => {
    beforeEach(() => {
        getPage.mockReset();
        renderPage.mockReset();
        vi.mocked(getDocument).mockReset();
        initialWidth = 300;
        frames = new Map();
        nextFrame = 0;
        disconnect = vi.fn();
        vi.stubGlobal('ResizeObserver', class {
            constructor(callback: ResizeObserverCallback) { resizeCallback = callback; }
            observe = vi.fn();
            disconnect = disconnect;
        });
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; }));
        vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => { frames.delete(id); }));
        vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => initialWidth);
        vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(2);
        destroy.mockResolvedValue(undefined);
        vi.mocked(getDocument).mockReturnValue({ promise: Promise.resolve({ getPage, numPages: 10 }), destroy } as never);
        getPage.mockResolvedValue(page);
        renderPage.mockReturnValue({ promise: Promise.resolve(), cancel });
    });
    afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
    it('renders the requested physical page from protected bytes with local assets', async () => {
        render(<PdfCanvas {...props(7)}/>);
        const canvas = await ready();
        expect(canvas).toHaveAttribute('data-page-number', '8');
        expect(getPage).toHaveBeenCalledWith(8);
        expect(getDocument).toHaveBeenCalledWith(expect.objectContaining({ data: new Uint8Array([37, 80, 68, 70]), enableXfa: false, cMapUrl: '/pdfjs/6.4.299/cmaps/', standardFontDataUrl: '/pdfjs/6.4.299/standard_fonts/', wasmUrl: '/pdfjs/6.4.299/wasm/' }));
        expect(GlobalWorkerOptions.workerSrc).toBe('/pdfjs/6.4.299/pdf.worker.min.mjs');
        expect(renderPage).toHaveBeenCalledWith(expect.objectContaining({ canvas }));
        expect(canvas).toHaveAttribute('width', '600');
        expect(document.querySelector('iframe')).not.toBeInTheDocument();
    });
    it('shows a labeled selected-page text fallback instead of a blank pane on render failure', async () => {
        renderPage.mockImplementation(() => ({ promise: Promise.reject(new Error('unsupported canvas')), cancel }));
        render(<PdfCanvas {...props(1)} fallbackText="第二页的提取文字"/>);
        expect(await screen.findByText('PDF rendering is unavailable. Extracted text for this physical page is shown instead.')).toBeInTheDocument();
        expect(screen.getByText('第二页的提取文字')).toBeInTheDocument();
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });
    it('offers the original when parsing fails and no selected-page text exists', async () => {
        vi.mocked(getDocument).mockImplementation(() => ({ promise: Promise.reject(new Error('invalid PDF')), destroy }) as never);
        render(<PdfCanvas {...props()} fallbackText=""/>);
        expect(await screen.findByText('PDF rendering is unavailable. Extracted text for this physical page is shown instead.')).toBeInTheDocument();
        expect(screen.getByText('No extracted text is available for this page. Download the original version to read it.')).toBeInTheDocument();
    });
    it('fit_resize_rerenders_without_reloading_document', async () => {
        render(<Harness pageIndex={3}/>);
        const canvas = await ready();
        expect(canvas).toHaveStyle({ width: '300px', height: '400px' });
        expect(renderPage).toHaveBeenLastCalledWith(expect.objectContaining({ viewport: expect.objectContaining({ width: 300, height: 400 }), transform: [2, 0, 0, 2, 0, 0] }));
        observeWidth(420);
        observeWidth(450);
        observeWidth(0);
        observeWidth(NaN);
        expect(renderPage).toHaveBeenCalledTimes(1);
        flushFrames();
        await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(2));
        await ready();
        expect(canvas).toHaveStyle({ width: '450px', height: '600px' });
        expect(canvas).toHaveAttribute('width', '900');
        resize(450);
        expect(renderPage).toHaveBeenCalledTimes(2);
        expect(getDocument).toHaveBeenCalledTimes(1);
        expect(getPage.mock.calls.every(([number]) => number === 4)).toBe(true);
        expect(canvas).not.toHaveClass('max-w-full');
        expect(canvas.parentElement).toHaveClass('pdf-scroll');
        expect(canvas.parentElement).toHaveStyle({ scrollbarGutter: 'stable' });
    });
    it('numeric_zoom_survives_resize', async () => {
        render(<Harness initialZoom={2} pageIndex={5}/>);
        const canvas = await ready();
        expect(canvas).toHaveStyle({ width: '1200px', height: '1600px' });
        resize(150);
        await ready();
        expect(canvas).toHaveStyle({ width: '1200px', height: '1600px' });
        expect(canvas).toHaveAttribute('data-page-number', '6');
        expect(getDocument).toHaveBeenCalledTimes(1);
    });
    it('zoom_limits_and_fit_keep_page', async () => {
        render(<Harness pageIndex={7}/>);
        const canvas = await ready();
        expect(screen.getByText('50%')).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
        await waitFor(() => expect(canvas).toHaveStyle({ width: '450px' }));
        fireEvent.click(screen.getByRole('button', { name: '100%' }));
        await waitFor(() => expect(canvas).toHaveStyle({ width: '600px' }));
        for (let step = 0; step < 8; step++)
            fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
        await waitFor(() => expect(canvas).toHaveStyle({ width: '1800px' }));
        expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
        for (let step = 0; step < 11; step++)
            fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
        await waitFor(() => expect(canvas).toHaveStyle({ width: '150px' }));
        expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Fit width' }));
        await waitFor(() => expect(canvas).toHaveStyle({ width: '300px' }));
        fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
        await waitFor(() => expect(canvas).toHaveStyle({ width: '150px' }));
        expect(canvas).toHaveAttribute('data-page-number', '8');
        expect(getDocument).toHaveBeenCalledTimes(1);
    });
    it('tiny fit percentages stay positive and the first zoom step uses the effective fit scale', async () => {
        initialWidth = 1;
        render(<Harness />);
        const canvas = await ready();
        expect(screen.getByText('0.167%')).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
        await waitFor(() => expect(canvas).toHaveStyle({ width: '151px' }));
    });
    it('zero_width_waits_until_visible', async () => {
        initialWidth = 0;
        render(<Harness />);
        await waitFor(() => expect(getDocument).toHaveBeenCalledTimes(1));
        expect(renderPage).not.toHaveBeenCalled();
        expect(canvasElement().width * canvasElement().height).toBe(0);
        resize(-1);
        resize(0);
        expect(renderPage).not.toHaveBeenCalled();
        resize(240);
        expect(await ready()).toHaveStyle({ width: '240px', height: '320px' });
    });
    it('cleanup_disconnects_and_cancels_frame', async () => {
        const { unmount } = render(<Harness />);
        await ready();
        observeWidth(500);
        expect(frames.size).toBe(1);
        unmount();
        expect(disconnect).toHaveBeenCalledTimes(1);
        expect(cancelAnimationFrame).toHaveBeenCalled();
        expect(frames.size).toBe(0);
    });
    it.each(['zoom', 'width', 'page'] as const)('cancel_settles_before_canvas_reuse: %s', async (change) => {
        const first = pendingRender();
        renderPage.mockReturnValueOnce(first);
        const { rerender } = render(<PdfCanvas {...props()}/>);
        await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(1));
        const canvas = canvasElement();
        const originalWidth = canvas.width, originalHeight = canvas.height;
        if (change === 'width')
            resize(450);
        else
            rerender(<PdfCanvas {...props(change === 'page' ? 1 : 0, change === 'zoom' ? 2 : 'fit')}/>);
        await waitFor(() => expect(first.cancel).toHaveBeenCalled());
        expect(renderPage).toHaveBeenCalledTimes(1);
        expect(canvas.width).toBe(originalWidth);
        expect(canvas.height).toBe(originalHeight);
        await act(async () => first.settleCancellation());
        await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(2));
        await ready();
        expect(canvas).toHaveStyle({ width: change === 'zoom' ? '1200px' : change === 'width' ? '450px' : '300px' });
        expect(screen.queryByText('PDF rendering is unavailable. Extracted text for this physical page is shown instead.')).not.toBeInTheDocument();
    });
    it('late_generation_cannot_mark_new_page_ready', async () => {
        const oldPage = deferred<typeof page>();
        getPage.mockReturnValueOnce(oldPage.promise);
        const latestRender = pendingRender();
        renderPage.mockReturnValueOnce(latestRender);
        const { rerender } = render(<PdfCanvas {...props()}/>);
        await waitFor(() => expect(getPage).toHaveBeenCalledTimes(1));
        rerender(<PdfCanvas {...props(1, 2)}/>);
        await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(1));
        await act(async () => oldPage.resolve(page));
        expect(renderPage).toHaveBeenCalledTimes(1);
        expect(canvasElement()).toHaveAttribute('data-render-state', 'loading');
        expect(canvasElement()).toHaveStyle({ width: '1200px' });
        await act(async () => latestRender.resolve());
        expect(await ready()).toHaveAttribute('data-page-number', '2');
    });
    it('unmount_cancels_and_releases_backing_store', async () => {
        const first = pendingRender();
        renderPage.mockReturnValueOnce(first);
        const { unmount } = render(<Harness />);
        await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(1));
        const canvas = canvasElement();
        expect(canvas.width).toBeGreaterThan(0);
        unmount();
        expect(first.cancel).toHaveBeenCalled();
        expect(canvas.width).toBeGreaterThan(0);
        expect(destroy).toHaveBeenCalledTimes(1);
        expect(disconnect).toHaveBeenCalledTimes(1);
        await act(async () => first.settleCancellation());
        expect(canvas.width).toBe(0);
        expect(canvas.height).toBe(0);
        expect(renderPage).toHaveBeenCalledTimes(1);
    });
    it('rapid zoom and width generations wait for settlement and only the latest allocates', async () => {
        const first = pendingRender();
        renderPage.mockReturnValueOnce(first);
        const { rerender } = render(<PdfCanvas {...props()}/>);
        await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(1));
        rerender(<PdfCanvas {...props(0, 2)}/>);
        resize(400);
        rerender(<PdfCanvas {...props(0, 3)}/>);
        resize(600);
        expect(first.cancel).toHaveBeenCalledTimes(1);
        expect(renderPage).toHaveBeenCalledTimes(1);
        expect(canvasElement()).toHaveAttribute('width', '600');
        await act(async () => first.settleCancellation());
        await ready();
        expect(renderPage).toHaveBeenCalledTimes(2);
        expect(canvasElement()).toHaveStyle({ width: '1800px', height: '2400px' });
        expect(canvasElement().width).toBeLessThanOrEqual(3200);
        expect(canvasElement().height).toBeLessThanOrEqual(3200);
    });
    it('a stale render resolution cannot make a pending newer generation ready', async () => {
        const first = pendingRender();
        const nextPage = deferred<typeof page>();
        renderPage.mockReturnValueOnce(first);
        const { rerender } = render(<PdfCanvas {...props()}/>);
        await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(1));
        getPage.mockReturnValueOnce(nextPage.promise);
        rerender(<PdfCanvas {...props(1, 2)}/>);
        expect(first.cancel).toHaveBeenCalled();
        await act(async () => first.resolve());
        await waitFor(() => expect(getPage).toHaveBeenCalledTimes(2));
        expect(canvasElement()).toHaveAttribute('data-render-state', 'loading');
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
        await act(async () => nextPage.resolve(page));
        expect(await ready()).toHaveAttribute('data-page-number', '2');
    });
    it('late page failures and unmounted page completions do not render or show a stale fallback', async () => {
        const oldPage = deferred<typeof page>();
        getPage.mockReturnValueOnce(oldPage.promise);
        const { rerender, unmount } = render(<PdfCanvas {...props()}/>);
        await waitFor(() => expect(getPage).toHaveBeenCalledTimes(1));
        rerender(<PdfCanvas {...props(1)}/>);
        await ready();
        await act(async () => oldPage.reject(new Error('Old page failed')));
        expect(canvasElement()).toHaveAttribute('data-render-state', 'ready');
        expect(screen.queryByText('PDF rendering is unavailable. Extracted text for this physical page is shown instead.')).not.toBeInTheDocument();
        const unmountedPage = deferred<typeof page>();
        getPage.mockReturnValueOnce(unmountedPage.promise);
        rerender(<PdfCanvas {...props(2)}/>);
        await waitFor(() => expect(getPage).toHaveBeenCalledTimes(3));
        const target = canvasElement();
        unmount();
        await act(async () => unmountedPage.resolve(page));
        expect(renderPage).toHaveBeenCalledTimes(1);
        expect(target.width).toBe(0);
        expect(target.height).toBe(0);
    });
    it('document replacement destroys its owner and ignores late loading completion', async () => {
        const oldDocument = deferred<{
            getPage: typeof getPage;
        }>();
        const oldDestroy = vi.fn().mockResolvedValue(undefined);
        vi.mocked(getDocument).mockReturnValueOnce({ promise: oldDocument.promise, destroy: oldDestroy } as never);
        const { rerender, unmount } = render(<PdfCanvas {...props()}/>);
        await waitFor(() => expect(getDocument).toHaveBeenCalledTimes(1));
        const replacement = new Blob(['new PDF']);
        Object.defineProperty(replacement, 'arrayBuffer', { value: async () => new ArrayBuffer(0) });
        rerender(<PdfCanvas {...props(1)} blob={replacement}/>);
        await ready();
        expect(oldDestroy).toHaveBeenCalledTimes(1);
        await act(async () => oldDocument.resolve({ getPage }));
        expect(renderPage).toHaveBeenCalledTimes(1);
        expect(canvasElement()).toHaveAttribute('data-page-number', '2');
        unmount();
        expect(destroy).toHaveBeenCalledTimes(1);
    });
    it('uses a cleaned up window resize fallback when ResizeObserver is absent', async () => {
        vi.stubGlobal('ResizeObserver', undefined);
        const add = vi.spyOn(window, 'addEventListener');
        const remove = vi.spyOn(window, 'removeEventListener');
        const { unmount } = render(<Harness />);
        await ready();
        initialWidth = 420;
        act(() => window.dispatchEvent(new Event('resize')));
        flushFrames();
        await waitFor(() => expect(canvasElement()).toHaveStyle({ width: '420px' }));
        const listener = add.mock.calls.find(([name]) => name === 'resize')?.[1];
        expect(listener).toBeDefined();
        unmount();
        expect(remove).toHaveBeenCalledWith('resize', listener);
    });
});
it('keeps the document and page across theme-only rerenders', async () => { sourceSetup(); const view = render(<PdfCanvas {...props(3)}/>); await ready(); document.documentElement.dataset.theme = 'dark'; view.rerender(<PdfCanvas {...props(3)}/>); await ready(); expect(getDocument).toHaveBeenCalledTimes(1); expect(canvasElement()).toHaveAttribute('data-page-number', '4'); });
function sourceSetup() { vi.clearAllMocks(); vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300); destroy.mockResolvedValue(undefined); vi.mocked(getDocument).mockReturnValue({ promise: Promise.resolve({ getPage, numPages: 10 }), destroy } as never); getPage.mockResolvedValue(page); renderPage.mockReturnValue({ promise: Promise.resolve(), cancel }); }
