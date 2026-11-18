import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const cfg = vi.hoisted(() => ({ authMode: 'device_sessions', apiUrl: '', webSessionProtocol: 'bff-memory-v1' }))
vi.mock('@/lib/config', () => ({ getConfig: vi.fn(async () => cfg), getApiUrl: async () => cfg.apiUrl, resetConfig: vi.fn() }))
const request = vi.fn<typeof fetch>()
beforeEach(async () => { vi.resetModules(); const { getConfig } = await import('@/lib/config'); vi.mocked(getConfig).mockReset().mockImplementation(async () => cfg as never); cfg.authMode = 'device_sessions'; cfg.apiUrl = ''; request.mockReset(); vi.stubGlobal('fetch', request); localStorage.clear() })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear() })
async function store() { return (await import('./auth-store')).useAuthStore }
describe('metadata-only device bootstrap and recovery', () => {
  it('does not read/send passwords until config establishes an explicit legacy mode', async () => {
    const { getConfig } = await import('@/lib/config')
    vi.mocked(getConfig).mockRejectedValueOnce(new Error('configuration unavailable'))
    localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'do-not-send' } }))
    const read = vi.spyOn(Storage.prototype, 'getItem'); const auth = await store()
    await auth.getState().bootstrap()
    expect(request).not.toHaveBeenCalled(); expect(read.mock.calls).not.toContainEqual(['auth-storage'])
    expect(auth.getState().phase).toBe('unavailable')
  })
})
