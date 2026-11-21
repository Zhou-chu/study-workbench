import { afterEach, describe, expect, it } from 'vitest'
import { request as httpRequest } from 'node:http'
import { closeFixtures, deferred, sendJson, startUpstream, token } from './fixtures/upstream.js'

afterEach(closeFixtures)
async function status(run: Awaited<ReturnType<typeof startUpstream>>) {
  const response = await fetch(run.bff + '/api/auth/status', { headers: run.headers })
  expect(response.headers.get('set-cookie')).toBeNull()
  const body = await response.json()
  expect(JSON.stringify(body)).not.toMatch(/swa1_|swr1_|synthetic-password/)
  return body.web
}
async function refresh(run: Awaited<ReturnType<typeof startUpstream>>) {
  return fetch(run.bff + '/api/auth/sessions/refresh', { method: 'POST', headers: run.headers, body: '{}' })
}

describe('synthetic device refresh loss across real HTTP hops', () => {
  it.each(['truncated-ack', 'invalid-envelope', '429', '503', 'owner-timeout'] as const)('retires after API→BFF %s without reusing refresh or replaying business work', async loss => {
    const sentPartial = deferred(), apiClosed = deferred()
    const run = await startUpstream('device_sessions', { accessMs: 20_000, refresh: (_req, res) => {
      run.events.push('api:rotation-committed')
      res.once('close', () => apiClosed.resolve())
      if (loss === 'invalid-envelope') return sendJson(res, { ...run.envelope(1), extra: 'never accepted' })
      if (loss === '429' || loss === '503') return sendJson(res, { error: { code: loss === '429' ? 'AUTH_RATE_LIMITED' : 'AUTH_UNAVAILABLE' } }, Number(loss))
      res.writeHead(200, { 'content-type': 'application/json' }); res.flushHeaders(); res.write('{"session_id":')
      sentPartial.resolve()
      if (loss === 'truncated-ack') setImmediate(() => res.destroy())
    } })
    await run.activate()
    const cookie = run.headers.cookie
    const pending = refresh(run)
    await run.refreshStarted.promise
    if (loss === 'owner-timeout') { await sentPartial.promise; run.clock.advance(10_000) }
    const response = await pending
    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(await response.text()).not.toMatch(/swa1_|swr1_|extra|session_id/)
    expect((await status(run)).phase).toBe('reauth-required')
    expect((await refresh(run)).status).toBe(401)
    expect(run.rotations()).toBe(1); expect(run.headers.cookie).toBe(cookie)
    const upstreamRefresh = run.captured.filter(x => x.path === '/api/auth/sessions/refresh')
    expect(upstreamRefresh).toHaveLength(1)
    expect(JSON.parse(upstreamRefresh[0]!.bytes!.toString()).refresh_token).toBe(token('swr1_', 11))
    expect(run.captured.some(x => x.path.includes('/turns') || x.path.includes('/portable'))).toBe(false)
    if (loss === 'owner-timeout' || loss === 'truncated-ack') await apiClosed.promise
  })

  it('recovers BFF→browser delivery loss through the same cookie after the successor pair was installed', async () => {
    const installed = deferred(), delivery = deferred(), completed = deferred()
    let held = false
    const run = await startUpstream('device_sessions', { accessMs: 20_000, onBffResponse: async (path, response) => {
      if (path === '/api/auth/sessions/refresh' && response.ok && !held) {
        expect(await response.clone().json()).toMatchObject({ generation: 1 }); held = true
        run.events.push('bff:successor-installed'); installed.resolve(); await delivery.promise; completed.resolve()
      }
    } })
    await run.activate()
    const cookie = run.headers.cookie
    const request = httpRequest(run.bff + '/api/auth/sessions/refresh', { method: 'POST', headers: run.headers })
    request.on('error', () => {})
    request.end('{}')
    await installed.promise
    const closed = new Promise<void>(resolve => request.once('close', resolve))
    request.destroy(); await closed
    run.events.push('browser:ack-lost-after-swap'); delivery.resolve(); await completed.promise
    const web = await status(run)
    expect(web.phase).toBe('authenticated'); expect(web.session.generation).toBe(1)
    expect(run.headers.cookie).toBe(cookie); expect(run.rotations()).toBe(1)
    expect((await refresh(run)).status).toBe(200); expect(run.rotations()).toBe(1)
    const probes = run.captured.filter(x => x.method === 'GET' && x.path === '/api/auth/sessions')
    expect(probes.at(-1)!.headers.authorization).toBe('Bearer ' + token('swa1_', 2))
    expect(run.events.indexOf('bff:successor-installed')).toBeLessThan(run.events.indexOf('browser:ack-lost-after-swap'))
    console.info('lost-hop fixture', run.events.filter(x => /installed|ack-lost/.test(x)), 'native rotations', run.rotations())
  })

  it('singleflights overlapping HTTP refreshes without follower-induced successor rotation', async () => {
    const release = deferred(), followersAdmitted = deferred()
    const run = await startUpstream('device_sessions', { accessMs: 20_000, onRefreshAdmission: count => { if (count === 5) followersAdmitted.resolve() }, refresh: async (_req, res) => {
      await release.promise; sendJson(res, run.envelope(1))
    } })
    await run.activate()
    const first = refresh(run); await run.refreshStarted.promise
    const followers = Array.from({ length: 4 }, () => refresh(run))
    await followersAdmitted.promise; release.resolve()
    const responses = await Promise.all([first, ...followers])
    expect(responses.map(x => x.status)).toEqual([200, 200, 200, 200, 200])
    for (const response of responses) {
      expect(await response.json()).toMatchObject({ generation: 1 })
      expect(response.headers.get('set-cookie')).toBeNull()
    }
    expect(run.rotations()).toBe(1)
  })
})

