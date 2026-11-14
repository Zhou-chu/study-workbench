import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SourceDetailContent } from './SourceDetailContent'
import { sourcesApi } from '@/lib/api/sources'
import { embeddingApi } from '@/lib/api/embedding'
import { insightsApi } from '@/lib/api/insights'
import { transformationsApi } from '@/lib/api/transformations'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { SourceDetailResponse } from '@/lib/types/api'
import { toast } from 'sonner'

// useTranslation is mocked globally in setup.ts (t returns the key string)

vi.mock('@/lib/api/sources', () => ({
  sourcesApi: {
    get: vi.fn(),
  },
}))

vi.mock('@/lib/api/insights', () => ({
  insightsApi: {
    listForSource: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    waitForCommand: vi.fn(),
  },
}))

vi.mock('@/lib/api/transformations', () => ({
  transformationsApi: {
    list: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock('@/lib/api/embedding', () => ({
  embeddingApi: {
    embedContent: vi.fn(),
  },
}))

vi.mock('@/components/sources/SourceInsightDialog', () => ({
  SourceInsightDialog: () => null,
}))

vi.mock('@/components/sources/NotebookAssociations', () => ({
  NotebookAssociations: () => null,
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({ children, onValueChange, ...props }: React.PropsWithChildren<{
    onValueChange: (value: string) => void
  }>) => (
    <select {...props} aria-label="transformation" onChange={event => onValueChange(event.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: React.PropsWithChildren) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: React.PropsWithChildren) => <>{children}</>,
  SelectItem: ({ children, value }: React.PropsWithChildren<{ value: string }>) => (
    <option value={value}>{children}</option>
  ),
}))

vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  TabsList: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  TabsTrigger: ({ children }: React.PropsWithChildren) => <button>{children}</button>,
  TabsContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}))

const mockSourcesGet = vi.mocked(sourcesApi.get)
const mockListInsights = vi.mocked(insightsApi.listForSource)
const mockCreateInsight = vi.mocked(insightsApi.create)
const mockWaitForCommand = vi.mocked(insightsApi.waitForCommand)
const mockListTransformations = vi.mocked(transformationsApi.list)

const notFoundError = Object.assign(new Error('Request failed with status code 404'), {
  isAxiosError: true,
  response: { status: 404 },
})

const networkError = Object.assign(new Error('Network Error'), {
  isAxiosError: true,
  response: undefined,
})

function renderContent(onClose?: () => void, sourceId = 'source:missing') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SourceDetailContent sourceId={sourceId} onClose={onClose} />
    </QueryClientProvider>
  )
}

const loadedSource: SourceDetailResponse = {
  id: 'source:loaded',
  title: 'Loaded source',
  asset: null,
  embedded: false,
  embedded_chunks: 0,
  insights_count: 0,
  created: '2026-01-01T00:00:00Z',
  updated: '2026-01-01T00:00:00Z',
  full_text: 'Source content',
}

async function startInsightGeneration() {
  await screen.findByText('Loaded source')
  fireEvent.change(screen.getByRole('combobox', { name: 'transformation' }), {
    target: { value: 'transformation:summary' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'common.create' }))
}

