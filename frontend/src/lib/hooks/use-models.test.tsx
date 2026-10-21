import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { modelsApi } from '@/lib/api/models'
import { useModelDefaults } from './use-models'

vi.mock('@/lib/api/models', () => ({ modelsApi: { getDefaults: vi.fn() } }))

describe('useModelDefaults', () => {
  it('does not inherit automatic retries and recovers only after an explicit recheck', async () => {
    vi.mocked(modelsApi.getDefaults).mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue({ default_chat_model: 'model:test' } as never)
    const client = new QueryClient({ defaultOptions: { queries: { retry: 3, retryDelay: 0 } } })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const { result } = renderHook(() => useModelDefaults(), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(modelsApi.getDefaults).toHaveBeenCalledTimes(1)
    await act(async () => { await result.current.refetch() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(modelsApi.getDefaults).toHaveBeenCalledTimes(2)
    expect(result.current.data?.default_chat_model).toBe('model:test')
    client.clear()
  })
})
