import 'server-only'

import { AsyncLocalStorage } from 'node:async_hooks'
import {
  BffSessionStore, digestSessionHandle, getProcessBffSessionStore, NativeCallError,
  type AccessSnapshot, type AuthOutcome, type BffSessionOptions, type NativeCalls,
  type RecordRef,
} from './bff-session-store'
import { getWebSessionConfig, matchApiRoute, type RoutePolicy, type WebSessionConfig } from './session-proxy-policy'

const AUTH_BYTES = 8192
const LIST_BYTES = 262_144
const COOKIE_NAMES = ['__Host-sw-session', 'sw-session']
const OLD_COOKIES = ['__Host-sw-access', '__Host-sw-refresh', 'sw-access', 'sw-refresh']
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/
const BASE_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
const ERROR_STATUS: Record<string, number> = {
  AUTH_INVALID_REQUEST: 400, AUTH_MIXED_CREDENTIALS: 400, AUTH_INVALID_CREDENTIALS: 401,
  AUTH_REQUIRED: 401, ACCESS_EXPIRED: 401, REFRESH_REJECTED: 401, AUTH_PENDING: 401,
  CROSS_SITE_REQUEST: 403, AUTH_BODY_TOO_LARGE: 413, AUTH_UNSUPPORTED_MEDIA_TYPE: 415,
  AUTH_RATE_LIMITED: 429, AUTH_BUSY: 429, AUTH_UNAVAILABLE: 503,
}
class ProxyFailure extends Error {
  constructor(readonly code: string, readonly status = ERROR_STATUS[code] ?? 502, readonly retryAfter?: number) { super(code) }
}
function failure(code: string, status?: number, retryAfter?: number): Response {
  const headers = new Headers(BASE_HEADERS)
  const actualStatus = status ?? ERROR_STATUS[code] ?? 502
  if (actualStatus === 401) headers.set('WWW-Authenticate', 'Bearer')
  if (retryAfter !== undefined) headers.set('Retry-After', String(Math.max(1, Math.min(60, retryAfter))))
  return Response.json({ error: { code, message: code === 'CROSS_SITE_REQUEST' ? 'Cross-site request rejected.' : 'Request could not be completed.' } }, { status: actualStatus, headers })
}
function json(value: unknown, status = 200, headers = new Headers(BASE_HEADERS)): Response {
  return Response.json(value, { status, headers })
}
function outcomeResponse(outcome: AuthOutcome): Response {
  if (outcome.kind === 'confirmed') return json(outcome.metadata)
  if (outcome.kind === 'pending') return failure('AUTH_PENDING')
  if (outcome.kind === 'refresh-needed') return failure('ACCESS_EXPIRED')
  if (outcome.kind === 'reauth-required') return failure('AUTH_REQUIRED')
  return outcome.kind === 'busy' ? failure('AUTH_BUSY', 429, 1) : failure('AUTH_UNAVAILABLE')
}
function retryAfter(response: Response): number | undefined {
  const value = response.headers.get('retry-after')
  return value && /^\d{1,10}$/.test(value) ? Math.max(1, Math.min(60, Number(value))) : undefined
}
function isObject(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}
function jsonType(headers: Headers): boolean { return headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'application/json' }
function cancelBody(body: ReadableStream<Uint8Array> | null): void { if (body) void body.cancel().catch(() => {}) }
/** Bounded incremental reads for auth JSON only; never used on an upload/SSE/download. */
async function readBytes(body: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array> {
  if (!body) return new Uint8Array()
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) { void reader.cancel().catch(() => {}); throw new ProxyFailure('AUTH_BODY_TOO_LARGE') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}
async function readJson(body: ReadableStream<Uint8Array> | null, limit = AUTH_BYTES): Promise<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(body, limit)))
    if (!isObject(value)) throw new Error()
    return value
  } catch (error) {
    if (error instanceof ProxyFailure) throw error
    throw new ProxyFailure('AUTH_INVALID_REQUEST')
  }
}
async function nativeJson(response: Response, limit = AUTH_BYTES): Promise<Record<string, unknown>> {
  if (!jsonType(response.headers)) { cancelBody(response.body); throw new ProxyFailure('AUTH_UNAVAILABLE') }
  try { return await readJson(response.body, limit) }
  catch { throw new ProxyFailure('AUTH_UNAVAILABLE') }
}
async function authBody(req: Request, empty = false): Promise<Record<string, unknown>> {
  const length = req.headers.get('content-length')
  if (length !== null && !/^\d+$/.test(length)) throw new ProxyFailure('AUTH_INVALID_REQUEST')
  if (length !== null && Number(length) > AUTH_BYTES) throw new ProxyFailure('AUTH_BODY_TOO_LARGE')
  if (!empty && !jsonType(req.headers)) throw new ProxyFailure('AUTH_UNSUPPORTED_MEDIA_TYPE')
  if (empty) {
    if ((await readBytes(req.body, AUTH_BYTES)).length) throw new ProxyFailure('AUTH_INVALID_REQUEST')
    return {}
  }
  return readJson(req.body)
}
function loginInput(body: Record<string, unknown>): { password: string; device_name: string } {
  if (!exactKeys(body, ['password', 'device_name']) || typeof body.password !== 'string' || typeof body.device_name !== 'string'
    || new TextEncoder().encode(body.password).byteLength > 4096) throw new ProxyFailure('AUTH_INVALID_REQUEST')
  const name = body.device_name.trim()
  if (Array.from(name).length < 1 || Array.from(name).length > 80) throw new ProxyFailure('AUTH_INVALID_REQUEST')
  return { password: body.password, device_name: name }
}
function containsCredentials(body: Record<string, unknown>): boolean {
  return ['access_token', 'refresh_token', 'session_id', 'token'].some(key => Object.hasOwn(body, key))
}
type CookieState = { ambient: boolean; obsolete: boolean; handle?: string; present: boolean }
function cookies(req: Request, config: WebSessionConfig): CookieState {
  const raw = req.headers.get('cookie') ?? ''
  if (raw.length > 16384) throw new ProxyFailure('AUTH_INVALID_REQUEST')
  const found = new Map<string, string>()
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=')
    const name = (eq < 0 ? part : part.slice(0, eq)).trim()
    if (![...COOKIE_NAMES, ...OLD_COOKIES].includes(name)) continue
    if (found.has(name)) throw new ProxyFailure('AUTH_INVALID_REQUEST')
    const value = eq < 0 ? '' : part.slice(eq + 1).trim()
    // Intermediaries may coalesce duplicate Cookie fields with commas instead
    // of semicolons. Never reinterpret such an ambiguous app credential.
    if (value.includes(',')) throw new ProxyFailure('AUTH_INVALID_REQUEST')
    found.set(name, value)
  }
  if (COOKIE_NAMES.filter(name => found.has(name)).length > 1) throw new ProxyFailure('AUTH_INVALID_REQUEST')
  return {
    ambient: found.size > 0, obsolete: OLD_COOKIES.some(name => found.has(name)),
    handle: found.get(config.cookieName), present: COOKIE_NAMES.some(name => found.has(name)),
  }
}
type RequestContext = { headers: Headers; transportFailure?: ProxyFailure }
function webBoundary(req: Request, config: WebSessionConfig, cookie: CookieState): { native: boolean; context: RequestContext } {
  const origin = req.headers.get('origin')
  const metadata = [...req.headers.keys()].some(name => name.startsWith('sec-fetch-'))
  const native = config.nativePassthrough && origin === null && !metadata && !cookie.ambient
  const site = req.headers.get('sec-fetch-site')
  if (origin !== null && origin !== config.publicOrigin || site !== null && !['none', 'same-origin', 'same-site'].includes(site)) throw new ProxyFailure('CROSS_SITE_REQUEST')
  if (!native && !SAFE.has(req.method) && (origin !== config.publicOrigin || req.headers.get('x-studyworkbench-csrf') !== '1')) throw new ProxyFailure('CROSS_SITE_REQUEST')
  if (!native && req.headers.has('authorization')) throw new ProxyFailure('AUTH_MIXED_CREDENTIALS')
  const headers = new Headers()
  if (origin !== null) headers.set('Origin', origin)
  if (req.headers.get('x-studyworkbench-csrf') === '1') headers.set('X-StudyWorkbench-CSRF', '1')
  return { native, context: { headers } }
}
function rawPath(req: Request): string {
  // Request.url is the original serialized URL, not decoded Next params. Never
  // let request authority, forwarding headers or a query select the upstream.
  const match = /^https?:\/\/[^/]+(\/.*)$/.exec(req.url)
  if (!match) throw new ProxyFailure('AUTH_INVALID_REQUEST')
  return match[1]
}
function responseHeaders(upstream: Response, route: RoutePolicy): Headers {
  const headers = new Headers(BASE_HEADERS)
  const allowed = ['content-type', 'content-disposition', 'content-range', 'accept-ranges', 'etag', 'last-modified', 'vary']
  for (const name of allowed) { const value = upstream.headers.get(name); if (value !== null) headers.set(name, value) }
  // Node fetch decompresses upstream bytes. Request identity, and never relay a
  // stale compressed length/encoding if the server ignores that request.
  if (!upstream.headers.has('content-encoding') || upstream.headers.get('content-encoding') === 'identity') {
    const length = upstream.headers.get('content-length')
    if (length && /^\d+$/.test(length)) headers.set('Content-Length', length)
  }
  if (upstream.status === 401) headers.set('WWW-Authenticate', 'Bearer')
  const retry = retryAfter(upstream)
  if (retry !== undefined) headers.set('Retry-After', String(retry))
  if (route.kind === 'sse' && upstream.ok) {
    headers.set('Content-Type', 'text/event-stream; charset=utf-8')
    headers.set('Cache-Control', 'no-store, no-transform')
    headers.set('X-Accel-Buffering', 'no')
    headers.delete('content-length')
  }
  return headers
}
function requestHeaders(req: Request, route: RoutePolicy, access?: string, native = false): Headers {
  const headers = new Headers({ 'Accept-Encoding': 'identity' })
  for (const name of ['accept', 'content-type', 'origin', 'x-studyworkbench-csrf']) {
    const value = req.headers.get(name)
    if (value !== null) headers.set(name, value)
  }
  if (route.kind === 'download') for (const name of ['range', 'if-range', 'if-none-match', 'if-modified-since']) {
    const value = req.headers.get(name)
    if (value !== null) headers.set(name, value)
  }
  const length = req.headers.get('content-length')
  if (length && /^\d+$/.test(length)) headers.set('content-length', length)
  if (access) headers.set('Authorization', `Bearer ${access}`)
  else if (native && req.headers.has('authorization')) headers.set('Authorization', req.headers.get('authorization')!)
  if (route.kind === 'sse') headers.set('Accept', 'text/event-stream')
  return headers
}
function isRedirect(response: Response): boolean { return response.status >= 300 && response.status < 400 && response.status !== 304 }
function transportFailure(context: RequestContext | undefined, error: ProxyFailure): never {
  if (context) context.transportFailure = error
  throw error
}
async function upstreamError(response: Response): Promise<ProxyFailure> {
  let code: unknown
  try { const body = await readJson(response.body); code = isObject(body.error) ? body.error.code : undefined } catch { /* Never echo untrusted error bytes. */ }
  return typeof code === 'string' && ERROR_STATUS[code] === response.status
    ? new ProxyFailure(code, response.status, retryAfter(response))
    : new ProxyFailure('AUTH_UNAVAILABLE', response.status >= 400 && response.status <= 599 ? response.status : 502, retryAfter(response))
}
function validDate(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19)
}
function sessionList(body: Record<string, unknown>): Record<string, unknown> {
  if (!exactKeys(body, ['sessions']) || !Array.isArray(body.sessions)) throw new ProxyFailure('AUTH_UNAVAILABLE')
  for (const item of body.sessions) {
    if (!isObject(item) || !exactKeys(item, ['session_id', 'device_name', 'created_at', 'last_used_at', 'expires_at', 'revoked_at', 'is_current'])
      || typeof item.session_id !== 'string' || !UUID.test(item.session_id) || typeof item.device_name !== 'string'
      || Array.from(item.device_name).length < 1 || Array.from(item.device_name).length > 80
      || !validDate(item.created_at) || !validDate(item.last_used_at) || !validDate(item.expires_at)
      || item.revoked_at !== null && !validDate(item.revoked_at) || typeof item.is_current !== 'boolean') throw new ProxyFailure('AUTH_UNAVAILABLE')
  }
  return body
}

