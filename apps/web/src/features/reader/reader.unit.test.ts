import { expect, it } from 'vitest';
import { canonicalCitationLocator, createReaderNavigation, readerIsCurrent, readerIsOwned, verifiedQuoteRange } from './navigation';
import { sourceContext } from '../../test/source-fixtures';
import { citation } from '../../test/reader-fixtures';
import { sessionCoordinator } from '@study/web-transport';
import type { ReaderEvidence } from '../../data/evidence-api';

it('does not load the latest extraction for a citation with missing evidence identity', () => { const context = sourceContext(); const nav = createReaderNavigation({ notebookId: 'n', context, generation: sessionCoordinator.current() }); const value = { ...citation(), evidence_id: null }; expect(nav.openCitation(value, { turnId: 'old', focusKey: 'old' }).source_version_id).toBeNull(); });

it('keeps future citation kinds displayable without making their locator actionable',()=>{const context=sourceContext();const nav=createReaderNavigation({notebookId:'n',context,generation:sessionCoordinator.current()});const value={...citation(),kind:'future_kind'};const intent=nav.openCitation(value,{turnId:'old',focusKey:'old'});expect(intent.citation?.quote).toBe('😀 proof');expect(intent.source_version_id).toBeNull();});

const original: ReaderEvidence = {
    evidence_id: 'e-old', source_version_id: 'v-old', extraction_id: 'x-old',
    quote: 'A😀课Z',
    locator: { block_id: 'source-block', page_index: 8, start_offset: 30, end_offset: 34 },
    reference_validity: 'verified',
};

it('uses Unicode code points rather than UTF-16 positions when highlighting an exact quotation', () => {
    expect(verifiedQuoteRange('前😀课后', 1, 3, '😀课')).toEqual({ before: '前', quote: '😀课', after: '后' });
    expect(verifiedQuoteRange('前😀课后', 1, 4, '😀课')).toBeNull();
});

it.each([[-1, 2], [1.5, 2], [1, 1], [0, 6], [0, 2.5]])(
    'does not highlight invalid quotation boundaries %d through %d',
    (start, end) => expect(verifiedQuoteRange('前😀课后', start, end, '😀')).toBeNull(),
);

it('uses the retained original locator for the whole quotation, not an older projected page', () => {
    expect(canonicalCitationLocator(citation(original.quote, 2), original)).toEqual(original.locator);
    expect(canonicalCitationLocator({ ...citation(original.quote), evidence_id: 'e-new' }, original)).toBeNull();
    expect(canonicalCitationLocator({ ...citation(original.quote), source_version_id: 'v-new' }, original)).toBeNull();
    expect(canonicalCitationLocator(citation(''), original)).toBeNull();
});

it('uses the verified retained page and block for an exact subquote', () => {
    const quoted = {
        ...citation('😀课'), locator: { block_id: 'projected-block', page_index: 2, start_offset: 31, end_offset: 33 },
    };
    expect(canonicalCitationLocator(quoted, original)).toEqual({
        ...original.locator, start_offset: 31, end_offset: 33,
    });
    expect(canonicalCitationLocator({ ...quoted, quote: '😀错' }, original)).toBeNull();
    expect(canonicalCitationLocator({ ...quoted, locator: { ...quoted.locator, end_offset: 35 } }, original)).toBeNull();
    expect(canonicalCitationLocator(
        quoted, { ...original, locator: { ...original.locator, end_offset: 35 } },
    )).toBeNull();
});

it('opens a saved-note citation on its retained page and records the exact note revision', () => {
    const context = sourceContext();
    const nav = createReaderNavigation({ notebookId: 'n', context, generation: sessionCoordinator.current() });
    const origin = { kind: 'note' as const, noteId: 'note:entry', noteRevision: 5, focusKey: 'citation-5' };
    const intent = nav.openNoteCitation(citation(), origin);
    expect(intent).toMatchObject({
        notebookId: 'n', source_version_id: 'v-old', evidence_id: 'e-old', initialPage: 8, origin,
    });
    expect(Object.isFrozen(intent?.origin)).toBe(true);
    expect(nav.openNoteCitation(citation(), { ...origin, noteRevision: 0 })).toBeNull();
    expect(nav.openNoteCitation(citation(), { ...origin, focusKey: ' ' })).toBeNull();
    expect(nav.openNoteCitation(citation(), { ...origin, noteId: '' })).toBeNull();
});

it('keeps a manual source opening separate from evidence and ignores a missing or invalid page', () => {
    const context = sourceContext();
    const nav = createReaderNavigation({ notebookId: 'n', context, generation: sessionCoordinator.current() });
    const withPage = nav.openSource({ source_version_id: 'v-old', page_index: 5 }, { focusKey: 'source-card' });
    expect(withPage).toMatchObject({
        source_version_id: 'v-old', initialPage: 5, citation: null, evidence_id: null,
        origin: { kind: 'source', focusKey: 'source-card' },
    });
    expect(nav.openSource({ source_version_id: 'v-old', page_index: -1, evidence_id: 'e-old' })).toMatchObject({
        source_version_id: 'v-old', evidence_id: 'e-old', initialPage: 0, origin: null,
    });
});

it('invalidates pending reads when refreshing the session generation without hiding already loaded content', () => {
    const context = sourceContext();
    const nav = createReaderNavigation({ notebookId: 'n', context, generation: sessionCoordinator.current() });
    const intent = nav.openSource({ source_version_id: 'v-old' });
    expect(readerIsOwned(intent)).toBe(true);
    expect(readerIsCurrent(intent)).toBe(true);
    sessionCoordinator.begin();
    expect(readerIsOwned(intent)).toBe(true);
    expect(readerIsCurrent(intent)).toBe(false);
    sourceContext();
    expect(readerIsOwned(intent)).toBe(false);
});
