import type { ReaderBlock, ReaderLocator } from '../../data/evidence-api';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { verifiedQuoteRange } from './navigation';
export function TextView({ blocks, search, onSearchChange, locator, quote, onPage }: {
    blocks: ReaderBlock[];
    search: string;
    onSearchChange: (v: string) => void;
    locator: ReaderLocator | null;
    quote: string | null;
    onPage: (v: number) => void;
}) { const { t } = useI18n(); const filtered = blocks.filter(b => !search || b.text.toLocaleLowerCase().includes(search.toLocaleLowerCase())); return <div className="reader-text-view"><div className="reader-controls"><label>{t.workbench.searchEvidence}<input type="search" value={search} onChange={e => onSearchChange(e.target.value)}/></label>{search && <Button onClick={() => onSearchChange('')}>{t.workbench.clearReaderSearch}</Button>}</div>{filtered.length ? filtered.map(block => { const range = quote && block.block_id === locator?.block_id && typeof locator.start_offset === 'number' && typeof locator.end_offset === 'number' ? verifiedQuoteRange(block.text, locator.start_offset, locator.end_offset, quote) : null; return <div className="reader-block" key={block.block_id}>{block.page_index !== null && <Button onClick={() => onPage(block.page_index!)}>{t.workbench.physicalPage.replace('{{page}}', String(block.page_index + 1))}</Button>}<pre className="reader-text">{range ? <>{range.before}<mark>{range.quote}</mark>{range.after}</> : block.text}</pre></div>; }) : <p role="status">{blocks.length ? t.workbench.readerNoMatches : t.workbench.noEvidence}</p>}</div>; }
