import { sameTurnTarget, type DispatchContext as TurnContext, type DispatchTarget as TurnTarget } from '@study/domain'
export { sameTurnTarget, canDispatch, freezeDispatchContext } from '@study/domain'
export type { DispatchContext, DispatchTarget, TurnContext, TurnTarget } from '@study/domain'
let epoch = 0
let context: TurnContext | null = null
const listeners = new Set<() => void>()
const notify = () => { listeners.forEach(listener => listener()) }
export function readTurnContext(): TurnContext | null { return context }
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
