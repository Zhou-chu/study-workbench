/** Runtime configuration, discovered without sending any browser credentials. */
import { AppConfig, BackendConfigResponse, WEB_SESSION_PROTOCOL, type WebSessionMode } from '@/lib/types/config'

const BUILD_TIME = new Date().toISOString()
let config: AppConfig | null = null
let configPromise: Promise<AppConfig> | null = null
const PUBLIC_CONFIG_FETCH = { cache: 'no-store', credentials: 'omit', redirect: 'error' } as const

export async function getApiUrl(): Promise<string> {
  return (await getConfig()).apiUrl
}

export async function getConfig(): Promise<AppConfig> {
  if (config) return config
  if (!configPromise) configPromise = fetchConfig()
  return await configPromise
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

async function fetchConfig(): Promise<AppConfig> {
  let metadata: ReturnType<typeof runtimeMetadata>
  try {
    // Failure must stop bootstrap: neither build-time URLs nor saved passwords
    // may select a legacy path before the server's mode has been discovered.
    const response = await fetch('/config', PUBLIC_CONFIG_FETCH)
    if (!response.ok) return unavailable()
    metadata = runtimeMetadata(await response.json())
  } catch {
    return unavailable()
  }

  // Device apiUrl:'' is authoritative. Public metadata calls omit ALL cookies
  // and never follow redirects, even when the browser has a session cookie.
  // The BFF public dispatcher verifies the actual backend auth-mode/version.
  const response = await fetch(`${metadata.apiUrl}/api/config`, PUBLIC_CONFIG_FETCH)
  if (!response.ok) throw new Error(`API config endpoint returned status ${response.status}`)
  const data: BackendConfigResponse = await response.json()
  config = {
    ...metadata,
    version: data.version || 'unknown',
    buildTime: BUILD_TIME,
    latestVersion: data.latestVersion || null,
    hasUpdate: data.hasUpdate || false,
    dbStatus: data.dbStatus,
  }
  return config
}

/** Reset only on an explicit caller action; configuration errors never retry. */
export function resetConfig(): void {
  config = null
  configPromise = null
}
