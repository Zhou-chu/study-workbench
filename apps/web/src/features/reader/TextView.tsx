import { useLayoutEffect, useRef } from 'react';
import type { ReaderBlock, ReaderLocator } from '../../data/evidence-api';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { verifiedQuoteRange } from './navigation';

/** Each object is one explicit navigation request, owned by the reader intent. */
export type TextPosition = Readonly<{ kind: 'locator' } | { kind: 'page'; page: number }>;

export function TextView({ blocks, search, onSearchChange, locator, quote, onPage, position }: {
    blocks: ReaderBlock[];
    search: string;
    onSearchChange: (v: string) => void;
    locator: ReaderLocator | null;
    quote: string | null;
    onPage: (v: number) => void;
    position: TextPosition | null;
}) {
    const { t } = useI18n();
    const root = useRef<HTMLDivElement>(null);
    const revealed = useRef<TextPosition | null>(null);
    const filtered = blocks.filter(b => !search || b.text.toLocaleLowerCase().includes(search.toLocaleLowerCase()));

    useLayoutEffect(() => {
        if (!position || revealed.current === position || !blocks.length || root.current?.closest('[hidden]')) return;
        // Settle once before paint. Rerenders, filters and a late retry cannot
        // reclaim the scroll position after the user has started reading.
        revealed.current = position;
        const block = position.kind === 'locator'
            ? blocks.find(b => b.block_id === locator?.block_id)
            : blocks.find(b => b.page_index === position.page);
        if (!block || !root.current) return;
        const node = Array.from(root.current.querySelectorAll<HTMLElement>('[data-reader-block]'))
            .find(element => element.dataset.readerBlock === block.block_id);
        // For a quote, only the exact codepoint-verified mark is a target.
        const target = position.kind === 'locator' && quote ? node?.querySelector('mark') : node;
        const scroll = root.current.closest<HTMLElement>('.reader-scroll');
        if (target && scroll) {
            scroll.scrollTop = Math.max(0, scroll.scrollTop + target.getBoundingClientRect().top - scroll.getBoundingClientRect().top);
        }
    }); // Also recheck an unconsumed request when history makes this reader visible.

    return <div className="reader-text-view" ref={root}>
        <div className="reader-controls">
            <label>{t.workbench.searchEvidence}<input type="search" value={search} onChange={e => onSearchChange(e.target.value)}/></label>
            {search && <Button onClick={() => onSearchChange('')}>{t.workbench.clearReaderSearch}</Button>}
        </div>
        {filtered.length ? filtered.map(block => {
            const range = quote && block.block_id === locator?.block_id && typeof locator.start_offset === 'number' && typeof locator.end_offset === 'number'
                ? verifiedQuoteRange(block.text, locator.start_offset, locator.end_offset, quote) : null;
            return <div className="reader-block" data-reader-block={block.block_id} key={block.block_id}>
                {block.page_index !== null && <Button onClick={() => onPage(block.page_index!)}>{t.workbench.physicalPage.replace('{{page}}', String(block.page_index + 1))}</Button>}
                <pre className="reader-text">{range ? <>{range.before}<mark>{range.quote}</mark>{range.after}</> : block.text}</pre>
            </div>;
        }) : <p role="status">{blocks.length ? t.workbench.readerNoMatches : t.workbench.noEvidence}</p>}
    </div>;
}