describe('SourceDetailContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListInsights.mockResolvedValue([])
    mockListTransformations.mockResolvedValue([{
      id: 'transformation:summary',
      title: 'Summary',
      name: 'summary',
      description: '',
      prompt: 'Summarize',
      apply_default: false,
      model_id: null,
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-01T00:00:00Z',
    }])
  })

  it('shows the shared not-found state when the source returns 404', async () => {
    mockSourcesGet.mockRejectedValue(notFoundError)

    renderContent()

    await waitFor(() => {
      expect(screen.getByTestId('content-unavailable')).toBeInTheDocument()
    })
    expect(screen.getByText('common.contentUnavailable.notFoundTitle')).toBeInTheDocument()
    expect(screen.getByText('common.contentUnavailable.notFoundDescription')).toBeInTheDocument()
  })

  it('shows the shared load-error state for non-404 failures', async () => {
    mockSourcesGet.mockRejectedValue(networkError)

    renderContent()

    await waitFor(() => {
      expect(screen.getByTestId('content-unavailable')).toBeInTheDocument()
    })
    expect(screen.getByText('common.contentUnavailable.errorTitle')).toBeInTheDocument()
    expect(
      screen.queryByText('common.contentUnavailable.notFoundTitle')
    ).not.toBeInTheDocument()
  })

  it('shows the not-found state over stale cached data when a refetch returns 404', async () => {
    // Simulates the orphan-reference path: the source was viewed (cached),
    // then deleted; reopening it serves the retained cache while the
    // background refetch 404s. React Query keeps the previous data alongside
    // the error — the definitive 404 must still win over the stale render.
    mockSourcesGet.mockRejectedValue(notFoundError)

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const cachedSource: SourceDetailResponse = {
      id: 'source:stale',
      title: 'Deleted but cached',
      asset: null,
      embedded: false,
      embedded_chunks: 0,
      insights_count: 0,
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-01T00:00:00Z',
      full_text: 'stale content',
    }
    // Mark the cached entry as stale (older than useSource's 30s staleTime)
    // so mounting triggers a refetch, which rejects with the 404 above.
    queryClient.setQueryData(QUERY_KEYS.source('source:stale'), cachedSource, {
      updatedAt: Date.now() - 60_000,
    })

    render(
      <QueryClientProvider client={queryClient}>
        <SourceDetailContent sourceId="source:stale" />
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('content-unavailable')).toBeInTheDocument()
    })
    expect(screen.getByText('common.contentUnavailable.notFoundTitle')).toBeInTheDocument()
    expect(screen.queryByText('Deleted but cached')).not.toBeInTheDocument()
  })

  it('invokes onClose from the not-found close button', async () => {
    mockSourcesGet.mockRejectedValue(notFoundError)
    const onClose = vi.fn()

    renderContent(onClose)

    await waitFor(() => {
      expect(screen.getByText('common.close')).toBeInTheDocument()
    })
    screen.getByText('common.close').click()
    expect(onClose).toHaveBeenCalled()
  })

  it('does not start polling when creation finishes after unmount', async () => {
    mockSourcesGet.mockResolvedValue(loadedSource)
    let resolveCreate!: (value: Awaited<ReturnType<typeof insightsApi.create>>) => void
    mockCreateInsight.mockReturnValue(new Promise(resolve => {
      resolveCreate = resolve
    }))

    const view = renderContent(undefined, loadedSource.id)
    await startInsightGeneration()
    await waitFor(() => expect(mockCreateInsight).toHaveBeenCalled())

    view.unmount()
    await act(async () => {
      resolveCreate({
        status: 'pending',
        message: 'started',
        source_id: loadedSource.id,
        transformation_id: 'transformation:summary',
        command_id: 'job-1',
      })
    })

    expect(mockWaitForCommand).not.toHaveBeenCalled()
  })

  it('shows the backend error when insight generation fails', async () => {
    mockSourcesGet.mockResolvedValue(loadedSource)
    mockCreateInsight.mockResolvedValue({
      status: 'pending',
      message: 'started',
      source_id: loadedSource.id,
      transformation_id: 'transformation:summary',
      command_id: 'job-1',
    })
    mockWaitForCommand.mockResolvedValue({
      job_id: 'job-1',
      status: 'failed',
      error_message: 'Model ran out of memory',
    })

    renderContent(undefined, loadedSource.id)
    await startInsightGeneration()

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Model ran out of memory')
    })
  })

  it('does not apply terminal effects when unmounted during the final refresh', async () => {
    mockSourcesGet.mockResolvedValue(loadedSource)
    let resolveRefresh!: (value: Awaited<ReturnType<typeof insightsApi.listForSource>>) => void
    mockListInsights
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(new Promise(resolve => {
        resolveRefresh = resolve
      }))
    mockCreateInsight.mockResolvedValue({
      status: 'pending',
      message: 'started',
      source_id: loadedSource.id,
      transformation_id: 'transformation:summary',
      command_id: 'job-1',
    })
    mockWaitForCommand.mockResolvedValue({
      job_id: 'job-1',
      status: 'failed',
      error_message: 'Stale failure',
    })

    const view = renderContent(undefined, loadedSource.id)
    await startInsightGeneration()
    await waitFor(() => expect(mockListInsights).toHaveBeenCalledTimes(2))

    view.unmount()
    await act(async () => resolveRefresh([]))

    expect(toast.error).not.toHaveBeenCalledWith('Stale failure')
  })
  it('retains insight selection and gates a new attempt after uncertainty and remount', async () => {
    const startAndSettleSubmission = async () => {
      await screen.findByText('Loaded source')
      fireEvent.change(screen.getByRole('combobox', { name: 'transformation' }), {
        target: { value: 'transformation:summary' },
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'common.create' }))
      })
      await waitFor(() => expect(screen.getByRole('button', { name: 'common.create' })).not.toBeDisabled())
    }
    const id = 'source:uncertain-insight'
    mockSourcesGet.mockResolvedValue({ ...loadedSource, id })
    const unknown = { response: { status: 409, data: { detail: {
      code: 'COMMAND_SUBMISSION_UNKNOWN', retry_safe: false, message: 'private-secret', resource_id: id,
    } } } }
    mockCreateInsight.mockRejectedValue(unknown)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const view = renderContent(undefined, id)
    await startAndSettleSubmission()
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith('commandSubmission.title', { description: 'commandSubmission.warning' }))
    expect(screen.getByRole('combobox', { name: 'transformation' })).toHaveValue('transformation:summary')
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    expect(mockWaitForCommand).not.toHaveBeenCalled()
    view.unmount()
    renderContent(undefined, id)
    await startAndSettleSubmission()
    await waitFor(() => expect(confirm).toHaveBeenCalledWith('commandSubmission.newAttemptConfirm'))
    expect(mockCreateInsight).toHaveBeenCalledTimes(1)
    const warningsBeforeRetry = vi.mocked(toast.warning).mock.calls.length
    confirm.mockReturnValue(true)
    // The second rejected submission must settle through catch/finally before
    // leaving the test, not merely reach the API mock's invocation counter.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'common.create' }))
    })
    await waitFor(() => {
      expect(mockCreateInsight).toHaveBeenCalledTimes(2)
      expect(toast.warning).toHaveBeenCalledTimes(warningsBeforeRetry + 1)
      expect(screen.getByRole('button', { name: 'common.create' })).not.toBeDisabled()
    })
    confirm.mockRestore()
  })

  it('warns rather than reports failure when explicit embedding submission is uncertain', async () => {
    const id = 'source:uncertain-embed'
    mockSourcesGet.mockResolvedValue({ ...loadedSource, id })
    vi.mocked(embeddingApi.embedContent).mockRejectedValue({ response: { status: 409, data: { detail: {
      code: 'COMMAND_SUBMISSION_UNKNOWN', retry_safe: false, message: 'private-secret',
    } } } })
    renderContent(undefined, id)
    await screen.findByText('Loaded source')
    fireEvent.click(screen.getAllByRole('button', { name: 'sources.embedContent' })[0])
    await waitFor(() => expect(toast.warning).toHaveBeenCalled())
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    expect(JSON.stringify(vi.mocked(toast.warning).mock.calls)).not.toContain('private-secret')
  })

  it('announces clipboard success only after the write actually completes', async () => {
    const url = 'https://example.test/source'
    mockSourcesGet.mockResolvedValue({ ...loadedSource, asset: { url } })
    let complete!: () => void
    const writeText = vi.fn(() => new Promise<void>(resolve => { complete = resolve }))
    const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    try {
      renderContent(undefined, loadedSource.id)
      const code = await screen.findByText(url, { selector: 'code' })
      fireEvent.click(code.parentElement!.querySelector('button')!)
      expect(writeText).toHaveBeenCalledWith(url)
      expect(toast.success).not.toHaveBeenCalled()
      await act(async () => complete())
      expect(toast.success).toHaveBeenCalledWith('sources.urlCopied')
    } finally {
      if (descriptor) Object.defineProperty(navigator, 'clipboard', descriptor)
      else Reflect.deleteProperty(navigator, 'clipboard')
    }
  })

  it.each(['rejected', 'unavailable'])('reports clipboard %s without claiming success', async mode => {
    mockSourcesGet.mockResolvedValue({ ...loadedSource, asset: { url: 'https://example.test/source' } })
    const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: mode === 'unavailable' ? undefined : { writeText: vi.fn().mockRejectedValue(new Error('private browser failure')) },
    })
    try {
      renderContent(undefined, loadedSource.id)
      const button = await screen.findByRole('button', { name: 'common.copyToClipboard' })
      fireEvent.click(button)
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('common.error'))
      expect(toast.success).not.toHaveBeenCalled()
      expect(button).not.toBeDisabled()
    } finally {
      if (descriptor) Object.defineProperty(navigator, 'clipboard', descriptor)
      else Reflect.deleteProperty(navigator, 'clipboard')
    }
  })

  it('does not repeat an in-flight copy or toast after its source is unmounted', async () => {
    mockSourcesGet.mockResolvedValue({ ...loadedSource, asset: { url: 'https://example.test/source' } })
    let complete!: () => void
    const writeText = vi.fn(() => new Promise<void>(resolve => { complete = resolve }))
    const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    try {
      const view = renderContent(undefined, loadedSource.id)
      const button = await screen.findByRole('button', { name: 'common.copyToClipboard' })
      act(() => { fireEvent.click(button); fireEvent.click(button) })
      expect(writeText).toHaveBeenCalledTimes(1)
      expect(button).toBeDisabled()
      view.unmount()
      await act(async () => complete())
      expect(toast.success).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
    } finally {
      if (descriptor) Object.defineProperty(navigator, 'clipboard', descriptor)
      else Reflect.deleteProperty(navigator, 'clipboard')
    }
  })

})
