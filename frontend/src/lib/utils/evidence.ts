import type { EvidenceCitation, EvidenceRecord, Locator } from '@/lib/types/personal'

/** Locator offsets are Unicode code points, never UTF-16 code units. */
export function codePointSlice(text: string, start: number, end: number): string {
  return Array.from(text).slice(start, end).join('')
}

/** Fail closed: normalized or ambiguous quotes must not be highlighted. */
export function verifiedQuoteRange(text: string, start: number, end: number, quote: string) {
  const points = Array.from(text)
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > points.length) return null
  if (points.slice(start, end).join('') !== quote) return null
  return { before: points.slice(0, start).join(''), quote, after: points.slice(end).join('') }
}

/** Resolve archive subquotes only at their exact bounded codepoint offsets.
 * Page/block identity always comes from the retained canonical evidence record.
 * This establishes a display location, not fresh-extraction verification.
 */
export function canonicalCitationLocator(citation: EvidenceCitation, evidence: EvidenceRecord): Locator | null {
  if (!citation.quote || citation.evidence_id !== evidence.evidence_id || citation.source_version_id !== evidence.source_version_id) return null
  if (citation.quote === evidence.quote) return evidence.locator
  const sourceStart = evidence.locator.start_offset
  const sourceEnd = evidence.locator.end_offset
  const start = citation.locator?.start_offset
  const end = citation.locator?.end_offset
  if (typeof sourceStart !== 'number' || typeof sourceEnd !== 'number' || typeof start !== 'number' || typeof end !== 'number') return null
  if (![sourceStart, sourceEnd, start, end].every(Number.isInteger) || sourceStart < 0 || sourceEnd - sourceStart !== Array.from(evidence.quote).length) return null
  if (start < sourceStart || end > sourceEnd || !verifiedQuoteRange(evidence.quote, start - sourceStart, end - sourceStart, citation.quote)) return null
  return { ...evidence.locator, start_offset: start, end_offset: end }
}
