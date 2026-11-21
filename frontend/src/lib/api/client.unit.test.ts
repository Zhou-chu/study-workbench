import type { InternalAxiosRequestConfig } from 'axios'
import { expect, it, vi } from 'vitest'

import apiClient from './client'

vi.mock('@/lib/auth/session-coordinator', () => ({
  sessionCoordinator: { current: () => 1 },
}))
vi.mock('./browser-transport', () => ({
  protectedApiPath: (path: string) => path,
  prepareBrowserRequest: async (_method: string, path: string) => ({
    url: `/api${path}`,
    credentials: 'same-origin',
    headers: {},
  }),
  assertResourceDispatch: () => {},
}))

it('preserves multipart data and request options without a manual content-type header', async () => {
  const body = new FormData()
  const file = new File(['draft'], 'draft.txt')
  body.append('file', file)
  const signal = new AbortController().signal
  const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => ({
    data: {}, status: 200, statusText: 'OK', headers: {}, config,
  }))

  await apiClient.post('/personal/imports/portable', body, {
    adapter, signal, timeout: 42, responseType: 'blob',
  })

  expect(adapter).toHaveBeenCalledTimes(1)
  const [request] = adapter.mock.calls[0]
  expect(request.data).toBe(body)
  expect((request.data as FormData).get('file')).toBe(file)
  expect(request).toMatchObject({ signal, timeout: 42, responseType: 'blob' })
  expect(request.headers.get('Content-Type')).not.toContain('application/json')
})
