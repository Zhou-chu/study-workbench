import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
export function ReaderHeader({ title, page, pageCount, onPage, onClose }: {
    title: string;
    page: number;
    pageCount: number | null;
    onPage: (p: number) => void;
    onClose: () => void;
}) { const { t } = useI18n(); return <header className="reader-header"><div className="panel-heading"><h2>{title}</h2><Button autoFocus onClick={onClose}>{t.common.close}</Button></div><div className="reader-controls"><Button aria-label={t.common.back} disabled={page === 0} onClick={() => onPage(page - 1)}>←</Button><label>{t.workbench.pdfPage}<input type="number" min={1} {...(pageCount ? { max: pageCount } : {})} value={page + 1} onChange={e => { const value = Number(e.target.value); if (Number.isSafeInteger(value) && value >= 1)
    onPage(value - 1); }}/></label><span>/ {pageCount ?? t.common.unknown}</span><Button aria-label={t.common.next} disabled={pageCount !== null && page >= pageCount - 1} onClick={() => onPage(page + 1)}>→</Button></div></header>; }
