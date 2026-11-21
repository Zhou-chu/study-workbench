import axios, { AxiosResponse } from 'axios'
import { prepareBrowserRequest, classifyAuthFailure, protectedApiPath, assertResourceDispatch, rememberAuthRecoveryError, RequestNotDispatchedError, assertTurnDispatch, asRequestNotDispatchedError } from './browser-transport'
import { sessionCoordinator } from '@/lib/auth/session-coordinator'
import type { TurnContext } from '@/lib/workbench/turn-context'

declare module 'axios' {
  interface AxiosRequestConfig { turnContext?: TurnContext }
}

// API client with runtime-configurable base URL
// The base URL is fetched from the API config endpoint on first request
//
// Request timeout defaults to 10 minutes (600000ms) to accommodate slow LLM
// operations (transformations, insights, synchronous chat) on slower hardware
// (Ollama, LM Studio). Configure it via NEXT_PUBLIC_API_TIMEOUT_MS for models
// that can take longer than 10 minutes to respond (#880).
// Note: value is in milliseconds; an explicit 0 disables the timeout entirely.
// An empty or invalid value falls back to the default (so a present-but-empty
// env var doesn't accidentally disable timeouts).
const DEFAULT_API_TIMEOUT_MS = 600000 // 600 seconds = 10 minutes
const rawTimeout = process.env.NEXT_PUBLIC_API_TIMEOUT_MS
const parsedTimeout = rawTimeout && rawTimeout.trim() !== '' ? Number(rawTimeout) : NaN
const apiTimeout = Number.isFinite(parsedTimeout) && parsedTimeout >= 0
  ? parsedTimeout
  : DEFAULT_API_TIMEOUT_MS

// Resolved request budget in milliseconds (0 = disabled). Exported so streaming
// consumers can align their own idle watchdogs to the same configurable budget.
export const API_TIMEOUT_MS = apiTimeout

export const apiClient = axios.create({
  timeout: apiTimeout,
  headers: {
    'Content-Type': 'application/json',
  },
  adapter: 'fetch',
  fetchOptions: { redirect: 'error' },
})

// Capture the installed behavior once, by function identity, not through mutable
// instance defaults. Constrained calls cannot run later config-mutating hooks or
// synthesize local not-dispatched evidence after native dispatch.
function snapshotTransforms<T>(transforms: T | T[] | undefined): readonly T[] {
  return Object.freeze(Array.isArray(transforms) ? [...transforms] : transforms ? [transforms] : [])
}
const installedRequestTransforms = snapshotTransforms(apiClient.defaults.transformRequest)
const installedResponseTransforms = snapshotTransforms(apiClient.defaults.transformResponse)
const installedValidateStatus = apiClient.defaults.validateStatus
const installedEnvironment = Object.freeze({ ...apiClient.defaults.env })
function sameEnvironment(environment: unknown): boolean {
  if (!environment || typeof environment !== 'object') return false
  const keys = Reflect.ownKeys(environment)
  const installed = installedEnvironment as Record<PropertyKey, unknown>
  return keys.length === Reflect.ownKeys(installed).length &&
    keys.every(key => Object.hasOwn(installed, key) && (environment as Record<PropertyKey, unknown>)[key] === installed[key])
}
function sameTransformList(transforms: unknown, installed: readonly unknown[]): boolean {
  const list = Array.isArray(transforms) ? transforms : [transforms]
  return list.length === installed.length && list.every((transform, index) => transform === installed[index])
}

const requestGenerations = new WeakMap<object, number>()
const TURN_DISPATCH_OPTION = '__studyWorkbenchTurnDispatch'
type TurnDispatch = Pick<TurnContext, 'epoch' | 'target'> & { expectedAbsoluteUrl: string }

/** One stable factory seed: Axios caches env.fetch strongly. Never close over a turn.
 * Its installed fetch adapter forwards this private option after body preparation.
 */
