import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { AppProviders } from '../../app/providers';
import { ReaderPane } from './ReaderPane';
import { createReaderNavigation } from './navigation';
import { sourceContext } from '../../test/source-fixtures';
import { citation, readerDetail, deferred } from '../../test/reader-fixtures';
import { json } from '../../test/notebook-fixtures';
import { sessionCoordinator } from '@study/web-transport';
function setup(response: Promise<Response> | Response = json(readerDetail()), source = false) { const context = sourceContext(); const nav = createReaderNavigation({ notebookId: 'n', context, generation: sessionCoordinator.current() }); const send = vi.fn(async () => (await response).clone()); const onPositionChange = vi.fn(); const onClose = vi.fn(); const intent = source ? nav.openSource({ source_version_id: 'v-old' }) : nav.openCitation(citation(), { turnId: 't1', focusKey: 'origin' }); const props = { intent, onClose, onPositionChange }; const wrapper = ({ children }: {
    children: React.ReactNode;
}) => <AppProviders locale="en-US" transport={{ send }}>{children}</AppProviders>; const view = render(<ReaderPane {...props}/>, { wrapper }); return { ...view, nav, intent, send, onPositionChange, onClose, props }; }
it('keeps the later manual page over a late citation response without selecting sources', async () => { const d = deferred<Response>(); const h = setup(d.promise); fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '4' } }); await act(async () => d.resolve(json(readerDetail()))); expect(await screen.findByDisplayValue('4')).toBeInTheDocument(); expect(h.onPositionChange).toHaveBeenLastCalledWith({ source_version_id: 'v-old', page_index: 3 }); expect(h.send).toHaveBeenCalledTimes(1); });
it('treats identical c1 labels in different answers as distinct quote and locator intents', async () => { const h = setup(); await screen.findByRole('searchbox'); fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'absent' } }); expect(screen.getByText('No extracted text matches this filter. Clear it to read this document.')).toBeInTheDocument(); const second = h.nav.openCitation(citation('proof', 2), { turnId: 't2', focusKey: 'origin2' }); h.rerender(<ReaderPane {...h.props} intent={second}/>); await waitFor(() => expect(screen.getByRole('searchbox')).toHaveValue('')); expect(second.key).not.toBe(h.intent.key); expect(screen.getByText('proof', { selector: 'blockquote' })).toBeInTheDocument(); });
it('preserves historical unavailable citations without falling back to the latest version', async () => { const h = setup(json({}, 404)); expect(await screen.findByText('This historical version or extraction is unavailable.')).toBeInTheDocument(); expect(screen.getByText('😀 proof', { selector: 'blockquote' })).toBeInTheDocument(); expect(h.send.mock.calls).toHaveLength(1); });
it('highlights exact Unicode codepoints but never upgrades archived validity', async () => { setup(); await waitFor(() => expect(document.querySelector('mark')).toHaveTextContent('😀 proof')); expect(screen.getByText('Reference: unverified')).toBeInTheDocument(); expect(document.body).not.toHaveTextContent('private-provider-error'); expect(document.body).not.toHaveTextContent('/private'); });
it('separates missing original, no extraction, and no search matches', async () => { const d = readerDetail(); d.extraction.text = ''; d.extraction.blocks = []; d.evidence = []; const h = setup(json(d), true); await screen.findByText('Original file is not saved locally'); expect(screen.getByText('No extracted text is available')).toBeInTheDocument(); expect(screen.queryByText('No extracted text matches this filter. Clear it to read this document.')).not.toBeInTheDocument(); expect(h.send).toHaveBeenCalledTimes(1); });
it('closes with Escape and restores the originating message focus without scrolling it', async () => { const origin = document.createElement('button'); origin.id = 'origin'; document.body.append(origin); const focus = vi.spyOn(origin, 'focus'); const h = setup(); await screen.findByDisplayValue('9'); fireEvent.keyDown(screen.getByLabelText('Reader'), { key: 'Escape' }); expect(h.onClose).toHaveBeenCalledOnce(); expect(focus).toHaveBeenCalledWith({ preventScroll: true }); origin.remove(); });
it('retires pending reads on session generation change', async () => { const d = deferred<Response>(); setup(d.promise); sessionCoordinator.begin(); await act(async () => d.resolve(json(readerDetail()))); expect(document.querySelector('mark')).toBeNull(); });
it('does not load the latest extraction for a citation with missing evidence identity', () => { const context = sourceContext(); const nav = createReaderNavigation({ notebookId: 'n', context, generation: sessionCoordinator.current() }); const value = { ...citation(), evidence_id: null }; expect(nav.openCitation(value, { turnId: 'old', focusKey: 'old' }).source_version_id).toBeNull(); });
it('hides already-loaded protected content after session retirement', async () => { const h = setup(); await screen.findByRole('searchbox'); sessionCoordinator.begin(); h.rerender(<ReaderPane {...h.props}/>); expect(document.querySelector('mark')).toBeNull(); expect(screen.getByText('This reader belongs to an earlier session. Open the source again to continue.')).toBeInTheDocument(); });
it('reports an inexact quote instead of silently pretending a location was verified', async () => { const h = setup(); await screen.findByRole('searchbox'); const next = h.nav.openCitation({ ...citation('wrong quote'), locator: { page_index: 2 } }, { turnId: 't3', focusKey: 'origin' }); h.rerender(<ReaderPane {...h.props} intent={next}/>); expect(await screen.findByText('Exact text highlighting could not be verified. The original quote is preserved.')).toBeInTheDocument(); expect(document.querySelector('mark')).toBeNull(); });
it('contains keyboard focus in the narrow fullscreen reader', async () => { vi.mocked(window.matchMedia).mockImplementation(query => ({ matches: query === '(max-width: 899px)', media: query, onchange: null, addListener() { }, removeListener() { }, dispatchEvent() { return true; }, addEventListener() { }, removeEventListener() { } } as MediaQueryList)); setup(); const dialog = await screen.findByRole('dialog', { name: 'Reader' }); expect(dialog).toHaveAttribute('aria-modal', 'true'); await screen.findByRole('searchbox'); const first = screen.getByRole('button', { name: 'Close' }); first.focus(); fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Physical page 9' })); });

it('keeps future citation kinds displayable without making their locator actionable',()=>{const context=sourceContext();const nav=createReaderNavigation({notebookId:'n',context,generation:sessionCoordinator.current()});const value={...citation(),kind:'future_kind'};const intent=nav.openCitation(value,{turnId:'old',focusKey:'old'});expect(intent.citation?.quote).toBe('😀 proof');expect(intent.source_version_id).toBeNull();});

// JSDOM has no layout. Supply only DOM geometry; the real reader must choose
// the verified node and update its own scroll container, never the outer page.
function longTextDetail() {
    const detail = readerDetail();
    detail.extraction.blocks = [
        ...Array.from({ length: 18 }, (_, i) => ({ block_id: `chapter-${i}`, page_index: i === 3 ? 3 : 0, text: `Chapter ${i + 1}` })),
        { block_id: 'b', page_index: 8, text: 'A😀 proofZ' },
        { block_id: 'tail', page_index: 9, text: 'After the cited passage' }
    ];
    return detail;
}
function textGeometry() {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        const scroll = this.closest<HTMLElement>('.reader-scroll');
        const top = this.tagName === 'MARK' ? 3000 : this.classList.contains('reader-block') && this.textContent?.includes('Chapter 4') ? 600 : 0;
        return new DOMRect(0, top - (this === scroll ? 0 : scroll?.scrollTop ?? 0), 100, 20);
    });
}
it('reveals the exact retained passage deep in text once per intent without disturbing later scrolling', async () => {
    textGeometry();
    const h = setup(json(longTextDetail()));
    await screen.findByRole('searchbox');
    const scroll = document.querySelector<HTMLElement>('.reader-scroll')!;
    expect(scroll.scrollTop).toBe(3000);
    expect(document.scrollingElement?.scrollTop ?? 0).toBe(0);
    scroll.scrollTop = 1200;
    h.rerender(<ReaderPane {...h.props}/>);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Chapter' } });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    expect(scroll.scrollTop).toBe(1200);
    expect(h.onPositionChange).not.toHaveBeenCalled();
});
it('reveals a later manual text page instead of a citation when retained detail arrives late', async () => {
    textGeometry();
    const pending = deferred<Response>();
    const h = setup(pending.promise);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '4' } });
    await act(async () => pending.resolve(json(longTextDetail())));
    expect(document.querySelector<HTMLElement>('.reader-scroll')!.scrollTop).toBe(600);
    expect(screen.getByRole('spinbutton')).toHaveValue(4);
    expect(h.onPositionChange).toHaveBeenCalledExactlyOnceWith({ source_version_id: 'v-old', page_index: 3 });
});
it('lets a manual text page replace the revealed passage without reapplying its locator', async () => {
    textGeometry();
    setup(json(longTextDetail()));
    await screen.findByRole('searchbox');
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '4' } });
    expect(document.querySelector<HTMLElement>('.reader-scroll')!.scrollTop).toBe(600);
});

it('defers an unseen text position until the same history reader is shown', async () => {
    textGeometry();
    const context = sourceContext();
    const nav = createReaderNavigation({ notebookId: 'n', context, generation: sessionCoordinator.current() });
    const intent = nav.openCitation(citation(), { turnId: 't1', focusKey: 'origin' });
    const transport = { send: vi.fn(async () => json(longTextDetail())) };
    const tree = (hidden: boolean) => <AppProviders locale="en-US" transport={transport}><div hidden={hidden}><ReaderPane intent={intent} onClose={() => {}} onPositionChange={() => {}}/></div></AppProviders>;
    const h = render(tree(true));
    await waitFor(() => expect(document.querySelector('mark')).toHaveTextContent('😀 proof'));
    const scroll = document.querySelector<HTMLElement>('.reader-scroll')!;
    expect(scroll.scrollTop).toBe(0);
    h.rerender(tree(false));
    expect(scroll.scrollTop).toBe(3000);
    scroll.scrollTop = 1000;
    h.rerender(tree(true));
    h.rerender(tree(false));
    expect(scroll.scrollTop).toBe(1000);
    expect(transport.send).toHaveBeenCalledOnce();
});
