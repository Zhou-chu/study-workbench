import { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { toast } from 'sonner'
import { useSourceChat } from './use-source-chat'
import { sourceChatApi } from '@/lib/api/source-chat'
import { queryClient as productionQueryClient } from '@/lib/api/query-client'
import type { SourceChatSessionWithMessages } from '@/lib/types/api'

vi.mock('@/lib/api/source-chat', () => ({
  sourceChatApi: {
    listSessions: vi.fn(), getSession: vi.fn(), createSession: vi.fn(),
    sendMessage: vi.fn(), updateSession: vi.fn(), deleteSession: vi.fn(),
  },
}))
vi.mock('@/lib/hooks/use-translation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const session = (id = 'chat_session:abc', sourceId = 'source:xyz'): SourceChatSessionWithMessages => ({
  id, title: 'Session', source_id: sourceId, created: '2026-01-01T00:00:00', updated: '2026-01-01T00:00:00', messages: [],
})
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
function streamFixture() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const cancel = vi.fn()
  const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value }, cancel })
  return { stream, cancel, close: () => controller.close(), bytes: (value: Uint8Array) => controller.enqueue(value),
    event: (data: unknown) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)) }
}
function setup(sourceId = 'source:xyz') {
  // Match production freshness/retry policy instead of silently relying on staleTime: 0.
  const queryClient = new QueryClient({ defaultOptions: productionQueryClient.getDefaultOptions() })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  return { queryClient, ...renderHook(({ id }) => useSourceChat(id), { wrapper, initialProps: { id: sourceId } }) }
}
async function selected() {
  const hook = setup()
  await waitFor(() => expect(hook.result.current.currentSessionId).toBe('chat_session:abc'))
  await waitFor(() => expect(sourceChatApi.getSession).toHaveBeenCalled())
  return hook
}

