import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

/**
 * Host and X-Forwarded-Proto are client-controlled. Behind a reverse proxy
 * that forwards them untrusted, an unvalidated value here could redirect
 * the browser's subsequent API traffic (including the auth bearer token)
 * to an attacker-chosen host - see lib/api/client.ts for how apiUrl is
 * used app-wide once fetched.
 */
describe('GET /config', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.API_URL
    delete process.env.NEXT_PUBLIC_API_URL
  })

  afterEach(() => {
    process.env = originalEnv
  })

  function makeRequest(headers: Record<string, string>) {
    return new NextRequest('http://ignored.example/config', { headers })
  }

  it('uses API_URL env var when explicitly set, ignoring headers', async () => {
    process.env.API_URL = 'https://configured.example.com'
    const request = makeRequest({ host: 'evil.example.com', 'x-forwarded-proto': 'https' })

    const response = await GET(request)
    const body = await response.json()

    expect(body.apiUrl).toBe('https://configured.example.com')
  })

  it('auto-detects from a well-formed Host header', async () => {
    const request = makeRequest({ host: 'notebook.example.com', 'x-forwarded-proto': 'https' })

    const response = await GET(request)
    const body = await response.json()

    expect(body.apiUrl).toBe('https://notebook.example.com:5055')
  })

  it('strips the port from the Host header before rebuilding the URL', async () => {
    const request = makeRequest({ host: 'notebook.example.com:3000' })

    const response = await GET(request)
    const body = await response.json()

    expect(body.apiUrl).toBe('http://notebook.example.com:5055')
  })

  it('accepts a bare IPv4 Host header', async () => {
    const request = makeRequest({ host: '192.168.1.50' })

    const response = await GET(request)
    const body = await response.json()

    expect(body.apiUrl).toBe('http://192.168.1.50:5055')
  })

  it('accepts a bracketed IPv6 literal Host header', async () => {
    const request = makeRequest({ host: '[2001:db8::1]' })

    const response = await GET(request)
    const body = await response.json()

    expect(body.apiUrl).toBe('http://[2001:db8::1]:5055')
  })

  it('strips the port from a bracketed IPv6 Host header and keeps the brackets', async () => {
    const request = makeRequest({ host: '[::1]:3000' })

    const response = await GET(request)
    const body = await response.json()

    expect(body.apiUrl).toBe('http://[::1]:5055')
  })

  it('falls back to localhost for a bracketed IPv6 literal with trailing junk', async () => {
    const request = makeRequest({ host: '[::1]@evil.example.com' })

    const response = await GET(request)
    const body = await response.json()

    expect(body.apiUrl).toBe('http://localhost:5055')
  })

  it('falls back to localhost for an unclosed IPv6 bracket', async () => {
    const request = makeRequest({ host: '[::1' })

    const response = await GET(request)
    const body = await response.json()

    expect(body.apiUrl).toBe('http://localhost:5055')
  })

  it('falls back to localhost for a path-like payload inside IPv6 brackets', async () => {
    const request = makeRequest({ host: '[::1]/../../attacker' })

    const response = await GET(request)
    const body = await response.json()

    expect(body.apiUrl).toBe('http://localhost:5055')
  })

  it('falls back to localhost for a Host header containing a path-like payload', async () => {
    const request = makeRequest({ host: 'evil.example.com/../../attacker' })

    const response = await GET(request)
    const body = await response.json()

    expect(body.apiUrl).toBe('http://localhost:5055')
  })

  it('falls back to localhost for a Host header containing an @ (userinfo confusion)', async () => {
    const request = makeRequest({ host: 'legit.example.com@evil.example.com' })

    const response = await GET(request)
    const body = await response.json()

    expect(body.apiUrl).toBe('http://localhost:5055')
  })

  it('falls back to localhost for a Host header with embedded whitespace', async () => {
    const request = makeRequest({ host: 'evil.example.com foo' })

    const response = await GET(request)
    const body = await response.json()

    expect(body.apiUrl).toBe('http://localhost:5055')
  })

  it('never trusts an X-Forwarded-Proto value other than http/https', async () => {
    const request = makeRequest({
      host: 'notebook.example.com',
      'x-forwarded-proto': 'javascript',
    })

    const response = await GET(request)
    const body = await response.json()

    expect(body.apiUrl).toBe('http://notebook.example.com:5055')
  })

  it('falls back to localhost when no Host header is present', async () => {
    const request = makeRequest({})

    const response = await GET(request)
    const body = await response.json()

    expect(body.apiUrl).toBe('http://localhost:5055')
  })
})

