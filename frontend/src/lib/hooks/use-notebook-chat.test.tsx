import { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { chatApi } from '@/lib/api/chat'
import { QUERY_KEYS, queryClient as productionQueryClient } from '@/lib/api/query-client'
import { NotebookChatSessionWithMessages } from '@/lib/types/api'
import { useNotebookChat } from './use-notebook-chat'

vi.mock('@/lib/api/chat', () => ({ chatApi: { listSessions: vi.fn(), getSession: vi.fn(), createSession: vi.fn(), updateSession: vi.fn(), deleteSession: vi.fn(), buildContext: vi.fn(), sendMessage: vi.fn() } }))
vi.mock('@/lib/hooks/use-translation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
const session = (id = 'a', notebook_id = 'n'): NotebookChatSessionWithMessages => ({ id, notebook_id, title: id, created: '', updated: '', messages: [{ id: `${id}-history`, type: 'ai', content: id }] })
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const sources: [] = [], notes: [] = [], contextSelections = { sources: {}, notes: {} }
function setup() {
  const client = new QueryClient({ defaultOptions: productionQueryClient.getDefaultOptions() })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, ...renderHook(({ notebookId }) => useNotebookChat({ notebookId, sources, notes, contextSelections }), { wrapper, initialProps: { notebookId: 'n' } }) }
}
async function selected() {
  const hook = setup()
  await waitFor(() => expect(hook.result.current.messages).toEqual(session().messages))
  return hook
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(chatApi.listSessions).mockResolvedValue([session(), session('b')])
  vi.mocked(chatApi.getSession).mockImplementation(async id => session(id))
  vi.mocked(chatApi.buildContext).mockResolvedValue({ context: { sources: [], notes: [] }, token_count: 1, char_count: 2 })
})
describe('notebook chat ownership', () => {
  it.each(['success', 'failure'])('keeps B optimistic state and busy admission when late A ends in %s', async outcome => {
    const a = deferred<Awaited<ReturnType<typeof chatApi.sendMessage>>>()
    const b = deferred<Awaited<ReturnType<typeof chatApi.sendMessage>>>()
    vi.mocked(chatApi.sendMessage).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    const { result } = await selected()
    let first!: Promise<void>, second!: Promise<void>
    await act(async () => { first = result.current.sendMessage('A') })
    act(() => result.current.switchSession('b'))
    await waitFor(() => expect(result.current.messages).toEqual(session('b').messages))
    await act(async () => { second = result.current.sendMessage('B') })
    const before = result.current.messages
    await act(async () => { if (outcome === 'success') a.resolve({ session_id: 'a', messages: [] }); else a.reject(new Error('late A')); await first })
    expect(result.current.messages).toEqual(before)
    expect(result.current.isSending).toBe(true)
    expect(toast.error).not.toHaveBeenCalled()
    await act(async () => { b.resolve({ session_id: 'b', messages: session('b').messages }); await second })
  })
  it('admits one initial send before asynchronous session creation', async () => {
    vi.mocked(chatApi.listSessions).mockResolvedValue([])
    const creation = deferred<NotebookChatSessionWithMessages>()
    vi.mocked(chatApi.createSession).mockReturnValue(creation.promise)
    vi.mocked(chatApi.sendMessage).mockResolvedValue({ session_id: 'a', messages: [] })
    const { result } = setup()
    let first!: Promise<void>, duplicate!: Promise<void>
    act(() => { first = result.current.sendMessage('first'); duplicate = result.current.sendMessage('duplicate') })
    expect(chatApi.createSession).toHaveBeenCalledTimes(1)
    expect(result.current.isSending).toBe(true)
    await act(async () => { creation.resolve(session()); await Promise.all([first, duplicate]) })
    expect(chatApi.sendMessage).toHaveBeenCalledTimes(1)
    expect(chatApi.getSession).not.toHaveBeenCalledWith(null)
  })
  it('clears A history when B hydration fails', async () => {
    const { result } = await selected()
    vi.mocked(chatApi.getSession).mockRejectedValue(new Error('unavailable'))
    act(() => result.current.switchSession('b'))
    await waitFor(() => expect(chatApi.getSession).toHaveBeenCalledWith('b'))
    expect(result.current.messages).toEqual([])
  })
  it.each(['notebook', 'unmount', 'switch'])('fences pending creation on %s', async action => {
    vi.mocked(chatApi.listSessions).mockResolvedValue([])
    const creation = deferred<NotebookChatSessionWithMessages>()
    vi.mocked(chatApi.createSession).mockReturnValue(creation.promise)
    const { result, rerender, unmount } = setup()
    let send!: Promise<void>
    act(() => { send = result.current.sendMessage('first') })
    act(() => { if (action === 'notebook') rerender({ notebookId: 'other' }); else if (action === 'unmount') unmount(); else result.current.switchSession('b') })
    await act(async () => { creation.resolve(session()); await send })
    expect(chatApi.sendMessage).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    if (action !== 'unmount') expect(result.current.currentSessionId).toBe(action === 'switch' ? 'b' : null)
  })
  it('does not resurrect a deleted session after a pending send', async () => {
    const response = deferred<Awaited<ReturnType<typeof chatApi.sendMessage>>>()
    vi.mocked(chatApi.sendMessage).mockReturnValue(response.promise)
    const { result } = await selected()
    let send!: Promise<void>
    await act(async () => { send = result.current.sendMessage('A') })
    vi.mocked(chatApi.listSessions).mockResolvedValue([session('b')])
    await act(async () => result.current.deleteSession('a'))
    await waitFor(() => expect(result.current.currentSessionId).toBe('b'))
    await act(async () => { response.resolve({ session_id: 'a', messages: session().messages }); await send })
    expect(result.current.messages).toEqual(session('b').messages)
  })
  it('keeps completed B history when A completes last', async () => {
    const a = deferred<Awaited<ReturnType<typeof chatApi.sendMessage>>>()
    vi.mocked(chatApi.sendMessage).mockReturnValueOnce(a.promise).mockResolvedValueOnce({ session_id: 'b', messages: session('b').messages })
    const { result } = await selected()
    let first!: Promise<void>
    await act(async () => { first = result.current.sendMessage('A') })
    act(() => result.current.switchSession('b'))
    await waitFor(() => expect(result.current.messages).toEqual(session('b').messages))
    await act(async () => { await result.current.sendMessage('B') })
    const reads = vi.mocked(chatApi.getSession).mock.calls.length
    await act(async () => { a.resolve({ session_id: 'a', messages: session().messages }); await first })
    expect(result.current.messages).toEqual(session('b').messages)
    expect(chatApi.getSession).toHaveBeenCalledTimes(reads)
    expect(result.current.isSending).toBe(false)
  })
  it('releases admission after creation failure and preserves the pending model for retry', async () => {
    vi.mocked(chatApi.listSessions).mockResolvedValue([])
    const creation = deferred<NotebookChatSessionWithMessages>()
    vi.mocked(chatApi.createSession).mockReturnValueOnce(creation.promise).mockResolvedValue(session())
    vi.mocked(chatApi.sendMessage).mockResolvedValue({ session_id: 'a', messages: session().messages })
    const { result } = setup()
    act(() => result.current.setModelOverride('model'))
    let first!: Promise<void>
    act(() => { first = result.current.sendMessage('first') })
    expect(result.current.isSending).toBe(true)
    await act(async () => { creation.reject(new Error('create failed')); await first })
    expect(result.current.isSending).toBe(false)
    expect(result.current.pendingModelOverride).toBe('model')
    expect(result.current.messages).toEqual([])
    await act(async () => { await result.current.sendMessage('retry') })
    expect(chatApi.createSession).toHaveBeenLastCalledWith(expect.objectContaining({ model_override: 'model' }))
    expect(result.current.messages).toEqual(session().messages)
  })
  it('does not send after switching while context construction is pending', async () => {
    const { result } = await selected()
    const context = deferred<Awaited<ReturnType<typeof chatApi.buildContext>>>()
    vi.mocked(chatApi.buildContext).mockReturnValue(context.promise)
    let send!: Promise<void>
    act(() => { send = result.current.sendMessage('A') })
    act(() => result.current.switchSession('b'))
    await act(async () => { context.resolve({ context: { sources: [], notes: [] }, token_count: 99, char_count: 99 }); await send })
    expect(chatApi.sendMessage).not.toHaveBeenCalled()
    expect(result.current.tokenCount).toBe(1)
  })
  it('fences explicit creation when its selected session is deleted', async () => {
    const { result } = await selected()
    const creation = deferred<NotebookChatSessionWithMessages>()
    vi.mocked(chatApi.createSession).mockReturnValue(creation.promise)
    act(() => result.current.createSession('new'))
    vi.mocked(chatApi.listSessions).mockResolvedValue([session('b')])
    await act(async () => result.current.deleteSession('a'))
    await waitFor(() => expect(result.current.currentSessionId).toBe('b'))
    await act(async () => { creation.resolve(session('new')) })
    expect(result.current.currentSessionId).toBe('b')
    expect(result.current.messages).toEqual(session('b').messages)
  })
  it('does not replace optimistic text with a delayed initial history read', async () => {
    const history = deferred<NotebookChatSessionWithMessages>()
    const response = deferred<Awaited<ReturnType<typeof chatApi.sendMessage>>>()
    vi.mocked(chatApi.getSession).mockReturnValueOnce(history.promise).mockResolvedValue(session())
    vi.mocked(chatApi.sendMessage).mockReturnValue(response.promise)
    const { result, client } = setup()
    await waitFor(() => expect(result.current.currentSessionId).toBe('a'))
    let send!: Promise<void>
    await act(async () => { send = result.current.sendMessage('new question') })
    await act(async () => { history.resolve(session()) })
    await waitFor(() => expect(client.getQueryData(QUERY_KEYS.notebookChatSession('a'))).toEqual(session()))
    expect(result.current.messages.map(message => message.content)).toEqual(['new question'])
    await act(async () => { response.resolve({ session_id: 'a', messages: session().messages }); await send })
    expect(result.current.messages).toEqual(session().messages)
  })

  it.each([['before', 'send'], ['after', 'send'], ['before', 'context'], ['after', 'context']])('restores initial history resolving %s a failed %s', async (order, stage) => {
    const history = deferred<NotebookChatSessionWithMessages>()
    const failure = deferred<Awaited<ReturnType<typeof chatApi.sendMessage>>>()
    vi.mocked(chatApi.getSession).mockReturnValue(history.promise)
    vi.mocked(chatApi.sendMessage).mockReturnValue(failure.promise)
    const contextFailure = deferred<Awaited<ReturnType<typeof chatApi.buildContext>>>()
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result, client } = setup()
    await waitFor(() => expect(result.current.currentSessionId).toBe('a'))
    if (stage === 'context') vi.mocked(chatApi.buildContext).mockReturnValue(contextFailure.promise)
    let send!: Promise<void>
    await act(async () => { send = result.current.sendMessage('question') })
    if (order === 'before') {
      await act(async () => { history.resolve(session()) })
      await waitFor(() => expect(client.getQueryData(QUERY_KEYS.notebookChatSession('a'))).toEqual(session()))
    }
    await act(async () => { (stage === 'send' ? failure : contextFailure).reject(new Error('send failed')); await send })
    if (order === 'after') await act(async () => { history.resolve(session()) })
    await waitFor(() => expect(result.current.messages).toEqual(session().messages))
    expect(result.current.isSending).toBe(false)
    errorLog.mockRestore()
  })
  it('reconciles a deleted A cache even after switching to B', async () => {
    const deletion = deferred<void>()
    vi.mocked(chatApi.deleteSession).mockReturnValue(deletion.promise)
    const { result, client } = await selected()
    act(() => result.current.deleteSession('a'))
    act(() => result.current.switchSession('b'))
    await waitFor(() => expect(result.current.messages).toEqual(session('b').messages))
    vi.mocked(chatApi.listSessions).mockResolvedValue([session('b')])
    await act(async () => { deletion.resolve() })
    await waitFor(() => expect(result.current.sessions.map(item => item.id)).toEqual(['b']))
    expect(client.getQueryData(QUERY_KEYS.notebookChatSession('a'))).toBeUndefined()
    expect(result.current.currentSessionId).toBe('b')
    expect(result.current.messages).toEqual(session('b').messages)
    expect(chatApi.deleteSession).toHaveBeenCalledTimes(1)
  })
  it('reconciles an updated target after a send changes generation', async () => {
    const update = deferred<NotebookChatSessionWithMessages>()
    const response = deferred<Awaited<ReturnType<typeof chatApi.sendMessage>>>()
    vi.mocked(chatApi.updateSession).mockReturnValue(update.promise)
    vi.mocked(chatApi.sendMessage).mockReturnValue(response.promise)
    const { result } = await selected()
    act(() => result.current.updateSession('a', { title: 'renamed' }))
    let send!: Promise<void>
    await act(async () => { send = result.current.sendMessage('question') })
    const optimistic = result.current.messages
    const updated = { ...session(), title: 'renamed' }
    vi.mocked(chatApi.listSessions).mockResolvedValue([updated, session('b')])
    vi.mocked(chatApi.getSession).mockResolvedValue(updated)
    await act(async () => { update.resolve(updated) })
    await waitFor(() => expect(result.current.sessions[0].title).toBe('renamed'))
    expect(result.current.messages).toEqual(optimistic)
    expect(result.current.isSending).toBe(true)
    expect(chatApi.updateSession).toHaveBeenCalledTimes(1)
    await act(async () => { response.resolve({ session_id: 'a', messages: updated.messages }); await send })
  })
  it('reconciles explicit creation after switching without selecting the new session', async () => {
    const creation = deferred<NotebookChatSessionWithMessages>()
    vi.mocked(chatApi.createSession).mockReturnValue(creation.promise)
    const { result } = await selected()
    act(() => result.current.createSession('new'))
    act(() => result.current.switchSession('b'))
    await waitFor(() => expect(result.current.messages).toEqual(session('b').messages))
    vi.mocked(chatApi.listSessions).mockResolvedValue([session('new'), session(), session('b')])
    await act(async () => { creation.resolve(session('new')) })
    await waitFor(() => expect(result.current.sessions[0].id).toBe('new'))
    expect(result.current.currentSessionId).toBe('b')
    expect(result.current.messages).toEqual(session('b').messages)
    expect(chatApi.createSession).toHaveBeenCalledTimes(1)
  })
  it('prevents a late initial GET from replacing authoritative post-send cache history', async () => {
    const initial = deferred<NotebookChatSessionWithMessages>()
    const fresh = { ...session(), messages: [{ id: 'answer', type: 'ai' as const, content: 'fresh answer' }] }
    vi.mocked(chatApi.getSession).mockReturnValueOnce(initial.promise).mockImplementation(async id => id === 'a' ? fresh : session(id))
    vi.mocked(chatApi.sendMessage).mockResolvedValue({ session_id: 'a', messages: fresh.messages })
    const { result, client } = setup()
    await waitFor(() => expect(result.current.currentSessionId).toBe('a'))
    await act(async () => { await result.current.sendMessage('question') })
    expect(result.current.messages).toEqual(fresh.messages)
    await act(async () => { initial.resolve(session()) })
    expect(client.getQueryData(QUERY_KEYS.notebookChatSession('a'))).toEqual(fresh)
    act(() => result.current.switchSession('b'))
    await waitFor(() => expect(result.current.messages).toEqual(session('b').messages))
    act(() => result.current.switchSession('a'))
    await waitFor(() => expect(result.current.messages).toEqual(fresh.messages))
  })

})
