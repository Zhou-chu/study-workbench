import axios, { AxiosResponse } from 'axios'
import { prepareBrowserRequest, classifyAuthFailure, protectedApiPath, assertResourceDispatch, rememberAuthRecoveryError, RequestNotDispatchedError } from './browser-transport'
import { sessionCoordinator } from '@/lib/auth/session-coordinator'

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

const requestGenerations = new WeakMap<object, number>()

apiClient.interceptors.request.use(async (config) => {
  assertResourceDispatch()
  // Never let per-call URL/base/auth overrides redirect credential custody.
  if (config.adapter !== 'fetch' && typeof config.adapter !== 'function') throw new RequestNotDispatchedError('destination')
  if (config.baseURL || config.auth) throw new RequestNotDispatchedError('destination')
  const path = protectedApiPath(config.url || '')
  const policy = await prepareBrowserRequest(config.method || 'GET', path)
  assertResourceDispatch()
  config.baseURL = policy.url.slice(0, policy.url.length - path.length)
  config.url = path
  config.headers.delete('Authorization')
  config.headers.delete('X-StudyWorkbench-CSRF')
  Object.entries(policy.headers).forEach(([name, value]) => config.headers.set(name, value))
  // The installed fetch adapter defaults undefined to same-origin; false means
  // omit (legacy). Force both policies after all per-call options are merged.
  config.withCredentials = policy.mode === 'device_sessions' ? undefined : false
  config.fetchOptions = { ...config.fetchOptions, redirect: 'error' }
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