describe('bounded auth input through the native body adapter', () => {
  it.each(['content-length', 'chunked'] as const)('rejects auth JSON over 8KiB using %s before any native issuance', async framing => {
    const run = await startUpstream('device_sessions')
    const bytes = Buffer.from(JSON.stringify({ password: 'x'.repeat(8200), device_name: 'Synthetic' }))
    const response = await new Promise<{ status: number; text: string }>((resolve, reject) => {
      const req = httpRequest(run.bff + '/api/auth/sessions', { method: 'POST', headers: { ...run.headers,
        ...(framing === 'content-length' ? { 'content-length': String(bytes.length) } : {}) } }, res => {
        let text = ''; res.on('data', chunk => { text += chunk }); res.on('end', () => resolve({ status: res.statusCode!, text }))
      }); req.on('error', reject)
      req.write(bytes.subarray(0, 4096)); req.end(bytes.subarray(4096))
    })
    expect(response.status).toBe(413); expect(response.text).toContain('AUTH_BODY_TOO_LARGE')
    expect(run.captured).toHaveLength(0)
    if (framing === 'content-length') expect(run.reads[0]).toEqual({ iterators: 0, pulls: 0, bytes: 0 })
    else expect(run.reads[0]!.bytes).toBeGreaterThan(8192)
  })

  it('accepts exactly 8192 auth bytes and bounds an oversized native acknowledgement without publishing a handle', async () => {
    const normal = await startUpstream('device_sessions')
    const value = '{"password":"synthetic-password","device_name":"Synthetic"}'
    const accepted = await fetch(normal.bff + '/api/auth/sessions', { method: 'POST', headers: normal.headers, body: value.padEnd(8192, ' ') })
    expect(accepted.status).toBe(201); await accepted.arrayBuffer()
    const oversized = await startUpstream('device_sessions', { create: (_req, res) => sendJson(res, { ...oversized.envelope(), extra: 'x'.repeat(8192) }, 201) })
    const rejected = await fetch(oversized.bff + '/api/auth/sessions', { method: 'POST', headers: oversized.headers, body: value })
    expect(rejected.status).toBe(503); expect(rejected.headers.get('set-cookie')).toBeNull()
    expect(await rejected.text()).not.toMatch(/swa1_|swr1_|extra/)
  })

  it('accepts split UTF-8/JSON login bytes while retaining separate stable/obsolete Cookie fields', async () => {
    const run = await startUpstream('device_sessions')
    const bytes = Buffer.from('{"password":"资料","device_name":"Synthetic"}'), split = bytes.indexOf(Buffer.from('资')) + 1
    const response = await new Promise<{ status: number; text: string; cookies: string[] }>((resolve, reject) => {
      const req = httpRequest(run.bff + '/api/auth/sessions', { method: 'POST', headers: { ...run.headers, cookie: 'CF_Authorization=synthetic; sw-access=obsolete; sw-refresh=obsolete' } }, res => {
        let text = ''; res.on('data', chunk => { text += chunk }); res.on('end', () => resolve({ status: res.statusCode!, text, cookies: res.headers['set-cookie'] ?? [] }))
      }); req.on('error', reject); req.write(bytes.subarray(0, split)); setImmediate(() => req.end(bytes.subarray(split)))
    })
    expect(response.status).toBe(201); expect(response.cookies).toHaveLength(5)
    expect(response.cookies[0]).toMatch(/^__Host-sw-session=swb1_.*HttpOnly; SameSite=Strict; Secure$/)
    expect(response.cookies.slice(1).every(x => x.includes('Max-Age=0'))).toBe(true)
    expect(response.text).not.toMatch(/swa1_|swr1_|资料/)
    const create = run.captured.find(x => x.method === 'POST')!
    expect(JSON.parse(create.bytes!.toString())).toEqual({ password: '资料', device_name: 'Synthetic' })
    expect(create.headers.cookie).toBeUndefined()
  })
})


