import { expect, it } from 'vitest'
import type { Workspace } from '@/lib/types/personal'
import { selectedSourceBlockers } from './workbench-readiness'

const sources = (versions: Record<string, unknown>[]): Workspace['sources'] => [{ source_id: 'source:fixture', title: 'Fixture source', versions }]
it.each([null, 'completed', 'queued', 'extracting', 'needs_ocr', 'empty', 'failed', 'unsupported', 'unknown', 'READY', ' ready '])('blocks_every_nonallowlisted_authoritative_status: %s', status => {
  expect(selectedSourceBlockers(['bad'], sources([{ source_version_id: 'bad', status }]))).toEqual([{ versionId: 'bad', title: 'Fixture source', status, reason: 'not-ready' }])
})
it.each(['ready', 'partial'])('allows %s regardless of original availability', status => {
  expect(selectedSourceBlockers(['good'], sources([{ source_version_id: 'good', status, original_status: 'missing' }]))).toEqual([])
})
it('does_not_trust_extraction_fallback', () => {
  const versions = sources([{ source_version_id: 'good', status: 'partial' }, { source_version_id: 'bad', status: 'queued', extraction_status: 'ready' }])
  expect(selectedSourceBlockers(['good', 'bad'], versions).map(item => item.versionId)).toEqual(['bad'])
  expect(selectedSourceBlockers(['bad'], sources([{ source_version_id: 'bad', extraction_status: 'ready' }]))[0]).toMatchObject({ status: null, reason: 'not-ready' })
})
it('blocks_missing_or_duplicate_id', () => {
  expect(selectedSourceBlockers(['gone'], sources([]))[0].reason).toBe('missing')
  expect(selectedSourceBlockers(['gone', 'gone', 'other'], undefined).map(item => item.versionId)).toEqual(['gone', 'other'])
  const duplicateSources = [...sources([{ source_version_id: 'duplicate', status: 'ready' }]), { source_id: 'source:other', title: 'Other', versions: [{ source_version_id: 'duplicate', status: 'ready' }] }]
  expect(selectedSourceBlockers(['duplicate'], duplicateSources)[0].reason).toBe('ambiguous')
})
it('ignores_unselected_versions and preserves distinct selected order', () => {
  const versions = sources([{ source_version_id: 'good', status: 'ready' }, { source_version_id: 'bad', status: 'failed' }])
  expect(selectedSourceBlockers(['good'], versions)).toEqual([])
  expect(selectedSourceBlockers(['gone', 'bad', 'gone'], versions).map(item => item.versionId)).toEqual(['gone', 'bad'])
})
