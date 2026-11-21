import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getConfig, resetConfig } from './config'
import { readTurnContext } from './workbench/turn-context'

describe('turn target config-flight boundary', () => {
  const ok = (body: unknown) => ({ ok: true, json: async () => body })
  const meta = (host: string) => ({ apiUrl: `https://${host}.example`, auth_mode: 'legacy_password' })
  const request = vi.fn()
  beforeEach(() => { resetConfig(); request.mockReset(); vi.stubGlobal('fetch', request); vi.stubEnv('NEXT_PUBLIC_API_URL', '') })
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); resetConfig() })
  it('suspends on reset, preserving same-target identity through failure and recovery', async () => {
    request.mockResolvedValueOnce(ok(meta('a'))).mockResolvedValueOnce(ok({}))
    await getConfig(); const original = readTurnContext()!
    resetConfig(); expect(readTurnContext()).toEqual({ ...original, ready: false })
    request.mockResolvedValueOnce(ok(meta('a'))).mockRejectedValueOnce(new Error('outage'))
    await expect(getConfig()).rejects.toThrow(); expect(readTurnContext()!.epoch).toBe(original.epoch)
    resetConfig(); request.mockResolvedValueOnce(ok(meta('a'))).mockResolvedValueOnce(ok({}))
    await getConfig(); expect(readTurnContext()).toEqual(original)
  })
  it('publishes a changed target before awaiting its readiness and retires A to B to A', async () => {
    request.mockResolvedValueOnce(ok(meta('a'))).mockResolvedValueOnce(ok({})); await getConfig()
    const a = readTurnContext()!
    resetConfig(); let finish!: (value: unknown) => void
    request.mockResolvedValueOnce(ok(meta('b'))).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const flight = getConfig(); await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    const b = readTurnContext()!; expect(b.epoch).toBeGreaterThan(a.epoch); expect(b.ready).toBe(false); expect(b.target.apiBase).toBe('https://b.example/api')
    finish(ok({})); await flight; expect(readTurnContext()!.epoch).toBe(b.epoch)
    resetConfig(); request.mockResolvedValueOnce(ok(meta('a'))).mockResolvedValueOnce(ok({})); await getConfig()
    expect(readTurnContext()!.epoch).toBeGreaterThan(b.epoch)
  })
  it.each(['metadata', 'metadata-json', 'readiness', 'readiness-json'])('a superseded A %s flight cannot publish or return usable config after B', async stage => {
    let finish!: (value: unknown) => void
    if (stage === 'metadata') request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    else if (stage === 'metadata-json') request.mockResolvedValueOnce({ ok: true, json: () => new Promise(resolve => { finish = resolve }) })
    else if (stage === 'readiness') request.mockResolvedValueOnce(ok(meta('a'))).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    else request.mockResolvedValueOnce(ok(meta('a'))).mockResolvedValueOnce({ ok: true, json: () => new Promise(resolve => { finish = resolve }) })
    const stale = getConfig().catch(error => error); await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    resetConfig(); request.mockResolvedValueOnce(ok(meta('b'))).mockResolvedValueOnce(ok({ version: 'B' }))
    const current = await getConfig(); const context = readTurnContext()
    finish(stage === 'metadata' ? ok(meta('a')) : stage === 'metadata-json' ? meta('a') : stage === 'readiness' ? ok({ version: 'A' }) : { version: 'A' })
    expect(await stale).toBeInstanceOf(Error); expect(await getConfig()).toBe(current); expect(readTurnContext()).toBe(context)
    expect(current.apiUrl).toBe('https://b.example')
  })
  it.each(['https://user:pass@bad.example', 'https://bad.example/?query=1', 'https://bad.example/#fragment', '/relative', 'file:///tmp/fixture'])('rejects invalid target %s before readiness fetch', async apiUrl => {
    request.mockResolvedValueOnce(ok({ apiUrl })); await expect(getConfig()).rejects.toThrow(); expect(request).toHaveBeenCalledTimes(1)
  })
})
