/** Existing write DTOs, distinct from permissive read projections. */
export type KnownEngine = 'notebooklm' | 'independent'
export type Engine = KnownEngine | (string & {})
export interface WebSourceProvenance {
  kind: 'web'
  source_url: string | null
  retrieved_at: string
  provider: 'firecrawl'
  search_result_title?: string | null
  search_result_snippet?: string | null
  historical_url_omitted?: boolean
}
export type SourceProvenance = DerivedSourceProvenance | WebSourceProvenance

export interface Locator {
  page_index?: number | null
  page_label?: string | null
  block_id?: string | null
  start_offset?: number | null
  end_offset?: number | null
  bbox?: number[] | null
}
export interface EvidenceCitation {
  citation_id: string
  // Wire metadata only; no value proves independent corroboration.
  independent_support?: boolean | null
  provenance?: SourceProvenance | null
  reason?: string | null
  kind: 'local_evidence' | 'remote_text_snapshot' | 'remote_unmapped' | 'derived_snapshot'
  source_version_id: string | null
  evidence_id: string | null
  source_title: string | null
  locator?: Locator | null
  quote: string
  reference_validity: string
  remote_reference?: { url?: string; [key: string]: unknown } | null
}
export interface ReadingPosition { source_version_id: string; page_index: number; evidence_id?: string }
// Explicit write DTO. Opaque workspace reads are projected separately.
export interface WorkbenchSelection {
  engine: KnownEngine
  selection_origin: 'local' | 'remote'
  source_version_ids: string[]
  remote_source_ids: string[]
  reading?: ReadingPosition | null
}
/** Retained scope provenance emitted by NotebookLM; never current mapping authority. */
export interface ScopeMappingSnapshot {
  source_link_id: string | null
  remote_source_id: string | null
  source_version_id: string | null
  mapping_method: string | null
  last_checked_at: string | null
}
export interface ScopeSnapshot {
  mapping_version?: number
  engine?: Engine
  selection_origin?: 'local' | 'remote'
  source_version_ids: string[]
  remote_source_ids?: string[]
  remote_notebook_id?: string | null
  scope_hash?: string
  mappings?: ScopeMappingSnapshot[]
}
export interface RetrievalOptions {
  retrieval_mode?: 'lexical' | 'hybrid'
  embedding_profile_id?: string | null
  acknowledge_query_processing?: boolean
  disclosed_profile_fingerprint?: string | null
  destination_descriptor_version?: string | null
}
export interface TurnRequest extends Omit<WorkbenchSelection, 'reading'>, RetrievalOptions {
  engine: KnownEngine
  task: 'question' | 'outline'
  notebook_id: string
  message: string
  remote_notebook_id?: string | null
  idempotency_key: string
}
/** Exact Python legacy empty scope, valid only on note wire records. */
export type NoteScopeSnapshot = ScopeSnapshot | Record<string, never>
export interface CreateWorkbenchNoteInput { title: string; content: string; citations: EvidenceCitation[]; scope_snapshot?: NoteScopeSnapshot }
export interface UpdateWorkbenchNoteInput extends CreateWorkbenchNoteInput { expected_revision: number }
// Workspace native-only notes do not necessarily have personal snapshot metadata.
export interface WorkbenchNote { id: string; revision: number; title?: string | null; content?: string | null; citations?: EvidenceCitation[]; scope_snapshot?: NoteScopeSnapshot }

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
