import { describe, expect, it } from 'vitest'
import type { TurnReceipt } from './turn-operations.js'
import { reconcileTurn } from './turn-reconciliation.js'
import { reconciliationFixture as fixture } from '../test/fixtures/turn-reconciliation.js'

type Row = Record<string, unknown>
const unknown = (reason?: string) => reason ? { kind: 'unknown', reason } : { kind: 'unknown' }
const boundUnknown = (reason?: string) => ({ kind: 'bound', jobId: 'parent:one', turnId: 'turn:one', state: 'unknown', ...(reason ? { reason } : {}) })
const receipt: TurnReceipt = { jobId: 'parent:one', turnId: 'turn:one' }
function match(f = fixture(), known?: TurnReceipt) { return reconcileTurn(f.capture, f.workspace, f.history, known) }

describe('read-only turn reconciliation', () => {
  it('recovers the persisted independent local scope which omits remote_notebook_id', () => {
    const f = fixture()
    delete (f.turn.scope_snapshot as Row).remote_notebook_id
    delete ((f.parent.result as Row).scope_snapshot as Row).remote_notebook_id
    delete (f.parent.request_snapshot as Row).model_id
    delete (f.parent.request_snapshot as Row).remote_notebook_id
    expect(match(f).kind).toBe('complete')
  })
  it.each(['remote:notebook', '', false, { projection_status: 'unknown' }])('rejects a non-null independent remote notebook %j', value => {
    const f = fixture()
    ;(f.turn.scope_snapshot as Row).remote_notebook_id = value
    ;((f.parent.result as Row).scope_snapshot as Row).remote_notebook_id = value
    expect(match(f).kind).not.toBe('complete')
  })
  it.each(['local', 'remote'] as const)('still requires the Google remote notebook for %s scope', origin => {
    const f = fixture('notebooklm', origin)
    delete (f.turn.scope_snapshot as Row).remote_notebook_id
    delete ((f.parent.result as Row).scope_snapshot as Row).remote_notebook_id
    expect(match(f).kind).not.toBe('complete')
  })

  it.each(['independent', 'notebooklm'] as const)('completes only a bound actual %s parent/result/canonical answer', engine => {
    const f = fixture(engine)
    expect(match(f, receipt)).toEqual({ kind: 'complete', ...receipt, turn: f.turn })
    expect(match(f, receipt)).toHaveProperty('turn', f.turn)
  })
  it.each(['independent', 'notebooklm'] as const)('retains actual null-bearing %s citations on successful completion', engine => {
    const f = fixture(engine)
    const result = match(f, receipt)
    expect(result.kind).toBe('complete')
    if (result.kind !== 'complete') throw new Error('Expected complete answer')
    expect(result.turn.citations[0]).toMatchObject({ independent_support: null, kind: 'local_evidence', evidence_id: 'evidence:one' })
    expect(result.turn.citations[0].remote_reference).toEqual(engine === 'notebooklm' ? { remote_source_id: 'remote:a', quote: 'Quote', citation_number: 1 } : null)
    expect(result.turn.citations).toBe(f.turn.citations)
  })
  it('accepts derived-false metadata without changing its non-independent classification', () => {
    const f = fixture()
    for (const turn of [f.turn, f.parent.result as Row]) Object.assign((turn.citations as Row[])[0], { kind: 'derived_snapshot', independent_support: false })
    const result = match(f)
    expect(result.kind).toBe('complete')
    if (result.kind !== 'complete') throw new Error('Expected complete answer')
    expect(result.turn.citations[0]).toMatchObject({ kind: 'derived_snapshot', independent_support: false })
  })
  it.each([null, false, true])('accepts schema-compatible support metadata %j without upgrading reference validity', support => {
    for (const validity of ['unverified', 'invalid', 'out_of_scope']) {
      const f = fixture()
      for (const turn of [f.turn, f.parent.result as Row]) Object.assign((turn.citations as Row[])[0], { independent_support: support, reference_validity: validity })
      const before = JSON.stringify(f.turn)
      const result = match(f)
      expect(result.kind).toBe('complete')
      if (result.kind !== 'complete') throw new Error('Expected complete answer')
      expect(result.turn.citations[0].independent_support).toBe(support)
      expect(result.turn.citations[0].reference_validity).toBe(validity)
      expect(JSON.stringify(f.turn)).toBe(before)
    }
  })
  it.each(['false', 0, {}, [], undefined])('rejects present malformed support metadata %j even when both records agree', support => {
    const f = fixture()
    for (const turn of [f.turn, f.parent.result as Row]) (turn.citations as Row[])[0].independent_support = support
    expect(match(f)).toMatchObject(boundUnknown('malformed'))
  })
  it.each([false, true, 'omitted'])('requires exact null-versus-%s support metadata agreement', support => {
    const f = fixture()
    const citation = ((f.parent.result as Row).citations as Row[])[0]
    if (support === 'omitted') delete citation.independent_support
    else citation.independent_support = support
    expect(match(f)).toMatchObject(boundUnknown('mismatch'))
  })
  it('retains legacy omission when both records omit support metadata', () => {
    const f = fixture()
    for (const turn of [f.turn, f.parent.result as Row]) delete (turn.citations as Row[])[0].independent_support
    const result = match(f)
    expect(result.kind).toBe('complete')
    if (result.kind !== 'complete') throw new Error('Expected complete answer')
    expect(result.turn.citations[0]).not.toHaveProperty('independent_support')
  })
  it('accepts resolved local versions for a Google remote-origin request without inventing source mappings', () => {
    const f = fixture('notebooklm', 'remote')
    expect(f.capture.dto.source_version_ids).toEqual([])
    expect((f.turn.scope_snapshot as Row).source_version_ids).toEqual(['version:z', 'version:a'])
    expect(match(f, receipt).kind).toBe('complete')
  })
  it('does not confuse the Google child ID in the parent result with the parent job ID', () => {
    const f = fixture('notebooklm'); f.workspace.jobs.push({ job_id: 'google:child', operation: 'ask', idempotency_key: f.capture.operationId, state: 'succeeded' })
    expect(match(f, receipt).kind).toBe('complete')
  })
  it('keeps the same-key Google child alone inconclusive', () => {
    const f = fixture('notebooklm'); f.workspace.jobs = [{ ...f.parent, operation: 'ask', job_id: 'google:child' }]
    expect(match(f)).toEqual(unknown('not-found'))
  })
  it('requires workspace.notebook.id and never substitutes workspace turns for canonical history', () => {
    const f = fixture(); f.workspace.notebook.id = 'other'; expect(match(f)).toMatchObject(unknown('mismatch'))
    const good = fixture(); good.history = []; expect(match(good)).toMatchObject(boundUnknown('answer-unavailable'))
    expect(reconcileTurn(good.capture, good.workspace, null)).toMatchObject(boundUnknown('malformed'))
  })
  it('normalizes only documented request defaults and never array order', () => {
    const f = fixture(); const request = f.parent.request_snapshot as Row
    delete request.model_id; delete request.task; delete request.remote_notebook_id; delete request.remote_source_ids; delete request.selection_origin
    expect(match(f).kind).toBe('complete')
    request.source_version_ids = ['version:a', 'version:z', 'version:z']; expect(match(f)).toMatchObject(unknown('mismatch'))
  })
  it.each([
    ['changed message', { message: 'Other' }], ['changed task', { task: 'outline' }], ['changed model', { model_id: 'different' }], ['invalid model', { model_id: false }],
    ['unexpected reading', { reading: null }], ['unexpected extension', { future: true }], ['invalid array', { remote_source_ids: null }], ['invalid task', { task: 3 }],
    ['unknown engine', { engine: 'future' }], ['invalid key', { idempotency_key: 3 }], ['invalid ID', { source_version_ids: [null] }],
  ])('rejects complete parent request snapshot: %s', (_, patch) => {
    const f = fixture(); Object.assign(f.parent.request_snapshot as Row, patch); expect(match(f)).toMatchObject(unknown())
  })
  it.each(['job_id', 'turn_id', 'notebook_id', 'chat_session_id', 'idempotency_key', 'request_snapshot', 'operation'])('does not filter away a parent candidate missing %s', field => {
    const f = fixture(); delete f.parent[field]; expect(match(f)).toMatchObject(unknown())
  })
  it.each(['job_id', 'turn_id', 'notebook_id', 'chat_session_id', 'idempotency_key'])('rejects conflicting parent %s against captured identity/receipt', field => {
    const f = fixture(); f.parent[field] = 'other'; expect(match(f, receipt)).toMatchObject(unknown())
  })
  it.each([{}, { message: 'different' }, { model_id: 'different' }])('never collapses duplicate same-key parents, including mismatched bodies %j', patch => {
    const f = fixture(); f.workspace.jobs.push({ ...f.parent, job_id: 'duplicate', request_snapshot: { ...(f.parent.request_snapshot as Row), ...patch } }); expect(match(f)).toMatchObject(unknown('ambiguous'))
  })
  it.each(['job_id', 'turn_id'])('does not filter a different-key live row colliding with discovered parent %s', identity => {
    const f = fixture(); f.workspace.jobs.push({ ...f.parent, idempotency_key: 'different', request_snapshot: { ...(f.parent.request_snapshot as Row), idempotency_key: 'different' }, job_id: 'other', turn_id: 'other', [identity]: f.parent[identity] })
    expect(match(f)).toMatchObject(unknown())
  })
  it('rejects a same-ID child masquerading as a second record for the discovered parent', () => {
    const f = fixture(); f.workspace.jobs.push({ operation: 'ask', job_id: f.parent.job_id, idempotency_key: 'different' })
    expect(match(f)).toMatchObject(unknown())
  })
  it.each([{ restored_history: true }, { replay_allowed: false }])('excludes archived/replay-prohibited parents %j', flags => {
    const f = fixture(); Object.assign(f.parent, flags); expect(match(f)).toEqual(unknown('not-found'))
    const good = fixture(); good.workspace.jobs.push({ ...good.parent, ...flags }); expect(match(good).kind).toBe('complete')
  })
  it.each([{ restored_history: null }, { restored_history: 'false' }, { replay_allowed: null }, { replay_allowed: 'true' }, { operation: 'future' }])('malformed candidate markers cannot be filtered away %j', flags => {
    const f = fixture(); f.workspace.jobs.push({ ...f.parent, ...flags }); expect(match(f)).toMatchObject(unknown())
  })
  it('accepts explicit live markers and ignores provably unrelated jobs', () => {
    const f = fixture(); Object.assign(f.parent, { restored_history: false, replay_allowed: true }); f.workspace.jobs.push({ operation: 'chat', idempotency_key: 'different', job_id: 'different' }, { operation: 'audio', state: 'running' })
    expect(match(f).kind).toBe('complete')
  })
  it.each(['queued', 'running', 'waiting_remote', 'failed', 'needs_reauth', 'submission_unknown', 'cancelled_local', 'future', null, undefined])('never completes parent state %s despite succeeded answer', state => {
    const f = fixture(); f.parent.state = state; expect(match(f).kind).not.toBe('complete')
  })
  it.each(['not_submitted', 'unknown', 'future', null, undefined])('requires confirmed parent submission, not %s', state => {
    const f = fixture(); f.parent.submission_state = state; expect(match(f)).toMatchObject(boundUnknown('unconfirmed'))
  })
  it.each(['failed', 'future', null])('rejects contradictory parent status %s', status => {
    const f = fixture(); f.parent.status = status; expect(match(f)).toMatchObject(unknown())
  })
  it.each([null, false, { dispatch_ack: 'unknown', job_id: 'parent:one', turn_id: 'turn:one', retry_safe: true }, { dispatch_ack: 'future', job_id: 'parent:one', turn_id: 'turn:one', retry_safe: false }, { dispatch_ack: 'unknown', job_id: 'other', turn_id: 'turn:one', retry_safe: false }])('does not let malformed/historical receipt evidence authorize completion %j', dispatch_receipt => {
    const f = fixture(); f.parent.dispatch_receipt = dispatch_receipt; expect(match(f)).toMatchObject(unknown())
  })
  it('can complete after a valid dispatch-unknown receipt when actual confirmed answer evidence exists', () => {
    const f = fixture(); f.parent.dispatch_receipt = { dispatch_ack: 'unknown', job_id: receipt.jobId, turn_id: receipt.turnId, retry_safe: false }; expect(match(f).kind).toBe('complete')
  })
  it.each(['turn_id', 'notebook_id', 'chat_session_id', 'engine', 'message', 'idempotency_key'])('requires canonical history identity %s', field => {
    const f = fixture(); f.turn[field] = 'other'; expect(match(f)).toMatchObject(boundUnknown())
  })
  it('requires independent history key but accepts Google omission and rejects a present mismatching Google key', () => {
    const f = fixture(); delete f.turn.idempotency_key; expect(match(f)).toMatchObject(boundUnknown())
    const google = fixture('notebooklm'); google.turn.idempotency_key = 'other'; expect(match(google)).toMatchObject(boundUnknown())
  })
  it('does not filter away an unidentifiable malformed canonical row beside a valid answer', () => {
    const f = fixture(); const duplicate = { ...f.turn }; delete duplicate.turn_id; delete duplicate.idempotency_key; f.history.push(duplicate)
    expect(match(f)).toMatchObject(boundUnknown('malformed'))
  })
  it.each([false, true])('never deduplicates canonical rows (contradictory=%s)', contradictory => {
    const f = fixture(); f.history.push({ ...f.turn, ...(contradictory ? { answer: 'different', status: 'failed' } : {}) }); expect(match(f)).toEqual(boundUnknown('ambiguous'))
  })
  it.each(['result missing', 'result status', 'result state', 'result turn', 'result answer', 'result scope', 'result citations', 'canonical status', 'canonical state', 'canonical generation', 'canonical answer', 'canonical scope', 'canonical citations'])('requires well-typed consistent completion: %s', failure => {
    const f = fixture(); const result = f.parent.result as Row
    switch (failure) {
      case 'result missing': delete f.parent.result; break
      case 'result status': delete result.status; break
      case 'result state': result.state = 'failed'; break
      case 'result turn': result.turn_id = 'different'; break
      case 'result answer': result.answer = 'different'; break
      case 'result scope': result.scope_snapshot = { source_version_ids: [] }; break
      case 'result citations': result.citations = []; break
      case 'canonical status': delete f.turn.status; break
      case 'canonical state': f.turn.state = 'failed'; break
      case 'canonical generation': f.turn.generation_status = 'failed'; break
      case 'canonical answer': f.turn.answer = ''; break
      case 'canonical scope': f.turn.scope_snapshot = null; break
      case 'canonical citations': f.turn.citations = null; break
    }
    expect(match(f)).toMatchObject(boundUnknown())
  })
  it.each([null, '', '  ', 7])('missing/non-string answer %j is read recovery only, never completion', answer => {
    const f = fixture(); f.turn.answer = answer; (f.parent.result as Row).answer = answer
    expect(match(f)).toMatchObject(boundUnknown('answer-unavailable'))
  })
  it.each([
    { citations: [null] }, { citations: [{ citation_id: 'c1' }] },
    { scope_snapshot: { engine: 'independent', selection_origin: 'local', source_version_ids: [3], remote_source_ids: [], remote_notebook_id: null } },
    { scope_snapshot: { engine: 'future', selection_origin: 'local', source_version_ids: [], remote_source_ids: [], remote_notebook_id: null } },
  ])('equal malformed result/canonical fields still cannot prove completion %j', patch => {
    const f = fixture(); Object.assign(f.turn, patch); Object.assign(f.parent.result as Row, structuredClone(patch)); expect(match(f)).toMatchObject(boundUnknown())
  })
  it('compares full scope/citation content without depending on object key insertion order', () => {
    const f = fixture(); const result = f.parent.result as Row
    result.scope_snapshot = Object.fromEntries(Object.entries(result.scope_snapshot as Row).reverse())
    expect(match(f).kind).toBe('complete')
    ;(result.scope_snapshot as Row).scope_hash = 'other'; expect(match(f)).toMatchObject(boundUnknown('mismatch'))
  })
  it('does not mutate capture or raw workspace/history during reconciliation', () => {
    const f = fixture(); const before = JSON.stringify(f); match(f, receipt); expect(JSON.stringify(f)).toBe(before)
  })
})

