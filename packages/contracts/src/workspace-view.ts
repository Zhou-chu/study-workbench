import { z } from 'zod'

/** A marker is irreversible at the parser boundary and grants no actions. */
export type ProjectionStatus = 'unknown' | 'invalid'
export interface NonActionableValue { projection_status: ProjectionStatus }
export interface PublicView { projection_status?: ProjectionStatus | null | undefined }
export interface KnownDispatchReceipt { dispatch_ack: 'unknown'; job_id: string; turn_id: string; retry_safe: false }
export type DispatchReceiptView = { validity: 'valid'; receipt: KnownDispatchReceipt } | { validity: 'unknown' | 'invalid' }

export interface MappingView extends PublicView {
  source_link_id?: string | null | NonActionableValue | undefined
  remote_source_id?: string | null | NonActionableValue | undefined
  source_version_id?: string | null | NonActionableValue | undefined
  mapping_method?: string | null | NonActionableValue | undefined
  last_checked_at?: string | null | NonActionableValue | undefined
}

export interface ScopeView extends PublicView {
  engine?: string | null | NonActionableValue | undefined
  selection_origin?: string | null | NonActionableValue | undefined
  source_version_ids?: (string)[] | null | NonActionableValue | undefined
  remote_source_ids?: (string)[] | null | NonActionableValue | undefined
  remote_notebook_id?: string | null | NonActionableValue | undefined
  scope_hash?: string | null | NonActionableValue | undefined
  mappings?: (MappingView | NonActionableValue)[] | null | NonActionableValue | undefined
  mapping_version?: number | null | NonActionableValue | undefined
}

export interface LocatorView extends PublicView {
  page_index?: number | null | NonActionableValue | undefined
  page_label?: string | null | NonActionableValue | undefined
  block_id?: string | null | NonActionableValue | undefined
  start_offset?: number | null | NonActionableValue | undefined
  end_offset?: number | null | NonActionableValue | undefined
  bbox?: (number)[] | null | NonActionableValue | undefined
}

export interface RemoteReferenceView extends PublicView {
  remote_source_id?: string | null | NonActionableValue | undefined
  quote?: string | null | NonActionableValue | undefined
  citation_number?: number | null | NonActionableValue | undefined
  url?: string | null | NonActionableValue | undefined
}

export interface EvidenceCitationView extends PublicView {
  citation_id?: string | null | NonActionableValue | undefined
  kind?: string | null | NonActionableValue | undefined
  quote?: string | null | NonActionableValue | undefined
  reference_validity?: string | null | NonActionableValue | undefined
  source_version_id?: string | null | NonActionableValue | undefined
  evidence_id?: string | null | NonActionableValue | undefined
  source_title?: string | null | NonActionableValue | undefined
  independent_support?: boolean | null | NonActionableValue | undefined
  remote_reference?: RemoteReferenceView | null | NonActionableValue | undefined
  locator?: LocatorView | null | NonActionableValue | undefined
  provenance?: ProvenanceView | null | NonActionableValue | undefined
  reason?: string | null | NonActionableValue | undefined
}

export interface ProvenanceView extends PublicView {
  kind?: string | null | NonActionableValue | undefined
  origin_kind?: string | null | NonActionableValue | undefined
  origin_id?: string | null | NonActionableValue | undefined
  note_revision?: number | null | NonActionableValue | undefined
  origin_title?: string | null | NonActionableValue | undefined
  authorship?: string | null | NonActionableValue | undefined
  captured_at?: string | null | NonActionableValue | undefined
  content_sha256?: string | null | NonActionableValue | undefined
  scope_snapshot?: ScopeView | null | NonActionableValue | undefined
  citations?: (EvidenceCitationView | NonActionableValue)[] | null | NonActionableValue | undefined
  source_url?: string | null | NonActionableValue | undefined
  historical_url_omitted?: boolean | null | NonActionableValue | undefined
  retrieved_at?: string | null | NonActionableValue | undefined
  provider?: string | null | NonActionableValue | undefined
  search_result_title?: string | null | NonActionableValue | undefined
  search_result_snippet?: string | null | NonActionableValue | undefined
}

export interface ReadingView extends PublicView {
  source_version_id?: string | null | NonActionableValue | undefined
  page_index?: number | null | NonActionableValue | undefined
  evidence_id?: string | null | NonActionableValue | undefined
}

export interface SelectionView extends PublicView {
  notebook_id?: string | null | NonActionableValue | undefined
  engine?: string | null | NonActionableValue | undefined
  selection_origin?: string | null | NonActionableValue | undefined
  source_version_ids?: (string)[] | null | NonActionableValue | undefined
  remote_source_ids?: (string)[] | null | NonActionableValue | undefined
  remote_notebook_id?: string | null | NonActionableValue | undefined
  reading?: ReadingView | null | NonActionableValue | undefined
  updated_at?: string | null | NonActionableValue | undefined
}

