'use client'

import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { useTranslation } from '@/lib/hooks/use-translation'

export function PdfTextFallback({ text }: { text: string }) {
  const { t } = useTranslation()
  return <div className="rounded-md border p-3 space-y-2" role="status" data-pdf-fallback="true">
    <p className="text-sm text-muted-foreground">{t('workbench.pdfRenderFallback')}</p>
    <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7">{text || t('workbench.pdfNoPageText')}</pre>
  </div>
}

export function PdfCanvas({ blob, pageIndex, fallbackText }: { blob: Blob; pageIndex: number; fallbackText: string }) {
  const { t } = useTranslation()
  const container = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [renderState, setRenderState] = useState<{ page: number; state: 'loading' | 'ready' | 'failed' }>({ page: pageIndex, state: 'loading' })

  useEffect(() => {
    let stopped = false
    let task: PDFDocumentLoadingTask | undefined
    setPdf(null)
    setLoadFailed(false)
    void (async () => {
      const pdfjs = await import('pdfjs-dist')
      const bytes = new Uint8Array(await blob.arrayBuffer())
      if (stopped) return
      const assets = '/pdfjs/6.4.299/'
      pdfjs.GlobalWorkerOptions.workerSrc = `${assets}pdf.worker.min.mjs`
      task = pdfjs.getDocument({ data: bytes, cMapUrl: `${assets}cmaps/`, cMapPacked: true, standardFontDataUrl: `${assets}standard_fonts/`, wasmUrl: `${assets}wasm/`, enableXfa: false })
      const document = await task.promise
      if (!stopped) setPdf(document)
    })().catch(() => { if (!stopped) setLoadFailed(true) })
    return () => { stopped = true; void task?.destroy().catch(() => {}) }
  }, [blob])

  useEffect(() => {
    if (!pdf) return
    let stopped = false
    let task: RenderTask | undefined
    setRenderState({ page: pageIndex, state: 'loading' })
    void (async () => {
      const page = await pdf.getPage(pageIndex + 1)
      if (stopped || !canvas.current) return
      const original = page.getViewport({ scale: 1 })
      // Bound raster memory while keeping the original PDF page proportions.
      const width = container.current?.clientWidth || 760
      const scale = Math.min(width / original.width, 1600 / original.height, 1.5)
      const viewport = page.getViewport({ scale })
      const density = Math.min(window.devicePixelRatio || 1, 2)
      canvas.current.width = Math.floor(viewport.width * density)
      canvas.current.height = Math.floor(viewport.height * density)
      task = page.render({ canvas: canvas.current, viewport, transform: density === 1 ? undefined : [density, 0, 0, density, 0, 0] })
      await task.promise
      if (!stopped) setRenderState({ page: pageIndex, state: 'ready' })
    })().catch(() => { if (!stopped) setRenderState({ page: pageIndex, state: 'failed' }) })
    return () => { stopped = true; task?.cancel() }
  }, [pdf, pageIndex])

  const state = loadFailed ? 'failed' : renderState.page === pageIndex && pdf ? renderState.state : 'loading'
  return <div ref={container} className="w-full" data-pdf-render-state={state}>
    {state === 'loading' && <p role="status" className="rounded-md border p-3 text-sm text-muted-foreground">{t('workbench.pdfRendering')}</p>}
    {state === 'failed' && <PdfTextFallback text={fallbackText} />}
    <canvas ref={canvas} role="img" aria-label={t('workbench.pdfReader')} hidden={state !== 'ready'} data-render-state={state} data-page-number={pageIndex + 1} className="max-w-full h-auto rounded-md border" />
  </div>
}