describe('GET /config session mode', () => {
  const originalEnv = process.env
  beforeEach(() => {
    process.env = { ...originalEnv,
      STUDY_WORKBENCH_AUTH_MODE: 'device_sessions',
      STUDY_WORKBENCH_WEB_ORIGIN: 'https://workbench.example',
      STUDY_WORKBENCH_AUTH_ORIGINS: 'https://workbench.example',
      INTERNAL_API_URL: 'http://private-api:5055',
      API_URL: 'https://untrusted-api.example',
      NEXT_PUBLIC_API_URL: 'https://untrusted-build-api.example',
    }
    delete process.env.STUDY_WORKBENCH_WEB_NATIVE_PASSTHROUGH
    delete process.env.STUDY_WORKBENCH_WEB_ALLOW_INSECURE_LOOPBACK
  })
  afterEach(() => { process.env = originalEnv })

  it('publishes only relative browser API and nonsecret Web mode/version metadata', async () => {
    const response = await GET(new NextRequest('https://attacker.example/config', {
      headers: { host: 'attacker.example', 'x-forwarded-proto': 'http', cookie: 'platform=secret', authorization: 'Bearer secret' },
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ apiUrl: '', auth_mode: 'device_sessions', web_session_protocol: 'bff-memory-v1' })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  const rejectedReadHeaders: Record<string, string>[] = [{ origin: 'https://foreign.example' }, { origin: 'null' }, { origin: '' },
    { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-origin, same-origin' }]
  it.each(rejectedReadHeaders)('rejects device metadata unsafe read boundary %j', async headers => {
    const response = await GET(new NextRequest('https://workbench.example/config', { headers }))
    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('CROSS_SITE_REQUEST')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('accepts same-origin ingress cookies without parsing stale app credentials or making auth claims', async () => {
    const response = await GET(new NextRequest('https://workbench.example/config', { headers: {
      origin: 'https://workbench.example', 'sec-fetch-site': 'same-origin',
      cookie: 'private_ingress=synthetic; __Host-sw-session=x; __Host-sw-session=y', authorization: 'Bearer synthetic-token',
    } }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ apiUrl: '', auth_mode: 'device_sessions', web_session_protocol: 'bff-memory-v1' })
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it.each(['', 'device-session', 'unknown'])('fails closed for explicit mode %j without exposing config values', async mode => {
    process.env.STUDY_WORKBENCH_AUTH_MODE = mode
    const response = await GET(new NextRequest('https://workbench.example/config'))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: { code: 'AUTH_UNAVAILABLE', message: 'Web session configuration unavailable' } })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('fails closed for invalid origins, not falling back to legacy URL detection', async () => {
    process.env.STUDY_WORKBENCH_WEB_ORIGIN = 'https://wrong.example'
    const response = await GET(new NextRequest('https://workbench.example/config', { headers: { host: 'fallback.example' } }))
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('fallback.example')
  })

  it('adds explicit legacy metadata without changing the legacy URL selection', async () => {
    process.env.STUDY_WORKBENCH_AUTH_MODE = 'legacy_password'
    const response = await GET(new NextRequest('https://workbench.example/config'))
    expect(await response.json()).toEqual({ apiUrl: 'https://untrusted-api.example', auth_mode: 'legacy_password', web_session_protocol: null })
  })
})
