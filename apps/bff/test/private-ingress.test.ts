import { afterEach, describe, expect, it } from 'vitest'
import { connect } from 'node:net'
import { createServer } from 'node:http'
import { classifyIngressResponse } from '../src/public-config.js'
import { createBffHandler } from '../src/server.js'
import { createHttpAdapter } from '../src/http-adapter.js'
import { config, origin } from './fixtures.js'
import { closeFixtures, instrumentBody, listen, sha256, startUpstream, type Consumption } from './fixtures/upstream.js'

afterEach(closeFixtures)
it.each([
  [200, 'application/json', null, 'expected'], [401, 'application/json', null, 'expected'],
  [416, 'text/plain', null, 'expected'], [304, null, null, 'expected'],
  [200, 'Text/HTML; charset=utf-8', null, 'ingress_reauth'], [403, 'application/xhtml+xml', null, 'ingress_reauth'],
  [302, null, 'https://synthetic-access.example/login', 'ingress_reauth'], [307, null, '/login', 'ingress_reauth'],
  [302, null, null, 'unavailable'], [503, 'text/html', null, 'unavailable'], [0, null, null, 'unavailable'],
] as const)('classifies only observable hop %s %s %s', (status, media, location, expected) => {
  expect(classifyIngressResponse(status, media, location)).toBe(expected)
})