export interface SourceVersionView extends PublicView {
  source_version_id?: string | null | NonActionableValue | undefined
  source_id?: string | null | NonActionableValue | undefined
  notebook_id?: string | null | NonActionableValue | undefined
  title?: string | null | NonActionableValue | undefined
  source_title?: string | null | NonActionableValue | undefined
  origin?: string | null | NonActionableValue | undefined
  original_status?: string | null | NonActionableValue | undefined
  mime_type?: string | null | NonActionableValue | undefined
  sha256?: string | null | NonActionableValue | undefined
  byte_size?: number | null | NonActionableValue | undefined
  created_at?: string | null | NonActionableValue | undefined
  current_extraction_id?: string | null | NonActionableValue | undefined
  status?: string | null | NonActionableValue | undefined
  extraction_status?: string | null | NonActionableValue | undefined
  provenance?: ProvenanceView | null | NonActionableValue | undefined
}

export interface SourceView extends PublicView {
  source_id?: string | null | NonActionableValue | undefined
  title?: string | null | NonActionableValue | undefined
  versions?: (SourceVersionView | NonActionableValue)[] | null | NonActionableValue | undefined
}

export interface NoteView extends PublicView {
  id?: string | null | NonActionableValue | undefined
  note_id?: string | null | NonActionableValue | undefined
  notebook_id?: string | null | NonActionableValue | undefined
  revision?: number | null | NonActionableValue | undefined
  title?: string | null | NonActionableValue | undefined
  content?: string | null | NonActionableValue | undefined
  created?: string | null | NonActionableValue | undefined
  updated?: string | null | NonActionableValue | undefined
  created_at?: string | null | NonActionableValue | undefined
  updated_at?: string | null | NonActionableValue | undefined
  citations?: (EvidenceCitationView | NonActionableValue)[] | null | NonActionableValue | undefined
  scope_snapshot?: ScopeView | null | NonActionableValue | undefined
  provenance?: ProvenanceView | null | NonActionableValue | undefined
}

export interface RetrievalRequestView extends PublicView {
  retrieval_mode?: string | null | NonActionableValue | undefined
  embedding_profile_id?: string | null | NonActionableValue | undefined
  acknowledge_query_processing?: boolean | null | NonActionableValue | undefined
  disclosed_profile_fingerprint?: string | null | NonActionableValue | undefined
  destination_descriptor_version?: string | null | NonActionableValue | undefined
}

export interface RequestSnapshotView extends PublicView {
  notebook_id?: string | null | NonActionableValue | undefined
  engine?: string | null | NonActionableValue | undefined
  message?: string | null | NonActionableValue | undefined
  selection_origin?: string | null | NonActionableValue | undefined
  source_version_ids?: (string)[] | null | NonActionableValue | undefined
  remote_notebook_id?: string | null | NonActionableValue | undefined
  remote_source_ids?: (string)[] | null | NonActionableValue | undefined
  idempotency_key?: string | null | NonActionableValue | undefined
  model_id?: string | null | NonActionableValue | undefined
  task?: string | null | NonActionableValue | undefined
  retrieval_mode?: string | null | NonActionableValue | undefined
  embedding_profile_id?: string | null | NonActionableValue | undefined
  acknowledge_query_processing?: boolean | null | NonActionableValue | undefined
  disclosed_profile_fingerprint?: string | null | NonActionableValue | undefined
  destination_descriptor_version?: string | null | NonActionableValue | undefined
}

export interface RetrievalView extends PublicView {
  requested_method?: string | null | NonActionableValue | undefined
  retrieval_method?: string | null | NonActionableValue | undefined
  fallback_reason?: string | null | NonActionableValue | undefined
  profile_id?: string | null | NonActionableValue | undefined
  indexed_version_count?: number | null | NonActionableValue | undefined
  selected_version_count?: number | null | NonActionableValue | undefined
  warnings?: (string)[] | null | NonActionableValue | undefined
}

export interface CoverageView extends PublicView {
  selected_source_count?: number | null | NonActionableValue | undefined
  retrieved_source_count?: number | null | NonActionableValue | undefined
  evidence_count?: number | null | NonActionableValue | undefined
}

