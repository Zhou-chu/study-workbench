import { describe, expect, it } from 'vitest'
import { readTurnPostOutcome } from './operation.js'
import { parseDispatchReceipt, parseJobView, parseSourceVersionView, parseTurnView } from './workspace-view.js'

const receipt = { dispatch_ack: 'unknown', job_id: 'job', turn_id: 'turn', retry_safe: false }
const bound = { kind: 'bound', jobId: 'job', turnId: 'turn', dispatchUnknown: false }
const rejected = { kind: 'unknown', reason: 'receipt' }

describe('raw turn POST boundaries', () => {
  it.each(['queued', 'running', 'waiting_remote', 'succeeded', 'failed', 'needs_reauth', 'submission_unknown', 'cancelled_local'])('retains observed state %s without inferring success', state => {
    expect(readTurnPostOutcome(202, { job_id: 'job', turn_id: 'turn', state })).toEqual({ ...bound, state })
  })
  it.each([null, undefined, [], 'response', 123])('rejects a non-record response %j', body => {
    expect(readTurnPostOutcome(200, body)).toEqual(rejected)
  })
  it.each([{ job_id: '', turn_id: 'turn' }, { job_id: 'job', turn_id: ' ' }, { job_id: 1, turn_id: 'turn' }])('rejects missing or blank identities %j', body => {
    expect(readTurnPostOutcome(200, body)).toEqual(rejected)
  })
  it.each([199, 300, 401, 500])('does not bind non-success status %s to a valid-looking handle', status => {
    expect(readTurnPostOutcome(status, { job_id: 'job', turn_id: 'turn' })).toEqual({ kind: 'unknown', reason: 'transport' })
  })
  it.each([null, {}, { validity: 'valid', receipt }, { ...receipt, turn_id: 'other' }, { ...receipt, job_id: 'other' }])('rejects invalid or conflicting POST dispatch evidence %j', dispatch_receipt => {
    expect(readTurnPostOutcome(200, { job_id: 'job', turn_id: 'turn', dispatch_receipt })).toEqual(rejected)
  })
  it.each([null, {}, { validity: 'valid', receipt }])('rejects worker-unavailable without raw exact evidence %j', dispatch_receipt => {
    expect(readTurnPostOutcome(400, { detail: 'WORKER_UNAVAILABLE', dispatch_receipt })).toEqual(rejected)
  })
  it('checks sibling turn identity on worker-unavailable and existing local bindings', () => {
    expect(readTurnPostOutcome(400, { detail: 'WORKER_UNAVAILABLE', turn_id: 'other', dispatch_receipt: receipt })).toEqual(rejected)
    expect(readTurnPostOutcome(400, { detail: 'WORKER_UNAVAILABLE', job_id: 'job', turn_id: 'turn', dispatch_receipt: receipt }, { jobId: 'job', turnId: 'turn' })).toEqual({ ...bound, state: 'unknown', dispatchUnknown: true })
    expect(readTurnPostOutcome(200, { job_id: 'job', turn_id: 'turn' }, { jobId: 'job', turnId: 'other' })).toEqual({ kind: 'unknown', reason: 'conflict' })
  })
})

describe('projection boundary values', () => {
  it.each([null, [], 7, 'receipt'])('marks non-record dispatch evidence invalid %j', value => {
    expect(parseDispatchReceipt(value)).toEqual({ validity: 'invalid' })
  })
  it.each([{ validity: 'valid' }, { validity: 'future' }, { validity: 'valid', receipt: {} }, { validity: 'valid', receipt: { ...receipt, turn_id: ' ' } }, { validity: 'unknown', extra: true }])('does not upgrade malformed projected envelopes %j', value => {
    expect(parseDispatchReceipt(value, 'workspace-view-v1')).toEqual({ validity: 'invalid' })
  })
  it('retains unknown provenance as non-actionable and recognizes web provenance', () => {
    expect(parseSourceVersionView({ provenance: { kind: 'future', secret: 'omitted' } })).toEqual({ provenance: { projection_status: 'unknown' }, projection_status: 'unknown' })
    expect(parseSourceVersionView({ provenance: { kind: 'web', provider: 'firecrawl', source_url: null } })).toEqual({ provenance: { kind: 'web', provider: 'firecrawl', source_url: null } })
    expect(parseSourceVersionView({ provenance: { projection_status: 'invalid' } })).toEqual({ provenance: { projection_status: 'invalid' }, projection_status: 'invalid' })
  })
  it('retains scope mapping metadata and rejects malformed nested values', () => {
    const scope_snapshot = { mappings: [{ source_link_id: 'link', remote_source_id: 'remote', source_version_id: 'version', mapping_method: null, last_checked_at: null }] }
    expect(parseTurnView({ scope_snapshot })).toEqual({ scope_snapshot })
    expect(parseTurnView({ scope_snapshot: { mappings: [{ mapping_method: 8 }] } })).toMatchObject({ projection_status: 'invalid', scope_snapshot: { projection_status: 'invalid', mappings: [{ mapping_method: { projection_status: 'invalid' } }] } })
  })
  it.each(['extract_evidence', 'reparse', 'revalidate'])('projects maintenance result %s without internal fields', operation => {
    const result = { success: true, warnings: [], source_version_id: 'version', extraction_id: 'extract', fresh_extraction_id: null, status: 'ready', evidence_count: 0, checked_count: 2, verified_count: 1, unverified_count: 1 }
    expect(parseJobView({ operation, result })).toEqual({ operation, result })
    expect(parseJobView({ operation, result: { evidence_count: 0.5 } })).toMatchObject({ projection_status: 'invalid', result: { evidence_count: { projection_status: 'invalid' } } })
  })
  it.each(['audio', 'download'])('projects artifact result %s and redacts internal paths and errors', operation => {
    expect(parseJobView({ operation, result: { remote_artifact_id: 'remote', downloaded: false, artifact: { artifact_id: 'artifact', title: 'Audio', file_path: '/private/file', path: '/private' }, download_error: { secret: 'credential' } } })).toEqual({ operation, projection_status: 'unknown', result: { remote_artifact_id: 'remote', downloaded: false, artifact: { artifact_id: 'artifact', title: 'Audio' }, download_error: { projection_status: 'unknown' }, projection_status: 'unknown' } })
  })
  it('projects source snapshot and remote notebook results by operation rather than arbitrary payload shape', () => {
    expect(parseJobView({ operation: 'source_snapshot', result: { source_id: 'source', source_version_id: 'version', existing: false, embedding_status: 'not_requested' } })).toEqual({ operation: 'source_snapshot', result: { source_id: 'source', source_version_id: 'version', existing: false, embedding_status: 'not_requested' } })
    expect(parseJobView({ operation: 'create_notebook', result: { remote_notebook_id: 'remote' } })).toEqual({ operation: 'create_notebook', result: { remote_notebook_id: 'remote' } })
    expect(parseJobView({ operation: 'future', result: { remote_notebook_id: 'remote' } })).toEqual({ operation: 'future', result: { projection_status: 'unknown' }, projection_status: 'unknown' })
  })
})
