import type { RetrievalOptions } from '@study/contracts'

export type DispatchTarget = Readonly<{ mode: 'legacy_password' | 'device_sessions'; apiBase: string; protocol: string | null }>
/** Privacy/target boundary only, never human or provider-account identity. */
export type DispatchContext = Readonly<{ epoch: number; target: DispatchTarget; ready: boolean }>
export type TurnContext = DispatchContext
export type TurnTarget = DispatchTarget
export function sameTurnTarget(a: DispatchTarget, b: DispatchTarget): boolean { return a.mode === b.mode && a.apiBase === b.apiBase && a.protocol === b.protocol }
export function freezeDispatchContext(context: DispatchContext): DispatchContext {
  return Object.freeze({ epoch: context.epoch, ready: context.ready, target: Object.freeze({ mode: context.target.mode, apiBase: context.target.apiBase, protocol: context.target.protocol }) })
}
export function canDispatch(captured: DispatchContext, current: DispatchContext | null): boolean {
  return !!current && captured.ready && current.ready && current.epoch === captured.epoch && sameTurnTarget(current.target, captured.target)
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
