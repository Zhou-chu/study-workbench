import type { EmbeddingProfile, RetrievalOptions } from '@/lib/types/personal'
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

/** Nonsecret immutable identity shared by consent, dispatch and recovery. */
export const RETRIEVAL_FIELDS = ['retrieval_mode', 'embedding_profile_id', 'acknowledge_query_processing', 'disclosed_profile_fingerprint', 'destination_descriptor_version'] as const
export function copyRetrievalOptions(value: RetrievalOptions): Readonly<RetrievalOptions> {
  return Object.freeze(Object.fromEntries(RETRIEVAL_FIELDS.filter(key => value[key] !== undefined).map(key => [key, value[key]])))
}
export function validRetrievalOptions(value: RetrievalOptions): boolean {
  if (value.acknowledge_query_processing !== undefined && typeof value.acknowledge_query_processing !== 'boolean') return false
  if (value.retrieval_mode === 'hybrid') return [value.embedding_profile_id, value.disclosed_profile_fingerprint, value.destination_descriptor_version].every(id => typeof id === 'string' && !!id.trim())
  return (value.retrieval_mode === undefined || value.retrieval_mode === 'lexical') && !value.acknowledge_query_processing && [value.embedding_profile_id, value.disclosed_profile_fingerprint, value.destination_descriptor_version].every(id => id === undefined || id === null)
}
export function queryDisclosureIdentity(profile: EmbeddingProfile): string {
  return JSON.stringify([profile.profile_id, profile.fingerprint, profile.destination_descriptor_version, profile.destination_kind, profile.endpoint, profile.provider, profile.model_id, profile.model_name, profile.revision])
}
