import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import apiClient from './client'
vi.mock('@/lib/config', () => ({ getApiUrl: async () => 'http://localhost:5055' }))
vi.mock('@/lib/auth-token', () => ({ getAuthToken: () => 'local-app-test-password' }))
const fakeWindow = { location: { href: '/notebooks' } }
function rejected401(data: unknown) {
  return async (config: InternalAxiosRequestConfig) => {
    const response = { data, status: 401, statusText: 'Unauthorized', headers: {}, config } as AxiosResponse
    throw new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, undefined, response)
  }
}
describe('separate application and Google authentication', () => {
  beforeEach(() => { localStorage.setItem('auth-storage', 'local-session'); fakeWindow.location.href = '/notebooks'; vi.stubGlobal('window', fakeWindow) })
  afterEach(() => { localStorage.clear(); vi.unstubAllGlobals() })
  it('keeps the app login when only the Google connection expires', async () => {
    await expect(apiClient.get('/personal/notebooklm/notebooks', { adapter: rejected401({ error: { code: 'NEEDS_REAUTH', message: 'Google sign-in expired' } }) })).rejects.toThrow('Unauthorized')
    expect(localStorage.getItem('auth-storage')).toBe('local-session')
    expect(fakeWindow.location.href).toBe('/notebooks')
  })
  it('still clears app auth and redirects on an actual application authentication failure', async () => {
    await expect(apiClient.get('/personal/notebooks/n/workspace', { adapter: rejected401({ detail: 'Invalid password' }) })).rejects.toThrow('Unauthorized')
    expect(localStorage.getItem('auth-storage')).toBeNull()
    expect(fakeWindow.location.href).toBe('/login')
  })
})
