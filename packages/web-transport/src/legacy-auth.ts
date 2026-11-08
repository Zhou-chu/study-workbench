type WebSessionMode = 'legacy_password' | 'device_sessions'

// Legacy-only custody. Device sessions never hydrate this state or persist a
// credential. Mode must be established by /config before callers can read it.
let legacyToken: string | null = null
let volatileBaseline: { raw: string | null | undefined } | null = null
function clearVolatile() {
  volatileBaseline = null
  if (typeof window !== 'undefined') window.removeEventListener('storage', storageChanged)
}
function storageChanged(event: StorageEvent) {
  if (event.key === 'auth-storage' || event.key === null) { legacyToken = null; clearVolatile() }
}
export function purgeLegacyAuth(): void {
  legacyToken = null
  clearVolatile()
  try { if (typeof window !== 'undefined') window.localStorage.removeItem('auth-storage') } catch { /* storage may be disabled */ }
}
export function getAuthToken(mode?: WebSessionMode): string | null {
  if (mode !== 'legacy_password' || typeof window === 'undefined') return null
  // Legacy has no durable browser coordinator: re-read on every request so a
  // second tab's sign-out/removal is honored before the next dispatch.
  let raw: string | null
  try { raw = window.localStorage.getItem('auth-storage') }
  catch { return legacyToken } // Storage-disabled legacy login can use memory.
  if (volatileBaseline && raw === volatileBaseline.raw) return legacyToken
  clearVolatile()
  try {
    const token: unknown = raw ? JSON.parse(raw)?.state?.token : null
    legacyToken = typeof token === 'string' && token !== 'not-required' ? token : null
  } catch { legacyToken = null }

  return legacyToken
}
export function setLegacyAuthToken(token: string): void {
  legacyToken = token
  clearVolatile()
  try {
    window.localStorage.setItem('auth-storage', JSON.stringify({ state: { token, isAuthenticated: true }, version: 0 }))
  } catch {
    // A quota failure can leave reads working. Keep only this explicitly entered
    // password until the storage baseline changes, a cross-tab event, or purge.
    let raw: string | null | undefined
    try { raw = window.localStorage.getItem('auth-storage') } catch { /* unavailable */ }
    volatileBaseline = { raw }
    window.addEventListener('storage', storageChanged)
  }
}