/** Peek only bounded JSON 401 errors; reconstruct every original byte, including
 * oversized/non-auth errors, without cloning or buffering resource streams. */
async function observeResourceError(response: Response, snapshot: AccessSnapshot, store: BffSessionStore): Promise<ReadableStream<Uint8Array> | null> {
  if (response.status !== 401 || !jsonType(response.headers) || !response.body) return response.body
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let ended = false
  try {
    while (size <= AUTH_BYTES) {
      const next = await reader.read()
      if (next.done) { ended = true; break }
      chunks.push(next.value); size += next.value.byteLength
    }
    if (ended && size <= AUTH_BYTES) {
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
      try {
        const value = JSON.parse(new TextDecoder().decode(bytes))
        if (['AUTH_REQUIRED', 'ACCESS_EXPIRED'].includes(value?.error?.code)) store.observeAuthFailure(snapshot, value.error.code)
      } catch { /* Non-auth errors retain their original status and bytes. */ }
    }
  } catch (error) { reader.releaseLock(); throw error }
  return new ReadableStream<Uint8Array>({
    start(controller) { for (const chunk of chunks) controller.enqueue(chunk); if (ended) { reader.releaseLock(); controller.close() } },
    async pull(controller) {
      if (ended) return
      try { const next = await reader.read(); if (next.done) { ended = true; reader.releaseLock(); controller.close() } else controller.enqueue(next.value) }
      catch (error) { ended = true; reader.releaseLock(); controller.error(error) }
    },
    async cancel(reason) { if (!ended) { ended = true; try { await reader.cancel(reason) } finally { reader.releaseLock() } } },
  })
}