describe.each(['legacy_password', 'device_sessions'] as const)('actual BFF-hop ingress %s', mode => {
  it.each(['/api/notebooks', '/api/search/ask', '/api/personal/exports/export%3Aone/download'])('never serves upstream login HTML as successful JSON/SSE/file for %s', async path => {
    const run = await startUpstream(mode, { respond: (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': ['Access=never', 'other=never'], 'location': 'https://synthetic-access.example/login' })
      res.end('<html>synthetic private login secret</html>')
    } }); await run.activate()
    const response = await fetch(run.bff + path, { headers: run.headers, ...(path.includes('/ask') ? { method: 'POST', body: '{}' } : {}) })
    expect(response.status).toBe(502); expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.text()).not.toMatch(/<html>|private login secret/)
    expect(response.headers.get('set-cookie')).toBeNull(); expect(response.headers.get('location')).toBeNull()
  })

  it.each([[200, 'attachment; filename="synthetic artifact.html"'], [206, "attachment; filename*=UTF-8''synthetic%20artifact.html"]] as const)('preserves an opaque HTML artifact attachment %s with exact bytes/hash and range', async (status, disposition) => {
    const bytes = Buffer.from('<!doctype html>\n<article>合成 artifact, not rendered</article>\n')
    const run = await startUpstream(mode, { respond: (_req, res) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'content-disposition': disposition,
        'content-length': String(bytes.length), 'content-range': `bytes 0-${bytes.length - 1}/${bytes.length}`, 'set-cookie': 'upstream=never' }); res.end(bytes)
    } }); await run.activate()
    const response = await fetch(run.bff + '/api/personal/artifacts/artifact%3Aone/download', { headers: { ...run.headers, range: 'bytes=0-' } })
    expect(response.status).toBe(status); const received = Buffer.from(await response.arrayBuffer()); expect(received).toEqual(bytes)
    expect(sha256(received)).toBe('1d6e182be3a0c31b22db442de85b1b908f448a0615e8efd98b371717d8349b8b')
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('content-disposition')).toBe(disposition)
    expect(response.headers.get('content-range')).toBe(`bytes 0-${bytes.length - 1}/${bytes.length}`)
    expect(response.headers.get('cache-control')).toBe('no-store'); expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it.each([
    [200, null, null], [200, 'inline; filename="login.html"', null], [200, 'attachmentevil; filename="login.html"', null],
    [200, 'attachment; filename="unterminated', null], [200, 'attachment; filename="one"; filename="two"', null], [200, 'attachment; filename*=UTF-8\'\'bad%ZZ.html', null],
    [200, "attachment; filename*=UTF-8''bad%FF.html", null],
    [401, 'attachment; filename="login.html"', null], [403, 'attachment; filename="login.html"', null],
    [200, 'attachment; filename="login.html"', 'https://synthetic-access.example/login'],
  ] as const)('rejects artifact login HTML with status=%s disposition=%s location=%s without retiring a confirmed handle', async (status, disposition, location) => {
    const run = await startUpstream(mode, { respond: (_req, res) => {
      res.statusCode = status; res.setHeader('content-type', 'text/html')
      if (disposition !== null) res.setHeader('content-disposition', disposition)
      if (location !== null) res.setHeader('location', location)
      res.end('<html>synthetic login</html>')
    } }); await run.activate()
    const response = await fetch(run.bff + '/api/personal/artifacts/artifact%3Aone/download', { headers: run.headers })
    expect(response.status).toBe(502); expect(await response.text()).not.toContain('<html>')
    expect(response.headers.get('location')).toBeNull(); expect(response.headers.get('set-cookie')).toBeNull()
    expect(run.captured.filter(x => x.path.includes('/artifacts/'))).toHaveLength(1)
    if (mode === 'device_sessions') {
      const status = await fetch(run.bff + '/api/auth/status', { headers: run.headers })
      expect((await status.json()).web.phase).toBe('authenticated')
    }
  })

  it('does not follow external redirects or leak Bearer/Cookie to their destination', async () => {
    let destinationCalls = 0
    const destination = await listen(createServer((_req, res) => { destinationCalls++; res.end('never') }))
    const run = await startUpstream(mode, { respond: (_req, res) => { res.writeHead(307, { location: destination + '/login' }); res.end('private redirect') } })
    await run.activate()
    const response = await fetch(run.bff + '/api/notebooks', { headers: run.headers })
    expect(response.status).toBe(502); expect(response.headers.get('location')).toBeNull()
    expect(await response.text()).not.toContain('private redirect'); expect(destinationCalls).toBe(0)
    for (const entry of run.captured) expect(entry.headers.cookie).toBeUndefined()
  })

  it.each([
    ['POST', '/api/unknown', '', 404], ['PATCH', '/api/notebooks', '', 405],
    ['POST', '/api/%61uth/sessions', '', 404], ['POST', '/api/notes/part%252fother', '', 404],
    ['POST', '/api/personal/imports/portable', 'Origin: https://duplicate.example\r\n', 400],
    ['POST', '/api/personal/imports/portable', 'Host: duplicate.example\r\n', 400],
  ] as const)('rejects streamed %s %s before opening the application body reader', async (method, target, extra, status) => {
    const reads: Consumption[] = []; let fetches = 0
    const cfg = config(mode), handler = createBffHandler(cfg, { fetch: async () => { fetches++; throw new Error('unexpected upstream') } })
    const adapter = createHttpAdapter(handler, cfg)
    const base = await listen(createServer((req, res) => { reads.push(instrumentBody(req)); adapter(req, res) }))
    const result = await rawUpload(base, method, target, extra)
    expect(result).toMatch(new RegExp(`^HTTP/1.1 ${status} `)); expect(fetches).toBe(0)
    expect(reads).toEqual([{ iterators: 0, pulls: 0, bytes: 0 }])
  })

  it('refuses a backend mode mismatch with a real chunked upload and zero application pulls', async () => {
    const run = await startUpstream(mode)
    await run.activate()
    const before = run.captured.length
    run.setReadinessMode(mode === 'legacy_password' ? 'device_sessions' : 'legacy_password')
    const result = await rawUpload(run.bff, 'POST', '/api/personal/imports/portable', '', run.headers)
    expect(result).toMatch(/^HTTP\/1.1 503 /)
    expect(run.reads.at(-1)).toEqual({ iterators: 0, pulls: 0, bytes: 0 })
    expect(run.captured.slice(before).map(x => x.path)).toEqual(['/api/auth/status'])
  })
})

async function rawUpload(base: string, method: string, target: string, extra = '', headers: Record<string, string> = { origin, 'x-studyworkbench-csrf': '1', authorization: 'Bearer synthetic' }) {
  const { port } = new URL(base)
  return new Promise<string>((resolve, reject) => {
    const socket = connect(Number(port), '127.0.0.1'); let result = ''
    socket.on('error', reject); socket.on('data', chunk => { result += chunk.toString() }); socket.on('end', () => resolve(result))
    socket.on('connect', () => {
      socket.write(`${method} ${target} HTTP/1.1\r\nHost: localhost\r\n${Object.entries(headers).filter(([key]) => key.toLowerCase() !== 'content-type').map(([key, value]) => `${key}: ${value}\r\n`).join('')}Content-Type: multipart/form-data; boundary=synthetic\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n${extra}\r\n`)
      // Actual bytes reach the HTTP socket. No terminal chunk is sent: local
      // rejection cannot wait for or consume this application's upload body.
      socket.write('15\r\nsynthetic-upload-body\r\n')
    })
  })
}
