import type { EvidenceCitation, ScopeSnapshot } from './personal'

export type SnapshotOrigin =
  | { kind: 'note'; id: string; revision: number }
  | { kind: 'turn'; id: string }

export type SourceSnapshotRequest = (
  | { origin_kind: 'note'; note_id: string; expected_revision: number }
  | { origin_kind: 'turn'; turn_id: string }
) & { idempotency_key: string }

export interface DerivedSourceProvenance {
  kind: 'derived'
  origin_kind: 'note' | 'turn'
  origin_id: string
  note_revision?: number | null
  origin_title: string
  captured_at: string
  content_sha256: string
  authorship: 'ai' | 'human' | 'unknown'
  scope_snapshot: ScopeSnapshot
  citations: EvidenceCitation[]
}

export interface SourceSnapshotResult {
  source_id: string
  source_version_id: string
  job_id: string
  status: 'ready'
  existing: boolean
  embedding_status: 'not_requested'
  provenance: DerivedSourceProvenance
}
