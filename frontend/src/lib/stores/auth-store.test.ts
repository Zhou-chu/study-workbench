import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const cfg = vi.hoisted(() => ({ authMode: 'device_sessions', apiUrl: '', webSessionProtocol: 'bff-memory-v1' }))
vi.mock('@/lib/config', () => ({ getConfig: vi.fn(async () => cfg), getApiUrl: async () => cfg.apiUrl, resetConfig: vi.fn() }))
const metadata = { session_id: 'synthetic-session', access_expires_at: '2030-01-01T00:15:00Z', refresh_expires_at: '2030-01-31T00:00:00Z', generation: 0 }
const status = (phase: string, session: unknown = null) => ({ auth_enabled: true, auth_mode: 'device_sessions', protocol_version: 1, web: { phase, session } })
const json = (data: unknown, code = 200) => new Response(JSON.stringify(data), { status: code, headers: { 'Content-Type': 'application/json' } })
const request = vi.fn<typeof fetch>()
beforeEach(async () => { vi.resetModules(); const { getConfig } = await import('@/lib/config'); vi.mocked(getConfig).mockReset().mockImplementation(async () => cfg as never); cfg.authMode = 'device_sessions'; cfg.apiUrl = ''; request.mockReset(); vi.stubGlobal('fetch', request); localStorage.clear() })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear() })
async function store() { return (await import('./auth-store')).useAuthStore }
describe('metadata-only device bootstrap and recovery', () => {
  it.each(['{corrupt-password', JSON.stringify({ state: { token: 'old-secret', isAuthenticated: true } })])('purges old storage without hydrating its content', async saved => {
    localStorage.setItem('auth-storage', saved); localStorage.setItem('theme-storage', 'theme'); localStorage.setItem('language-storage', 'locale')
    const read = vi.spyOn(Storage.prototype, 'getItem')
    const auth = await store(); request.mockResolvedValueOnce(json(status('authenticated', metadata)))
    await auth.getState().bootstrap()
    expect(auth.getState()).toMatchObject({ phase: 'authenticated', session: metadata, hasHydrated: true })
    expect(auth.getState()).not.toHaveProperty('token')
    expect(read.mock.calls.filter(([key]) => key === 'auth-storage')).toHaveLength(0)
    expect(localStorage.getItem('auth-storage')).toBeNull()
    expect(localStorage.getItem('theme-storage')).toBe('theme'); expect(localStorage.getItem('language-storage')).toBe('locale')
    expect(JSON.stringify(auth.getState())).not.toContain('old-secret')
  })
  it('does not read/send passwords until config establishes an explicit legacy mode', async () => {
    const { getConfig } = await import('@/lib/config')
    vi.mocked(getConfig).mockRejectedValueOnce(new Error('configuration unavailable'))
    localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'do-not-send' } }))
    const read = vi.spyOn(Storage.prototype, 'getItem'); const auth = await store()
    await auth.getState().bootstrap()
    expect(request).not.toHaveBeenCalled(); expect(read.mock.calls).not.toContainEqual(['auth-storage'])
    expect(auth.getState().phase).toBe('unavailable')
  })
  it('continues without localStorage or Web Locks', async () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('disabled') })
    const auth = await store(); request.mockResolvedValueOnce(json(status('authenticated', metadata)))
    expect(await auth.getState().bootstrap()).toBe(true)
    expect(auth.getState().phase).toBe('authenticated')
  })
  it('keeps pending login untrusted until cookie status confirms it', async () => {
    const auth = await store()
    let complete!: (value: Response) => void
    request.mockResolvedValueOnce(json(metadata, 201)).mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    const login = auth.getState().login('synthetic-password')
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    expect(auth.getState()).toMatchObject({ phase: 'pending', isAuthenticated: false })
    expect(request.mock.calls[0][0]).toBe('/api/auth/sessions')
    expect(new Headers(request.mock.calls[0][1]?.headers).get('Authorization')).toBeNull()
    complete(json(status('authenticated', metadata)))
    expect(await login).toBe(true)
    expect(JSON.stringify(auth.getState())).not.toContain('synthetic-password')
    expect(localStorage.getItem('auth-storage')).toBeNull()
  })
  it('does not authenticate if the login cookie was never installed', async () => {
    const auth = await store(); request.mockResolvedValueOnce(json(metadata, 201)).mockResolvedValueOnce(json(status('anonymous')))
    expect(await auth.getState().login('fixture-password')).toBe(false)
    expect(auth.getState().phase).toBe('anonymous')
  })
  it('expired access requires one explicit refresh and does not replay a resource', async () => {
    const auth = await store(); request.mockResolvedValueOnce(json(status('refresh-needed')))
    await auth.getState().bootstrap()
    expect(auth.getState().phase).toBe('refresh-needed'); expect(request).toHaveBeenCalledTimes(1)
    request.mockResolvedValueOnce(json({ ...metadata, generation: 1 }))
    expect(await auth.getState().refresh()).toBe(true)
    expect(request.mock.calls[1][0]).toBe('/api/auth/sessions/refresh')
    expect(request.mock.calls[1][1]?.body).toBe('{}')
  })
  it('lost browser refresh delivery recovers with status, not another rotation', async () => {
    const auth = await store(); request.mockRejectedValueOnce(new TypeError('network failure'))
    await auth.getState().refresh(); expect(auth.getState().phase).toBe('unavailable')
    request.mockResolvedValueOnce(json(status('authenticated', { ...metadata, generation: 1 })))
    await auth.getState().bootstrap()
    expect(auth.getState().phase).toBe('authenticated')
    expect(request.mock.calls.map(([url]) => url)).toEqual(['/api/auth/sessions/refresh', '/api/auth/status'])
  })
  it('BFF custody loss requires login and never falls back to a password Bearer', async () => {
    const auth = await store(); request.mockResolvedValueOnce(json({ error: { code: 'AUTH_REQUIRED' } }, 401))
    expect(await auth.getState().refresh()).toBe(false)
    expect(auth.getState().phase).toBe('reauth-required')
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('ignores stale login JSON after local signout and reports remote revocation honestly', async () => {
    const auth = await store(); let complete!: (value: Response) => void
    request.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    const login = auth.getState().login('fixture-password')
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    request.mockResolvedValueOnce(json({ server_revocation: 'unconfirmed' }))
    await auth.getState().signoutLocal()
    complete(json(metadata, 201)); expect(await login).toBe(false)
    expect(auth.getState()).toMatchObject({ phase: 'anonymous', serverRevocation: 'unconfirmed', isAuthenticated: false })
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('local signout during an outage never claims server retirement was acknowledged', async () => {
    const auth = await store(); request.mockRejectedValueOnce(new TypeError('offline'))
    await auth.getState().signoutLocal()
    expect(auth.getState()).toMatchObject({ phase: 'anonymous', serverRevocation: 'unconfirmed', localSignoutConfirmed: false })
  })
  it('204 alone confirms remote revocation', async () => {
    const auth = await store(); request.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await auth.getState().revokeAll()
    expect(auth.getState()).toMatchObject({ phase: 'anonymous', serverRevocation: 'confirmed' })
  })
})

it('keeps explicit legacy wrong-password entry retryable without treating it as an outage', async () => {
  cfg.authMode = 'legacy_password'; cfg.apiUrl = 'http://127.0.0.1:5055'
  const auth = await store(); request.mockResolvedValueOnce(json({ detail: 'Invalid password' }, 401))
  expect(await auth.getState().login('synthetic-wrong')).toBe(false)
  expect(auth.getState()).toMatchObject({ phase: 'anonymous', error: 'auth.invalidPassword' })
  expect(new Headers(request.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer synthetic-wrong')
})
it('explicit successful recovery revalidates active reads but never replays failed mutations', async () => {
  const auth = await store(); const { queryClient } = await import('@/lib/api/query-client')
  const { QueryObserver, MutationObserver } = await import('@tanstack/react-query')
  const read = vi.fn(async () => 'updated read')
  const observer = new QueryObserver(queryClient, { queryKey: ['recovery-read'], queryFn: read, initialData: 'kept read', staleTime: Infinity })
  const unsubscribe = observer.subscribe(() => {})
  const write = vi.fn(async () => { throw new Error('dispatched save is uncertain') })
  const mutation = new MutationObserver(queryClient, { mutationFn: write })
  await expect(mutation.mutate()).rejects.toThrow()
  auth.setState({ phase: 'unavailable', hasHydrated: true })
  request.mockResolvedValueOnce(json(status('authenticated', metadata)))
  await auth.getState().bootstrap()
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1))
  expect(write).toHaveBeenCalledTimes(1); expect(mutation.getCurrentResult().status).toBe('error')
  unsubscribe(); queryClient.clear()
})
it('a known device can retire its BFF handle even when backend configuration is unavailable', async () => {
  const auth = await store(); auth.setState({ mode: 'device_sessions', phase: 'authenticated', isAuthenticated: true })
  const { getConfig } = await import('@/lib/config')
  vi.mocked(getConfig).mockRejectedValueOnce(new Error('backend config outage'))
  request.mockResolvedValueOnce(json({ server_revocation: 'unconfirmed' }))
  expect(await auth.getState().signoutLocal()).toBe(true)
  expect(request.mock.calls.map(([url]) => url)).toEqual(['/api/auth/web-signout-local'])
  expect(request.mock.calls[0][1]).toMatchObject({ method: 'POST', credentials: 'same-origin', redirect: 'error', body: '{}' })
  expect(new Headers(request.mock.calls[0][1]?.headers).get('X-StudyWorkbench-CSRF')).toBe('1')
  expect(new Headers(request.mock.calls[0][1]?.headers).has('Authorization')).toBe(false)
  expect(auth.getState()).toMatchObject({ localSignoutConfirmed: true, serverRevocation: 'unconfirmed' })
})
it('a superseded bootstrap cannot hold a newer status check hostage or overwrite it', async () => {
  const auth = await store(); let oldStatus!: (response: Response) => void
  request.mockImplementationOnce(() => new Promise(resolve => { oldStatus = resolve }))
  const oldBootstrap = auth.getState().bootstrap()
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
  request.mockResolvedValueOnce(json(metadata, 201)).mockResolvedValueOnce(json(status('authenticated', metadata)))
  expect(await auth.getState().login('fixture')).toBe(true)
  request.mockResolvedValueOnce(json(status('authenticated', { ...metadata, generation: 1 })))
  expect(await auth.getState().bootstrap()).toBe(true)
  oldStatus(json(status('reauth-required'))); expect(await oldBootstrap).toBe(false)
  expect(auth.getState()).toMatchObject({ phase: 'authenticated', session: { generation: 1 } })
})

it('lost local retirement acknowledgement is resolved by an explicit typed absent-handle retry', async () => {
  const auth = await store(); auth.setState({ mode: 'device_sessions', phase: 'authenticated', isAuthenticated: true })
  request.mockRejectedValueOnce(new TypeError('retired but response lost'))
  expect(await auth.getState().signoutLocal()).toBe(false)
  expect(auth.getState().localSignoutConfirmed).toBe(false)
  request.mockResolvedValueOnce(json({ error: { code: 'AUTH_REQUIRED' } }, 401))
  expect(await auth.getState().signoutLocal()).toBe(true)
  expect(auth.getState()).toMatchObject({ signedOutLocally: true, localSignoutConfirmed: true, serverRevocation: 'unconfirmed' })
  expect(request).toHaveBeenCalledTimes(2)
})
it.each([[503, { error: { code: 'AUTH_UNAVAILABLE' } }], [401, { error: { code: 'ACCESS_EXPIRED' } }], [401, '<html>ingress</html>']])('local retirement does not trust response %s %s', async (code, data) => {
  const auth = await store(); auth.setState({ mode: 'device_sessions' })
  request.mockResolvedValueOnce(json(data, code as number))
  expect(await auth.getState().signoutLocal()).toBe(false)
  expect(auth.getState()).toMatchObject({ signedOutLocally: true, localSignoutConfirmed: false, serverRevocation: 'unconfirmed' })
})

it.each(['invalid-password', 'outage'])('a failed %s sign-in preserves unconfirmed signout and its retry action', async failure => {
  const auth = await store()
  auth.setState({ mode: 'device_sessions', phase: 'anonymous', signedOutLocally: true, serverRevocation: 'unconfirmed', localSignoutConfirmed: false, hasHydrated: true })
  if (failure === 'invalid-password') request.mockResolvedValueOnce(json({ error: { code: 'AUTH_INVALID_CREDENTIALS' } }, 401))
  else request.mockRejectedValueOnce(new TypeError('service unavailable'))
  expect(await auth.getState().login('synthetic-password')).toBe(false)
  expect(auth.getState()).toMatchObject({ signedOutLocally: true, serverRevocation: 'unconfirmed', localSignoutConfirmed: false })
})

it.each([
  ['device_sessions', '<html>private ingress sign-in</html>', 'unavailable', 'auth.serviceUnavailable'],
  ['device_sessions', { detail: 'Invalid password' }, 'unavailable', 'auth.serviceUnavailable'],
  ['legacy_password', '<html>private ingress sign-in</html>', 'unavailable', 'auth.serviceUnavailable'],
  ['legacy_password', { detail: 'Missing authorization header' }, 'unavailable', 'auth.serviceUnavailable'],
  ['legacy_password', { detail: 'Invalid authorization header format' }, 'unavailable', 'auth.serviceUnavailable'],
  ['legacy_password', { detail: 'Invalid password' }, 'anonymous', 'auth.invalidPassword'],
  ['legacy_password', { detail: 'Invalid password', error: { code: 'AUTH_UNAVAILABLE' } }, 'unavailable', 'auth.serviceUnavailable'],
  ['legacy_password', '{"detail":"Invalid password"}', 'unavailable', 'auth.serviceUnavailable'],
] as const)('classifies %s login401 body %s without guessing a wrong password', async (mode, body, phase, error) => {
  cfg.authMode = mode
  const auth = await store()
  request.mockResolvedValueOnce(typeof body === 'string' ? new Response(body, { status: 401, headers: { 'Content-Type': 'text/html' } }) : json(body, 401))
  expect(await auth.getState().login('synthetic-password')).toBe(false)
  expect(auth.getState()).toMatchObject({ phase, error })
  expect(request).toHaveBeenCalledTimes(1)
})
it('an exact rejected saved legacy password reaches password recovery instead of endless connection checks', async () => {
  cfg.authMode = 'legacy_password'
  localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'synthetic-obsolete-password' } }))
  const auth = await store()
  request.mockResolvedValueOnce(json({ auth_enabled: true })).mockResolvedValueOnce(json({ detail: 'Invalid password' }, 401))
  expect(await auth.getState().bootstrap()).toBe(false)
  expect(auth.getState()).toMatchObject({ phase: 'reauth-required', error: 'auth.invalidPassword', isAuthenticated: false })
  expect(request).toHaveBeenCalledTimes(2)
})