describe('useSourceChat', () => {
  afterEach(() => vi.restoreAllMocks())
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(sourceChatApi.listSessions).mockResolvedValue([session()])
    vi.mocked(sourceChatApi.getSession).mockImplementation(async (sourceId, sessionId) => session(sessionId, sourceId))
  })

  it('restores context indicators from the loaded session', async () => {
    const indicators = { sources: ['source:xyz'], insights: [], notes: [] }
    vi.mocked(sourceChatApi.getSession).mockResolvedValue({ ...session(), messages: [{ id: 'm1', type: 'human', content: 'hello' }], context_indicators: indicators })
    const { result } = setup()
    await waitFor(() => expect(result.current.contextIndicators).toEqual(indicators))
    expect(result.current.messages).toHaveLength(1)
  })

  it('admits only one send synchronously, including while automatic session creation is pending', async () => {
    vi.mocked(sourceChatApi.listSessions).mockResolvedValue([])
    const creation = deferred<SourceChatSessionWithMessages>()
    vi.mocked(sourceChatApi.createSession).mockReturnValue(creation.promise)
    const stream = streamFixture()
    vi.mocked(sourceChatApi.sendMessage).mockResolvedValue(stream.stream)
    const { result } = setup()
    let first!: Promise<void>
    act(() => { first = result.current.sendMessage('first'); void result.current.sendMessage('duplicate') })
    expect(sourceChatApi.createSession).toHaveBeenCalledTimes(1)
    expect(result.current.isStreaming).toBe(true)
    await act(async () => { creation.resolve(session()); await Promise.resolve() })
    expect(sourceChatApi.sendMessage).toHaveBeenCalledTimes(1)
    act(() => { void result.current.sendMessage('another duplicate') })
    expect(sourceChatApi.sendMessage).toHaveBeenCalledTimes(1)
    await act(async () => { stream.close(); await first })
  })

  it.each(['cancel', 'switch', 'source', 'unmount'] as const)('fences a delayed automatic session creation after %s', async action => {
    vi.mocked(sourceChatApi.listSessions).mockResolvedValue([])
    const creation = deferred<SourceChatSessionWithMessages>()
    vi.mocked(sourceChatApi.createSession).mockReturnValue(creation.promise)
    const { result, rerender, unmount } = setup()
    let send!: Promise<void>
    act(() => { send = result.current.sendMessage('first') })
    act(() => {
      if (action === 'cancel') result.current.cancelStreaming()
      if (action === 'switch') result.current.switchSession('chat_session:other')
      if (action === 'source') rerender({ id: 'source:other' })
      if (action === 'unmount') unmount()
    })
    await act(async () => { creation.resolve(session()); await send })
    expect(sourceChatApi.sendMessage).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    if (action !== 'unmount') {
      expect(result.current.currentSessionId).toBe(action === 'switch' ? 'chat_session:other' : null)
      expect(result.current.isStreaming).toBe(false)
    }
  })

  it('explicit cancellation aborts the request and releases the reader without refetching or an error toast', async () => {
    const stream = streamFixture()
    vi.mocked(sourceChatApi.sendMessage).mockResolvedValue(stream.stream)
    const { result } = await selected()
    let send!: Promise<void>
    await act(async () => { send = result.current.sendMessage('first') })
    const readsBeforeCancel = vi.mocked(sourceChatApi.getSession).mock.calls.length
    const signal = vi.mocked(sourceChatApi.sendMessage).mock.calls[0][3]
    expect(signal).toBeInstanceOf(AbortSignal)
    act(() => result.current.cancelStreaming())
    await act(async () => { await send })
    expect(signal?.aborted).toBe(true)
    expect(stream.cancel).toHaveBeenCalledTimes(1)
    expect(result.current.isStreaming).toBe(false)
    expect(sourceChatApi.getSession).toHaveBeenCalledTimes(readsBeforeCancel)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('unmount aborts an already-open stream', async () => {
    const stream = streamFixture()
    vi.mocked(sourceChatApi.sendMessage).mockResolvedValue(stream.stream)
    const { result, unmount } = await selected()
    let send!: Promise<void>
    await act(async () => { send = result.current.sendMessage('first') })
    const signal = vi.mocked(sourceChatApi.sendMessage).mock.calls[0][3]
    unmount()
    expect(signal?.aborted).toBe(true)
    await act(async () => { await send })
    expect(stream.cancel).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it.each(['switch', 'source'] as const)('%s cancels the old stream and cannot load a session under the wrong source', async action => {
    const oldStream = streamFixture()
    vi.mocked(sourceChatApi.sendMessage).mockResolvedValue(oldStream.stream)
    vi.mocked(sourceChatApi.listSessions).mockImplementation(async sourceId => sourceId === 'source:xyz' ? [session()] : [session('chat_session:new', sourceId)])
    const { result, rerender } = await selected()
    let send!: Promise<void>
    await act(async () => { send = result.current.sendMessage('old') })
    const signal = vi.mocked(sourceChatApi.sendMessage).mock.calls[0][3]
    act(() => {
      oldStream.event({ type: 'ai_message', content: 'late old text' })
      if (action === 'switch') result.current.switchSession('chat_session:new')
      else rerender({ id: 'source:new' })
    })
    expect(signal?.aborted).toBe(true)
    await act(async () => { await send })
    await waitFor(() => expect(result.current.currentSessionId).toBe('chat_session:new'))
    expect(result.current.messages).toEqual([])
    expect(result.current.contextIndicators).toBeNull()
    expect(sourceChatApi.getSession).not.toHaveBeenCalledWith('source:new', 'chat_session:abc')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('a queued chunk from a canceled send cannot overwrite a newer send or its streaming state', async () => {
    const oldStream = streamFixture(), newStream = streamFixture()
    vi.mocked(sourceChatApi.sendMessage).mockResolvedValueOnce(oldStream.stream).mockResolvedValueOnce(newStream.stream)
    const { result } = await selected()
    let oldSend!: Promise<void>, newSend!: Promise<void>
    await act(async () => { oldSend = result.current.sendMessage('old') })
    act(() => {
      oldStream.bytes(new TextEncoder().encode('data: {"type":"ai_message","content":"late old text"}\n\ndata: {"type":"context_indicators","data":{"sources":["source:old"],"insights":[],"notes":[]}}\n\n'))
      oldStream.close()
      result.current.cancelStreaming()
      newSend = result.current.sendMessage('new')
    })
    await act(async () => { await oldSend; newStream.event({ type: 'ai_message', content: 'new text' }) })
    expect(result.current.isStreaming).toBe(true)
    expect(result.current.messages.map(message => message.content)).toEqual(['old', 'new', 'new text'])
    expect(result.current.contextIndicators).toBeNull()
    await act(async () => { result.current.cancelStreaming(); await newSend })
  })

  it('cancels a late response body after a new send starts', async () => {
    const response = deferred<ReadableStream<Uint8Array> | null>()
    const oldStream = streamFixture(), newStream = streamFixture()
    vi.mocked(sourceChatApi.sendMessage).mockReturnValueOnce(response.promise).mockResolvedValueOnce(newStream.stream)
    const { result } = await selected()
    let oldSend!: Promise<void>, newSend!: Promise<void>
    act(() => { oldSend = result.current.sendMessage('old'); result.current.cancelStreaming(); newSend = result.current.sendMessage('new') })
    await act(async () => { response.resolve(oldStream.stream); await Promise.resolve() })
    expect(oldStream.cancel).toHaveBeenCalledTimes(1)
    await act(async () => { await oldSend })
    expect(result.current.isStreaming).toBe(true)
    expect(result.current.messages.map(message => message.content)).toEqual(['old', 'new'])
    expect(toast.error).not.toHaveBeenCalled()
    await act(async () => { result.current.cancelStreaming(); await newSend })
  })

  it('a late rejection cannot remove a newer optimistic message or show a cancellation error', async () => {
    const response = deferred<ReadableStream<Uint8Array> | null>()
    const stream = streamFixture()
    vi.mocked(sourceChatApi.sendMessage).mockReturnValueOnce(response.promise).mockResolvedValueOnce(stream.stream)
    const { result } = await selected()
    let oldSend!: Promise<void>, newSend!: Promise<void>
    act(() => { oldSend = result.current.sendMessage('old'); result.current.cancelStreaming(); newSend = result.current.sendMessage('new') })
    await act(async () => { response.reject(new Error('late network failure')); await oldSend })
    expect(result.current.messages.map(message => message.content)).toEqual(['old', 'new'])
    expect(result.current.isStreaming).toBe(true)
    expect(toast.error).not.toHaveBeenCalled()
    await act(async () => { result.current.cancelStreaming(); await newSend })
  })

  it('keeps live text and context when an earlier session read finishes, preserving split UTF-8/SSE parsing', async () => {
    const loaded = deferred<SourceChatSessionWithMessages>()
    vi.mocked(sourceChatApi.getSession).mockReturnValueOnce(loaded.promise)
    const stream = streamFixture()
    vi.mocked(sourceChatApi.sendMessage).mockResolvedValue(stream.stream)
    const { result } = await selected()
    let send!: Promise<void>
    await act(async () => { send = result.current.sendMessage('question') })
    const bytes = new TextEncoder().encode('data: {"type":"ai_message","content":"中文😀"}\n\n')
    const split = bytes.indexOf(0xe4) + 1
    const indicators = { sources: ['source:live'], insights: [], notes: [] }
    await act(async () => { stream.bytes(bytes.slice(0, split)) })
    await act(async () => { stream.bytes(bytes.slice(split)); stream.event({ type: 'context_indicators', data: indicators }) })
    await act(async () => { loaded.resolve({ ...session(), messages: [{ id: 'stale', type: 'ai', content: 'stale' }] }); await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(result.current.messages.map(message => message.content)).toEqual(['question', '中文😀'])
    expect(result.current.contextIndicators).toEqual(indicators)
    await act(async () => { result.current.cancelStreaming(); await send })
  })

  it('refreshes only the actual newly-created session on normal completion', async () => {
    vi.mocked(sourceChatApi.listSessions).mockResolvedValue([])
    vi.mocked(sourceChatApi.createSession).mockResolvedValue(session('chat_session:created'))
    const persisted = { ...session('chat_session:created'), messages: [{ id: 'persisted', type: 'ai' as const, content: 'saved' }] }
    vi.mocked(sourceChatApi.getSession).mockResolvedValue(persisted)
    const stream = streamFixture()
    vi.mocked(sourceChatApi.sendMessage).mockResolvedValue(stream.stream)
    const { result } = setup()
    let send!: Promise<void>
    await act(async () => { send = result.current.sendMessage('question') })
    await act(async () => { stream.close(); await send })
    await waitFor(() => expect(result.current.messages).toEqual(persisted.messages))
    expect(vi.mocked(sourceChatApi.getSession).mock.calls.every(([sourceId, sessionId]) => sourceId === 'source:xyz' && sessionId === 'chat_session:created')).toBe(true)
  })

  it('does not select a delayed explicit creation after a session switch', async () => {
    const creation = deferred<SourceChatSessionWithMessages>()
    vi.mocked(sourceChatApi.createSession).mockReturnValue(creation.promise)
    const { result } = await selected()
    act(() => { result.current.createSession({ title: 'new' }) })
    await waitFor(() => expect(sourceChatApi.createSession).toHaveBeenCalledTimes(1))
    act(() => result.current.switchSession('chat_session:other'))
    await act(async () => { creation.resolve(session('chat_session:late')); await creation.promise })
    expect(result.current.currentSessionId).toBe('chat_session:other')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('selecting the already-selected session preserves its loaded conversation', async () => {
    const loaded = { ...session(), messages: [{ id: 'loaded', type: 'human' as const, content: 'keep me' }] }
    vi.mocked(sourceChatApi.getSession).mockResolvedValue(loaded)
    const { result } = await selected()
    await waitFor(() => expect(result.current.messages).toEqual(loaded.messages))
    act(() => result.current.switchSession('chat_session:abc'))
    expect(result.current.messages).toEqual(loaded.messages)
  })

  it('does not mutate a canceled partial AI message when the next send starts in the same millisecond', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000)
    const first = streamFixture(), second = streamFixture()
    vi.mocked(sourceChatApi.sendMessage).mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream)
    const { result } = await selected()
    let oldSend!: Promise<void>, newSend!: Promise<void>
    await act(async () => { oldSend = result.current.sendMessage('old') })
    await act(async () => first.event({ type: 'ai_message', content: 'old partial' }))
    await act(async () => { result.current.cancelStreaming(); await oldSend; newSend = result.current.sendMessage('new') })
    await act(async () => second.event({ type: 'ai_message', content: 'new' }))
    await act(async () => second.event({ type: 'ai_message', content: ' answer' }))
    expect(result.current.messages.filter(message => message.type === 'ai').map(message => message.content)).toEqual(['old partial', 'new answer'])
    await act(async () => { result.current.cancelStreaming(); await newSend })
  })

  it('a canceled automatic creation cannot replace or dispatch ahead of its newer creation', async () => {
    vi.mocked(sourceChatApi.listSessions).mockResolvedValue([])
    const oldCreation = deferred<SourceChatSessionWithMessages>(), newCreation = deferred<SourceChatSessionWithMessages>()
    vi.mocked(sourceChatApi.createSession).mockReturnValueOnce(oldCreation.promise).mockReturnValueOnce(newCreation.promise)
    const stream = streamFixture()
    vi.mocked(sourceChatApi.sendMessage).mockResolvedValue(stream.stream)
    const { result } = setup()
    let oldSend!: Promise<void>, newSend!: Promise<void>
    act(() => { oldSend = result.current.sendMessage('old'); result.current.cancelStreaming(); newSend = result.current.sendMessage('new') })
    await act(async () => { oldCreation.resolve(session('chat_session:old')); await oldSend })
    expect(result.current.currentSessionId).toBeNull()
    expect(result.current.isStreaming).toBe(true)
    expect(sourceChatApi.sendMessage).not.toHaveBeenCalled()
    await act(async () => { newCreation.resolve(session('chat_session:new')) })
    expect(result.current.currentSessionId).toBe('chat_session:new')
    expect(sourceChatApi.sendMessage).toHaveBeenCalledTimes(1)
    expect(vi.mocked(sourceChatApi.sendMessage).mock.calls[0].slice(0, 3)).toEqual(['source:xyz', 'chat_session:new', { message: 'new' }])
    await act(async () => { result.current.cancelStreaming(); await newSend })
  })

  it('a completed send cannot apply its delayed persisted-session refresh over a newer send', async () => {
    const oldStream = streamFixture(), newStream = streamFixture()
    vi.mocked(sourceChatApi.sendMessage).mockResolvedValueOnce(oldStream.stream).mockResolvedValueOnce(newStream.stream)
    const { result } = await selected()
    const persisted = deferred<SourceChatSessionWithMessages>()
    vi.mocked(sourceChatApi.getSession).mockReturnValueOnce(persisted.promise)
    let oldSend!: Promise<void>, newSend!: Promise<void>
    await act(async () => { oldSend = result.current.sendMessage('old'); oldStream.close() })
    await waitFor(() => expect(sourceChatApi.getSession).toHaveBeenCalledTimes(2))
    await act(async () => { newSend = result.current.sendMessage('new') })
    await act(async () => { persisted.resolve({ ...session(), messages: [{ id: 'stale', type: 'ai', content: 'stale refresh' }] }); await oldSend })
    expect(result.current.messages.map(message => message.content)).toEqual(['old', 'new'])
    expect(result.current.isStreaming).toBe(true)
    await act(async () => { result.current.cancelStreaming(); await newSend })
  })


  it('ignores a late session read after switching to another session', async () => {
    const oldRead = deferred<SourceChatSessionWithMessages>()
    const indicators = { sources: ['source:current'], insights: [], notes: [] }
    const current = { ...session('chat_session:current'), messages: [{ id: 'current', type: 'ai' as const, content: 'current' }], context_indicators: indicators }
    vi.mocked(sourceChatApi.getSession).mockReturnValueOnce(oldRead.promise).mockResolvedValue(current)
    const { result } = await selected()
    act(() => result.current.switchSession('chat_session:current'))
    await waitFor(() => expect(result.current.messages).toEqual(current.messages))
    await act(async () => { oldRead.resolve({ ...session(), messages: [{ id: 'old', type: 'ai', content: 'old' }] }); await oldRead.promise })
    expect(result.current.messages).toEqual(current.messages)
    expect(result.current.contextIndicators).toEqual(indicators)
  })


  it('releases an open response body when the server sends a stream error', async () => {
    const stream = streamFixture()
    vi.mocked(sourceChatApi.sendMessage).mockResolvedValue(stream.stream)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = await selected()
    let send!: Promise<void>
    await act(async () => { send = result.current.sendMessage('question') })
    await act(async () => { stream.event({ type: 'error', message: 'stream failed' }); await send })
    expect(stream.cancel).toHaveBeenCalledTimes(1)
    expect(result.current.isStreaming).toBe(false)
    expect(toast.error).toHaveBeenCalledTimes(1)
  })


  it.each([false, true])('forces a fresh completion read despite the production cache policy (pre-send read pending: %s)', async pendingRead => {
    const oldRead = deferred<SourceChatSessionWithMessages>()
    const persisted = {
      ...session(),
      messages: [{ id: 'saved', type: 'ai' as const, content: 'complete answer' }],
      context_indicators: { sources: ['source:persisted'], insights: [], notes: [] }
    }
    vi.mocked(sourceChatApi.getSession).mockResolvedValueOnce(session())
    if (pendingRead) vi.mocked(sourceChatApi.getSession).mockReturnValueOnce(oldRead.promise)
    vi.mocked(sourceChatApi.getSession).mockResolvedValue(persisted)
    const stream = streamFixture()
    vi.mocked(sourceChatApi.sendMessage).mockResolvedValue(stream.stream)
    const { result, queryClient } = await selected()
    const queryKey = ['sourceChatSession', 'source:xyz', 'chat_session:abc']
    await waitFor(() => expect(queryClient.getQueryState(queryKey)?.fetchStatus).toBe('idle'))
    expect(queryClient.getDefaultOptions().queries?.staleTime).toBe(5 * 60 * 1000)
    expect(queryClient.getQueryData<SourceChatSessionWithMessages>(queryKey)?.messages).toEqual([])

    let earlierRefetch: Promise<void> | undefined
    if (pendingRead) {
      act(() => { earlierRefetch = queryClient.refetchQueries({ queryKey, exact: true }) })
      await waitFor(() => expect(sourceChatApi.getSession).toHaveBeenCalledTimes(2))
    }
    let send!: Promise<void>
    await act(async () => { send = result.current.sendMessage('question') })
    await act(async () => { stream.event({ type: 'ai_message', content: 'complete answer' }) })
    expect(result.current.messages.map(message => message.content)).toContain('complete answer')
    await act(async () => { stream.close(); await send })

    expect(sourceChatApi.getSession).toHaveBeenCalledTimes(pendingRead ? 3 : 2)
    expect(result.current.messages).toEqual(persisted.messages)
    expect(result.current.contextIndicators).toEqual(persisted.context_indicators)
    if (pendingRead) {
      await act(async () => { oldRead.resolve(session()); await earlierRefetch })
      expect(result.current.messages).toEqual(persisted.messages)
      expect(queryClient.getQueryData<SourceChatSessionWithMessages>(queryKey)?.messages).toEqual(persisted.messages)
    }
    expect(sourceChatApi.sendMessage).toHaveBeenCalledTimes(1)
    expect(sourceChatApi.createSession).not.toHaveBeenCalled()
  })

})
