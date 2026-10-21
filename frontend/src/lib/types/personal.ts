export type Engine = 'notebooklm' | 'independent'
export type JobState = 'queued' | 'running' | 'waiting_remote' | 'succeeded' | 'failed' | 'needs_reauth' | 'submission_unknown' | 'cancelled_local'
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
  kind: 'local_evidence' | 'remote_text_snapshot' | 'remote_unmapped'
  source_version_id: string | null
  evidence_id: string | null
  source_title: string
  locator?: Locator | null
  quote: string
  reference_validity: string
  remote_reference?: { url?: string; [key: string]: unknown } | null
}
export interface EvidenceRecord {
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
export interface WorkbenchSelection {
  engine: Engine
  selection_origin: 'local' | 'remote'
  source_version_ids: string[]
  remote_source_ids: string[]
  reading?: ReadingPosition | null
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
export interface TurnRequest extends WorkbenchSelection {
  task: 'question' | 'outline'
  notebook_id: string
  message: string
  remote_notebook_id?: string | null
  idempotency_key: string
}
export interface BridgeJob {
  job_id: string
  operation: string
  state: JobState
  submission_state?: 'not_submitted' | 'confirmed' | 'unknown'
  error?: unknown
  result?: { download_url?: string; artifact_id?: string; import_report?: unknown; [key: string]: unknown } | null
  remote_may_continue?: boolean
}
export interface WorkbenchNote { id: string; title: string; content: string; citations: EvidenceCitation[]; scope_snapshot?: ScopeSnapshot }
export interface RemoteLink { remote_notebook_id: string; connection_id?: string }
export interface Workspace {
  notebook: { id: string; name: string }
  sources: Array<{ source_id: string; title: string; versions: SourceVersion[] }>
  notes: WorkbenchNote[]
  turns: TurnRecord[]
  jobs: BridgeJob[]
  link: RemoteLink | null
  selection: WorkbenchSelection
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
