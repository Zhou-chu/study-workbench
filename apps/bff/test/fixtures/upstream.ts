import { createServer, type IncomingHttpHeaders, type IncomingMessage, type RequestListener, type Server, type ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { createBffHandler } from '../../src/server.js'
import { createHttpAdapter } from '../../src/http-adapter.js'
import { BffSessionStore, type SessionClock } from '../../src/session-store.js'
import { config, origin } from '../fixtures.js'

export const sessionId = '12345678-1234-1234-1234-123456789abc'
export const token = (prefix: string, byte: number) => prefix + Buffer.alloc(32, byte).toString('base64url')
export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
export class FixtureClock implements SessionClock {
  time = Date.now()
  #sequence = 0
  #timers = new Map<number, { at: number; callback: () => void }>()
  now = () => this.time
  setTimeout = (callback: () => void, delay: number) => {
    const id = ++this.#sequence
    this.#timers.set(id, { at: this.time + delay, callback })
    return id as unknown as ReturnType<typeof setTimeout>
  }
  clearTimeout = (id: ReturnType<typeof setTimeout>) => { this.#timers.delete(id as unknown as number) }
  advance(ms: number) {
    this.time += ms
    for (const [id, timer] of this.#timers) if (timer.at <= this.time) { this.#timers.delete(id); timer.callback() }
  }
}
export type Captured = { method: string; path: string; headers: IncomingHttpHeaders; bytes?: Buffer }
export type Consumption = { iterators: number; pulls: number; bytes: number }
export function instrumentBody(req: IncomingMessage): Consumption {
  const stats = { iterators: 0, pulls: 0, bytes: 0 }
  const originalIterator = req.iterator.bind(req)
  const originalAsyncIterator = req[Symbol.asyncIterator].bind(req)
  function tracked(iterator: ReturnType<typeof originalAsyncIterator>) {
    stats.iterators++
    const next = iterator.next.bind(iterator)
    return Object.assign(iterator, { next: async (...args: [] | [unknown]) => {
      stats.pulls++
      const chunk = await next(...args)
      if (!chunk.done) stats.bytes += chunk.value.length
      return chunk
    } })
  }
  // Both Node entry points are observed, so the positive upload control and
  // rejected-request assertions instrument the adapter's actual reader.
  req[Symbol.asyncIterator] = () => tracked(originalAsyncIterator())
  req.iterator = options => tracked(originalIterator(options))
  return stats
}
const servers = new Set<Server>()
export async function listen(server: Server) {
  servers.add(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('fixture address')
  return `http://127.0.0.1:${address.port}`
}
export async function closeFixtures() {
  await Promise.all([...servers].map(server => new Promise<void>(resolve => {
    server.closeAllConnections(); server.close(() => resolve()); servers.delete(server)
  })))
}
export function sendJson(res: ServerResponse, value: unknown, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value))
}
export async function collect(req: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}
export async function startUpstream(mode: 'legacy_password' | 'device_sessions', options: {
  respond?: (req: IncomingMessage, res: ServerResponse, entry: Captured) => void | Promise<void>
  refresh?: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  list?: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  create?: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  onRefreshAdmission?: (count: number) => void
  nativePassthrough?: boolean
  accessMs?: number
  clock?: FixtureClock
  onBffResponse?: (path: string, response: Response) => void | Promise<void>
} = {}) {
  const clock = options.clock ?? new FixtureClock()
  const events: string[] = []
  const captured: Captured[] = []
  const reads: Consumption[] = []
  const ingress: IncomingHttpHeaders[] = []
  let refreshAdmissions = 0
  const refreshStarted = deferred()
  let rotations = 0
  let readinessMode = mode
  const sessionEnd = clock.now() + 86_400_000
  const envelope = (generation = 0) => ({ session_id: sessionId, access_token: token('swa1_', generation + 1),
    refresh_token: token('swr1_', generation + 11), access_expires_at: new Date(clock.now() + (generation ? 600_000 : options.accessMs ?? 600_000)).toISOString(),
    refresh_expires_at: new Date(sessionEnd).toISOString() })
  const upstream = await listen(createServer((req, res) => {
    void (async () => {
      const entry: Captured = { method: req.method!, path: req.url!, headers: req.headers }
      captured.push(entry); events.push(`api:${req.method}:${req.url}`)
      if (req.url === '/api/auth/status') return sendJson(res, readinessMode === 'legacy_password'
        ? { auth_enabled: true, message: 'required' } : { auth_enabled: true, auth_mode: readinessMode, protocol_version: 1 })
      if (req.url === '/api/auth/sessions/refresh') {
        entry.bytes = await collect(req); rotations++; refreshStarted.resolve()
        if (options.refresh) return options.refresh(req, res)
        return sendJson(res, envelope(rotations))
      }
      if (req.url === '/api/auth/sessions') {
        if (req.method === 'POST') { entry.bytes = await collect(req); if (options.create) return options.create(req, res); return sendJson(res, envelope(), 201) }
        if (options.list) return options.list(req, res)
        return sendJson(res, { sessions: [] })
      }
      if (options.respond) return options.respond(req, res, entry)
      return sendJson(res, { ok: true })
    })().catch(() => res.destroy())
  }))
  const cfg = { ...config(mode), internalOrigin: upstream, nativePassthrough: options.nativePassthrough ?? false }
  const handler = createBffHandler(cfg, { storeFactory: value => {
    const store = new BffSessionStore({ ...value, clock })
    const refresh = store.refresh.bind(store)
    store.refresh = ref => { const result = refresh(ref); options.onRefreshAdmission?.(++refreshAdmissions); return result }
    return store
  } })
  const wrapped = async (request: Request) => {
    const response = await handler(request)
    events.push(`bff:${request.method}:${new URL(request.url).pathname}:${response.status}`)
    await options.onBffResponse?.(new URL(request.url).pathname, response)
    return response
  }
  const adapter = createHttpAdapter(wrapped, cfg)
  const bff = await listen(createServer(((req, res) => { reads.push(instrumentBody(req)); ingress.push(req.headers); adapter(req, res) }) as RequestListener))
  const headers: Record<string, string> = { origin, 'x-studyworkbench-csrf': '1', 'content-type': 'application/json', cookie: 'CF_Authorization=synthetic-ingress' }
  if (mode === 'legacy_password') headers.authorization = 'Bearer synthetic-password'
  async function activate() {
    if (mode !== 'device_sessions') return
    const login = await fetch(bff + '/api/auth/sessions', { method: 'POST', headers, body: '{"password":"synthetic-password","device_name":"Synthetic browser"}' })
    if (login.status !== 201) throw new Error(`fixture login ${login.status}`)
    headers.cookie += '; ' + login.headers.getSetCookie()[0]!.split(';')[0]
    await login.arrayBuffer()
    const status = await fetch(bff + '/api/auth/status', { headers })
    if ((await status.json()).web.phase !== 'authenticated') throw new Error('fixture pending')
  }
  return { bff, upstream, cfg, headers, captured, events, reads, ingress, clock, envelope, activate, refreshStarted, rotations: () => rotations, setReadinessMode: (value: typeof mode) => { readinessMode = value } }
}
