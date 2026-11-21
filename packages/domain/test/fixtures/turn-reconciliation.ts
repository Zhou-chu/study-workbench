import type { TurnCapture } from '../../src/turn-operations.js'

function literalCapture(engine: 'independent' | 'notebooklm', origin: 'local' | 'remote'): TurnCapture {
  const operationId = 'fixture:operation'
  const dto = Object.freeze({
    task: 'question' as const, notebook_id: 'notebook:one', engine, selection_origin: origin,
    source_version_ids: origin === 'local' ? ['version:z', 'version:a', 'version:z'] : [],
    remote_source_ids: origin === 'remote' ? ['remote:z', 'remote:a'] : [],
    remote_notebook_id: engine === 'notebooklm' ? 'remote:notebook' : null,
    message: 'Question', idempotency_key: operationId,
  })
  Object.freeze(dto.source_version_ids)
  Object.freeze(dto.remote_source_ids)
  return Object.freeze({
    operationId, dto, sessionId: 'chat:one', owner: Object.freeze({ mountId: 'mount:one' }),
    context: Object.freeze({ epoch: 1, ready: true, target: Object.freeze({ mode: 'legacy_password' as const, apiBase: 'https://fixture.example/api', protocol: null }) }),
    bytes: new TextEncoder().encode(JSON.stringify(dto)).byteLength,
  })
}

type Row = Record<string, unknown>
/** Shapes follow PersonalService.run_turn, GroundedChatService.turn and NotebookLMService.ask.
 * In particular Google result.job_id belongs to the child, and canonical scope is resolved/sorted. */
export function reconciliationFixture(engine: 'independent' | 'notebooklm' = 'independent', origin: 'local' | 'remote' = 'local') {
  const capture = literalCapture(engine, origin)
  const scope = engine === 'independent' ? {
    engine, selection_origin: 'local', source_version_ids: ['version:a', 'version:z'], remote_source_ids: [], remote_notebook_id: null, mapping_version: 1, scope_hash: 'independent-hash',
  } : {
    engine, selection_origin: origin, source_version_ids: ['version:z', 'version:a'], remote_source_ids: ['remote:z', 'remote:a'], remote_notebook_id: 'remote:notebook', scope_hash: 'google-hash',
    mappings: [{ source_link_id: 'link:z', remote_source_id: 'remote:z', source_version_id: 'version:z', mapping_method: 'upload', last_checked_at: null }, { source_link_id: 'link:a', remote_source_id: 'remote:a', source_version_id: 'version:a', mapping_method: 'upload', last_checked_at: null }],
  }
  const turn: Row = { turn_id: 'turn:one', notebook_id: 'notebook:one', chat_session_id: 'chat:one', engine, message: 'Question', answer: 'Answer [c1]', status: 'succeeded',
    ...(engine === 'independent' ? { idempotency_key: capture.operationId, generation_status: 'succeeded' } : { job_id: 'google:child' }),
    scope_snapshot: scope, evidence_ids: ['evidence:one'], citations: [{
      citation_id: 'c1', kind: 'local_evidence', source_version_id: 'version:a', evidence_id: 'evidence:one', source_title: 'Source',
      locator: { page_index: 0, page_label: null, block_id: 'page_0000', start_offset: 0, end_offset: 5, bbox: null }, quote: 'Quote', reference_validity: 'verified',
      // EvidenceService.validate_citation serializes these nullable fields. Mapped
      // Google references reuse that exact result and attach the remote reference.
      independent_support: null, provenance: null, reason: null,
      remote_reference: engine === 'notebooklm' ? { remote_source_id: 'remote:a', quote: 'Quote', citation_number: 1 } : null,
    }], created_at: '2026-10-26T00:00:00+00:00' }
  const parent: Row = { job_id: 'parent:one', turn_id: 'turn:one', notebook_id: 'notebook:one', operation: 'chat', chat_session_id: 'chat:one', idempotency_key: capture.operationId,
    request_snapshot: { ...capture.dto, model_id: null }, state: 'succeeded', submission_state: 'confirmed', result: structuredClone(turn), attempts: 1 }
  const workspace = { notebook: { id: 'notebook:one', name: 'Notebook' }, jobs: [parent] as unknown[], turns: [turn] }
  const history: unknown[] = [turn]
  return { capture, parent, workspace, history, turn }
}
