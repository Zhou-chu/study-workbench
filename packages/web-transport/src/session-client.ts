import type { RuntimeConfig } from '@study/contracts'
import { sameTurnTarget } from '@study/domain'
import { configuredTarget, dispatchRequest, RequestNotDispatchedError, TransportResponseError } from './client.js'
import { readTurnContext, publishTurnTarget, invalidateTurnContext } from './dispatch-context.js'
import { purgeLegacyAuth, setLegacyAuthToken } from './legacy-auth.js'
import { sessionCoordinator } from './session-coordinator.js'
export type LocalSignoutResult = Readonly<{ localConfirmed: boolean; serverRevocation: 'unconfirmed' | 'not-performed' }>
/** Authentication feature interface. No credential getter or raw header override is exposed. */
export interface SessionClient {
  status(operation?: number): Promise<Response>
  probeLegacy(operation?: number): Promise<Response>
  login(password: string, deviceName?: string, operation?: number): Promise<Response>
  refresh(operation?: number): Promise<Response>
  revoke(sessionId?: string, operation?: number): Promise<Response>
  signoutLocal(operation?: number, retry?: boolean): Promise<LocalSignoutResult>
}
export function createSessionClient(config: RuntimeConfig): SessionClient {
  const selected = Object.freeze({ ...config, client_contracts: Object.freeze([...config.client_contracts]) })
  const target = configuredTarget(selected)
  const current = readTurnContext(); if (!current || !sameTurnTarget(current.target,target)) publishTurnTarget(target,true)
  if (selected.auth_mode === 'device_sessions') purgeLegacyAuth()
  const request = (method: string, path: string, operation: number, body?: string, password?: string) => {
    if (!sessionCoordinator.isCurrent(operation)) return Promise.reject(new RequestNotDispatchedError('superseded'))
    const context = readTurnContext()
    if (!context || !sameTurnTarget(context.target,target)) return Promise.reject(new RequestNotDispatchedError('destination'))
    return dispatchRequest(selected,{ method,path,context,...(body !== undefined ? { body } : {}) },false,password)
  }
  return Object.freeze({
    probeLegacy(operation = sessionCoordinator.begin()) {
      if (selected.auth_mode !== 'legacy_password') return Promise.reject(new RequestNotDispatchedError('configuration'))
      return request('GET','/notebooks',operation)
    },
    status: (operation = sessionCoordinator.begin()) => request('GET','/auth/status',operation),
    async login(password: string, deviceName = 'Web browser', operation = sessionCoordinator.begin()) {
      const context = readTurnContext()
      if (selected.auth_mode === 'device_sessions') return request('POST','/auth/sessions',operation,JSON.stringify({ password,device_name:deviceName }))
      const response = await request('GET','/notebooks',operation,undefined,password)
      if (!sessionCoordinator.isCurrent(operation) || context?.epoch !== readTurnContext()?.epoch) throw new TransportResponseError('retired')
      if (response.ok) setLegacyAuthToken(password)
      return response
    },
    refresh(operation = sessionCoordinator.begin()) {
      return selected.auth_mode === 'device_sessions' ? request('POST','/auth/sessions/refresh',operation,'{}') : request('GET','/auth/status',operation)
    },
    revoke(sessionId?: string, operation = sessionCoordinator.begin()) {
      if (selected.auth_mode !== 'device_sessions') return Promise.reject(new RequestNotDispatchedError('configuration'))
      return request('DELETE',`/auth/sessions${sessionId ? `/${encodeURIComponent(sessionId)}` : ''}`,operation)
    },
    async signoutLocal(operation = sessionCoordinator.begin(), retry = false) {
      if (!sessionCoordinator.isCurrent(operation)) throw new RequestNotDispatchedError('superseded')
      invalidateTurnContext(); sessionCoordinator.setPhase('anonymous')
      const removed = purgeLegacyAuth()
      if (selected.auth_mode === 'legacy_password') return { localConfirmed: removed, serverRevocation: 'not-performed' as const }
      const response = await request('POST','/auth/web-signout-local',operation,'{}')
      let confirmed = false
      try {
        const data: unknown = await response.json()
        if (!sessionCoordinator.isCurrent(operation)) throw new TransportResponseError('retired')
        if (data && typeof data === 'object' && !Array.isArray(data)) {
          const value = data as Record<string, unknown>
          confirmed = response.status === 200 && Object.keys(value).length === 1 && value.server_revocation === 'unconfirmed' ||
            retry && response.status === 401 && Object.keys(value).length === 1 && !!value.error && typeof value.error === 'object' && !Array.isArray(value.error) && (value.error as Record<string, unknown>).code === 'AUTH_REQUIRED'
        }
      } catch { /* Malformed/late response is not local confirmation. */ }
      return { localConfirmed: confirmed && removed, serverRevocation: 'unconfirmed' as const }
    },
  })
}
