import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { parseWorkspaceView, parseJobView, parseTurnView, parseSourceVersionView, parseClientCapabilities, readTurnPostOutcome } from './index.js'
const fixture = JSON.parse(readFileSync(new URL('../../../contracts/v1/fixtures/workspace-view-v1.json', import.meta.url), 'utf8'))
describe('public view', () => {
  it('preserves_unknown_fields_as_non_actionable_values', () => {
    const view = parseWorkspaceView(fixture.workspace_view)
    expect(view).toEqual(fixture.workspace_view)
    const job = parseJobView({ ...fixture.raw_workspace.jobs[0], request_snapshot: { ...fixture.raw_workspace.jobs[0].request_snapshot, future: 'synthetic-secret' } })
    expect(job.projection_status).toBe('unknown')
    expect(job.request_snapshot).toMatchObject({ projection_status: 'unknown' })
    expect(JSON.stringify(job)).not.toContain('synthetic-secret')
    expect(parseSourceVersionView({ origin: 'future-origin' })).toEqual({ origin: 'future-origin' })
    expect(parseTurnView({ turn_id: 'turn', generation_status: 'failed' })).toMatchObject({ generation_status: 'failed' })
  })
  it('never upgrades malformed or future dispatch evidence', () => {
    for (const receipt of [null, {}, { dispatch_ack: 'unknown', job_id: 'parent', turn_id: 'turn', retry_safe: false, extra: true }, { dispatch_ack: 'unknown', job_id: 'other', turn_id: 'turn', retry_safe: false }]) {
      const job = parseJobView({ ...fixture.raw_workspace.jobs[0], dispatch_receipt: receipt })
      expect(job.projection_status).toBeDefined()
    }
  })
  it('retains HTTP outcome separately from a generic handle', () => {
    const receipt = { dispatch_ack: 'unknown', job_id: 'parent', turn_id: 'turn', retry_safe: false }
    expect(readTurnPostOutcome(200, { job_id: 'parent', turn_id: 'turn', state: 'future' })).toEqual({ kind: 'bound', jobId: 'parent', turnId: 'turn', state: 'unknown', dispatchUnknown: false })
    expect(readTurnPostOutcome(400, { detail: 'WORKER_UNAVAILABLE', dispatch_receipt: receipt })).toMatchObject({ kind: 'bound', dispatchUnknown: true })
    expect(readTurnPostOutcome(400, { detail: 'OTHER', dispatch_receipt: receipt })).toEqual({ kind: 'unknown', reason: 'transport' })
    expect(readTurnPostOutcome(200, { job_id: 'parent', turn_id: 'turn', dispatch_receipt: { ...receipt, extra: true } })).toEqual({ kind: 'unknown', reason: 'receipt' })
    expect(readTurnPostOutcome(200, { job_id: 'parent', turn_id: 'turn' }, { jobId: 'other', turnId: 'turn' })).toEqual({ kind: 'unknown', reason: 'conflict' })
  })
  it('requires actual API capabilities and supported version', () => {
    expect(() => parseWorkspaceView({})).toThrow()
    expect(() => parseClientCapabilities({})).toThrow()
    expect(() => parseClientCapabilities({ contract_version: 'future' })).toThrow()
  })
})

it('keeps null and exact IDs without normalization and cannot clear issue markers', () => {
  const receipt = { dispatch_ack: 'unknown', job_id: ' parent ', turn_id: ' turn ', retry_safe: false }
  expect(readTurnPostOutcome(200, { job_id: ' parent ', turn_id: ' turn ', dispatch_receipt: receipt })).toMatchObject({ kind: 'bound', jobId: ' parent ', turnId: ' turn ' })
  const job = parseJobView({ ...fixture.raw_workspace.jobs[0], request_snapshot: { ...fixture.raw_workspace.jobs[0].request_snapshot, future: true, projection_status: null } })
  expect(job.projection_status).toBe('unknown')
  expect(parseJobView({ result: null }).result).toBeNull()
})

it('does not bind HTTP400 to conflicting sibling identities', () => {
  const receipt = { dispatch_ack: 'unknown', job_id: 'parent', turn_id: 'turn', retry_safe: false }
  expect(readTurnPostOutcome(400, { detail: 'WORKER_UNAVAILABLE', job_id: 'other', dispatch_receipt: receipt })).toEqual({ kind: 'unknown', reason: 'receipt' })
})

it.each(z.array(z.object({ name: z.string(), raw_job: z.unknown(), job_view: z.unknown(), non_actionable: z.boolean() })).parse(fixture.recovery_jobs))('preserves Python recovery wire: $name', (testCase) => {
  expect(parseJobView(testCase.job_view, 'workspace-view-v1')).toEqual(testCase.job_view)
  expect(parseJobView(testCase.raw_job)).toEqual(testCase.job_view)
  if (testCase.non_actionable) expect(parseJobView(testCase.job_view, 'workspace-view-v1').projection_status).toBeDefined()
})

it('keeps collisions, malformed neighbors and canonical proof disagreements visible', () => {
  const raw = structuredClone(fixture.workspace_view)
  raw.jobs.push({ job_id: 'parent', idempotency_key: 'other' }, null)
  raw.turns.push({ turn_id: 'turn', generation_status: 'failed' }, null)
  const view = parseWorkspaceView(raw)
  expect(view.jobs).toHaveLength(3)
  expect(view.jobs[1]).toMatchObject({ job_id: 'parent', idempotency_key: 'other' })
  expect(view.jobs[2]).toEqual({ projection_status: 'invalid' })
  expect(view.turns).toHaveLength(3)
  expect(view.turns[1]).toMatchObject({ turn_id: 'turn', generation_status: 'failed' })
  expect(view.turns[2]).toEqual({ projection_status: 'invalid' })
})

it('does not trust a projected validity wrapper stored in a legacy raw receipt', () => {
  const job = parseJobView({ ...fixture.raw_workspace.jobs[0], dispatch_receipt: fixture.workspace_view.jobs[0].dispatch_receipt })
  expect(job.projection_status).toBe('unknown')
  expect(job.dispatch_receipt).toEqual({ validity: 'unknown' })
})

it('does not treat a retained null projection marker as known request evidence', () => {
  const job = parseJobView({ ...fixture.raw_workspace.jobs[0], request_snapshot: { ...fixture.raw_workspace.jobs[0].request_snapshot, projection_status: null } })
  expect(job.projection_status).toBe('unknown')
})

it('keeps actual grounded turn public metadata and scope mapping version', () => {
  const turn = parseTurnView({ ...fixture.raw_workspace.turns[0], scope_hash: 'synthetic-scope', request_hash: 'internal-hash', model_id: 'model:synthetic', pipeline_version: '1', grounding_status: 'references_verified', usage: { private: 'usage' }, scope_snapshot: { ...fixture.raw_workspace.turns[0].scope_snapshot, mapping_version: 1 }, budget: { context_tokens: 8192, output_tokens: 2048, estimated_input_tokens: 1000, estimator: 'utf8_byte_upper_bound', retrieved_evidence_count: 2, included_evidence_count: 2 } })
  expect(turn.projection_status).toBeUndefined()
  expect(turn).toMatchObject({ grounding_status: 'references_verified', scope_snapshot: { mapping_version: 1 } })
  expect(JSON.stringify(turn)).not.toContain('internal-hash')
})
