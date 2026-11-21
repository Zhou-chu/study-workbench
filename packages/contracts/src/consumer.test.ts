import { expect, expectTypeOf, it } from 'vitest'
import type { TurnRequest, CreateWorkbenchNoteInput, UpdateWorkbenchNoteInput, WorkbenchNote, SourceSnapshotRequest, SourceSnapshotResult, EvidenceCitation, SourceProvenance, ScopeSnapshot, OperationReceipt, OperationState, NoteView, LegacyMessageView, NonActionableValue } from './index.js'

it('exports the existing turn/note/snapshot write DTO dependency closure', () => {
  const scope: ScopeSnapshot = { source_version_ids: ['synthetic-version'] }
  const citation: EvidenceCitation = { citation_id: 'c1', kind: 'remote_unmapped', source_version_id: null, evidence_id: null, source_title: null, quote: 'Synthetic', reference_validity: 'unverified', independent_support: null }
  const turn: TurnRequest = { notebook_id: 'notebook:synthetic', engine: 'independent', message: 'Synthetic', selection_origin: 'local', source_version_ids: [], remote_source_ids: [], idempotency_key: 'synthetic', task: 'question', retrieval_mode: 'hybrid', embedding_profile_id: 'synthetic-profile', acknowledge_query_processing: true, disclosed_profile_fingerprint: 'synthetic-fingerprint', destination_descriptor_version: 'v1' }
  const create: CreateWorkbenchNoteInput = { title: 'Synthetic', content: 'Synthetic', citations: [citation], scope_snapshot: scope }
  const update: UpdateWorkbenchNoteInput = { ...create, expected_revision: 2 }
  const note: WorkbenchNote = { id: 'note:synthetic', revision: 2, title: null, content: null }
  const snapshot: SourceSnapshotRequest = { origin_kind: 'note', note_id: note.id, expected_revision: note.revision, idempotency_key: 'synthetic' }
  const handle: OperationReceipt = { job_id: 'synthetic' }
  const state: OperationState = 'unknown'
  expectTypeOf<SourceSnapshotResult['provenance']['scope_snapshot']>().toEqualTypeOf<ScopeSnapshot>()
  expectTypeOf(update.expected_revision).toEqualTypeOf<number>()
  expect([turn.task, snapshot.origin_kind, handle.job_id, state]).toEqual(['question', 'note', 'synthetic', 'unknown'])
  // @ts-expect-error Read-only note views are not conditional-update DTOs.
  const invalidUpdate: UpdateWorkbenchNoteInput = note
  expect(invalidUpdate).toBe(note)
})

it('exports producer-compatible public note and historical message metadata', () => {
  const note: NoteView = { id: 'note:synthetic', note_type: 'ai' }
  const message: LegacyMessageView = { id: 'message:synthetic', type: 'human', content: 'Synthetic', timestamp: null }
  expectTypeOf<NoteView['note_type']>().toEqualTypeOf<string | null | NonActionableValue | undefined>()
  expectTypeOf<LegacyMessageView['id']>().toEqualTypeOf<string | null | NonActionableValue | undefined>()
  expectTypeOf<LegacyMessageView['type']>().toEqualTypeOf<string | null | NonActionableValue | undefined>()
  expectTypeOf<LegacyMessageView['timestamp']>().toEqualTypeOf<string | null | NonActionableValue | undefined>()
  expect([note.note_type, message.type, message.timestamp]).toEqual(['ai', 'human', null])
})

it('types producer-nullable citation metadata and retained mapping provenance without loose objects', () => {
  const citation: EvidenceCitation = { citation_id:'c1',kind:'local_evidence',source_version_id:'v',evidence_id:'e',source_title:'Synthetic',quote:'Quote',reference_validity:'unverified',provenance:null,reason:'Restored archive evidence',independent_support:null }
  const mapping: NonNullable<ScopeSnapshot['mappings']>[number] = {source_link_id:null,remote_source_id:'remote',source_version_id:null,mapping_method:null,last_checked_at:null}
  const scope: ScopeSnapshot = {source_version_ids:[],mappings:[mapping]}
  expectTypeOf<EvidenceCitation['provenance']>().toEqualTypeOf<SourceProvenance | null | undefined>()
  expectTypeOf<EvidenceCitation['reason']>().toEqualTypeOf<string | null | undefined>()
  expect(scope.mappings?.[0]).toEqual(mapping)
  // @ts-expect-error Unknown reason structures are not valid citation metadata.
  const invalid: EvidenceCitation = {...citation,reason:{projection_status:'unknown'}}
  expect(invalid.reason).toEqual({projection_status:'unknown'})
})