export interface BudgetView extends PublicView {
  context_tokens?: number | null | NonActionableValue | undefined
  output_tokens?: number | null | NonActionableValue | undefined
  estimated_input_tokens?: number | null | NonActionableValue | undefined
  estimator?: string | null | NonActionableValue | undefined
  retrieved_evidence_count?: number | null | NonActionableValue | undefined
  included_evidence_count?: number | null | NonActionableValue | undefined
}
export interface TurnView extends PublicView {
  turn_id?: string | null | NonActionableValue | undefined
  notebook_id?: string | null | NonActionableValue | undefined
  chat_session_id?: string | null | NonActionableValue | undefined
  engine?: string | null | NonActionableValue | undefined
  message?: string | null | NonActionableValue | undefined
  idempotency_key?: string | null | NonActionableValue | undefined
  status?: string | null | NonActionableValue | undefined
  state?: string | null | NonActionableValue | undefined
  generation_status?: string | null | NonActionableValue | undefined
  answer?: string | null | NonActionableValue | undefined
  scope_snapshot?: ScopeView | null | NonActionableValue | undefined
  citations?: (EvidenceCitationView | NonActionableValue)[] | null | NonActionableValue | undefined
  retrieval_request?: RetrievalRequestView | null | NonActionableValue | undefined
  retrieval?: RetrievalView | null | NonActionableValue | undefined
  coverage?: CoverageView | null | NonActionableValue | undefined
  warnings?: (string)[] | null | NonActionableValue | undefined
  evidence_ids?: (string)[] | null | NonActionableValue | undefined
  job_id?: string | null | NonActionableValue | undefined
  conversation_id?: string | null | NonActionableValue | undefined
  connector_version?: string | null | NonActionableValue | undefined
  created_at?: string | null | NonActionableValue | undefined
  completed_at?: string | null | NonActionableValue | undefined
  error?: NonActionableValue | null | NonActionableValue | undefined
  scope_hash?: string | null | NonActionableValue | undefined
  grounding_status?: string | null | NonActionableValue | undefined
  model_id?: string | null | NonActionableValue | undefined
  pipeline_version?: string | null | NonActionableValue | undefined
  budget?: BudgetView | null | NonActionableValue | undefined
}

export interface ArtifactView extends PublicView {
  artifact_id?: string | null | NonActionableValue | undefined
  id?: string | null | NonActionableValue | undefined
  notebook_id?: string | null | NonActionableValue | undefined
  remote_artifact_id?: string | null | NonActionableValue | undefined
  title?: string | null | NonActionableValue | undefined
  kind?: string | null | NonActionableValue | undefined
  status?: string | null | NonActionableValue | undefined
  mime_type?: string | null | NonActionableValue | undefined
  byte_size?: number | null | NonActionableValue | undefined
  sha256?: string | null | NonActionableValue | undefined
  remote_source_ids?: (string)[] | null | NonActionableValue | undefined
  created_at?: string | null | NonActionableValue | undefined
}

export interface SourceResultView extends PublicView {
  source_id?: string | null | NonActionableValue | undefined
  source_version_id?: string | null | NonActionableValue | undefined
  job_id?: string | null | NonActionableValue | undefined
  status?: string | null | NonActionableValue | undefined
  existing?: boolean | null | NonActionableValue | undefined
  embedding_status?: string | null | NonActionableValue | undefined
  provenance?: ProvenanceView | null | NonActionableValue | undefined
}

export interface MaintenanceResultView extends PublicView {
  source_version_id?: string | null | NonActionableValue | undefined
  extraction_id?: string | null | NonActionableValue | undefined
  fresh_extraction_id?: string | null | NonActionableValue | undefined
  status?: string | null | NonActionableValue | undefined
  evidence_count?: number | null | NonActionableValue | undefined
  checked_count?: number | null | NonActionableValue | undefined
  verified_count?: number | null | NonActionableValue | undefined
  unverified_count?: number | null | NonActionableValue | undefined
}

export interface ArtifactResultView extends PublicView {
  remote_artifact_id?: string | null | NonActionableValue | undefined
  artifact?: ArtifactView | null | NonActionableValue | undefined
  downloaded?: boolean | null | NonActionableValue | undefined
  download_error?: NonActionableValue | null | NonActionableValue | undefined
}

export interface RemoteNotebookResultView extends PublicView {
  remote_notebook_id?: string | null | NonActionableValue | undefined
}

export interface JobView extends PublicView {
  operation?: string | null | NonActionableValue | undefined
  job_id?: string | null | NonActionableValue | undefined
  turn_id?: string | null | NonActionableValue | undefined
  notebook_id?: string | null | NonActionableValue | undefined
  chat_session_id?: string | null | NonActionableValue | undefined
  idempotency_key?: string | null | NonActionableValue | undefined
  state?: string | null | NonActionableValue | undefined
  status?: string | null | NonActionableValue | undefined
  submission_state?: string | null | NonActionableValue | undefined
  restored_history?: boolean | null | NonActionableValue | undefined
  replay_allowed?: boolean | null | NonActionableValue | undefined
  dispatch_receipt?: DispatchReceiptView | null | NonActionableValue | undefined
  request_snapshot?: RequestSnapshotView | null | NonActionableValue | undefined
  result?: TurnView | SourceResultView | MaintenanceResultView | ArtifactResultView | RemoteNotebookResultView | null | NonActionableValue | undefined
  source_id?: string | null | NonActionableValue | undefined
  source_version_id?: string | null | NonActionableValue | undefined
  extraction_id?: string | null | NonActionableValue | undefined
  provider?: string | null | NonActionableValue | undefined
  remote_task_id?: string | null | NonActionableValue | undefined
  attempts?: number | null | NonActionableValue | undefined
  poll_attempts?: number | null | NonActionableValue | undefined
  created_at?: string | null | NonActionableValue | undefined
  updated_at?: string | null | NonActionableValue | undefined
  started_at?: string | null | NonActionableValue | undefined
  completed_at?: string | null | NonActionableValue | undefined
  next_poll_at?: string | null | NonActionableValue | undefined
  next_dispatch_at?: string | null | NonActionableValue | undefined
  cancel_requested?: boolean | null | NonActionableValue | undefined
  remote_may_continue?: boolean | null | NonActionableValue | undefined
  error?: NonActionableValue | null | NonActionableValue | undefined
}

