'use client'

import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react'
import { sessionCoordinator } from '@/lib/auth/session-coordinator'
import { readTurnContext, sameTurnTarget, subscribeTurnContext, type TurnContext } from '@/lib/workbench/turn-context'
import { createTurnRegistry, type TurnOperation, type TurnRegistry } from '@/lib/workbench/turn-operations'

const RegistryContext = createContext<TurnRegistry | null>(null)
const sameIdentity = (a: TurnContext | null, b: TurnContext | null) => a === b ||
  (!!a && !!b && a.epoch === b.epoch && sameTurnTarget(a.target, b.target))

function createDocumentOwner() {
  const core = createTurnRegistry()
  // This index retains only IDs, never another copy of the captured payload.
  const notebooks = new Map<string, string>()
  let context = readTurnContext()
  let active = true
  const clear = () => { notebooks.clear(); core.invalidate() }
  const current = () => {
    if (!active) return null
    const next = readTurnContext()
    const changed = !sameIdentity(context, next)
    context = next
    if (changed) clear()
    return next
  }
  const dispatchReady = () => {
    const value = current()
    return !!value?.ready && sessionCoordinator.resourcePhase() === 'authenticated'
  }
  const snapshot = (notebookId: string): TurnOperation | null => {
    const value = current()
    if (!value) return null
    const operation = core.getSnapshot(notebookId)
    return operation && sameIdentity(value, operation.capture.context) ? operation : null
  }
  const operation = (operationId: string) => {
    current()
    const notebookId = notebooks.get(operationId)
    return notebookId ? snapshot(notebookId) : null
  }
  const facade: TurnRegistry = {
    admit(input) {
      current()
      if (!input?.context?.target) return { ok: false, reason: 'invalid' }
      if (!dispatchReady() || !sameIdentity(current(), input?.context)) return { ok: false, reason: 'unavailable' }
      const result = core.admit(input)
      if (result.ok) notebooks.set(result.token.operationId, result.token.notebookId)
      return result
    },
    beginRetry(operationId) { return dispatchReady() && operation(operationId) ? core.beginRetry(operationId) : null },
    beginCheck(operationId) { return dispatchReady() && operation(operationId) ? core.beginCheck(operationId) : null },
    settlePost(token, result) { if (snapshot(token.notebookId)) core.settlePost(token, result) },
    settleCheck(token, result) { if (snapshot(token.notebookId)) core.settleCheck(token, result) },
    abandonNotSent(operationId) {
      if (!operation(operationId) || !core.abandonNotSent(operationId)) return false
      notebooks.delete(operationId); return true
    },
    releaseCompleted(operationId) {
      const value = operation(operationId)
      if (!value) return
      core.releaseCompleted(operationId)
      if (!core.getSnapshot(value.capture.dto.notebook_id)) notebooks.delete(operationId)
    },
    invalidate() { current(); clear() },
    getSnapshot: snapshot,
    subscribe(listener) {
      current()
      // Subscription itself has no action authority. StrictMode reconnects child
      // subscriptions before the parent's passive-effect setup reactivates it.
      return core.subscribe(listener)
    },
  }
  return {
    facade,
    connect() {
      active = true
      current()
      const stop = subscribeTurnContext(current)
      current() // Also close an invalidation during subscription setup.
      return () => { stop(); active = false; clear() }
    },
  }
}

/** One owner per root provider/document; construction and effects never dispatch. */
export function TurnOperationProvider({ children }: { children: React.ReactNode }) {
  const [owner] = useState(createDocumentOwner)
  useEffect(() => owner.connect(), [owner])
  return <RegistryContext.Provider value={owner.facade}>{children}</RegistryContext.Provider>
}
export function useTurnOperationRegistry(): TurnRegistry {
  const registry = useContext(RegistryContext)
  if (!registry) throw new Error('TurnOperationProvider is required')
  return registry
}
const serverSnapshot = () => null
export function useTurnOperationSnapshot(notebookId: string): TurnOperation | null {
  const registry = useTurnOperationRegistry()
  return useSyncExternalStore(registry.subscribe, () => registry.getSnapshot(notebookId), serverSnapshot)
}
