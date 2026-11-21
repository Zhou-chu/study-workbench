import { create } from 'zustand'
import { queryClient } from '@/lib/api/query-client'
import { authApi, AuthRequestError, parseWebStatus } from '@/lib/api/auth'
import { getConfig, resetConfig } from '@/lib/config'
import { getAuthToken, purgeLegacyAuth, setLegacyAuthToken } from '@/lib/auth-token'
import { invalidateTurnContext } from '@/lib/workbench/turn-context'
import { sessionCoordinator } from '@/lib/auth/session-coordinator'
import type { AuthPhase, ServerRevocation, WebSessionMetadata } from '@/lib/types/auth'
import type { WebSessionMode } from '@/lib/types/config'

interface AuthState {
  phase: AuthPhase
  mode: WebSessionMode | null
  session: WebSessionMetadata | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
  hasHydrated: boolean
  authRequired: boolean | null
  serverRevocation: ServerRevocation
  localSignoutConfirmed: boolean | null
  signedOutLocally: boolean
  bootstrap: () => Promise<boolean>
  login: (password: string) => Promise<boolean>
  refresh: () => Promise<boolean>
  revokeSession: (sessionId: string) => Promise<boolean>
  revokeAll: () => Promise<boolean>
  signoutLocal: () => Promise<boolean>
  logout: () => Promise<boolean>
  checkAuth: () => Promise<boolean>
  checkAuthRequired: () => Promise<boolean>
}
let bootstrapFlight: { operation: number; promise: Promise<boolean> } | null = null

