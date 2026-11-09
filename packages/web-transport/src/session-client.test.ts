import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createSessionClient } from './session-client.js'
import { createWebTransport } from './client.js'
import { readTurnContext, invalidateTurnContext } from './dispatch-context.js'
import { sessionCoordinator } from './session-coordinator.js'
import type { RuntimeConfig } from '@study/contracts'
const config: RuntimeConfig = { apiUrl: '', auth_mode: 'legacy_password', web_session_protocol: null, client_contracts: [], ui_transport_protocol: 1 }
const json = (value: unknown = {}, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
const fetcher = vi.fn<typeof fetch>(); let storage: Map<string,string>
beforeEach(() => { storage = new Map(); vi.stubGlobal('window',{ location: new URL('https://fixture.example/'), localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string,v: string) => storage.set(k,v), removeItem: (k: string) => storage.delete(k) }, addEventListener: vi.fn(), removeEventListener: vi.fn() }); vi.stubGlobal('fetch',fetcher); fetcher.mockReset(); fetcher.mockResolvedValue(json()); sessionCoordinator.begin(); sessionCoordinator.setPhase('anonymous'); invalidateTurnContext() })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('only persists the established legacy key after an explicit successful same-origin probe', async () => {
  const client = createSessionClient(config); await client.login('synthetic-password')
  expect((fetcher.mock.calls[0]![0] as Request).url).toBe('https://fixture.example/api/notebooks')
  expect(storage.size).toBe(1); expect(JSON.parse(storage.get('auth-storage')!).state.token).toBe('synthetic-password')
  expect(client).not.toHaveProperty('getAuthToken')
})
it('does not save failed or retired legacy logins and preserves preexisting credentials', async () => {
  storage.set('auth-storage','old-synthetic'); const client = createSessionClient(config); fetcher.mockResolvedValueOnce(json({detail:'Invalid password'},401))
  expect((await client.login('wrong')).status).toBe(401); expect(storage.get('auth-storage')).toBe('old-synthetic')
  let finish!: (r: Response) => void; fetcher.mockImplementationOnce(() => new Promise(r => { finish = r })); const late = client.login('late').catch(e=>e)
  sessionCoordinator.begin(); finish(json()); expect((await late).kind).toBe('retired'); expect(storage.get('auth-storage')).toBe('old-synthetic')
})
it('signout purges legacy custody and retires captured work without a remote call', async () => {
  const client = createSessionClient(config); const context = readTurnContext()!; storage.set('auth-storage','old')
  await client.signoutLocal(); expect(storage.size).toBe(0); expect(readTurnContext()!.epoch).toBeGreaterThan(context.epoch); expect(fetcher).not.toHaveBeenCalled(); expect(sessionCoordinator.resourcePhase()).toBe('anonymous')
})
it('device login uses a single request body, CSRF, no bearer and no browser credential storage', async () => {
  storage.set('auth-storage','old'); const client = createSessionClient({ ...config, auth_mode:'device_sessions', web_session_protocol:'bff-memory-v1' }); await client.login('synthetic-password','Fixture')
  const sent = fetcher.mock.calls[0]![0] as Request; expect(sent.headers.has('authorization')).toBe(false); expect(await sent.json()).toEqual({ password:'synthetic-password',device_name:'Fixture' }); expect(storage.size).toBe(0)
})
it('retains the storage-disabled volatile legacy fallback inside the adapter only', async () => {
  const client = createSessionClient(config); window.localStorage.setItem = () => { throw new Error('quota') }; await client.login('volatile-synthetic')
  sessionCoordinator.setPhase('authenticated'); const transport = createWebTransport(config); await transport.send({ method:'GET',path:'/notebooks',context:readTurnContext()! })
  expect((fetcher.mock.calls[1]![0] as Request).headers.get('authorization')).toBe('Bearer volatile-synthetic'); expect(storage.size).toBe(0)
})

it('only the newest concurrent legacy login may persist a password', async () => {
  const client = createSessionClient(config); let finish!: (r: Response) => void
  fetcher.mockImplementationOnce(() => new Promise(r => { finish = r })); const first = client.login('old-login').catch(e=>e)
  await client.login('new-login'); finish(json()); expect((await first).kind).toBe('retired'); expect(JSON.parse(storage.get('auth-storage')!).state.token).toBe('new-login')
})
it('uses exact device session routes and does not replay a failed refresh', async () => {
  const client = createSessionClient({ ...config,auth_mode:'device_sessions',web_session_protocol:'bff-memory-v1' })
  await client.status(); await client.refresh(); fetcher.mockResolvedValueOnce(new Response(null,{status:204})); await client.revoke('session:one'); await client.signoutLocal()
  expect(fetcher.mock.calls.map(([r]) => [(r as Request).method,new URL((r as Request).url).pathname])).toEqual([['GET','/api/auth/status'],['POST','/api/auth/sessions/refresh'],['DELETE','/api/auth/sessions/session%3Aone'],['POST','/api/auth/web-signout-local']])
  fetcher.mockRejectedValueOnce(new TypeError('network')); await expect(client.refresh()).rejects.toMatchObject({ kind:'unavailable' }); expect(fetcher).toHaveBeenCalledTimes(5)
})

it('allows bootstrap to probe legacy auth without exposing the stored token', async () => {
  const client = createSessionClient(config); storage.set('auth-storage',JSON.stringify({state:{token:'saved-synthetic'}})); await client.probeLegacy()
  const sent = fetcher.mock.calls[0]![0] as Request; expect(sent.method).toBe('GET'); expect(sent.headers.get('authorization')).toBe('Bearer saved-synthetic'); expect(sent.url).toBe('https://fixture.example/api/notebooks')
})

it('reports failed durable legacy removal without exposing credentials or claiming confirmation', async () => {
 const client=createSessionClient(config); storage.set('auth-storage','synthetic');
 window.localStorage.removeItem=()=>{throw new Error('blocked')};
 expect(await client.signoutLocal()).toEqual({localConfirmed:false,serverRevocation:'not-performed'});
});
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

it('does not call device local signout fully confirmed when legacy browser residue could not be removed',async()=>{
 const client=createSessionClient({...config,auth_mode:'device_sessions',web_session_protocol:'bff-memory-v1'});
 window.localStorage.removeItem=()=>{throw Error('synthetic blocked removal')};fetcher.mockResolvedValueOnce(json({server_revocation:'unconfirmed'}));
 expect(await client.signoutLocal()).toEqual({localConfirmed:false,serverRevocation:'unconfirmed'});
});
