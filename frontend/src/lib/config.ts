/** Runtime configuration without application-supplied credentials. */
import { browserTurnTarget } from '@/lib/api/browser-target'
import { publishTurnTarget, suspendTurnTarget } from '@/lib/workbench/turn-context'
import { purgeLegacyAuth } from '@/lib/auth-token'
import { AppConfig, BackendConfigResponse, WEB_SESSION_PROTOCOL, type WebSessionMode } from '@/lib/types/config'

const BUILD_TIME = new Date().toISOString()
let config: AppConfig | null = null
let configPromise: Promise<AppConfig> | null = null
let configGeneration = 0
const PUBLIC_CONFIG_FETCH = { cache: 'no-store', credentials: 'same-origin', redirect: 'error' } as const

export async function getApiUrl(): Promise<string> {
  return (await getConfig()).apiUrl
}

export async function getConfig(): Promise<AppConfig> {
  if (config) return config
  const generation = configGeneration
  if (!configPromise) configPromise = fetchConfig(generation)
  const result = await configPromise
  assertCurrentConfig(generation)
  return result
}

function unavailable(): never {
  throw new Error('Web session configuration unavailable')
}

function runtimeMetadata(data: unknown): {
  apiUrl: string
  authMode: WebSessionMode
  webSessionProtocol: typeof WEB_SESSION_PROTOCOL | null
} {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return unavailable()
  const metadata = data as Record<string, unknown>
  // Older successful /config responses are legacy compatibility, not fallback
  // from a failed lookup, explicit invalid mode, or incompatible Web protocol.
  const authMode = Object.hasOwn(metadata, 'auth_mode') ? metadata.auth_mode : 'legacy_password'
  if (authMode !== 'legacy_password' && authMode !== 'device_sessions') return unavailable()
  if (authMode === 'device_sessions') {
    if (metadata.web_session_protocol !== WEB_SESSION_PROTOCOL || metadata.apiUrl !== '') return unavailable()
    return { apiUrl: '', authMode, webSessionProtocol: WEB_SESSION_PROTOCOL }
  }
  if (metadata.web_session_protocol !== undefined && metadata.web_session_protocol !== null) return unavailable()
  if (metadata.apiUrl !== undefined && metadata.apiUrl !== null && typeof metadata.apiUrl !== 'string') return unavailable()
  return {
    apiUrl: (metadata.apiUrl as string | null | undefined) || process.env.NEXT_PUBLIC_API_URL || '',
    authMode, webSessionProtocol: null,
  }
}

function assertCurrentConfig(generation: number): void {
  if (generation !== configGeneration) unavailable()
}

async function fetchConfig(generation: number): Promise<AppConfig> {
  let metadata: ReturnType<typeof runtimeMetadata>
  try {
    // Failure must stop bootstrap: neither build-time URLs nor saved passwords
    // may select a legacy path before the server's mode has been discovered.
    const response = await fetch('/config', PUBLIC_CONFIG_FETCH)
    assertCurrentConfig(generation)
    if (!response.ok) return unavailable()
    metadata = runtimeMetadata(await response.json())
    assertCurrentConfig(generation)
    // Retire an actual destination change before waiting for API readiness.
    publishTurnTarget(browserTurnTarget(metadata), false)
    // Device discovery is sufficient to retire browser password persistence,
    // even if the later public API readiness/config request fails or hangs.
    if (metadata.authMode === 'device_sessions') purgeLegacyAuth()
  } catch {
    return unavailable()
  }

  // Device apiUrl:'' is authoritative. Ambient same-origin cookies can satisfy
  // an owner-private ingress; no application Authorization/password is supplied.
  // Never include cross-origin cookies or follow redirects. The BFF metadata
  // dispatcher strips Cookie/Authorization before contacting the backend.
  const target = browserTurnTarget(metadata)
  const response = await fetch(metadata.apiUrl ? `${target.apiBase}/config` : '/api/config', PUBLIC_CONFIG_FETCH)
  assertCurrentConfig(generation)
  if (!response.ok) throw new Error(`API config endpoint returned status ${response.status}`)
  const data: BackendConfigResponse = await response.json()
  assertCurrentConfig(generation)
  config = {
    ...metadata,
    version: data.version || 'unknown',
    buildTime: BUILD_TIME,
    latestVersion: data.latestVersion || null,
    hasUpdate: data.hasUpdate || false,
    dbStatus: data.dbStatus,
  }
  publishTurnTarget(target, true)
  return config
}

/** Reset only on an explicit caller action; configuration errors never retry. */
export function resetConfig(): void {
  configGeneration++
  suspendTurnTarget()
  config = null
  configPromise = null
}
