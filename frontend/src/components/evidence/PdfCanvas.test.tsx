import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PdfCanvas } from './PdfCanvas'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'

vi.mock('pdfjs-dist', () => ({ getDocument: vi.fn(), GlobalWorkerOptions: { workerSrc: '' } }))
const renderPage = vi.fn()
const getPage = vi.fn()
const destroy = vi.fn()
const cancel = vi.fn()
const blob = new Blob(['%PDF-fixture'])
Object.defineProperty(blob, 'arrayBuffer', { value: async () => new Uint8Array([37, 80, 68, 70]).buffer })

describe('PdfCanvas', () => {
  beforeEach(() => {
    destroy.mockResolvedValue(undefined)
    vi.mocked(getDocument).mockReturnValue({ promise: Promise.resolve({ getPage, numPages: 10 }), destroy } as never)
    getPage.mockResolvedValue({ getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }), render: renderPage })
    renderPage.mockReturnValue({ promise: Promise.resolve(), cancel })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as never)
  })
  afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })
  it('renders the requested physical page from protected bytes with local assets', async () => {
    render(<PdfCanvas blob={blob} pageIndex={7} fallbackText="Extracted page eight" />)
    const canvas = await screen.findByRole('img', { name: 'workbench.pdfReader' })
    await waitFor(() => expect(canvas).toHaveAttribute('data-render-state', 'ready'))
    expect(canvas).toHaveAttribute('data-page-number', '8')
    expect(getPage).toHaveBeenCalledWith(8)
    expect(getDocument).toHaveBeenCalledWith(expect.objectContaining({ data: new Uint8Array([37, 80, 68, 70]), enableXfa: false, cMapUrl: '/pdfjs/6.4.299/cmaps/', standardFontDataUrl: '/pdfjs/6.4.299/standard_fonts/', wasmUrl: '/pdfjs/6.4.299/wasm/' }))
    expect(GlobalWorkerOptions.workerSrc).toBe('/pdfjs/6.4.299/pdf.worker.min.mjs')
    expect(renderPage).toHaveBeenCalledWith(expect.objectContaining({ canvas }))
    expect(canvas).toHaveAttribute('width', expect.stringMatching(/^[1-9]\d+$/))
    expect(document.querySelector('iframe')).not.toBeInTheDocument()
  })
  it('shows a labeled selected-page text fallback instead of a blank pane on render failure', async () => {
    renderPage.mockImplementation(() => ({ promise: Promise.reject(new Error('unsupported canvas')), cancel }))
    render(<PdfCanvas blob={blob} pageIndex={1} fallbackText="第二页的提取文字" />)
    expect(await screen.findByText('workbench.pdfRenderFallback')).toBeInTheDocument()
    expect(screen.getByText('第二页的提取文字')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
  it('keeps a loading label and cancels stale page rendering', async () => {
    renderPage.mockReturnValueOnce({ promise: new Promise(() => {}), cancel })
    const { rerender, unmount } = render(<PdfCanvas blob={blob} pageIndex={0} fallbackText="one" />)
    await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(1))
    expect(screen.getByText('workbench.pdfRendering')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    rerender(<PdfCanvas blob={blob} pageIndex={1} fallbackText="two" />)
    await waitFor(() => expect(screen.getByRole('img')).toHaveAttribute('data-page-number', '2'))
    expect(cancel).toHaveBeenCalled()
    unmount()
    expect(destroy).toHaveBeenCalled()
  })
  it('offers the original when parsing fails and no selected-page text exists', async () => {
    vi.mocked(getDocument).mockImplementation(() => ({ promise: Promise.reject(new Error('invalid PDF')), destroy }) as never)
    render(<PdfCanvas blob={blob} pageIndex={0} fallbackText="" />)
    expect(await screen.findByText('workbench.pdfRenderFallback')).toBeInTheDocument()
    expect(screen.getByText('workbench.pdfNoPageText')).toBeInTheDocument()
  })
})
