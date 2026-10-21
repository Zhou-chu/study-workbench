import { describe, expect, it } from 'vitest'
import { canonicalCitationLocator, codePointSlice, verifiedQuoteRange } from './evidence'

describe('evidence offsets', () => {
  it('slices the original Unicode codepoints, including astral characters before the quote', () => {
    expect(codePointSlice('😀A𠮷中文B', 2, 5)).toBe('𠮷中文')
  })
  it('does not normalize the original extracted text', () => {
    expect(codePointSlice('x e\u0301 y', 2, 4)).toBe('e\u0301')
  })
  it('only highlights when the exact quote and bounds match', () => {
    expect(verifiedQuoteRange('😀前证据后', 2, 4, '证据')).toEqual({ before: '😀前', quote: '证据', after: '后' })
    expect(verifiedQuoteRange('😀前证据后', 1, 3, '证据')).toBeNull()
    expect(verifiedQuoteRange('abc', -1, 2, 'ab')).toBeNull()
    expect(verifiedQuoteRange('abc', 0, 4, 'abc')).toBeNull()
    expect(verifiedQuoteRange('abc', 0.5, 2, 'ab')).toBeNull()
  })
})


describe('canonical archived subquote location', () => {
  const evidence = { evidence_id: 'ev_old', source_version_id: 'sv_old', extraction_id: 'ex_old', quote: '😀前文证据后文', locator: { block_id: 'page_0001', page_index: 1, start_offset: 2, end_offset: 9 } }
  const citation = { citation_id: 'LOC_a_5', evidence_id: 'ev_old', source_version_id: 'sv_old', kind: 'local_evidence' as const, source_title: 'Archived PDF', quote: '证据', reference_validity: 'unverified', locator: { block_id: 'untrusted', page_index: 0, start_offset: 5, end_offset: 7 } }
  it('uses exact codepoint offsets while replacing imported page/block identity with canonical values', () => {
    expect(canonicalCitationLocator(citation, evidence)).toEqual({ block_id: 'page_0001', page_index: 1, start_offset: 5, end_offset: 7 })
    expect(citation.reference_validity).toBe('unverified')
    expect(citation.locator.page_index).toBe(0)
  })
  it.each([{ evidence_id: 'wrong' }, { source_version_id: 'wrong' }, { quote: '' }])('rejects a mismatched citation identity or empty quote %j', mismatch => {
    expect(canonicalCitationLocator({ ...citation, ...mismatch }, evidence)).toBeNull()
  })
  it.each([{ start_offset: 1, end_offset: 3 }, { start_offset: 8, end_offset: 10 }, { start_offset: 3, end_offset: 5 }, { start_offset: 5.5, end_offset: 7.5 }, { start_offset: undefined, end_offset: undefined }])('rejects unbounded or inexact subquote offsets %j', locator => {
    expect(canonicalCitationLocator({ ...citation, locator }, evidence)).toBeNull()
  })
  it('rejects inconsistent canonical range length instead of guessing a match', () => {
    expect(canonicalCitationLocator(citation, { ...evidence, locator: { ...evidence.locator, end_offset: 10 } })).toBeNull()
  })
})
