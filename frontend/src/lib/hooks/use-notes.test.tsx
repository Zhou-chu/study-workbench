import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { notesApi } from '@/lib/api/notes'
import { useCreateNote, useDeleteNote, useUpdateNote } from './use-notes'
vi.mock('@/lib/api/notes', () => ({ notesApi: { create: vi.fn(), update: vi.fn(), delete: vi.fn() } }))
vi.mock('@/lib/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
beforeEach(() => {
  vi.resetAllMocks()
  for (const method of [notesApi.create, notesApi.update, notesApi.delete]) vi.mocked(method).mockRejectedValue(new Error('acknowledgement lost'))
})
it.each([
  { name: 'create', hook: useCreateNote, api: notesApi.create, input: { notebook_id: 'notebook:1', title: 'Draft', content: 'Body' } },
  { name: 'update', hook: useUpdateNote, api: notesApi.update, input: { id: 'note:1', data: { title: 'Draft', content: 'Body', expected_revision: 7 } } },
  { name: 'delete', hook: useDeleteNote, api: notesApi.delete, input: 'note:1' },
])('never retries note $name after an ambiguous response even with global mutation retry enabled', async ({ hook, api, input }) => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: 1, retryDelay: 0 } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const { result } = renderHook(() => hook(), { wrapper })
  await act(async () => { await expect(result.current.mutateAsync(input as never)).rejects.toThrow('acknowledgement lost') })
  expect(api).toHaveBeenCalledTimes(1)
})
