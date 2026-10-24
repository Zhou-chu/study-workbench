import { describe, expect, it } from 'vitest'
import compatibility from '../../../../contracts/v1/fixtures/workspace-read-compatibility.json'
import { newestSelectableVersionId, projectWorkbenchSelection, projectWorkbenchVersion } from './workbench-read-model'

const valid = { engine: 'independent', selection_origin: 'local', source_version_ids: ['sv_known'], remote_source_ids: [] }

describe('workspace selection read projection', () => {
  it.each(compatibility.selections)('keeps raw $name intact and does not authorize incomplete scopes', ({ name, value }) => {
    const before = structuredClone(value)
    const view = projectWorkbenchSelection(value)
    expect(value).toEqual(before)
    expect(view.supported).toBe(name === 'null_selection' || name === 'opaque_reading')
    expect(Array.isArray(view.source_version_ids)).toBe(true)
    expect(Array.isArray(view.remote_source_ids)).toBe(true)
    if (value !== null) {
      expect(view.engine).toEqual(value.engine)
      expect(view.selection_origin).toEqual(value.selection_origin)
    }
  })
  it('makes a null selection empty rather than all sources', () => {
    expect(projectWorkbenchSelection(null)).toEqual({ engine: 'notebooklm', selection_origin: 'local', source_version_ids: [], remote_source_ids: [], reading: null, supported: true })
    expect(projectWorkbenchSelection(undefined).supported).toBe(false)
  })
  it.each([['sv_known', 9], ['sv_known', ' '], [null]].map(ids => ({ ids })))('does not authorize the valid subset of a malformed ID list: $ids', ({ ids }) => {
    const view = projectWorkbenchSelection({ ...valid, source_version_ids: ids })
    expect(view.source_version_ids).toEqual([])
    expect(view.supported).toBe(false)
  })
  it.each([null, [], {}, { source_version_id: '', page_index: 0 }, { source_version_id: 'sv_known', page_index: -1 }, { source_version_id: 'sv_known', page_index: 0.5 }, { source_version_id: 'sv_known', page_index: Number.MAX_SAFE_INTEGER + 1 }, { source_version_id: 'sv_known', page_index: 0, evidence_id: {} }].map(reading => ({ reading })))('does not invent a reading position from $reading', ({ reading }) => {
    expect(projectWorkbenchSelection({ ...valid, reading }).reading).toBeNull()
  })
  it('copies valid IDs and keeps only validated reading identity and position', () => {
    const raw = { ...valid, reading: { source_version_id: 'sv_known', page_index: 2, evidence_id: 'ev_known', future: true } }
    const view = projectWorkbenchSelection(raw)
    expect(view.reading).toEqual({ source_version_id: 'sv_known', page_index: 2, evidence_id: 'ev_known' })
    view.source_version_ids.push('sv_other')
    expect(raw.source_version_ids).toEqual(['sv_known'])
  })
})

describe('workspace version read projection', () => {
  it('does not manufacture missing IDs, dates or complete source metadata', () => {
    const raw = { source_version_id: null, status: { future: true }, provenance: ['retained'], extension: null }
    const before = structuredClone(raw)
    const view = projectWorkbenchVersion(raw)
    expect(view).toEqual({ source_version_id: null, created_at: null, origin: null, status: null, extraction_status: null, original_status: null, provenance: ['retained'] })
    expect(view).not.toHaveProperty('sha256')
    expect(view).not.toHaveProperty('byte_size')
    expect(raw).toEqual(before)
  })
  it.each([undefined, null, 'invalid', '1', '2026-02-30', '2026-10-24T00:00:00'])('does not use an invalid or timezone-ambiguous date: %s', created_at => {
    expect(projectWorkbenchVersion({ source_version_id: 'sv_known', created_at }).created_at).toBeNull()
  })
  it('orders complete versions by absolute date rather than lexicographic timezone text', () => {
    const views = [{ source_version_id: 'sv_old', created_at: '2026-10-24T09:00:00+02:00' }, { source_version_id: 'sv_new', created_at: '2026-10-24T08:00:00Z' }].map(projectWorkbenchVersion)
    expect(newestSelectableVersionId(views)).toBe('sv_new')
  })
  it.each([
    [{ source_version_id: 'sv_known' }],
    [{ created_at: '2026-10-24' }],
    [{ source_version_id: 'sv_known', created_at: '2026-10-24' }, { source_version_id: 'sv_missing' }],
    [{ source_version_id: 'sv_known', created_at: '2026-10-24' }, { source_version_id: 'sv_other', created_at: '2026-10-24' }],
    [{ source_version_id: 'sv_known', created_at: '2026-10-24' }, { source_version_id: 'sv_known', created_at: '2026-10-23' }],
    [],
  ].map(versions => ({ versions })))('does not guess newest identity from incomplete, duplicate or tied versions: $versions', ({ versions }) => {
    expect(newestSelectableVersionId(versions.map(projectWorkbenchVersion))).toBeNull()
  })
})