describe('turn privacy context, independent of auth race generations', () => {
  async function retained() {
    const context = await import('@/lib/workbench/turn-context')
    context.publishTurnTarget({ mode: 'device_sessions', apiBase: `${window.location.origin}/api`, protocol: 'bff-memory-v1' }, true)
    const original = context.readTurnContext()!
    const payloads = new Map([['notebook:fixture', 'private retained draft']])
    const unsubscribe = context.subscribeTurnContext(() => { if (context.readTurnContext()?.epoch !== original.epoch) payloads.clear() })
    return { context, original, payloads, unsubscribe }
  }
  it.each(['signoutLocal', 'logout', 'revokeAll', 'revokeSession', 'unknown-own'] as const)('%s releases subscribed captures synchronously before unresolved mode lookup', async action => {
    const auth = await store(); auth.setState({ session: action === 'unknown-own' ? null : metadata })
    const held = await retained(); const { getConfig } = await import('@/lib/config')
    let finish!: (value: unknown) => void
    vi.mocked(getConfig).mockImplementationOnce(() => new Promise(resolve => { finish = value => resolve(value as Awaited<ReturnType<typeof getConfig>>) }))
    const pending = action === 'unknown-own' ? auth.getState().revokeSession('not-known-other') : action === 'revokeSession' ? auth.getState().revokeSession(metadata.session_id) : auth.getState()[action]()
    expect(held.payloads.size).toBe(0); expect(held.context.readTurnContext()!.epoch).toBeGreaterThan(held.original.epoch)
    finish(cfg); request.mockResolvedValueOnce(new Response(null, { status: 204 })); await pending; held.unsubscribe()
  })
  it.each(['revokeSession', 'refresh', 'bootstrap', 'login'] as const)('known-other revoke / ordinary %s keeps the turn context without POSTing turns', async action => {
    const auth = await store(); auth.setState({ session: metadata, phase: 'authenticated', hasHydrated: true })
    const held = await retained()
    if (action === 'revokeSession') request.mockResolvedValueOnce(new Response(null, { status: 204 }))
    else if (action === 'refresh') request.mockResolvedValueOnce(json(metadata))
    else if (action === 'login') request.mockResolvedValueOnce(json(metadata, 201)).mockResolvedValueOnce(json(status('authenticated', metadata)))
    else request.mockResolvedValueOnce(json(status('authenticated', metadata)))
    await (action === 'revokeSession' ? auth.getState().revokeSession('known-other') : action === 'login' ? auth.getState().login('fixture') : auth.getState()[action]())
    expect(held.context.readTurnContext()).toBe(held.original); expect(held.payloads.size).toBe(1)
    expect(request.mock.calls.every(([url]) => !String(url).includes('/turns'))).toBe(true); held.unsubscribe()
  })
})