const guardedTurnFetch: typeof fetch = (input, init) => {
  const { [TURN_DISPATCH_OPTION]: dispatch, ...nativeInit } = (init || {}) as RequestInit & { [TURN_DISPATCH_OPTION]?: TurnDispatch }
  if (!dispatch) throw new RequestNotDispatchedError('destination')
  const actualUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (actualUrl !== dispatch.expectedAbsoluteUrl) throw new RequestNotDispatchedError('destination')
  assertTurnDispatch({ epoch: dispatch.epoch, target: dispatch.target, ready: true })
  assertResourceDispatch()
  // No await or user callback between the final checks and native dispatch.
  return globalThis.fetch(input, nativeInit)
}

apiClient.interceptors.request.use(async (config) => {
  assertResourceDispatch()
  // Snapshot only scalar context metadata before the asynchronous policy lookup.
  const captured = config.turnContext ? { epoch: config.turnContext.epoch, target: { ...config.turnContext.target }, ready: config.turnContext.ready } : null
  if (captured) {
    assertTurnDispatch(captured)
    if (config.adapter !== 'fetch' || !sameEnvironment(config.env) ||
      !sameTransformList(config.transformRequest, installedRequestTransforms) ||
      !sameTransformList(config.transformResponse, installedResponseTransforms) ||
      typeof config.withXSRFToken === 'function' || typeof config.parseReviver === 'function' ||
      config.validateStatus !== installedValidateStatus) {
      throw new RequestNotDispatchedError('destination')
    }
  }
  // Never let per-call URL/base/auth overrides redirect credential custody.
  if (config.adapter !== 'fetch' && typeof config.adapter !== 'function') throw new RequestNotDispatchedError('destination')
  if (config.baseURL || config.auth) throw new RequestNotDispatchedError('destination')
  const path = protectedApiPath(config.url || '')
  const policy = await prepareBrowserRequest(config.method || 'GET', path)
  assertResourceDispatch()
  if (captured) assertTurnDispatch(captured, policy.target)
  config.baseURL = policy.url.slice(0, policy.url.length - path.length)
  config.url = path
  config.headers.delete('Authorization')
  config.headers.delete('X-StudyWorkbench-CSRF')
  Object.entries(policy.headers).forEach(([name, value]) => config.headers.set(name, value))
  // The installed fetch adapter defaults undefined to same-origin; false means
  // omit. Force the shared origin boundary after per-call options are merged.
  config.withCredentials = policy.credentials === 'same-origin' ? undefined : false
  const fetchOptions = { ...config.fetchOptions, redirect: 'error' } as RequestInit & { [TURN_DISPATCH_OPTION]?: TurnDispatch }
  config.fetchOptions = fetchOptions
  // Caller-supplied metadata never establishes a precondition, even for ordinary requests.
  delete fetchOptions[TURN_DISPATCH_OPTION]
  if (captured) {
    config.env = { ...installedEnvironment, fetch: guardedTurnFetch }
    fetchOptions[TURN_DISPATCH_OPTION] = {
      epoch: captured.epoch, target: captured.target,
      expectedAbsoluteUrl: new URL(apiClient.getUri(config), window.location.href).href,
    } satisfies TurnDispatch
  }
  config.maxRedirects = undefined
  requestGenerations.set(config, sessionCoordinator.current())
  if (config.data instanceof FormData) {
    config.headers.delete('Content-Type')
  } else if (config.method && ['post', 'put', 'patch'].includes(config.method.toLowerCase())) {
    config.headers.set('Content-Type', 'application/json')
  }
  return config
})

apiClient.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error) => {
    const notDispatched = asRequestNotDispatchedError(error)
    if (notDispatched) return Promise.reject(notDispatched)
    const generation = error.config && requestGenerations.get(error.config)
    if (generation !== undefined) {
      const phase = error.response
        ? await classifyAuthFailure(error.response.status, error.response.data)
        : axios.isCancel(error) ? null : 'unavailable'
      if (phase) { rememberAuthRecoveryError(error); sessionCoordinator.report(phase, generation) }
    }
    // Preserve note conflicts, Blob details and integration errors verbatim.
    // Never redirect, clear cookies, log credentials or replay the operation.
    return Promise.reject(error)
  }
)

export default apiClient
