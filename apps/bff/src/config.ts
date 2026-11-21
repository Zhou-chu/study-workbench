const WEB_SESSION_PROTOCOL = 'bff-memory-v1' as const
type WebSessionMode = 'legacy_password' | 'device_sessions'

export interface WebSessionConfig {
  mode: WebSessionMode
  publicOrigin: string
  internalOrigin: string
  cookieName: '__Host-sw-session' | 'sw-session'
  secure: boolean
  nativePassthrough: boolean
  webSessionProtocol: typeof WEB_SESSION_PROTOCOL | null
}

function unavailable(): never {
  // Never include the invalid configuration value in errors or logs.
  throw new Error('AUTH_UNAVAILABLE')
}

function booleanFlag(value: string | undefined): boolean {
  if (value === undefined || value === 'false') return false
  if (value === 'true') return true
  return unavailable()
}

function exactOrigin(value: string, allowTrailingSlash = false): URL {
  try {
    const url = new URL(value)
    const expected = allowTrailingSlash && value.endsWith('/') ? `${url.origin}/` : url.origin
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || value !== expected || value.includes('*')) return unavailable()
    return url
  } catch {
    return unavailable()
  }
}

/** Server configuration only. Caller-supplied headers/URLs never select an origin. */
export function getWebSessionConfig(): WebSessionConfig {
  const mode = process.env.STUDY_WORKBENCH_AUTH_MODE ?? 'legacy_password'
  if (mode !== 'legacy_password' && mode !== 'device_sessions') return unavailable()

  const nativePassthrough = booleanFlag(process.env.STUDY_WORKBENCH_WEB_NATIVE_PASSTHROUGH)
  const allowLoopback = booleanFlag(process.env.STUDY_WORKBENCH_WEB_ALLOW_INSECURE_LOOPBACK)
  const internalOrigin = exactOrigin(process.env.INTERNAL_API_URL ?? 'http://localhost:5055', true).origin
  const base = { mode, internalOrigin, nativePassthrough } as const
  const configuredOrigin = process.env.STUDY_WORKBENCH_WEB_ORIGIN
  if (configuredOrigin === undefined) return unavailable()
  const publicUrl = exactOrigin(configuredOrigin)
  const secure = publicUrl.protocol === 'https:'
  if (!secure && (!allowLoopback || process.env.NODE_ENV === 'production'
    || !['127.0.0.1', '[::1]'].includes(publicUrl.hostname))) return unavailable()

  if (mode === 'legacy_password') {
    return { ...base, publicOrigin: configuredOrigin, cookieName: secure ? '__Host-sw-session' : 'sw-session', secure, webSessionProtocol: null }
  }

  const origins = (process.env.STUDY_WORKBENCH_AUTH_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean)
  for (const origin of origins) exactOrigin(origin)
  if (!origins.includes(configuredOrigin)) return unavailable()

  return {
    ...base, publicOrigin: configuredOrigin, cookieName: secure ? '__Host-sw-session' : 'sw-session',
    secure, webSessionProtocol: WEB_SESSION_PROTOCOL,
  }
}


export type BffConfig = WebSessionConfig
/** Copy/freeze caller config before creating any handler or listening socket. */
export function validateBffConfig(config: BffConfig): Readonly<BffConfig> {
  if (!config || !['legacy_password', 'device_sessions'].includes(config.mode)
    || typeof config.publicOrigin !== 'string' || typeof config.internalOrigin !== 'string'
    || typeof config.nativePassthrough !== 'boolean') return unavailable()
  const publicUrl = exactOrigin(config.publicOrigin)
  const internalUrl = exactOrigin(config.internalOrigin)
  const secure = publicUrl.protocol === 'https:'
  if (config.secure !== secure || config.cookieName !== (secure ? '__Host-sw-session' : 'sw-session')
    || !secure && (process.env.NODE_ENV === 'production' || !['127.0.0.1', '[::1]'].includes(publicUrl.hostname))
    || config.webSessionProtocol !== (config.mode === 'device_sessions' ? WEB_SESSION_PROTOCOL : null)) return unavailable()
  return Object.freeze({ ...config, publicOrigin: publicUrl.origin, internalOrigin: internalUrl.origin })
}
