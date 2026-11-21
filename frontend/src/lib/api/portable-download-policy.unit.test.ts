import { expect, it, vi } from 'vitest'

vi.mock('./client', () => {
 const defaults = { adapter: vi.fn() }
 return { default: { defaults, get: (...args: unknown[]) => defaults.adapter(...args) } }
})

it('review: server supplied export paths must not select unrelated personal resource routes', async () => {
  const { portableApi } = await import('./portable')
  const { default: apiClient } = await import('./client')
  const adapter = vi.fn(async config => ({ status: 200, statusText: 'OK', data: new Blob(['private']), headers: {}, config }))
  apiClient.defaults.adapter = adapter
  await expect(portableApi.download('/personal/notebooks/synthetic/workspace')).rejects.toThrow()
  expect(adapter).not.toHaveBeenCalled()
})
