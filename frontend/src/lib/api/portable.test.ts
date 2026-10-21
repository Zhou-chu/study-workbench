import { describe, expect, it, vi } from 'vitest'
import { portableApi } from './portable'
import apiClient from './client'
vi.mock('./client', () => ({ default: { get: vi.fn(async () => ({ data: new Blob(['ok']) })) } }))
describe('protected download boundary', () => {
  it('refuses external URLs before attaching the application token', async () => {
    await expect(portableApi.download('https://untrusted.example/file')).rejects.toThrow('Invalid protected download path')
    expect(apiClient.get).not.toHaveBeenCalled()
  })
  it('uses the existing authenticated client for own API paths', async () => {
    await portableApi.download('/api/personal/exports/test/download')
    expect(apiClient.get).toHaveBeenCalledWith('/personal/exports/test/download', { responseType: 'blob', signal: undefined })
  })
})