export interface NotebookView extends PublicView {
  id?: string | null | NonActionableValue | undefined
  name?: string | null | NonActionableValue | undefined
}

export interface LinkView extends PublicView {
  remote_notebook_id?: string | null | NonActionableValue | undefined
  connection_id?: string | null | NonActionableValue | undefined
}

export interface LegacyMessageView extends PublicView {
  role?: string | null | NonActionableValue | undefined
  content?: string | null | NonActionableValue | undefined
}

export interface LegacyHistoryView extends PublicView {
  chat_session_id?: string | null | NonActionableValue | undefined
  notebook_id?: string | null | NonActionableValue | undefined
  history_origin?: string | null | NonActionableValue | undefined
  messages?: (LegacyMessageView | NonActionableValue)[] | null | NonActionableValue | undefined
  restored_history?: boolean | null | NonActionableValue | undefined
  replay_allowed?: boolean | null | NonActionableValue | undefined
  created_at?: string | null | NonActionableValue | undefined
}

export interface WorkspaceViewV1 extends PublicView {
  schema_version: 'workspace-view-v1'
  notebook: NotebookView
  sources: (SourceView | NonActionableValue)[]
  notes: (NoteView | NonActionableValue)[]
  turns: (TurnView | NonActionableValue)[]
  jobs: (JobView | NonActionableValue)[]
  selection: SelectionView | null | NonActionableValue
  link: LinkView | null | NonActionableValue
  legacy_history: (LegacyHistoryView | NonActionableValue)[]
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
const invalid: NonActionableValue = { projection_status: 'invalid' }
const unknownValue: NonActionableValue = { projection_status: 'unknown' }
const marker = z.object({ projection_status: z.enum(['unknown', 'invalid']) }).strict()
const status = z.enum(['unknown', 'invalid']).nullable().optional()
function issue(value: unknown): ProjectionStatus | undefined {
  if (isRecord(value)) {
    if (value.projection_status === 'invalid' || value.validity === 'invalid') return 'invalid'
    if (value.projection_status === 'unknown' || value.validity === 'unknown') return 'unknown'
    return issues(Object.values(value))
  }
  return Array.isArray(value) ? issues(value) : undefined
}
function issues(values: unknown[]): ProjectionStatus | undefined {
  const all = values.map(issue)
  return all.includes('invalid') ? 'invalid' : all.includes('unknown') ? 'unknown' : undefined
}
function withIssue<T extends object>(value: T): T & PublicView {
  const found = issue(value)
  return found ? { ...value, projection_status: found } : value
}
function field<T extends z.ZodType>(schema: T) {
  return z.union([z.null(), marker, schema]).optional().catch(invalid)
}
function clean(value: unknown, keys: string[], omitted: string[] = []): Record<string, unknown> {
  if (!isRecord(value)) return { projection_status: 'invalid' }
  const result: Record<string, unknown> = {}
  const hasUnknown = Object.keys(value).some(key => !keys.includes(key) && !omitted.includes(key))
  for (const key of keys) if (Object.hasOwn(value, key)) result[key] = value[key]
  for (const key of ['error', 'download_error']) {
    if (Object.hasOwn(result, key) && result[key] !== null) result[key] = unknownValue
  }
  if ((hasUnknown || (Object.hasOwn(value, 'projection_status') && value.projection_status === null)) && result.projection_status !== 'invalid') result.projection_status = 'unknown'
  return result
}
function view<S extends z.ZodRawShape>(shape: S, omitted: string[] = []) {
  return z.preprocess(value => clean(value, [...Object.keys(shape), 'projection_status'], omitted), z.object({ ...shape, projection_status: status }).strict()).transform(withIssue)
}
const knownReceipt = z.object({ dispatch_ack: z.literal('unknown'), job_id: z.string().refine(value => !!value.trim()), turn_id: z.string().refine(value => !!value.trim()), retry_safe: z.literal(false) }).strict()
export type ViewInputFormat = 'legacy' | 'workspace-view-v1'
export function parseDispatchReceipt(value: unknown, format: ViewInputFormat = 'legacy'): DispatchReceiptView {
  if (!isRecord(value)) return { validity: 'invalid' }
  // Already-projected evidence retains its branch. Never remove invalidity.
  if (format === 'workspace-view-v1') {
    if ((value.validity === 'unknown' || value.validity === 'invalid') && Object.keys(value).length === 1) return { validity: value.validity }
    if (value.validity !== 'valid' || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'receipt')) return { validity: 'invalid' }
    const parsed = knownReceipt.safeParse(value.receipt)
    return parsed.success ? { validity: 'valid', receipt: parsed.data } : { validity: 'invalid' }
  }
  const keys = ['dispatch_ack', 'job_id', 'turn_id', 'retry_safe']
  if (Object.keys(value).some(key => !keys.includes(key))) return { validity: 'unknown' }
  const parsed = knownReceipt.safeParse(value)
  return parsed.success ? { validity: 'valid', receipt: parsed.data } : { validity: 'invalid' }
}
const DispatchReceiptViewSchema: z.ZodType<DispatchReceiptView> = z.unknown().transform(value => parseDispatchReceipt(value, 'workspace-view-v1'))

