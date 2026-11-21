import { describe, expect, it } from 'vitest'
import type { EmbeddingProfile } from '@/lib/types/personal'
import { captureEmbeddingDisclosure, matchesEmbeddingDisclosure } from './embedding-disclosure'
import { canReplayCapturedTurn, createTurnRegistry, type ValidatedTurnCapture } from './turn-operations'
const profile: EmbeddingProfile = { profile_id: 'p1', fingerprint: 'fp1', destination_descriptor_version: 'd1', provider: 'fixture', model_id: 'model:original', model_name: 'Original model', destination_kind: 'remote', endpoint: 'https://original.example/embed', revision: 'r1', credential_binding_id: 'opaque', dimension: 3, document_prefix: '', query_prefix: '', preprocessing_revision: 'evidence-identity-v1', max_input_bytes: 100, cosine_min_score: 0, endpoint_fingerprint: 'ep1' }
const identity = { profileId: 'p1', fingerprint: 'fp1', descriptorVersion: 'd1' }
function input(): ValidatedTurnCapture {
  return { sessionId: 'session', context: { epoch: 1, ready: true, target: { mode: 'legacy_password', apiBase: 'https://api.example/api', protocol: null } }, owner: { mountId: 'mount' }, embeddingDisclosure: captureEmbeddingDisclosure(profile)!, request: { task: 'question', notebook_id: 'notebook', engine: 'independent', selection_origin: 'local', source_version_ids: ['version'], remote_source_ids: [], message: 'Original query', retrieval_mode: 'hybrid', embedding_profile_id: 'p1', disclosed_profile_fingerprint: 'fp1', destination_descriptor_version: 'd1', acknowledge_query_processing: true } }
}
describe('document-owned original embedding disclosure', () => {
  it('copies only bounded safe metadata, freezes it, binds it to the original DTO, and excludes credentials from capture/wire', () => {
    const value = input(); const summary = value.embeddingDisclosure!
    expect(Object.isFrozen(summary)).toBe(true)
    expect(Object.keys(summary).sort()).toEqual(['profile_id', 'profile_fingerprint', 'destination_descriptor_version', 'provider', 'model_id', 'model_name', 'revision', 'destination_kind', 'endpoint'].sort())
    expect(matchesEmbeddingDisclosure(summary, identity)).toBe(true)
    const registry = createTurnRegistry(); const result = registry.admit(value); expect(result.ok).toBe(true)
    const capture = registry.getSnapshot('notebook')!.capture
    expect(capture.embeddingDisclosure).toBe(summary); expect(canReplayCapturedTurn(capture)).toBe(true)
    expect(capture.dto).not.toHaveProperty('embeddingDisclosure'); expect(capture.dto).not.toHaveProperty('endpoint')
    expect(JSON.stringify(capture)).not.toContain('credential_binding_id')
    expect(capture.bytes).toBe(new TextEncoder().encode(JSON.stringify(capture.dto)).byteLength + new TextEncoder().encode(JSON.stringify(summary)).byteLength)
    registry.settlePost(result.ok ? result.token : {} as never, { kind: 'unknown', reason: 'transport' })
    expect(registry.beginRetry(capture.operationId)).not.toBeNull()
  })
  it.each(['missing', 'rehydrated', 'tampered endpoint', 'tampered descriptor'] as const)('does not authorize paid replay/admission from %s metadata', variant => {
    const value = input(); const registry = createTurnRegistry(); registry.admit(value)
    const capture = registry.getSnapshot('notebook')!.capture
    const summary = variant === 'missing' ? undefined : variant === 'rehydrated' ? JSON.parse(JSON.stringify(capture.embeddingDisclosure)) : Object.freeze({ ...capture.embeddingDisclosure, ...(variant === 'tampered endpoint' ? { endpoint: 'https://tampered.example/embed' } : { destination_descriptor_version: 'd2' }) })
    const restored = { ...capture, embeddingDisclosure: summary }
    expect(canReplayCapturedTurn(restored)).toBe(false)
    expect(createTurnRegistry().admit({ ...value, embeddingDisclosure: summary })).toEqual({ ok: false, reason: 'invalid' })
    expect(matchesEmbeddingDisclosure(summary, identity)).toBe(false)
  })
  it.each(['profileId', 'fingerprint', 'descriptorVersion'] as const)('rejects original summary/DTO %s mismatch', field => {
    expect(matchesEmbeddingDisclosure(captureEmbeddingDisclosure(profile), { ...identity, [field]: 'rotated' })).toBe(false)
  })
  it.each(['', undefined, null, '\n', 'x'.repeat(513)])('rejects incomplete or unsafe revision metadata: %j', revision => {
    expect(captureEmbeddingDisclosure({ ...profile, revision } as EmbeddingProfile)).toBeNull()
  })
  it.each(['https://user:secret@example.invalid/embed', 'https://example.invalid/embed?api_key=secret', 'https://example.invalid/embed#secret', 'javascript:secret', 'https://example.invalid/\nsecret'])('does not retain unsafe destination %s', endpoint => {
    expect(captureEmbeddingDisclosure({ ...profile, endpoint })).toBeNull()
  })
})