function errorKey(error: unknown): string {
  if (error instanceof AuthRequestError) {
    if (error.code === 'AUTH_INVALID_CREDENTIALS') return 'auth.invalidPassword'
    if (error.code === 'AUTH_RATE_LIMITED' || error.code === 'AUTH_BUSY') return 'auth.rateLimited'
    if (error.code === 'CROSS_SITE_REQUEST' || error.code === 'AUTH_MIXED_CREDENTIALS') return 'auth.signInFailed'
  }
  return 'auth.serviceUnavailable'
}
function failurePhase(error: unknown): AuthPhase {
  return error instanceof AuthRequestError && error.phase ? error.phase : 'unavailable'
}
export const useAuthStore = create<AuthState>()((set, get) => {
  const install = (phase: AuthPhase, session: WebSessionMetadata | null = get().session) => {
    const resumeReads = phase === 'authenticated' && get().phase !== 'authenticated' && get().hasHydrated
    if (phase === 'authenticated') sessionCoordinator.confirmed()
    sessionCoordinator.setPhase(phase)
    set({ phase, session, isAuthenticated: phase === 'authenticated', hasHydrated: true, ...(phase === 'authenticated' ? { signedOutLocally: false, serverRevocation: null, localSignoutConfirmed: null } : {}) })
    if (resumeReads) void queryClient.refetchQueries({ type: 'active' })
  }
  const mode = async () => {
    const config = await getConfig()
    // No Zustand persist hydration runs at all. Only explicit legacy mode may
    // read saved passwords; device migration removes valid AND corrupt storage.
    if (config.authMode === 'device_sessions') purgeLegacyAuth()
    return config.authMode
  }
  const status = async (operation: number, selectedMode: WebSessionMode) => {
    const data = await authApi.status()
    if (!sessionCoordinator.isCurrent(operation)) return false
    if (selectedMode === 'device_sessions') {
      const result = parseWebStatus(data)
      set({ authRequired: true })
      install(result.web.phase, result.web.session)
    } else {
      const enabled = (data as { auth_enabled?: unknown })?.auth_enabled
      if (typeof enabled !== 'boolean') throw new Error('Invalid legacy auth status')
      set({ authRequired: enabled })
      if (!enabled) install('authenticated', null)
      else if (getAuthToken('legacy_password')) {
        await authApi.legacyProbe()
        if (!sessionCoordinator.isCurrent(operation)) return false
        install('authenticated', null)
      } else install('anonymous', null)
    }
    return get().isAuthenticated
  }
  const revoke = async (target?: string) => {
    // Unknown own identity cannot establish that this is another session.
    const own = !target || !get().session?.session_id || target === get().session?.session_id
    if (own) invalidateTurnContext()
    const operation = sessionCoordinator.begin()
    set({ isLoading: true, error: null })
    try {
      const selectedMode = await mode()
      if (!sessionCoordinator.isCurrent(operation)) return false
      if (selectedMode !== 'device_sessions') return await get().signoutLocal()
      await authApi.revoke(target, operation)
      if (!sessionCoordinator.isCurrent(operation)) return false
      set({ serverRevocation: 'confirmed' })
      if (own) { install('anonymous', null); set({ signedOutLocally: true, localSignoutConfirmed: true }) }
      return true
    } catch (error) {
      if (sessionCoordinator.isCurrent(operation)) {
        set({ error: errorKey(error), serverRevocation: 'unconfirmed' })
        install(failurePhase(error))
      }
      return false
    } finally { if (sessionCoordinator.isCurrent(operation)) set({ isLoading: false }) }
  }
  return {
    phase: 'bootstrapping', mode: null, session: null, isAuthenticated: false,
    isLoading: true, error: null, hasHydrated: false, authRequired: null,
    serverRevocation: null, localSignoutConfirmed: null, signedOutLocally: false,
    bootstrap: () => {
      // Only a successful, intentional sign-in may authorize confirmation while locked.
      if (get().signedOutLocally && !get().session) return Promise.resolve(false)
      if (bootstrapFlight && sessionCoordinator.isCurrent(bootstrapFlight.operation)) return bootstrapFlight.promise
      const operation = sessionCoordinator.begin()
      set({ isLoading: true, error: null })
      const promise = (async () => {
        try {
          // An explicit Check connection can recover a failed config lookup.
          if (get().phase === 'unavailable') resetConfig()
          const selectedMode = await mode()
          if (!sessionCoordinator.isCurrent(operation)) return false
          set({ mode: selectedMode })
          return await status(operation, selectedMode)
        } catch (error) {
          if (sessionCoordinator.isCurrent(operation)) { install(failurePhase(error)); set({ error: errorKey(error) }) }
          return false
        } finally {
          if (sessionCoordinator.isCurrent(operation)) set({ isLoading: false, hasHydrated: true })
          if (bootstrapFlight?.operation === operation) bootstrapFlight = null
        }
      })()
      bootstrapFlight = { operation, promise }
      return promise
    },
    login: async password => {
      const operation = sessionCoordinator.begin()
      const previous = { phase: get().phase, session: get().session, evidence: sessionCoordinator.evidence() }
      set({ isLoading: true, error: null, ...(!get().signedOutLocally ? { serverRevocation: null, localSignoutConfirmed: null } : {}) })
      try {
        const selectedMode = await mode()
        if (!sessionCoordinator.isCurrent(operation)) return false
        set({ mode: selectedMode, authRequired: true })
        if (selectedMode === 'device_sessions') {
          const metadata = await authApi.login(password, 'Web browser', operation)
          if (!sessionCoordinator.isCurrent(operation)) return false
          install('pending', metadata)
          // Keep an explicit sign-out lock until safe status confirms.
          // Login metadata cannot authenticate; the stable cookie must return.
          return await status(operation, selectedMode)
        }
        await authApi.legacyProbe(password, operation)
        if (!sessionCoordinator.isCurrent(operation)) return false
        setLegacyAuthToken(password)
        set({ signedOutLocally: false }); install('authenticated', null)
        return true
      } catch (error) {
        if (sessionCoordinator.isCurrent(operation)) {
          set({ error: errorKey(error) })
          if (error instanceof AuthRequestError && error.code === 'AUTH_INVALID_CREDENTIALS') {
            if (sessionCoordinator.evidence() === previous.evidence) install(previous.phase === 'authenticated' ? 'authenticated' : 'anonymous', previous.session)
          } else install(failurePhase(error))
        }
        return false
      } finally { if (sessionCoordinator.isCurrent(operation)) set({ isLoading: false, hasHydrated: true }) }
    },
    refresh: async () => {
      const operation = sessionCoordinator.begin()
      set({ isLoading: true, error: null })
      try {
        const selectedMode = await mode()
        if (!sessionCoordinator.isCurrent(operation)) return false
        set({ mode: selectedMode })
        if (selectedMode !== 'device_sessions') return await status(operation, selectedMode)
        const metadata = await authApi.refresh(operation)
        if (!sessionCoordinator.isCurrent(operation)) return false
        install('authenticated', metadata)
        return true
      } catch (error) {
        if (sessionCoordinator.isCurrent(operation)) { install(failurePhase(error)); set({ error: errorKey(error) }) }
        return false
      } finally { if (sessionCoordinator.isCurrent(operation)) set({ isLoading: false, hasHydrated: true }) }
    },
    revokeSession: sessionId => revoke(sessionId),
    revokeAll: () => revoke(),
    signoutLocal: async () => {
      invalidateTurnContext()
      const operation = sessionCoordinator.begin()
      // Lock this mounted screen immediately. A failed network request cannot
      // prove server retirement; retain an honest retryable unconfirmed state.
      install('anonymous', null)
      set({ signedOutLocally: true, isLoading: true, error: null, serverRevocation: 'unconfirmed', localSignoutConfirmed: false })
      try {
        const selectedMode = get().mode === 'device_sessions' ? 'device_sessions' : await mode()
        if (!sessionCoordinator.isCurrent(operation)) return false
        set({ mode: selectedMode })
        if (selectedMode === 'device_sessions') await authApi.signoutLocal(operation)
        else purgeLegacyAuth()
        if (!sessionCoordinator.isCurrent(operation)) return false
        set({ localSignoutConfirmed: true })
        return true
      } catch {
        if (sessionCoordinator.isCurrent(operation)) set({ error: 'auth.signoutUnconfirmed' })
        return false
      } finally { if (sessionCoordinator.isCurrent(operation)) set({ isLoading: false, hasHydrated: true }) }
    },
    logout: () => get().signoutLocal(),
    checkAuth: () => get().bootstrap(),
    checkAuthRequired: async () => { await get().bootstrap(); return get().authRequired !== false },
  }
})

sessionCoordinator.subscribe(phase => {
  const state = useAuthStore.getState()
  if (state.signedOutLocally) return
  sessionCoordinator.setPhase(phase)
  useAuthStore.setState({ phase, isAuthenticated: false, error: null })
})