const MappingViewShape = () => ({
  source_link_id: field(z.string()),
  remote_source_id: field(z.string()),
  source_version_id: field(z.string()),
  mapping_method: field(z.string()),
  last_checked_at: field(z.string()),
})
const MappingViewSchema: z.ZodType<MappingView> = z.lazy(() => view(MappingViewShape(), []))

const ScopeViewShape = () => ({
  engine: field(z.string()),
  selection_origin: field(z.string()),
  source_version_ids: field(z.array(z.string())),
  remote_source_ids: field(z.array(z.string())),
  remote_notebook_id: field(z.string()),
  scope_hash: field(z.string()),
  mappings: field(z.array(z.union([MappingViewSchema, marker]))),
  mapping_version: field(z.number().int().safe()),
})
const ScopeViewSchema: z.ZodType<ScopeView> = z.lazy(() => view(ScopeViewShape(), []))

const LocatorViewShape = () => ({
  page_index: field(z.number().int().safe()),
  page_label: field(z.string()),
  block_id: field(z.string()),
  start_offset: field(z.number().int().safe()),
  end_offset: field(z.number().int().safe()),
  bbox: field(z.array(z.number().finite())),
})
const LocatorViewSchema: z.ZodType<LocatorView> = z.lazy(() => view(LocatorViewShape(), []))

const RemoteReferenceViewShape = () => ({
  remote_source_id: field(z.string()),
  quote: field(z.string()),
  citation_number: field(z.number().int().safe()),
  url: field(z.string()),
})
const RemoteReferenceViewSchema: z.ZodType<RemoteReferenceView> = z.lazy(() => view(RemoteReferenceViewShape(), []))

const EvidenceCitationViewShape = () => ({
  citation_id: field(z.string()),
  kind: field(z.string()),
  quote: field(z.string()),
  reference_validity: field(z.string()),
  source_version_id: field(z.string()),
  evidence_id: field(z.string()),
  source_title: field(z.string()),
  independent_support: field(z.boolean()),
  remote_reference: field(RemoteReferenceViewSchema),
  locator: field(LocatorViewSchema),
  provenance: field(ProvenanceViewSchema),
  reason: field(z.string()),
})
const EvidenceCitationViewSchema: z.ZodType<EvidenceCitationView> = z.lazy(() => view(EvidenceCitationViewShape(), []))

const ProvenanceViewShape = () => ({
  kind: field(z.string()),
  origin_kind: field(z.string()),
  origin_id: field(z.string()),
  note_revision: field(z.number().int().safe()),
  origin_title: field(z.string()),
  authorship: field(z.string()),
  captured_at: field(z.string()),
  content_sha256: field(z.string()),
  scope_snapshot: field(ScopeViewSchema),
  citations: field(z.array(z.union([EvidenceCitationViewSchema, marker]))),
  source_url: field(z.string()),
  historical_url_omitted: field(z.boolean()),
  retrieved_at: field(z.string()),
  provider: field(z.string()),
  search_result_title: field(z.string()),
  search_result_snippet: field(z.string()),
})
const ProvenanceViewSchema: z.ZodType<ProvenanceView> = z.lazy(() => z.preprocess(value => isRecord(value) && (value.kind === 'derived' || value.kind === 'web' || Object.hasOwn(value, 'projection_status')) ? value : unknownValue, view(ProvenanceViewShape(), [])))

const ReadingViewShape = () => ({
  source_version_id: field(z.string()),
  page_index: field(z.number().int().safe()),
  evidence_id: field(z.string()),
})
const ReadingViewSchema: z.ZodType<ReadingView> = z.lazy(() => view(ReadingViewShape(), []))

const SelectionViewShape = () => ({
  notebook_id: field(z.string()),
  engine: field(z.string()),
  selection_origin: field(z.string()),
  source_version_ids: field(z.array(z.string())),
  remote_source_ids: field(z.array(z.string())),
  remote_notebook_id: field(z.string()),
  reading: field(ReadingViewSchema),
  updated_at: field(z.string()),
})
const SelectionViewSchema: z.ZodType<SelectionView> = z.lazy(() => view(SelectionViewShape(), []))

