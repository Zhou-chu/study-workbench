import { describe, expect, it } from 'vitest'
import type { DisclosureProfile as EmbeddingProfile } from './embedding-disclosure.js'
import { captureEmbeddingDisclosure, matchesEmbeddingDisclosure } from './embedding-disclosure.js'
const profile: EmbeddingProfile = { profile_id: 'p1', fingerprint: 'fp1', destination_descriptor_version: 'd1', provider: 'fixture', model_id: 'model:original', model_name: 'Original model', destination_kind: 'remote', endpoint: 'https://original.example/embed', revision: 'r1', credential_binding_id: 'opaque', dimension: 3, document_prefix: '', query_prefix: '', preprocessing_revision: 'evidence-identity-v1', max_input_bytes: 100, cosine_min_score: 0, endpoint_fingerprint: 'ep1' }
const identity = { profileId: 'p1', fingerprint: 'fp1', descriptorVersion: 'd1' }

describe('embedding disclosure metadata validation', () => {
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
