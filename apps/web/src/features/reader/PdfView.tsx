import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { pdfRenderSizing, type PdfZoom } from './pdf-render-sizing';
export function PdfTextFallback({ text }: {
    text: string;
}) {
    const { t } = useI18n();
    return <div className="rounded-md border p-3 space-y-2" role="status" data-pdf-fallback="true">
    <p className="text-sm text-muted-foreground">{t.workbench.pdfRenderFallback}</p>
    <pre className="reader-text">{text || t.workbench.pdfNoPageText}</pre>
  </div>;
}
interface Props {
    blob: Blob;
    pageIndex: number;
    fallbackText: string;
    zoom: PdfZoom;
    onZoomChange: (zoom: PdfZoom) => void;
}
interface RenderOwner {
    task: RenderTask;
    settled: Promise<void>;
    cancelled: boolean;
}
export function PdfView({ blob, pageIndex, fallbackText, zoom, onZoomChange }: Props) {
    const { t } = useI18n();
    const container = useRef<HTMLDivElement>(null);
    const canvas = useRef<HTMLCanvasElement>(null);
    const generation = useRef(0);
    const liveRender = useRef<RenderOwner | null>(null);
    const [loaded, setLoaded] = useState<{
        blob: Blob;
        pdf: PDFDocumentProxy;
    } | null>(null);
    const pdf = loaded?.blob === blob ? loaded.pdf : null;
    const [loadFailed, setLoadFailed] = useState<Blob | null>(null);
    const [width, setWidth] = useState(0);
    const [geometry, setGeometry] = useState<{
        pdf: PDFDocumentProxy;
        page: number;
        width: number;
        height: number;
    } | null>(null);
    const [renderState, setRenderState] = useState<{
        pdf: PDFDocumentProxy;
        page: number;
        zoom: PdfZoom;
        width: number;
        state: 'loading' | 'ready' | 'failed';
    } | null>(null);
    useEffect(() => {
        const element = container.current;
        if (!element)
            return;
        let stopped = false;
        let frame: number | undefined;
        let latestWidth = element.clientWidth;
        if (Number.isFinite(latestWidth) && latestWidth > 0)
            setWidth(latestWidth);
        const observeWidth = (value: number) => {
            if (stopped || !Number.isFinite(value) || value <= 0 || value === latestWidth)
                return;
            latestWidth = value;
            if (frame !== undefined)
                return;
            frame = requestAnimationFrame(() => {
                frame = undefined;
                if (!stopped)
                    setWidth(previous => previous === latestWidth ? previous : latestWidth);
            });
        };
        const measure = () => observeWidth(element.clientWidth);
        const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(entries => {
            const entry = entries[entries.length - 1];
            if (entry)
                observeWidth(entry.contentRect.width);
        });
        if (observer)
            observer.observe(element);
        else
            window.addEventListener('resize', measure);
        return () => {
            stopped = true;
            observer?.disconnect();
            window.removeEventListener('resize', measure);
            if (frame !== undefined)
                cancelAnimationFrame(frame);
        };
    }, []);
    useEffect(() => {
        let stopped = false;
        let task: PDFDocumentLoadingTask | undefined;
        setLoaded(null);
        setLoadFailed(null);
        void (async () => {
            const pdfjs = await import('pdfjs-dist');
            const bytes = new Uint8Array(await blob.arrayBuffer());
            if (stopped)
                return;
            const assets = '/pdfjs/6.4.299/';
            pdfjs.GlobalWorkerOptions.workerSrc = `${assets}pdf.worker.min.mjs`;
            task = pdfjs.getDocument({ data: bytes, cMapUrl: `${assets}cmaps/`, cMapPacked: true, standardFontDataUrl: `${assets}standard_fonts/`, wasmUrl: `${assets}wasm/`, enableXfa: false });
            const document = await task.promise;
            if (!stopped)
                setLoaded({ blob, pdf: document });
        })().catch(() => { if (!stopped)
            setLoadFailed(blob); });
        return () => { stopped = true; void task?.destroy().catch(() => { }); };
    }, [blob]);
    useEffect(() => {
        const nextGeneration = () => ++generation.current;
        const isGeneration = (value: number) => generation.current === value;
        const current = nextGeneration();
        const target = canvas.current;
        const isCurrent = () => isGeneration(current);
        const cancelRender = () => {
            const owner = liveRender.current;
            if (owner && !owner.cancelled) {
                owner.cancelled = true;
                owner.task.cancel();
            }
            return owner?.settled ?? Promise.resolve();
        };
        if (pdf && target && width > 0) {
            const identity = { pdf, page: pageIndex, zoom, width };
            setRenderState({ ...identity, state: 'loading' });
            void (async () => {
                // Cancellation is not settlement. Never resize or reuse a live canvas.
                await cancelRender();
                if (!isCurrent())
                    return;
                const page = await pdf.getPage(pageIndex + 1);
                if (!isCurrent())
                    return;
                const original = page.getViewport({ scale: 1 });
                const size = pdfRenderSizing(original.width, original.height, width, zoom, window.devicePixelRatio);
                if (!size)
                    throw new Error('Invalid PDF page geometry');
                setGeometry({ pdf, page: pageIndex, width: original.width, height: original.height });
                const viewport = page.getViewport({ scale: size.scale });
                target.width = size.pixelWidth;
                target.height = size.pixelHeight;
                target.style.width = `${size.cssWidth}px`;
                target.style.height = `${size.cssHeight}px`;
                const task = page.render({ canvas: target, viewport, transform: size.rasterScale === 1 ? undefined : [size.rasterScale, 0, 0, size.rasterScale, 0, 0] });
                const owner: RenderOwner = { task, settled: task.promise.then(() => { }, () => { }), cancelled: false };
                liveRender.current = owner;
                try {
                    await task.promise;
                    if (isCurrent())
                        setRenderState({ ...identity, state: 'ready' });
                }
                finally {
                    if (liveRender.current === owner)
                        liveRender.current = null;
                }
            })().catch(() => { if (isCurrent())
                setRenderState({ ...identity, state: 'failed' }); });
        }
        return () => {
            const retired = nextGeneration();
            const settlement = cancelRender();
            void settlement.then(() => {
                // A replacement generation owns the same node; only final cleanup clears it.
                if (isGeneration(retired) && target) {
                    target.width = 0;
                    target.height = 0;
                }
            });
        };
    }, [pdf, pageIndex, zoom, width]);
    const size = geometry?.pdf === pdf && geometry.page === pageIndex
        ? pdfRenderSizing(geometry.width, geometry.height, width, zoom, window.devicePixelRatio) : null;
    const state = loadFailed === blob ? 'failed' : renderState?.pdf === pdf && renderState.page === pageIndex && renderState.zoom === zoom && renderState.width === width ? renderState.state : 'loading';
    const stepZoom = (step: number) => { if (size)
        onZoomChange(Math.max(0.25, Math.min(3, size.scale + step))); };
    return <div className="pdf-view" data-pdf-render-state={state}>
    <div role="group" aria-label={t.workbench.pdfZoomControls} className="reader-controls">
      <Button type="button" onClick={() => onZoomChange('fit')}>{t.workbench.pdfFitWidth}</Button>
      <Button type="button" onClick={() => onZoomChange(1)}>{t.workbench.pdfActualSize}</Button>
      <Button type="button" disabled={!size || size.scale <= 0.25} onClick={() => stepZoom(-0.25)}>{t.workbench.pdfZoomOut}</Button>
      <Button type="button" disabled={!size || size.scale >= 3} onClick={() => stepZoom(0.25)}>{t.workbench.pdfZoomIn}</Button>
      <span className="text-sm text-muted-foreground">{size ? t.workbench.pdfZoomPercentage.replace('{{percent}}', String(Number((size.scale * 100).toPrecision(3)))) : t.workbench.unavailable}</span>
    </div>
    {state === 'loading' && <p role="status" className="rounded-md border p-3 text-sm text-muted-foreground">{t.workbench.pdfRendering}</p>}
    {state === 'failed' && <PdfTextFallback text={fallbackText}/>}
    <div ref={container} className="pdf-scroll" style={{ scrollbarGutter: 'stable' }}>
      <canvas ref={canvas} width={0} height={0} role="img" aria-label={t.workbench.pdfReader} hidden={state !== 'ready'} data-render-state={state} data-page-number={pageIndex + 1} className="pdf-canvas"/>
    </div>
  </div>;
}