it('requires modern recovered answer disclosure to match the exact captured request and parent result', () => {
  const f = fixture()
  const fields = { retrieval_mode: 'hybrid' as const, embedding_profile_id: 'profile:old', acknowledge_query_processing: true, disclosed_profile_fingerprint: 'old-fingerprint', destination_descriptor_version: 'd1' }
  const capture = { ...f.capture, dto: Object.freeze({ ...f.capture.dto, ...fields }) }
  f.parent.request_snapshot = { ...capture.dto, model_id: null }
  f.turn.retrieval_request = { ...fields }
  f.parent.result = structuredClone(f.turn)
  expect(reconcileTurn(capture, f.workspace, f.history, receipt).kind).toBe('complete')
  f.turn.retrieval_request = { ...fields, disclosed_profile_fingerprint: 'rotated' }
  expect(reconcileTurn(capture, f.workspace, f.history, receipt)).toEqual(boundUnknown('mismatch'))
})
it('does not accept missing pinned disclosure on a modern completed result', () => {
  const f = fixture()
  const capture = { ...f.capture, dto: Object.freeze({ ...f.capture.dto, retrieval_mode: 'lexical' as const }) }
  f.parent.request_snapshot = { ...capture.dto, model_id: null }
  expect(reconcileTurn(capture, f.workspace, f.history, receipt)).toEqual(boundUnknown('mismatch'))
})

it('retains actual NotebookLM result compatibility: explicit lexical request fields exist only in its parent snapshot', () => {
  const f = fixture('notebooklm')
  const capture = { ...f.capture, dto: Object.freeze({ ...f.capture.dto, retrieval_mode: 'lexical' as const }) }
  f.parent.request_snapshot = { ...capture.dto, model_id: null }
  expect(f.turn).not.toHaveProperty('retrieval_request')
  expect(reconcileTurn(capture, f.workspace, f.history, receipt).kind).toBe('complete')
})