export type ProxyOptions = {
  fetch?: (url: string, options?: RequestInit) => Promise<Response>
  storeFactory?: (options: BffSessionOptions) => BffSessionStore
}
/** Injected ordinary Fetch/Request/Response for deterministic, credential-free tests. */
export function createSessionProxy(config: WebSessionConfig, options: ProxyOptions = {}) {
  const fetcher = options.fetch ?? ((url, init) => fetch(url, init))
  const context = new AsyncLocalStorage<RequestContext>()
  async function nativeFetch(path: string, method: string, signal: AbortSignal, body?: unknown, access?: string): Promise<Response> {
    const headers = new Headers(context.getStore()?.headers)
    headers.set('Accept', 'application/json'); headers.set('Accept-Encoding', 'identity')
    if (body !== undefined) headers.set('Content-Type', 'application/json')
    if (access) headers.set('Authorization', `Bearer ${access}`)
    const response = await fetcher(`${config.internalOrigin}${path}`, { method, headers, signal,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}), cache: 'no-store', redirect: 'manual' })
    if (isRedirect(response)) { cancelBody(response.body); transportFailure(context.getStore(), new ProxyFailure('UPSTREAM_UNAVAILABLE', 502)) }
    return response
  }
  async function readiness(signal: AbortSignal): Promise<void> {
    try {
      const response = await nativeFetch('/api/auth/status', 'GET', signal)
      if (response.status !== 200) { cancelBody(response.body); throw new ProxyFailure('AUTH_UNAVAILABLE') }
      const body = await nativeJson(response)
      if (!exactKeys(body, ['auth_enabled', 'auth_mode', 'protocol_version']) || body.auth_enabled !== true || body.auth_mode !== 'device_sessions' || body.protocol_version !== 1) throw new ProxyFailure('AUTH_UNAVAILABLE')
    } catch (error) {
      // The core still owns retirement after uncertain/due refresh. Preserve a
      // known pre-dispatch readiness failure for this observing request only,
      // rather than misreporting backend configuration/outage as bad credentials.
      transportFailure(context.getStore(), error instanceof ProxyFailure ? error : new ProxyFailure('AUTH_UNAVAILABLE'))
    }
  }
  async function legacyReadiness(signal: AbortSignal): Promise<Record<string, unknown>> {
    let response: Response
    try {
      response = await fetcher(`${config.internalOrigin}/api/auth/status`, { method: 'GET',
        headers: new Headers({ Accept: 'application/json', 'Accept-Encoding': 'identity' }),
        signal, cache: 'no-store', redirect: 'manual' })
    } catch { throw new ProxyFailure('AUTH_UNAVAILABLE') }
    if (isRedirect(response)) { cancelBody(response.body); throw new ProxyFailure('UPSTREAM_UNAVAILABLE', 502) }
    if (response.status !== 200) { cancelBody(response.body); throw new ProxyFailure('AUTH_UNAVAILABLE') }
    const value = await nativeJson(response)
    if (!exactKeys(value, ['auth_enabled', 'message']) || typeof value.auth_enabled !== 'boolean' || typeof value.message !== 'string') throw new ProxyFailure('AUTH_UNAVAILABLE')
    return value
  }
  const native: NativeCalls = {
    async create(input, signal) {
      await readiness(signal)
      const response = await nativeFetch('/api/auth/sessions', 'POST', signal, input)
      if (response.status !== 201) {
        const error = await upstreamError(response)
        if (['AUTH_INVALID_REQUEST', 'AUTH_INVALID_CREDENTIALS', 'AUTH_RATE_LIMITED', 'AUTH_UNAVAILABLE'].includes(error.code)
          && ERROR_STATUS[error.code] === error.status) throw new NativeCallError(error.code as 'AUTH_INVALID_REQUEST', error.retryAfter)
        transportFailure(context.getStore(), error)
      }
      if (!jsonType(response.headers)) { cancelBody(response.body); throw new ProxyFailure('AUTH_UNAVAILABLE') }
      return readJson(response.body)
    },
    async refresh(input, signal) {
      await readiness(signal)
      const response = await nativeFetch('/api/auth/sessions/refresh', 'POST', signal, input)
      if (response.status !== 200 || !jsonType(response.headers)) { cancelBody(response.body); throw new ProxyFailure('AUTH_UNAVAILABLE') }
      return readJson(response.body)
    },
    async probe(snapshot, signal) {
      await readiness(signal)
      const response = await nativeFetch('/api/auth/sessions', 'GET', signal, undefined, snapshot.accessToken)
      if (response.status !== 200) { const error = await upstreamError(response); return { ok: false, code: error.code } }
      if (!jsonType(response.headers)) { cancelBody(response.body); throw new ProxyFailure('AUTH_UNAVAILABLE') }
      sessionList(await nativeJson(response, LIST_BYTES))
      return { ok: true }
    },
    revoke(input, signal) {
      // Core-owned best-effort maintenance is not the request that happened to
      // sweep this record. Isolate both diagnostics and incidental headers so
      // cleanup cannot poison another caller's result or borrow its context.
      return context.run({ headers: new Headers() }, async () => {
        const response = await nativeFetch(`/api/auth/sessions/${input.sessionId}`, 'DELETE', signal, undefined, input.accessToken)
        cancelBody(response.body)
        return response.status === 204
      })
    },
  }
  const store = (options.storeFactory ?? (value => new BffSessionStore(value)))({ native })
  function ref(cookie: CookieState): RecordRef | undefined {
    if (cookie.obsolete || !cookie.handle) return undefined
    const digest = digestSessionHandle(cookie.handle)
    return digest ? store.lookup(digest) : undefined
  }
  async function webAuth(req: Request, route: RoutePolicy, cookie: CookieState): Promise<Response> {
    if (req.method === 'POST' && route.template === '/api/auth/sessions') {
      const body = await authBody(req)
      if (containsCredentials(body)) throw new ProxyFailure('AUTH_MIXED_CREDENTIALS')
      // login() reserves/owns admission BEFORE even native readiness awaits.
      const result = await store.login(loginInput(body), ref(cookie))
      if (result.kind === 'published') {
        const headers = new Headers(BASE_HEADERS)
        headers.append('Set-Cookie', `${config.cookieName}=${result.handle}; Path=/; Expires=${new Date(result.metadata.refresh_expires_at).toUTCString()}; HttpOnly; SameSite=Strict${config.secure ? '; Secure' : ''}`)
        if (cookie.obsolete) for (const name of OLD_COOKIES) {
          if (!config.secure && name.startsWith('__Host-')) continue
          headers.append('Set-Cookie', `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${config.secure ? '; Secure' : ''}`)
        }
        return json(result.metadata, 201, headers)
      }
      if (context.getStore()?.transportFailure) throw context.getStore()!.transportFailure!
      return result.kind === 'login-rejected' ? failure(result.code, undefined, result.retryAfter) : outcomeResponse(result)
    }
    if (req.method === 'POST') {
      const body = await authBody(req)
      if (containsCredentials(body)) throw new ProxyFailure('AUTH_MIXED_CREDENTIALS')
      if (!exactKeys(body, [])) throw new ProxyFailure('AUTH_INVALID_REQUEST')
      const own = ref(cookie)
      if (!own) return failure('AUTH_REQUIRED')
      if (route.template === '/api/auth/web-signout-local') {
        store.retireOwn(own)
        return json({ server_revocation: 'unconfirmed' })
      }
      const outcome = await store.refresh(own)
      if (context.getStore()?.transportFailure) throw context.getStore()!.transportFailure!
      return outcomeResponse(outcome)
    }
    if (req.method === 'DELETE') await authBody(req, true)
    await readiness(AbortSignal.any([req.signal, AbortSignal.timeout(10_000)]))
    const own = ref(cookie)
    if (route.template === '/api/auth/status') {
      const outcome = own ? await store.confirmStatus(own) : undefined
      if (context.getStore()?.transportFailure) throw context.getStore()!.transportFailure!
      const phase = outcome?.kind === 'confirmed' ? 'authenticated' : outcome?.kind === 'busy' ? 'unavailable'
        : outcome?.kind ?? (cookie.ambient ? 'reauth-required' : 'anonymous')
      return json({ auth_enabled: true, auth_mode: 'device_sessions', protocol_version: 1,
        web: { phase, session: outcome && 'metadata' in outcome ? outcome.metadata : null } })
    }
    if (!own) return failure('AUTH_REQUIRED')
    const proof = await store.validateAuthority(own)
    if (context.getStore()?.transportFailure) throw context.getStore()!.transportFailure!
    if (proof.kind !== 'access') return outcomeResponse(proof)
    if (req.method === 'GET') {
      const response = await nativeFetch('/api/auth/sessions', 'GET', AbortSignal.any([req.signal, AbortSignal.timeout(10_000)]), undefined, proof.accessToken)
      if (response.status !== 200) { const error = await upstreamError(response); store.observeAuthFailure(proof, error.code); throw error }
      if (!jsonType(response.headers)) { cancelBody(response.body); throw new ProxyFailure('AUTH_UNAVAILABLE') }
      return json(sessionList(await nativeJson(response, LIST_BYTES)))
    }
    const target = route.template === '/api/auth/sessions' ? 'all' : decodeURIComponent(rawPath(req).split('?')[0].split('/').at(-1)!)
    if (target !== 'all' && !UUID.test(target)) throw new ProxyFailure('AUTH_INVALID_REQUEST')
    const boundary = store.captureAuthorizedRevocation(proof, target)
    if (boundary.kind !== 'captured') return outcomeResponse(boundary)
    // Capture retires identities, including caller for revoke-all. Preserve this
    // exact request-local proof for the ONE native call; never re-look it up.
    let acknowledged = false
    try {
      const response = await nativeFetch(target === 'all' ? '/api/auth/sessions' : `/api/auth/sessions/${target}`, 'DELETE',
        AbortSignal.any([req.signal, AbortSignal.timeout(10_000)]), undefined, proof.accessToken)
      if (response.status !== 204) throw await upstreamError(response)
      acknowledged = true
      return new Response(null, { status: 204, headers: BASE_HEADERS })
    } finally { store.completeRevocation(boundary, acknowledged) }
  }
  async function forward(req: Request, route: RoutePolicy, path: string, access?: AccessSnapshot, explicit = false): Promise<Response> {
    const headers = requestHeaders(req, route, access?.accessToken, explicit)
    if (config.mode === 'legacy_password' && route.kind === 'sse' && req.method === 'POST') headers.set('Content-Type', 'application/json')
    const init: RequestInit & { duplex?: 'half' } = { method: req.method, headers, cache: 'no-store', redirect: 'manual', signal: req.signal }
    if (!SAFE.has(req.method) && req.body) { init.body = req.body; init.duplex = 'half' }
    const upstream = await fetcher(`${config.internalOrigin}${path}`, init)
    if (isRedirect(upstream)) { cancelBody(upstream.body); throw new ProxyFailure('UPSTREAM_UNAVAILABLE', 502) }
    const body = access ? await observeResourceError(upstream, access, store) : upstream.body
    return new Response(req.method === 'HEAD' || [204, 205, 304].includes(upstream.status) ? null : body,
      { status: upstream.status, headers: responseHeaders(upstream, route) })
  }
  async function resource(req: Request, route: RoutePolicy, cookie: CookieState, path: string): Promise<Response> {
    let snapshot: AccessSnapshot | undefined
    if (route.kind !== 'public') {
      const own = ref(cookie)
      if (!own) return failure('AUTH_REQUIRED')
      const digest = digestSessionHandle(cookie.handle!)!
      const candidate = store.snapshotForResource(digest)
      if (candidate.kind !== 'access') return outcomeResponse(candidate)
      snapshot = candidate
      if (route.kind === 'multipart') {
        const proof = await store.validateAuthority(own)
        if (context.getStore()?.transportFailure) throw context.getStore()!.transportFailure!
        if (proof.kind !== 'access') return outcomeResponse(proof)
        snapshot = proof
      } else await readiness(AbortSignal.any([req.signal, AbortSignal.timeout(10_000)]))
    } else await readiness(AbortSignal.any([req.signal, AbortSignal.timeout(10_000)]))
    return forward(req, route, path, snapshot)
  }
  async function nativeAuth(req: Request, route: RoutePolicy, path: string): Promise<Response> {
    if (route.template === '/api/auth/web-signout-local') return failure('AUTH_INVALID_REQUEST')
    let body: Record<string, unknown> | undefined
    if (req.method === 'POST') {
      body = await authBody(req)
      if (req.headers.has('authorization')) throw new ProxyFailure('AUTH_MIXED_CREDENTIALS')
      if (route.template === '/api/auth/sessions') body = loginInput(body)
      else if (!exactKeys(body, ['session_id', 'refresh_token']) || typeof body.session_id !== 'string' || !UUID.test(body.session_id)
        || typeof body.refresh_token !== 'string' || !/^swr1_[A-Za-z0-9_-]{43}$/.test(body.refresh_token)) throw new ProxyFailure('AUTH_INVALID_REQUEST')
    }
    if (req.method === 'DELETE') await authBody(req, true)
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(10_000)])
    await readiness(signal)
    const headers = requestHeaders(req, route, undefined, true)
    // Auth JSON is validated/normalized above; its original byte length is no
    // longer authoritative. Let Fetch compute the regenerated length.
    headers.delete('content-length')
    const response = await fetcher(`${config.internalOrigin}${path}`, { method: req.method, headers, signal,
      ...(body ? { body: JSON.stringify(body) } : {}), cache: 'no-store', redirect: 'manual' })
    if (isRedirect(response)) { cancelBody(response.body); throw new ProxyFailure('UPSTREAM_UNAVAILABLE', 502) }
    if (!response.ok) throw await upstreamError(response)
    return new Response([204, 205, 304].includes(response.status) ? null : response.body, { status: response.status, headers: responseHeaders(response, route) })
  }
  async function dispatch(req: Request, legacyPath?: string, expected?: RoutePolicy): Promise<Response> {
    try {
      const path = rawPath(req)
      const route = matchApiRoute(req.method, path)
      if (config.mode === 'legacy_password') {
        // Keep legacy's broad API surface and password Bearer, not a device-mode
        // fallback. Filesystem handlers replace rewrites without a size cap.
        const destination = legacyPath ?? path
        if (!destination.startsWith('/api/') || destination.includes('\\') || destination.includes('#')) return failure('AUTH_INVALID_REQUEST')
        const legacyRoute = route ?? { method: req.method, template: path.split('?')[0], kind: 'json' as const, headerClass: 'json' as const }
        const decodedPath = decodeURIComponent(path.split('?')[0])
        // Native session operations are unavailable in legacy mode even if
        // the backend was replaced. This local rejection needs no probe/body.
        if (decodedPath.startsWith('/api/auth/') && decodedPath !== '/api/auth/status') return failure('AUTH_UNAVAILABLE')
        // Every dispatch gets a fresh credential-free check: no positive mode
        // cache can survive an API replacement or accidentally enable native
        // passthrough. In particular, do this before forwarding any upload byte.
        const status = await legacyReadiness(AbortSignal.any([req.signal, AbortSignal.timeout(10_000)]))
        if (decodedPath === '/api/auth/status' && req.method === 'GET') return json(status)
        if (req.signal.aborted) return new Response(null, { status: 499, headers: BASE_HEADERS })
        return await forward(req, legacyRoute, destination, undefined, true)
      }
      const cookie = cookies(req, config)
      const boundary = webBoundary(req, config, cookie)
      return await context.run(boundary.context, async () => {
        if (req.method === 'OPTIONS') {
          const allowed = METHODS.filter(method => matchApiRoute(method, path))
          if (!allowed.length) return failure('AUTH_INVALID_REQUEST', 404)
          const requested = req.headers.get('access-control-request-method')
          if (requested && !allowed.includes(requested)) return failure('AUTH_INVALID_REQUEST', 405)
          return new Response(null, { status: 204, headers: { ...BASE_HEADERS, Allow: [...allowed, 'OPTIONS'].join(', ') } })
        }
        if (!route || expected && (expected.template !== route.template || expected.method !== route.method || expected.kind !== route.kind)) {
          return failure('AUTH_INVALID_REQUEST', METHODS.some(method => matchApiRoute(method, path)) ? 405 : 404)
        }
        const auth = route.kind === 'auth' || route.template === '/api/auth/status'
        if (boundary.native) {
          if (auth) return nativeAuth(req, route, path)
          const signal = AbortSignal.any([req.signal, AbortSignal.timeout(10_000)])
          await readiness(signal)
          if (route.kind === 'multipart') {
            // Explicit native transport still authenticates before uploading
            // bytes; API validates the actual mutation again afterward.
            const headers = requestHeaders(req, { ...route, kind: 'auth', headerClass: 'auth' }, undefined, true)
            headers.delete('content-length'); headers.delete('content-type')
            const probe = await fetcher(`${config.internalOrigin}/api/auth/sessions`, { method: 'GET', headers, signal, cache: 'no-store', redirect: 'manual' })
            if (isRedirect(probe)) { cancelBody(probe.body); throw new ProxyFailure('UPSTREAM_UNAVAILABLE', 502) }
            if (probe.status !== 200) throw await upstreamError(probe)
            sessionList(await nativeJson(probe, LIST_BYTES))
          }
          return forward(req, route, path, undefined, true)
        }
        return auth ? webAuth(req, route, cookie) : resource(req, route, cookie, path)
      })
    } catch (error) {
      if (error instanceof ProxyFailure) return failure(error.code, error.status, error.retryAfter)
      if (req.signal.aborted) return new Response(null, { status: 499, headers: BASE_HEADERS })
      return failure('UPSTREAM_UNAVAILABLE', 502)
    }
  }
  return {
    dispatch,
    proxyAuth: (req: Request, route: RoutePolicy) => dispatch(req, undefined, route),
    proxyResource: (req: Request, route: RoutePolicy) => dispatch(req, undefined, route),
  }
}

