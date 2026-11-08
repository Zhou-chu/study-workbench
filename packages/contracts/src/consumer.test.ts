import { expect, expectTypeOf, it } from 'vitest'
import type { TurnRequest, CreateWorkbenchNoteInput, UpdateWorkbenchNoteInput, WorkbenchNote, SourceSnapshotRequest, SourceSnapshotResult, EvidenceCitation, ScopeSnapshot, OperationReceipt, OperationState } from './index.js'

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