const SourceVersionViewShape = () => ({
  source_version_id: field(z.string()),
  source_id: field(z.string()),
  notebook_id: field(z.string()),
  title: field(z.string()),
  source_title: field(z.string()),
  origin: field(z.string()),
  original_status: field(z.string()),
  mime_type: field(z.string()),
  sha256: field(z.string()),
  byte_size: field(z.number().int().safe()),
  created_at: field(z.string()),
  current_extraction_id: field(z.string()),
  status: field(z.string()),
  extraction_status: field(z.string()),
  provenance: field(ProvenanceViewSchema),
})
const SourceVersionViewSchema: z.ZodType<SourceVersionView> = z.lazy(() => view(SourceVersionViewShape(), ["file_path"]))

const SourceViewShape = () => ({
  source_id: field(z.string()),
  title: field(z.string()),
  versions: field(z.array(z.union([SourceVersionViewSchema, marker]))),
})
const SourceViewSchema: z.ZodType<SourceView> = z.lazy(() => view(SourceViewShape(), []))

const NoteViewShape = () => ({
  id: field(z.string()),
  note_id: field(z.string()),
  notebook_id: field(z.string()),
  revision: field(z.number().int().safe()),
  title: field(z.string()),
  content: field(z.string()),
  created: field(z.string()),
  updated: field(z.string()),
  created_at: field(z.string()),
  updated_at: field(z.string()),
  citations: field(z.array(z.union([EvidenceCitationViewSchema, marker]))),
  scope_snapshot: field(ScopeViewSchema),
  provenance: field(ProvenanceViewSchema),
})
const NoteViewSchema: z.ZodType<NoteView> = z.lazy(() => view(NoteViewShape(), []))

const RetrievalRequestViewShape = () => ({
  retrieval_mode: field(z.string()),
  embedding_profile_id: field(z.string()),
  acknowledge_query_processing: field(z.boolean()),
  disclosed_profile_fingerprint: field(z.string()),
  destination_descriptor_version: field(z.string()),
})
const RetrievalRequestViewSchema: z.ZodType<RetrievalRequestView> = z.lazy(() => view(RetrievalRequestViewShape(), []))

const RequestSnapshotViewShape = () => ({
  notebook_id: field(z.string()),
  engine: field(z.string()),
  message: field(z.string()),
  selection_origin: field(z.string()),
  source_version_ids: field(z.array(z.string())),
  remote_notebook_id: field(z.string()),
  remote_source_ids: field(z.array(z.string())),
  idempotency_key: field(z.string()),
  model_id: field(z.string()),
  task: field(z.string()),
  retrieval_mode: field(z.string()),
  embedding_profile_id: field(z.string()),
  acknowledge_query_processing: field(z.boolean()),
  disclosed_profile_fingerprint: field(z.string()),
  destination_descriptor_version: field(z.string()),
})
const RequestSnapshotViewSchema: z.ZodType<RequestSnapshotView> = z.lazy(() => view(RequestSnapshotViewShape(), []))

const RetrievalViewShape = () => ({
  requested_method: field(z.string()),
  retrieval_method: field(z.string()),
  fallback_reason: field(z.string()),
  profile_id: field(z.string()),
  indexed_version_count: field(z.number().int().safe()),
  selected_version_count: field(z.number().int().safe()),
  warnings: field(z.array(z.string())),
})
const RetrievalViewSchema: z.ZodType<RetrievalView> = z.lazy(() => view(RetrievalViewShape(), []))

const CoverageViewShape = () => ({
  selected_source_count: field(z.number().int().safe()),
  retrieved_source_count: field(z.number().int().safe()),
  evidence_count: field(z.number().int().safe()),
})
const CoverageViewSchema: z.ZodType<CoverageView> = z.lazy(() => view(CoverageViewShape(), []))

const BudgetViewShape = () => ({
  context_tokens: field(z.number().int().safe()), output_tokens: field(z.number().int().safe()),
  estimated_input_tokens: field(z.number().int().safe()), estimator: field(z.string()),
  retrieved_evidence_count: field(z.number().int().safe()), included_evidence_count: field(z.number().int().safe()),
})
const BudgetViewSchema: z.ZodType<BudgetView> = z.lazy(() => view(BudgetViewShape()))
const TurnViewShape = () => ({
  turn_id: field(z.string()),
  notebook_id: field(z.string()),
  chat_session_id: field(z.string()),
  engine: field(z.string()),
  message: field(z.string()),
  idempotency_key: field(z.string()),
  status: field(z.string()),
  state: field(z.string()),
  generation_status: field(z.string()),
  answer: field(z.string()),
  scope_snapshot: field(ScopeViewSchema),
  citations: field(z.array(z.union([EvidenceCitationViewSchema, marker]))),
  retrieval_request: field(RetrievalRequestViewSchema),
  retrieval: field(RetrievalViewSchema),
  coverage: field(CoverageViewSchema),
  warnings: field(z.array(z.string())),
  evidence_ids: field(z.array(z.string())),
  job_id: field(z.string()),
  conversation_id: field(z.string()),
  connector_version: field(z.string()),
  created_at: field(z.string()),
  completed_at: field(z.string()),
  error: field(marker),
  scope_hash: field(z.string()), grounding_status: field(z.string()), model_id: field(z.string()),
  pipeline_version: field(z.string()), budget: field(BudgetViewSchema),
})
const TurnViewSchema: z.ZodType<TurnView> = z.lazy(() => view(TurnViewShape(), ["usage", "request_hash"]))

