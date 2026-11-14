import { afterEach, describe, expect, it, vi } from 'vitest'
import { getWebSessionConfig, matchApiRoute } from './session-proxy-policy'

afterEach(() => vi.unstubAllEnvs())

const allowed = [
  ['GET', '/api/personal/web-search/status'],
  ['POST', '/api/personal/web-search'],
  ['POST', '/api/personal/notebooks/notebook%3Atest/sources/web-import'],
  ['POST', '/api/personal/notebooks/notebook%3Atest/source-snapshots'],
] as const

describe.each(['legacy_password', 'device_sessions'])('research routes in %s', mode => {
  it.each(allowed)('allows only the reviewed %s %s JSON resource', (method, url) => {
    vi.stubEnv('STUDY_WORKBENCH_AUTH_MODE', mode)
    vi.stubEnv('STUDY_WORKBENCH_WEB_ORIGIN', 'https://workbench.example')
    vi.stubEnv('STUDY_WORKBENCH_AUTH_ORIGINS', 'https://workbench.example')
    expect(getWebSessionConfig().mode).toBe(mode)
    expect(matchApiRoute(method, url)).toMatchObject({ method, kind: 'json', headerClass: 'json' })
  })
})

describe('research routes remain narrowly bounded', () => {
  it.each([
    ['POST', '/api/personal/web-search/status'],
    ['GET', '/api/personal/web-search'],
    ['DELETE', '/api/personal/web-search'],
    ['GET', '/api/personal/notebooks/n/sources/web-import'],
    ['DELETE', '/api/personal/notebooks/n/source-snapshots'],
    ['POST', '/api/personal/notebooks/n/source-snapshots/extra'],
    ['POST', '/api/personal/notebooks/n/sources/web-import/extra'],
    ['POST', '/api/personal/notebooks/n%2Fother/source-snapshots'],
    ['POST', '/api/personal/notebooks/n%252Fother/sources/web-import'],
    ['POST', '/api/personal/web-search/anything'],
  ])('rejects unreviewed %s %s', (method, url) => {
    expect(matchApiRoute(method, url)).toBeNull()
  })
})
