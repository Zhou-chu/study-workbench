import type { RetrievalOptions } from '@study/contracts'
import { safeHttpTarget } from './values.js'
export type DisclosureProfile = { profile_id: string; fingerprint: string; destination_descriptor_version: string; provider: string; model_id: string; model_name: string; revision: string; destination_kind: 'on_device' | 'remote' | 'unknown'; endpoint: string }
type EmbeddingProfile = DisclosureProfile

/** Human-readable nonsecret metadata, never part of a strict wire request. */
export type EmbeddingDisclosure = Readonly<{
  profile_id: string; profile_fingerprint: string; destination_descriptor_version: string
  provider: string; model_id: string; model_name: string; revision: string
  destination_kind: 'on_device' | 'remote' | 'unknown'; endpoint: string
}>
export type DisclosureIdentity = { profileId?: string | null | undefined; fingerprint?: string | null | undefined; descriptorVersion?: string | null | undefined }
// These operations are document-owned, not persisted. JSON/rehydration cannot
// restore evidence that a safe original disclosure was captured in this document.
const captured = new WeakSet<object>()
const label = (value: unknown, maximum = 512): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value)
export function captureEmbeddingDisclosure(profile: EmbeddingProfile): EmbeddingDisclosure | null {
  if (![profile.profile_id, profile.fingerprint, profile.destination_descriptor_version, profile.provider, profile.model_id, profile.model_name, profile.revision].every(value => label(value)) || !['on_device', 'remote', 'unknown'].includes(profile.destination_kind) || !label(profile.endpoint, 2048)) return null
  if (!safeHttpTarget(profile.endpoint)) return null
  const summary = Object.freeze({ profile_id: profile.profile_id, profile_fingerprint: profile.fingerprint, destination_descriptor_version: profile.destination_descriptor_version,
    provider: profile.provider, model_id: profile.model_id, model_name: profile.model_name, revision: profile.revision, destination_kind: profile.destination_kind, endpoint: profile.endpoint })
  captured.add(summary)
  return summary
}
export function matchesEmbeddingDisclosure(value: unknown, identity: DisclosureIdentity): value is EmbeddingDisclosure {
  if (!value || typeof value !== 'object' || !captured.has(value) || !Object.isFrozen(value)) return false
  const summary = value as EmbeddingDisclosure
  return summary.profile_id === identity.profileId && summary.profile_fingerprint === identity.fingerprint && summary.destination_descriptor_version === identity.descriptorVersion
}
export function queryDisclosureIdentityFromRequest(request: RetrievalOptions): DisclosureIdentity {
  return { profileId: request.embedding_profile_id, fingerprint: request.disclosed_profile_fingerprint, descriptorVersion: request.destination_descriptor_version }
}
