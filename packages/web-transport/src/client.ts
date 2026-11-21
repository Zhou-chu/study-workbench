import type { RuntimeConfig } from '@study/contracts'
import { canDispatch, freezeDispatchContext, sameTurnTarget, type DispatchContext, type DispatchTarget } from '@study/domain'
import { readTurnContext, publishTurnTarget } from './dispatch-context.js'
import { sessionCoordinator } from './session-coordinator.js'
import { getAuthToken, purgeLegacyAuth } from './legacy-auth.js'
import { RequestNotDispatchedError, TransportResponseError } from './errors.js'
import { protectedApiPath, endpointPolicy } from './endpoint-policy.js'
import { classifyAuthFailure, classifyIngressResponse, readBoundedAuthError } from './ingress.js'
export { RequestNotDispatchedError, asRequestNotDispatchedError, TransportResponseError } from './errors.js'
export type RequestSpec = { method: string; path: string; body?: BodyInit | null; signal?: AbortSignal; context: DispatchContext; operationKey?: string }
export interface WebTransport { send(request: RequestSpec): Promise<Response> }
const safeMethods = new Set(['GET','HEAD','OPTIONS'])
export function configuredTarget(config: RuntimeConfig): DispatchTarget {
  if (config.apiUrl !== '' || config.ui_transport_protocol !== 1 || !['legacy_password','device_sessions'].includes(config.auth_mode) || (config.auth_mode === 'device_sessions' ? config.web_session_protocol !== 'bff-memory-v1' : config.web_session_protocol !== null)) throw new RequestNotDispatchedError('configuration')
  if (typeof window === 'undefined') throw new RequestNotDispatchedError('configuration')
  const origin = new URL(window.location.href).origin
  if (!/^https?:/.test(origin)) throw new RequestNotDispatchedError('destination')
  return Object.freeze({ mode: config.auth_mode, apiBase: `${origin}/api`, protocol: config.web_session_protocol })
}
function assertCurrent(context: DispatchContext, target: DispatchTarget, generation: number, resource: boolean): void {
  const current = readTurnContext()
  if (sessionCoordinator.current() !== generation || current && (current.epoch !== context.epoch || !sameTurnTarget(current.target, context.target))) throw new RequestNotDispatchedError('superseded')
  if (!current || resource && !canDispatch(context,current)) throw new RequestNotDispatchedError('configuration')
  if (!sameTurnTarget(context.target,target)) throw new RequestNotDispatchedError('destination')
  const phase = sessionCoordinator.resourcePhase()
  if (resource && phase && phase !== 'authenticated') throw new RequestNotDispatchedError('authentication')
}
/** Private session adapter entrypoint. Never exported from the package surface. */
export async function dispatchRequest(config: RuntimeConfig, request: RequestSpec, resource = true, password?: string, generation = sessionCoordinator.current()): Promise<Response> {
  const context = freezeDispatchContext(request.context)
  const target = configuredTarget(config)
  assertCurrent(context,target,generation,resource)
  const method = request.method.toUpperCase(); const path = protectedApiPath(request.path)
  const url = new URL(`/api${path}`,window.location.href)
  if (url.origin !== window.location.origin || `${url.origin}/api` !== target.apiBase) throw new RequestNotDispatchedError('destination')
  const body = request.body; const signal = request.signal
  const headers = new Headers()
  if (typeof body === 'string') headers.set('Content-Type','application/json')
  if (config.auth_mode === 'device_sessions') {
    purgeLegacyAuth(); if (!safeMethods.has(method)) headers.set('X-StudyWorkbench-CSRF','1')
    if (password !== undefined) throw new RequestNotDispatchedError('configuration')
  } else {
    const token = password ?? getAuthToken('legacy_password'); if (token) headers.set('Authorization',`Bearer ${token}`)
  }
  const prepared = new Request(url, { method, headers, credentials: 'same-origin', redirect: 'error', cache: 'no-store', ...(body !== undefined ? { body } : {}), ...(signal ? { signal } : {}), ...(typeof ReadableStream !== 'undefined' && body instanceof ReadableStream ? { duplex: 'half' } : {}) } as RequestInit & { duplex?: 'half' })
  const nativeFetch = globalThis.fetch
  assertCurrent(context,target,generation,resource)
  if (prepared.signal.aborted) throw new RequestNotDispatchedError('aborted')
  // No await, body coercion, policy lookup or caller callback between these checks and native fetch.
  let response: Response
  try { response = await nativeFetch(prepared) }
  catch (error) {
    if (prepared.signal.aborted || error instanceof Error && error.name === 'AbortError') throw error
    sessionCoordinator.report('unavailable',generation); throw new TransportResponseError('unavailable')
  }
  const retired = () => { const current = readTurnContext(); return generation !== sessionCoordinator.current() || !current || current.epoch !== context.epoch || !sameTurnTarget(current.target,context.target) || resource && !canDispatch(context,current) }
  if (retired()) { void response.body?.cancel(); throw new TransportResponseError('retired') }
  const ingress = method === 'HEAD' ? null : classifyIngressResponse(response,path)
  if (ingress) { sessionCoordinator.report('unavailable',generation); void response.body?.cancel(); throw new TransportResponseError(ingress,response.status) }
  if (!response.ok) {
    const phase = classifyAuthFailure(response.status,await readBoundedAuthError(response))
    if (retired()) { void response.body?.cancel(); throw new TransportResponseError('retired') }
    if (phase) sessionCoordinator.report(phase,generation)
  }
  return response
}
export function createWebTransport(config: RuntimeConfig): WebTransport {
  const selected = Object.freeze({ ...config, client_contracts: Object.freeze([...config.client_contracts]) })
  const target = configuredTarget(selected)
  const current = readTurnContext(); if (!current || !sameTurnTarget(current.target,target)) publishTurnTarget(target,true)
  if (selected.auth_mode === 'device_sessions') purgeLegacyAuth()
  const flights = new Map<string,Promise<Response>>()
  return Object.freeze({ send(request: RequestSpec): Promise<Response> {
    const generation = sessionCoordinator.current()
    let frozen: RequestSpec; let dedupe: string | undefined
    try {
      const context = freezeDispatchContext(request.context)
      frozen = { ...request, context }
      if (frozen.signal?.aborted) throw new RequestNotDispatchedError('aborted')
      const policy = endpointPolicy(frozen.method,frozen.path)
      dedupe = policy.dedupeKey
      const key = `${context.epoch}:${generation}:${JSON.stringify(context.target)}:${dedupe ?? (frozen.operationKey ? `operation:${frozen.operationKey}` : '')}`
      if (!dedupe && !frozen.operationKey) return dispatchRequest(selected,frozen,true,undefined,generation)
      const existing = flights.get(key)
      if (existing) return dedupe ? existing.then(response => response.clone()) : Promise.reject(new RequestNotDispatchedError('duplicate'))
      // Reserve before preparing body or invoking fetch, including synchronous reentry.
      let resolve!: (response: Response) => void; let reject!: (error: unknown) => void
      const flight = new Promise<Response>((yes,no) => { resolve = yes; reject = no }); flights.set(key,flight)
      void dispatchRequest(selected,frozen,true,undefined,generation).then(resolve,reject)
      void flight.then(() => flights.delete(key),() => flights.delete(key))
      return dedupe ? flight.then(response => response.clone()) : flight
    } catch (error) { return Promise.reject(error) }
  } })
}
