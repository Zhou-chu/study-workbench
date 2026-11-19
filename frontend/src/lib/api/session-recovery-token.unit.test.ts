import { beforeEach, afterEach, expect, it, vi } from 'vitest'

beforeEach(() => { vi.resetModules(); localStorage.clear() })
afterEach(() => { vi.restoreAllMocks() })

it('review: a legacy login remains usable in memory if writes fail while reads still work', async () => {
 const { getAuthToken, setLegacyAuthToken, purgeLegacyAuth } = await import('../auth-token')
 purgeLegacyAuth()
 vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError') })
 setLegacyAuthToken('synthetic-storage-unavailable-password')
 expect(getAuthToken('legacy_password')).toBe('synthetic-storage-unavailable-password')
})
it('volatile legacy authorization is invalidated by another tab and by device purge', async () => {
 const { getAuthToken, setLegacyAuthToken, purgeLegacyAuth } = await import('../auth-token')
 vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError') })
 setLegacyAuthToken('synthetic-volatile')
 expect(getAuthToken('legacy_password')).toBe('synthetic-volatile')
 window.dispatchEvent(new StorageEvent('storage', { key: 'auth-storage', newValue: null }))
 expect(getAuthToken('legacy_password')).toBeNull()
 setLegacyAuthToken('synthetic-volatile-again'); purgeLegacyAuth()
 expect(getAuthToken('legacy_password')).toBeNull()
})
it('volatile legacy fallback yields to a changed persistent baseline', async () => {
 const { getAuthToken, setLegacyAuthToken } = await import('../auth-token')
 const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError') })
 setLegacyAuthToken('synthetic-volatile')
 expect(getAuthToken('legacy_password')).toBe('synthetic-volatile')
 write.mockRestore()
 localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'synthetic-other-tab' } }))
 expect(getAuthToken('legacy_password')).toBe('synthetic-other-tab')
})

it('review: legacy credential removal in another tab must stop sending the removed password', async () => {
  const { getAuthToken, purgeLegacyAuth } = await import('../auth-token')
  purgeLegacyAuth()
  localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'synthetic-legacy-password' } }))
  expect(getAuthToken('legacy_password')).toBe('synthetic-legacy-password')
  // This is what a different tab's legacy signout does to shared origin storage.
  localStorage.removeItem('auth-storage')
  window.dispatchEvent(new StorageEvent('storage', { key: 'auth-storage', newValue: null, storageArea: localStorage }))
  expect(getAuthToken('legacy_password')).toBeNull()
})