const ArtifactViewShape = () => ({
  artifact_id: field(z.string()),
  id: field(z.string()),
  notebook_id: field(z.string()),
  remote_artifact_id: field(z.string()),
  title: field(z.string()),
  kind: field(z.string()),
  status: field(z.string()),
  mime_type: field(z.string()),
  byte_size: field(z.number().int().safe()),
  sha256: field(z.string()),
  remote_source_ids: field(z.array(z.string())),
  created_at: field(z.string()),
})
const ArtifactViewSchema: z.ZodType<ArtifactView> = z.lazy(() => view(ArtifactViewShape(), ["file_path", "path"]))

const SourceResultViewShape = () => ({
  source_id: field(z.string()),
  source_version_id: field(z.string()),
  job_id: field(z.string()),
  status: field(z.string()),
  existing: field(z.boolean()),
  embedding_status: field(z.string()),
  provenance: field(ProvenanceViewSchema),
})
const SourceResultViewSchema: z.ZodType<SourceResultView> = z.lazy(() => view(SourceResultViewShape(), []))

const MaintenanceResultViewShape = () => ({
  source_version_id: field(z.string()),
  extraction_id: field(z.string()),
  fresh_extraction_id: field(z.string()),
  status: field(z.string()),
  evidence_count: field(z.number().int().safe()),
  checked_count: field(z.number().int().safe()),
  verified_count: field(z.number().int().safe()),
  unverified_count: field(z.number().int().safe()),
})
const MaintenanceResultViewSchema: z.ZodType<MaintenanceResultView> = z.lazy(() => view(MaintenanceResultViewShape(), []))

const ArtifactResultViewShape = () => ({
  remote_artifact_id: field(z.string()),
  artifact: field(ArtifactViewSchema),
  downloaded: field(z.boolean()),
  download_error: field(marker),
})
const ArtifactResultViewSchema: z.ZodType<ArtifactResultView> = z.lazy(() => view(ArtifactResultViewShape(), []))

const RemoteNotebookResultViewShape = () => ({
  remote_notebook_id: field(z.string()),
})
const RemoteNotebookResultViewSchema: z.ZodType<RemoteNotebookResultView> = z.lazy(() => view(RemoteNotebookResultViewShape(), []))

const NotebookViewShape = () => ({
  id: field(z.string()),
  name: field(z.string()),
})
const NotebookViewSchema: z.ZodType<NotebookView> = z.lazy(() => view(NotebookViewShape(), []))

const LinkViewShape = () => ({
  remote_notebook_id: field(z.string()),
  connection_id: field(z.string()),
})
const LinkViewSchema: z.ZodType<LinkView> = z.lazy(() => view(LinkViewShape(), []))

const LegacyMessageViewShape = () => ({
  role: field(z.string()),
  content: field(z.string()),
})
const LegacyMessageViewSchema: z.ZodType<LegacyMessageView> = z.lazy(() => view(LegacyMessageViewShape(), []))

const LegacyHistoryViewShape = () => ({
  chat_session_id: field(z.string()),
  notebook_id: field(z.string()),
  history_origin: field(z.string()),
  messages: field(z.array(z.union([LegacyMessageViewSchema, marker]))),
  restored_history: field(z.boolean()),
  replay_allowed: field(z.boolean()),
  created_at: field(z.string()),
})
const LegacyHistoryViewSchema: z.ZodType<LegacyHistoryView> = z.lazy(() => view(LegacyHistoryViewShape(), []))

