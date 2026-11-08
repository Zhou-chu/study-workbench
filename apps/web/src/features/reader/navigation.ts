import { parseTurnView, type EvidenceCitationView } from '@study/contracts';
import { canDispatch, freezeDispatchContext, readTurnContext, sessionCoordinator, type DispatchContext } from '@study/web-transport';
import type { CitationOrigin } from '../chat/Message';
import type { SourceReadIntent } from '../sources/source-selection';
import type { ReaderEvidence, ReaderLocator } from '../../data/evidence-api';
export interface ReaderCapture {
    notebookId: string;
    context: DispatchContext;
    generation: number;
}
export type ReaderIntent = Readonly<ReaderCapture & {
    key: string;
    source_version_id: string | null;
    evidence_id: string | null;
    extraction_id: string | null;
    initialPage: number;
    citation: EvidenceCitationView | null;
    origin: CitationOrigin | null;
}>;
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export function readerIsCurrent(intent: ReaderIntent) { return canDispatch(intent.context, readTurnContext()) && intent.generation === sessionCoordinator.current(); }
/** A bound controller supplies notebook, target and generation without global selection inference. */
export function createReaderNavigation(capture: ReaderCapture) {
    const frozen = { ...capture, context: freezeDispatchContext(capture.context) };
    return {
        openCitation(citation: EvidenceCitationView, origin: CitationOrigin): ReaderIntent { const parsed = parseTurnView({ citations: [citation] }).citations; const c = Array.isArray(parsed) ? parsed[0] as EvidenceCitationView : undefined; const valid = c && !c.projection_status && ['local_evidence', 'remote_text_snapshot', 'derived_snapshot'].includes(String(c.kind)) && typeof c.source_version_id === 'string' && !!c.source_version_id && typeof c.evidence_id === 'string' && !!c.evidence_id; return Object.freeze({ ...frozen, key: crypto.randomUUID(), source_version_id: valid && typeof c.source_version_id === 'string' ? c.source_version_id : null, evidence_id: valid && typeof c.evidence_id === 'string' ? c.evidence_id : null, extraction_id: null, initialPage: valid && c.locator && 'page_index' in c.locator && positive(c.locator.page_index) ? c.locator.page_index : 0, citation: c ?? { projection_status: 'invalid' as const }, origin: { ...origin } }); },
        openSource(source: SourceReadIntent, origin: Pick<CitationOrigin, 'focusKey'> | null = null): ReaderIntent { return Object.freeze({ ...frozen, key: crypto.randomUUID(), source_version_id: source.source_version_id || null, evidence_id: source.evidence_id ?? null, extraction_id: null, initialPage: positive(source.page_index) ? source.page_index : 0, citation: null, origin: origin ? { turnId: '', focusKey: origin.focusKey } : null }); }
    };
}
export function restoreReaderFocus(intent: ReaderIntent) { if (intent.origin?.focusKey)
    document.getElementById(intent.origin.focusKey)?.focus({ preventScroll: true }); }
export function verifiedQuoteRange(text: string, start: number, end: number, quote: string) { const points = Array.from(text); if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > points.length || points.slice(start, end).join('') !== quote)
    return null; return { before: points.slice(0, start).join(''), quote, after: points.slice(end).join('') }; }
export function canonicalCitationLocator(c: EvidenceCitationView, e: ReaderEvidence): ReaderLocator | null { if (!c.quote || c.evidence_id !== e.evidence_id || c.source_version_id !== e.source_version_id)
    return null; if (c.quote === e.quote)
    return e.locator; const loc = c.locator && 'start_offset' in c.locator ? c.locator : null; const start = loc?.start_offset, end = loc?.end_offset, a = e.locator.start_offset, b = e.locator.end_offset; if (typeof c.quote !== 'string' || !positive(start) || !positive(end) || !positive(a) || !positive(b) || b - a !== Array.from(e.quote).length || start < a || end > b || !verifiedQuoteRange(e.quote, start - a, end - a, c.quote))
    return null; return { ...e.locator, start_offset: start, end_offset: end }; }
