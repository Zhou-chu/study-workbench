import type { DerivedSourceProvenance } from './source-snapshots'

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

export type KnownEngine = 'notebooklm' | 'independent'
// Retained selections/scopes may name engines this client cannot execute.
export type Engine = KnownEngine | (string & {})
export type KnownJobState = 'queued' | 'running' | 'waiting_remote' | 'succeeded' | 'failed' | 'needs_reauth' | 'submission_unknown' | 'cancelled_local'
// Keep future server states verbatim; only explicit known states authorize actions.
export type JobState = KnownJobState | (string & {})
export interface TurnSubmissionResponse { job_id: string; turn_id: string; state: JobState; dispatch_receipt?: unknown }
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
  independent_support?: false
  provenance?: SourceProvenance
  kind: 'local_evidence' | 'remote_text_snapshot' | 'remote_unmapped' | 'derived_snapshot'
  source_version_id: string | null
  evidence_id: string | null
  source_title: string | null
  locator?: Locator | null
  quote: string
  reference_validity: string
  remote_reference?: { url?: string; [key: string]: unknown } | null
}
export interface EvidenceRecord {
  independent_support?: false
  provenance?: SourceProvenance
  reference_reason?: string | null
  reference_validity?: string
  evidence_id: string
  source_version_id: string
  extraction_id: string
  locator: Locator
  quote: string
  source_title?: string
  evidence_kind?: string
}
export interface SourceVersion {
  provenance?: SourceProvenance
  source_version_id: string
  source_id: string
  title?: string
  source_title?: string
  origin?: string
  original_status: string
  mime_type: string
  sha256: string
  byte_size: number
  created_at: string
  status?: string
  extraction_status?: string
}
export interface Extraction {
  verification_origin?: string
  revalidation?: { checked_count: number; verified_count: number; unverified_count: number }
  extraction_id?: string
  status: string
  page_count?: number | null
  warnings: string[]
  text?: string
  blocks?: Array<{ block_id: string; page_index: number | null; text: string }>
}
export interface VersionDetail { version: SourceVersion; extraction: Extraction | null; evidence: EvidenceRecord[] }
export interface ReadingPosition { source_version_id: string; page_index: number; evidence_id?: string }
// Explicit write DTO. Opaque workspace reads are projected separately.
export interface WorkbenchSelection {
  engine: KnownEngine
  selection_origin: 'local' | 'remote'
  source_version_ids: string[]
  remote_source_ids: string[]
  reading?: ReadingPosition | null
}
// Retained workspace objects are intentionally opaque wire data, not SourceVersion
// or WorkbenchSelection write contracts. Keep them intact in the Query cache.
export type WorkspaceSelection = Record<string, unknown>
export interface WorkbenchSelectionView {
  engine: unknown
  selection_origin: unknown
  source_version_ids: string[]
  remote_source_ids: string[]
  reading: ReadingPosition | null
  supported: boolean
}
export interface WorkbenchVersionView {
  source_version_id: string | null
  created_at: string | null
  origin: string | null
  status: string | null
  extraction_status: string | null
  original_status: string | null
  provenance: unknown
}
export interface ScopeSnapshot {
  engine?: Engine
  selection_origin?: 'local' | 'remote'
  source_version_ids: string[]
  remote_source_ids?: string[]
  remote_notebook_id?: string | null
  scope_hash?: string
}
export interface TurnRecord {
  coverage?: { selected_source_count: number; retrieved_source_count: number; evidence_count: number } | null
  warnings?: string[] | null
  turn_id: string
  engine: Engine
  message: string
  answer?: string | null
  state?: string
  status?: string
  citations: EvidenceCitation[]
  scope_snapshot: ScopeSnapshot
  error?: unknown
  created_at?: string
}
export interface TurnRequest extends Omit<WorkbenchSelection, 'reading'> {
  engine: KnownEngine
  task: 'question' | 'outline'
  notebook_id: string
  message: string
  remote_notebook_id?: string | null
  idempotency_key: string
}
export interface CurrentJobResponse {
  provider?: string | null
  job_id: string
  notebook_id?: string
  operation: string
  state: JobState
  submission_state?: string | null
  error?: unknown
  result?: unknown
  remote_may_continue?: boolean | null
  cancel_requested?: boolean | null
  restored_history?: false
  replay_allowed?: boolean | null
  [key: string]: unknown
}
// Archive fields were historically opaque; do not pretend they match live results.
export interface HistoricalJobResponse {
  job_id: string
  state: JobState
  restored_history: true
  replay_allowed: false
  [key: string]: unknown
}
export type BridgeJob = CurrentJobResponse | HistoricalJobResponse
export interface CreateWorkbenchNoteInput { title: string; content: string; citations: EvidenceCitation[]; scope_snapshot?: ScopeSnapshot }
export interface UpdateWorkbenchNoteInput extends CreateWorkbenchNoteInput { expected_revision: number }
// Workspace native-only notes do not necessarily have personal snapshot metadata.
export interface WorkbenchNote { id: string; revision: number; title?: string | null; content?: string | null; citations?: EvidenceCitation[]; scope_snapshot?: ScopeSnapshot }
export interface RemoteLink { remote_notebook_id: string; connection_id?: string }
export interface Workspace {
  notebook: { id: string; name: string }
  sources: Array<{ source_id: string; title: string | null; versions: Record<string, unknown>[] }>
  notes: WorkbenchNote[]
  turns: TurnRecord[]
  jobs: BridgeJob[]
  link: RemoteLink | null
  selection: WorkspaceSelection | null
  legacy_history?: Array<{ chat_session_id: string; history_origin?: string; messages: Array<{ role?: string; content?: string }> }>
}
export interface ConnectionStatus {
  state: 'disconnected' | 'awaiting_user_login' | 'verifying' | 'connected' | 'needs_reauth' | 'unavailable'
  reason?: string | null
  last_verified_at?: string | null
  account_label?: string | null
  quota?: unknown | null
}
export interface ConnectionFlow extends ConnectionStatus { flow_id: string; expires_at?: string }
export interface Capability { name: string; support: string; last_verified_at?: string | null; reason?: string | null }
export interface CapabilityMatrix { sdk_version?: string; adapter_version?: string; operations: Capability[] }
export interface RemoteNotebook { id: string; title: string }
export interface RemoteSource { id: string; title: string; status?: string; original_available?: boolean }
export interface RemotePage<T> { items: T[]; next_cursor?: string | null; listing_complete?: boolean; completeness_note?: string | null }

export interface RemoteArtifact { id: string; title: string; kind: string; status: string; remote_source_ids: string[] }

export interface PortableLimits {
  max_archive_bytes: number
  max_expanded_bytes: number
  max_entity_bytes: number
  max_manifest_bytes: number
  max_request_bytes: number
  multipart_overhead_bytes: number
  max_entries: number
  max_compression_ratio: number
}
