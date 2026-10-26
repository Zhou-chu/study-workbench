import type { AppConfig } from '@/lib/types/config'
import type { TurnTarget } from '@/lib/workbench/turn-context'

/** Same canonical URL validation for config discovery and resource transport. */
export function browserTurnTarget(config: Pick<AppConfig, 'authMode' | 'apiUrl' | 'webSessionProtocol'>): TurnTarget {
  const base = config.authMode === 'device_sessions' ? '' : config.apiUrl.replace(/\/$/, '')
  if (base) {
    const parsed = new URL(base)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Invalid legacy API destination')
  }
  const apiBase = new URL(`${base}/api`, typeof window === 'undefined' ? undefined : window.location.href).href
  return { mode: config.authMode, apiBase, protocol: config.webSessionProtocol ?? null }
}