const PROXY_KEY = Symbol.for('study-workbench.bff-session-proxy/v1')
function processProxy() {
  const config = getWebSessionConfig()
  if (config.mode === 'legacy_password') return createSessionProxy(config)
  const host = globalThis as typeof globalThis & { [PROXY_KEY]?: { fingerprint: string; proxy: ReturnType<typeof createSessionProxy> } }
  const fingerprint = JSON.stringify(config)
  if (host[PROXY_KEY]) {
    if (host[PROXY_KEY].fingerprint !== fingerprint) throw new ProxyFailure('AUTH_UNAVAILABLE')
    return host[PROXY_KEY].proxy
  }
  const proxy = createSessionProxy(config, { storeFactory: getProcessBffSessionStore })
  Object.defineProperty(host, PROXY_KEY, { value: { fingerprint, proxy } })
  return proxy
}
export async function dispatchApiRequest(req: Request, legacyPath?: string): Promise<Response> {
  try { return await processProxy().dispatch(req, legacyPath) } catch { return failure('AUTH_UNAVAILABLE') }
}
export async function proxyAuth(req: Request, route: RoutePolicy): Promise<Response> {
  try { return await processProxy().proxyAuth(req, route) } catch { return failure('AUTH_UNAVAILABLE') }
}
export async function proxyResource(req: Request, route: RoutePolicy): Promise<Response> {
  try { return await processProxy().proxyResource(req, route) } catch { return failure('AUTH_UNAVAILABLE') }
}
