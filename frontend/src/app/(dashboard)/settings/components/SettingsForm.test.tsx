import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

// Radix Select measures its trigger via ResizeObserver, which jsdom lacks.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

import { SettingsForm } from './SettingsForm'

// useTranslation is mocked globally in setup.ts (t returns the key string),
// so hint keys render as their literal key names below.

vi.mock('@/lib/hooks/use-settings', () => ({
  useSettings: vi.fn(),
  useUpdateSettings: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}))

vi.mock('@/lib/hooks/use-capabilities', () => ({
  useCapabilities: vi.fn(),
}))

import { useSettings, useUpdateSettings } from '@/lib/hooks/use-settings'
import { useCapabilities } from '@/lib/hooks/use-capabilities'

const settingsData = {
  default_content_processing_engine_doc: 'auto',
  default_content_processing_engine_url: 'auto',
  default_embedding_option: 'ask',
  auto_delete_files: 'no',
  docling_ocr: true,
}

function mockCapabilities(caps: unknown, { isError = false } = {}) {
  ;(useSettings as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    data: settingsData,
    isLoading: false,
    error: null,
  })
  ;(useCapabilities as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    data: caps,
    isError,
  })
}

describe('SettingsForm engine gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('disables OCR and shows env hints when the runtimes are unavailable', () => {
    mockCapabilities({
      docling_available: false,
      crawl4ai_available: false,
      crawl4ai_remote_configured: false,
    })
    render(<SettingsForm />)

    expect(screen.getByText('settings.enableDoclingHint')).toBeInTheDocument()
    expect(screen.getByText('settings.enableCrawl4aiHint')).toBeInTheDocument()
    // Target the OCR toggle by its accessible name (from the associated Label).
    expect(
      screen.getByRole('checkbox', { name: 'settings.ocrEnabled' })
    ).toBeDisabled()
  })

  it('enables OCR and hides the hints when the runtimes are available', () => {
    mockCapabilities({
      docling_available: true,
      crawl4ai_available: true,
      crawl4ai_remote_configured: false,
    })
    render(<SettingsForm />)

    expect(screen.queryByText('settings.enableDoclingHint')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.enableCrawl4aiHint')).not.toBeInTheDocument()
    expect(
      screen.getByRole('checkbox', { name: 'settings.ocrEnabled' })
    ).not.toBeDisabled()
  })

  it('treats runtimes as available while the capability probe is still loading', () => {
    mockCapabilities(undefined)
    render(<SettingsForm />)

    // Optimistic default avoids a flash of disabled controls on a working setup.
    expect(screen.queryByText('settings.enableDoclingHint')).not.toBeInTheDocument()
    expect(
      screen.getByRole('checkbox', { name: 'settings.ocrEnabled' })
    ).not.toBeDisabled()
  })

  it('fails closed when the capability probe errors', () => {
    mockCapabilities(undefined, { isError: true })
    render(<SettingsForm />)

    // A failed probe must not advertise engines the backend couldn't verify.
    expect(screen.getByText('settings.enableDoclingHint')).toBeInTheDocument()
    expect(screen.getByText('settings.enableCrawl4aiHint')).toBeInTheDocument()
    expect(
      screen.getByRole('checkbox', { name: 'settings.ocrEnabled' })
    ).toBeDisabled()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('SettingsForm saved baseline', () => {
  const saved = { ...settingsData, docling_ocr: false, docling_formulas: false, docling_vision: false }
  let request: ReturnType<typeof deferred<typeof saved>>
  let mutateAsync: ReturnType<typeof vi.fn>

  const ocr = () => screen.getByRole('checkbox', { name: 'settings.ocrEnabled' })
  const save = () => screen.getByRole('button', { name: 'common.save' })

  beforeEach(() => {
    vi.clearAllMocks()
    mockCapabilities({ docling_available: true, crawl4ai_available: true })
    request = deferred<typeof saved>()
    mutateAsync = vi.fn(() => request.promise)
    vi.mocked(useUpdateSettings).mockReturnValue({
      mutateAsync, isPending: false,
    } as unknown as ReturnType<typeof useUpdateSettings>)
  })

  async function startSave() {
    render(<SettingsForm />)
    expect(save()).toBeDisabled()
    fireEvent.click(ocr())
    fireEvent.click(save())
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
  }

  it('becomes clean after a confirmed save', async () => {
    await startSave()
    await act(async () => request.resolve(saved))
    expect(ocr()).not.toBeChecked()
    expect(save()).toBeDisabled()
  })

  it('allows saving the original value after saving a changed value', async () => {
    await startSave()
    await act(async () => request.resolve(saved))
    await waitFor(() => expect(save()).toBeDisabled())
    fireEvent.click(ocr())
    await waitFor(() => expect(save()).toBeEnabled())
    mutateAsync.mockResolvedValueOnce({ ...saved, docling_ocr: true })
    await act(async () => fireEvent.click(save()))
    await waitFor(() => expect(mutateAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ docling_ocr: true })
    ))
  })

  it('keeps a rejected save dirty and retryable without an unhandled rejection', async () => {
    await startSave()
    await act(async () => request.reject(new Error('Save failed')))
    expect(ocr()).not.toBeChecked()
    expect(save()).toBeEnabled()
    fireEvent.click(ocr())
    await waitFor(() => expect(save()).toBeDisabled())
  })

  it('preserves edits made while saving, including a return to the old baseline', async () => {
    await startSave()
    fireEvent.click(ocr())
    await act(async () => request.resolve(saved))
    expect(ocr()).toBeChecked()
    expect(save()).toBeEnabled()
  })

  it('preserves edits to another field while advancing the submitted field baseline', async () => {
    await startSave()
    const formulas = screen.getByRole('checkbox', { name: 'settings.formulasEnabled' })
    fireEvent.click(formulas)
    await act(async () => request.resolve(saved))
    expect(formulas).toBeChecked()
    expect(save()).toBeEnabled()
    fireEvent.click(formulas)
    await waitFor(() => expect(save()).toBeDisabled())
  })

  it('uses the confirmed response as baseline and excludes settings outside the form', async () => {
    await startSave()
    await act(async () => request.resolve({
      ...saved, docling_ocr: true, youtube_preferred_languages: ['en'],
    } as typeof saved))
    expect(ocr()).not.toBeChecked()
    expect(save()).toBeEnabled()
    fireEvent.click(ocr())
    await waitFor(() => expect(save()).toBeDisabled())
  })

  it('treats an in-flight ABA edit back to the saved value as clean', async () => {
    await startSave()
    fireEvent.click(ocr())
    fireEvent.click(ocr())
    await act(async () => request.resolve(saved))
    expect(ocr()).not.toBeChecked()
    expect(save()).toBeDisabled()
  })
})
