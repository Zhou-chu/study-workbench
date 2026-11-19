import { beforeEach, expect, it, vi } from 'vitest'
import type { RuntimeConfig } from '@study/contracts'
import type { DispatchContext, DispatchTarget } from '@study/domain'
import { createSessionClient } from './session-client.js'

const fake = vi.hoisted(() => {
  let target: DispatchTarget | null = null
  return {
    dispatch: vi.fn<() => Promise<Response>>(),
    read: (): DispatchContext | null => target ? { target, epoch: 1, ready: true } : null,
    publish: (value: DispatchTarget) => { target = value },
    reset: () => { target = null },
  }
})

vi.mock('./client.js', async () => ({
  ...await import('./errors.js'),
  configuredTarget: (value: RuntimeConfig): DispatchTarget => ({
    mode: value.auth_mode,
    apiBase: 'https://fixture.example/api',
    protocol: value.web_session_protocol,
  }),
  dispatchRequest: fake.dispatch,
}))
vi.mock('./dispatch-context.js', () => ({
  readTurnContext: fake.read,
  publishTurnTarget: fake.publish,
  // This policy suite observes returned confirmation, not real context retirement.
  invalidateTurnContext: vi.fn(),
}))
vi.mock('./session-coordinator.js', () => ({
  sessionCoordinator: { begin: () => 1, isCurrent: (id: number) => id === 1, setPhase: vi.fn() },
}))
vi.mock('./legacy-auth.js', () => ({ purgeLegacyAuth: () => true, setLegacyAuthToken: vi.fn() }))

const config: RuntimeConfig = { apiUrl: '', auth_mode: 'legacy_password', web_session_protocol: null, client_contracts: [], ui_transport_protocol: 1 }
const json = (value: unknown = {}, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
// Kept as the test-double name; no browser fetch adapter runs in this suite.
const fetcher = fake.dispatch
beforeEach(() => { fake.reset(); fetcher.mockReset() })

it('parses exact device local evidence and never calls it remote revocation', async () => {
 const client=createSessionClient({...config,auth_mode:'device_sessions',web_session_protocol:'bff-memory-v1'});
 fetcher.mockResolvedValueOnce(json({server_revocation:'unconfirmed'}));
 expect(await client.signoutLocal()).toEqual({localConfirmed:true,serverRevocation:'unconfirmed'});
 fetcher.mockResolvedValueOnce(json({server_revocation:'confirmed'}));
 expect(await client.signoutLocal()).toEqual({localConfirmed:false,serverRevocation:'unconfirmed'});
});
it('accepts only exact endpoint AUTH_REQUIRED on an explicit local retry', async () => {
 const client=createSessionClient({...config,auth_mode:'device_sessions',web_session_protocol:'bff-memory-v1'});
 fetcher.mockImplementation(async()=>json({error:{code:'AUTH_REQUIRED'}},401));
 expect(await client.signoutLocal()).toMatchObject({localConfirmed:false});
 expect(await client.signoutLocal(undefined,true)).toMatchObject({localConfirmed:true,serverRevocation:'unconfirmed'});
 fetcher.mockImplementation(async()=>json({error:{code:'AUTH_INVALID_CREDENTIALS'}},401));
 expect(await client.signoutLocal(undefined,true)).toMatchObject({localConfirmed:false});
});

it('rejects session operations reserved for the other auth mode', async () => {
  const legacy = createSessionClient(config)
  await expect(legacy.revoke()).rejects.toMatchObject({ reason: 'configuration' })
  const device = createSessionClient({ ...config, auth_mode: 'device_sessions', web_session_protocol: 'bff-memory-v1' })
  await expect(device.probeLegacy()).rejects.toMatchObject({ reason: 'configuration' })
  expect(fetcher).not.toHaveBeenCalled()
})
it.each([null, [], 'invalid'])('does not confirm local signout from malformed response %j', async value => {
  const client = createSessionClient({ ...config, auth_mode: 'device_sessions', web_session_protocol: 'bff-memory-v1' })
  fetcher.mockResolvedValueOnce(json(value))
  expect(await client.signoutLocal()).toEqual({ localConfirmed: false, serverRevocation: 'unconfirmed' })
})
