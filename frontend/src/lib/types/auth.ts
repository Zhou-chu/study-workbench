export type AuthPhase = 'bootstrapping' | 'pending' | 'authenticated' | 'refresh-needed' | 'reauth-required' | 'unavailable' | 'anonymous'

/** Public metadata is never an authorization credential. */
export interface WebSessionMetadata {
  session_id: string
  access_expires_at: string
  refresh_expires_at: string
  generation: number
}
export interface WebAuthStatus {
  auth_enabled: true
  auth_mode: 'device_sessions'
  protocol_version: 1
  web: { phase: Exclude<AuthPhase, 'bootstrapping'>; session: WebSessionMetadata | null }
}
export interface LoginCredentials { password: string }
export type ServerRevocation = 'confirmed' | 'unconfirmed' | null
