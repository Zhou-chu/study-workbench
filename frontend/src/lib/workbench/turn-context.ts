import type { WebSessionMode } from '@/lib/types/config'

/** Browser-visible destination only; not a credential or account identity. */
export type TurnTarget = Readonly<{ mode: WebSessionMode; apiBase: string; protocol: string | null }>
export type TurnContext = Readonly<{ epoch: number; target: TurnTarget; ready: boolean }>
let epoch = 0
let context: TurnContext | null = null
const listeners = new Set<() => void>()
const notify = () => { listeners.forEach(listener => listener()) }
export function readTurnContext(): TurnContext | null { return context }
export function sameTurnTarget(a: TurnTarget, b: TurnTarget): boolean {
  return a.mode === b.mode && a.apiBase === b.apiBase && a.protocol === b.protocol
}
export function publishTurnTarget(target: TurnTarget, ready: boolean): void {
  const changed = !context || !sameTurnTarget(context.target, target)
  if (!changed && context!.ready === ready) return
  if (changed) epoch++
  context = Object.freeze({ epoch, target: Object.freeze({ mode: target.mode, apiBase: target.apiBase, protocol: target.protocol }), ready })
  notify()
}
/** Readiness loss is not identity loss: unresolved captures remain recoverable. */
export function suspendTurnTarget(): void {
  if (context) publishTurnTarget(context.target, false)
}
/** Explicit local privacy boundary, including before any target is discovered. */
export function invalidateTurnContext(): void {
  epoch++
  if (context) context = Object.freeze({ ...context, epoch })
  notify()
}
export function subscribeTurnContext(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