describe('explicit synthetic native auth response boundary', () => {
  it.each(['html', 'oversized-json'] as const)('never returns %s as a successful native auth envelope', async kind => {
    const run = await startUpstream('device_sessions', { nativePassthrough: true, create: (_req, res) => {
      if (kind === 'html') { res.writeHead(201, { 'content-type': 'text/html', 'set-cookie': 'upstream=never' }); res.end('<html>synthetic private login</html>') }
      else sendJson(res, { ...run.envelope(), extra: 'x'.repeat(8192) }, 201)
    } })
    const response = await new Promise<{ status: number; text: string; cookie: string[] | undefined }>((resolve, reject) => {
      const req = httpRequest(run.bff + '/api/auth/sessions', { method: 'POST', headers: { 'content-type': 'application/json' } }, res => {
        let text = ''; res.on('data', bytes => { text += bytes }); res.on('end', () => resolve({ status: res.statusCode!, text, cookie: res.headers['set-cookie'] }))
      }); req.on('error', reject); req.end('{"password":"synthetic-password","device_name":"Synthetic native"}')
    })
    expect(response.status).toBe(503)
    expect(response.text).not.toMatch(/<html>|swa1_|swr1_|extra/); expect(response.cookie).toBeUndefined()
  })

  it('keeps valid native token JSON, bounded large session lists and empty204 distinct from Web cookies', async () => {
    const sessions = Array.from({ length: 32 }, (_, i) => ({ session_id: `12345678-1234-1234-1234-${i.toString(16).padStart(12, '0')}`,
      device_name: 'S'.repeat(80), created_at: '2026-11-08T00:00:00Z', last_used_at: '2026-11-08T00:00:00Z',
      expires_at: '2026-11-09T00:00:00Z', revoked_at: null, is_current: i === 0 }))
    expect(Buffer.byteLength(JSON.stringify({ sessions }))).toBeGreaterThan(8192)
    const run = await startUpstream('device_sessions', { nativePassthrough: true, list: (_req, res) => sendJson(res, { sessions }),
      respond: (_req, res) => { res.writeHead(204, { 'set-cookie': 'upstream=never' }); res.end() } })
    const created = await nativeRequest(run.bff, '/api/auth/sessions', 'POST', '{"password":"synthetic-password","device_name":"Synthetic native"}')
    expect(created.status).toBe(201); expect(JSON.parse(created.text)).toEqual(run.envelope())
    expect(created.headers['set-cookie']).toBeUndefined()
    const listed = await nativeRequest(run.bff, '/api/auth/sessions', 'GET')
    expect(listed.status).toBe(200); expect(JSON.parse(listed.text)).toEqual({ sessions })
    expect(listed.headers['set-cookie']).toBeUndefined()
    const revoked = await nativeRequest(run.bff, '/api/auth/sessions/12345678-1234-1234-1234-123456789abc', 'DELETE')
    expect(revoked.status).toBe(204); expect(revoked.text).toBe(''); expect(revoked.headers['set-cookie']).toBeUndefined()
    expect(run.captured.at(-1)!.headers.authorization).toBe('Bearer ' + token('swa1_', 1))
    for (const entry of run.captured) expect(entry.headers.cookie).toBeUndefined()
  })

  it('bounds explicit native session-list acknowledgements at256KiB rather than8KiB', async () => {
    const run = await startUpstream('device_sessions', { nativePassthrough: true, list: (_req, res) => sendJson(res, { sessions: [], extra: 'x'.repeat(262144) }) })
    const response = await nativeRequest(run.bff, '/api/auth/sessions', 'GET')
    expect(response.status).toBe(503); expect(response.text).not.toContain('extra'); expect(response.headers['set-cookie']).toBeUndefined()
  })

})


function nativeRequest(base: string, path: string, method: string, body?: string) {
  return new Promise<{ status: number; text: string; headers: import('node:http').IncomingHttpHeaders }>((resolve, reject) => {
    const req = httpRequest(base + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : { authorization: 'Bearer ' + token('swa1_', 1) }), cookie: 'CF_Authorization=synthetic-ingress' } }, res => {
      let text = ''; res.on('data', bytes => { text += bytes }); res.on('end', () => resolve({ status: res.statusCode!, text, headers: res.headers }))
    }); req.on('error', reject); req.end(body)
  })
}
