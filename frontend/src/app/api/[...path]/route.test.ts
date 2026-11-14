import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as resource from './route'
import * as auth from '../auth/[...path]/route'
import * as ask from '../search/ask/route'
import * as portable from '../personal/imports/portable/route'

const origin = 'https://workbench.example'
beforeEach(() => {
  vi.stubEnv('STUDY_WORKBENCH_AUTH_MODE', 'device_sessions')
  vi.stubEnv('STUDY_WORKBENCH_WEB_ORIGIN', origin)
  vi.stubEnv('STUDY_WORKBENCH_AUTH_ORIGINS', origin)
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('explicit Node route handlers', () => {
  it('exports all methods so Next cannot synthesize protected HEAD/OPTIONS behavior', () => {
    for (const handlers of [resource, auth, ask, portable]) {
      expect(handlers.runtime).toBe('nodejs')
      expect(handlers.dynamic).toBe('force-dynamic')
      for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const) expect(handlers[method]).toBeTypeOf('function')
    }
  })
  it('does not forward unknown routes or unsupported HEAD, and answers OPTIONS locally', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect((await resource.GET(new Request(`${origin}/api/private/new-route`))).status).toBe(404)
    expect((await auth.HEAD(new Request(`${origin}/api/auth/status`, { method: 'HEAD' }))).status).toBe(405)
    expect((await resource.HEAD(new Request(`${origin}/api/notes`, { method: 'HEAD' }))).status).toBe(405)
    expect((await resource.OPTIONS(new Request(`${origin}/api/notes`, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST' } }))).status).toBe(204)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('routes public Web status through actual backend mode verification', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ auth_enabled: true, auth_mode: 'device_sessions', protocol_version: 1 }))
    vi.stubGlobal('fetch', fetchMock)
    const response = await auth.GET(new Request(`${origin}/api/auth/status`))
    expect(await response.json()).toEqual({ auth_enabled: true, auth_mode: 'device_sessions', protocol_version: 1, web: { phase: 'anonymous', session: null } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('fails invalid runtime configuration closed before any forwarding', async () => {
    vi.stubEnv('STUDY_WORKBENCH_AUTH_MODE', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const response = await resource.GET(new Request(`${origin}/api/notes`))
    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe('AUTH_UNAVAILABLE')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('preserves default legacy status without extending it into Web authentication', async () => {
    vi.stubEnv('STUDY_WORKBENCH_AUTH_MODE', 'legacy_password')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ auth_enabled: false, message: 'Authentication is disabled' })))
    const response = await auth.GET(new Request(`${origin}/api/auth/status`))
    expect(await response.json()).toEqual({ auth_enabled: false, message: 'Authentication is disabled' })
  })
})