function projectResult(operation: unknown, value: unknown): unknown {
  if (value === null) return null
  switch (operation) {
    case 'chat': return TurnViewSchema.parse(value)
    case 'source_snapshot': return SourceResultViewSchema.parse(value)
    case 'extract_evidence': case 'reparse': case 'revalidate': return MaintenanceResultViewSchema.parse(value)
    case 'audio': case 'download': return ArtifactResultViewSchema.parse(value)
    case 'create_notebook': return RemoteNotebookResultViewSchema.parse(value)
    default: return unknownValue
  }
}
const resultSchema = z.lazy(() => z.union([
  z.object({ ...TurnViewShape(), projection_status: status }).strict(),
  z.object({ ...SourceResultViewShape(), projection_status: status }).strict(),
  z.object({ ...MaintenanceResultViewShape(), projection_status: status }).strict(),
  z.object({ ...ArtifactResultViewShape(), projection_status: status }).strict(),
  z.object({ ...RemoteNotebookResultViewShape(), projection_status: status }).strict(),
]))
const JobViewSchema: z.ZodType<JobView> = z.lazy(() => z.preprocess(value => {
  if (!isRecord(value)) return value
  return Object.hasOwn(value, 'result') ? { ...value, result: projectResult(value.operation, value.result) } : value
}, view({
  operation: field(z.string()),
  job_id: field(z.string()),
  turn_id: field(z.string()),
  notebook_id: field(z.string()),
  chat_session_id: field(z.string()),
  idempotency_key: field(z.string()),
  state: field(z.string()),
  status: field(z.string()),
  submission_state: field(z.string()),
  restored_history: field(z.boolean()),
  replay_allowed: field(z.boolean()),
  dispatch_receipt: field(DispatchReceiptViewSchema),
  request_snapshot: field(RequestSnapshotViewSchema),
  result: field(resultSchema),
  source_id: field(z.string()),
  source_version_id: field(z.string()),
  extraction_id: field(z.string()),
  provider: field(z.string()),
  remote_task_id: field(z.string()),
  attempts: field(z.number().int().safe()),
  poll_attempts: field(z.number().int().safe()),
  created_at: field(z.string()),
  updated_at: field(z.string()),
  started_at: field(z.string()),
  completed_at: field(z.string()),
  next_poll_at: field(z.string()),
  next_dispatch_at: field(z.string()),
  cancel_requested: field(z.boolean()),
  remote_may_continue: field(z.boolean()),
  error: field(marker),
}, ['worker_job_id', 'request_hash', 'lease_until', 'dispatch_after'])).transform((job): JobView => {
  const receipt = job.dispatch_receipt
  if (receipt === null) return { ...job, projection_status: 'invalid' }
  if (receipt && 'validity' in receipt && receipt.validity === 'valid' &&
    ((job.job_id !== undefined && job.job_id !== receipt.receipt.job_id) || (job.turn_id !== undefined && job.turn_id !== receipt.receipt.turn_id))) {
    return { ...job, projection_status: 'invalid', dispatch_receipt: { validity: 'invalid' } }
  }
  return job
}))
const workspaceSchema: z.ZodType<WorkspaceViewV1> = view({
  schema_version: z.literal('workspace-view-v1'), notebook: NotebookViewSchema,
  sources: z.array(z.union([SourceViewSchema, marker])), notes: z.array(z.union([NoteViewSchema, marker])),
  turns: z.array(z.union([TurnViewSchema, marker])), jobs: z.array(z.union([JobViewSchema, marker])),
  selection: z.union([z.null(), marker, SelectionViewSchema]), link: z.union([z.null(), marker, LinkViewSchema]),
  legacy_history: z.array(z.union([LegacyHistoryViewSchema, marker])),
})
export const parseWorkspaceView = (value: unknown): WorkspaceViewV1 => workspaceSchema.parse(value)
export const parseTurnView = (value: unknown): TurnView => TurnViewSchema.parse(value)
/** Existing job endpoints are legacy by default. Only the versioned endpoint may
 * opt into the projected receipt envelope. Caller format is never inferred from data. */
export function parseJobView(value: unknown, format: ViewInputFormat = 'legacy'): JobView {
  if (format === 'legacy' && isRecord(value) && Object.hasOwn(value, 'dispatch_receipt')) {
    value = { ...value, dispatch_receipt: value.dispatch_receipt === null ? null : parseDispatchReceipt(value.dispatch_receipt) }
  }
  return JobViewSchema.parse(value)
}
export const parseSourceVersionView = (value: unknown): SourceVersionView => SourceVersionViewSchema.parse(value)
const portableSchema = z.object({
  max_archive_bytes: z.number().int().positive().safe(), max_expanded_bytes: z.number().int().positive().safe(),
  max_entity_bytes: z.number().int().positive().safe(), max_manifest_bytes: z.number().int().positive().safe(),
  max_request_bytes: z.number().int().positive().safe(), multipart_overhead_bytes: z.number().int().positive().safe(),
  max_entries: z.number().int().positive().safe(), max_compression_ratio: z.number().int().positive().safe(),
}).strict()
export type PortableLimitsPublic = z.infer<typeof portableSchema>
const capabilitiesSchema = z.object({
  contract_version: z.literal('client-capabilities-v1'), supported_contracts: z.tuple([z.literal('workspace-view-v1')]),
  limits: z.object({ source_upload_max_bytes: z.number().int().nonnegative().safe(), portable: portableSchema }).strict(),
}).strict()
export type ClientCapabilitiesV1 = z.infer<typeof capabilitiesSchema>
export const parseClientCapabilities = (value: unknown): ClientCapabilitiesV1 => capabilitiesSchema.parse(value)
