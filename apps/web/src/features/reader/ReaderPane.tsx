import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { canDispatch, freezeDispatchContext, readTurnContext, sessionCoordinator, subscribeTurnContext } from '@study/web-transport';
import { useWorkbenchSnapshot } from '../../app/WorkbenchSession';
import type { ReadingPosition } from '@study/contracts';
import { useAppData } from '../../app/providers';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { createEvidenceApi, EvidenceReadError, type ReaderDetail } from '../../data/evidence-api';
import { canonicalCitationLocator, readerIsOwned, readerIsCurrent, restoreReaderFocus, type ReaderIntent } from './navigation';
import { ReaderHeader } from './ReaderHeader';
import { CitationContext } from './CitationContext';
import { TextView, type TextPosition } from './TextView';
import { PdfView, PdfTextFallback } from './PdfView';
import type { PdfZoom } from './pdf-render-sizing';
export interface ReaderPaneProps {
    maintenance?: (detail: ReaderDetail) => ReactNode;
    intent: ReaderIntent;
    onClose: () => void;
    onPositionChange: (position: ReadingPosition) => void;
    positionSave?: { blocked: boolean; onSave: () => void };
}
/** Intent replacement owns all local state. Theme and unrelated parent changes do not. */
export function ReaderPane(props: ReaderPaneProps) { useSyncExternalStore(subscribeTurnContext, readTurnContext, () => null); const { reader: m, t } = useI18n(); return readerIsOwned(props.intent) ? <ReaderDocument key={props.intent.key} {...props}/> : <section className="reader-pane" aria-label={t.workbench.reader}><p role="status">{m.retired}</p><Button onClick={() => { props.onClose(); restoreReaderFocus(props.intent); }}>{t.common.close}</Button></section>; }
function ReaderDocument({ intent, onClose, onPositionChange, positionSave, maintenance }: ReaderPaneProps) {
    const { transport } = useAppData(), { t, reader: m } = useI18n();
    const session = useWorkbenchSnapshot();
    const api = useMemo(() => transport ? createEvidenceApi(transport) : null, [transport]);
    const [detail, setDetail] = useState<ReaderDetail | null>(null), [blob, setBlob] = useState<Blob | null>(null), [page, setPage] = useState(intent.initialPage), [search, setSearch] = useState(''), [zoom, setZoom] = useState<PdfZoom>('fit'), [revision, setRevision] = useState(0), [loading, setLoading] = useState(false), [failure, setFailure] = useState<string | null>(null), [downloadFailure, setDownloadFailure] = useState<string | null>(null), [downloading, setDownloading] = useState(false);
    const pane = useRef<HTMLElement>(null);
    const [textPosition, setTextPosition] = useState<TextPosition | null>(() => intent.evidence_id ? { kind: 'locator' } : { kind: 'page', page: intent.initialPage });
    const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 899px)').matches);
    useEffect(() => { const media = window.matchMedia('(max-width: 899px)'); const update = () => setNarrow(media.matches); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
    const manual = useRef(false), owner = useRef<AbortController | null>(null), downloadOwner = useRef<AbortController | null>(null), boundExtraction = useRef(intent.extraction_id);
    const current = () => readerIsOwned(intent) && canDispatch(intent.context, readTurnContext()) && (!session.controller || session.controller.getSnapshot().ready);
    const ready = current();
    useEffect(() => () => { downloadOwner.current?.abort(); downloadOwner.current = null; }, []);
    const evidence = detail?.evidence.find(e => e.evidence_id === intent.evidence_id);
    const locator = intent.citation && evidence ? canonicalCitationLocator(intent.citation, evidence) : evidence?.locator ?? null;
    const pageCount = detail?.extraction?.page_count ?? null;
    const blocks = detail?.extraction?.blocks.length ? detail.extraction.blocks : detail?.extraction?.text ? [{ block_id: 'document', page_index: null, text: detail.extraction.text }] : [];
    const close = () => { onClose(); restoreReaderFocus(intent); };
    useEffect(() => {
        const abort = new AbortController();
        owner.current = abort;
        if (!api || !intent.source_version_id || !current()) return () => abort.abort();
        // A newly opened intent or explicit Retry owns this read. Never reuse an
        // older generation when readiness returns and never auto-replay it.
        const request = { ...intent, context: freezeDispatchContext(readTurnContext()!), generation: sessionCoordinator.current() };
        const ownsRead = () => !abort.signal.aborted && readerIsCurrent(request) && current();
        let pending = true;
        const off = subscribeTurnContext(() => {
            if (readerIsCurrent(request)) return;
            abort.abort();
            if (pending) { setLoading(false); setFailure('interrupted'); }
        });
        setLoading(true); setFailure(null);
        void (async () => {
            try {
                const value = await api.detail({ notebookId: intent.notebookId, source_version_id: intent.source_version_id!, evidence_id: intent.evidence_id, extraction_id: boundExtraction.current }, request.context, request.generation, abort.signal);
                if (!ownsRead()) return;
                boundExtraction.current = value.extraction?.extraction_id ?? null;
                setDetail(value);
                const record = value.evidence.find(e => e.evidence_id === intent.evidence_id);
                const loc = record ? (intent.citation ? canonicalCitationLocator(intent.citation, record) : record.locator) : null;
                if (!manual.current && typeof loc?.page_index === 'number') setPage(loc.page_index);
                if (value.version.mime_type === 'application/pdf' && value.version.original_status === 'available') {
                    try {
                        const original = await api.download(value.version, request.context, request.generation, abort.signal);
                        if (ownsRead()) setBlob(original);
                    } catch (error) {
                        if (ownsRead()) setDownloadFailure(error instanceof EvidenceReadError ? error.reason : 'interrupted');
                    }
                }
            } catch (error) {
                if (ownsRead()) setFailure(error instanceof EvidenceReadError ? error.reason : 'interrupted');
            } finally {
                pending = false;
                if (ownsRead()) setLoading(false);
            }
        })();
        return () => { pending = false; off(); abort.abort(); };
    }, [api, intent, revision]);
    const changePage = (value: number) => { if (!Number.isSafeInteger(value) || value < 0 || !current())
        return; manual.current = true; const next = pageCount ? Math.min(value, pageCount - 1) : value; setPage(next); setTextPosition({ kind: 'page', page: next }); if (intent.source_version_id)
        onPositionChange({ source_version_id: intent.source_version_id, page_index: next }); };
    const download = async () => {
        if (!api || !detail || downloadOwner.current || !current()) return;
        const abort = new AbortController(), request = { ...intent, context: freezeDispatchContext(readTurnContext()!), generation: sessionCoordinator.current() };
        downloadOwner.current = abort;
        const ownsRead = () => downloadOwner.current === abort && !abort.signal.aborted && readerIsCurrent(request) && current();
        const off = subscribeTurnContext(() => { if (!readerIsCurrent(request)) abort.abort(); });
        setDownloading(true); setDownloadFailure(null);
        try {
            const original = blob ?? await api.download(detail.version, request.context, request.generation, abort.signal);
            if (!ownsRead()) return;
            const url = URL.createObjectURL(original), a = document.createElement('a');
            a.href = url;
            a.download = (typeof detail.version.source_title === 'string' ? detail.version.source_title : intent.source_version_id ?? 'source').replace(/[\/\\\x00-\x1f]/g, '_');
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 0);
        } catch (error) {
            if (ownsRead()) setDownloadFailure(error instanceof EvidenceReadError ? error.reason : 'interrupted');
        } finally {
            off();
            if (downloadOwner.current === abort) { downloadOwner.current = null; setDownloading(false); }
        }
    };
    return <section ref={pane} className="reader-pane" role={narrow ? 'dialog' : 'region'} aria-modal={narrow ? true : undefined} aria-label={t.workbench.reader} onKeyDown={e => { if (e.key === 'Escape') {
        e.stopPropagation();
        close();
    } if (narrow && e.key === 'Tab') {
        const controls = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex]')).filter(node => node.tabIndex >= 0 && !node.hasAttribute('disabled') && !node.closest('[hidden]'));
        const first = controls[0], last = controls.at(-1);
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
        }
        else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
        }
    } }}><ReaderHeader title={detail && typeof detail.version.source_title === 'string' ? detail.version.source_title : t.workbench.reader} page={page} pageCount={pageCount} onPage={changePage} onClose={close}/><div className="reader-scroll" onScroll={event => {
        // CitationContext is scrollable before TextView exists. This newer
        // scroll supersedes any pending reveal, including an older page request.
        // A later explicit page action can still supply a fresh request.
        if (event.target === event.currentTarget)
            setTextPosition(null);
    }}><CitationContext citation={intent.citation} provenance={evidence?.provenance ?? detail?.version.provenance} independentSupport={evidence?.independent_support}/>{!intent.source_version_id && <p role="status">{intent.citation?.kind === 'remote_unmapped' ? t.workbench.remoteUnmapped : m.unavailable}</p>}{loading && <p role="status">{t.common.loading}</p>}{failure && <p role="alert">{failure === 'unavailable' ? m.unavailable : t.workbench.readerLoadFailed}</p>}{(failure || downloadFailure) && <Button disabled={loading || !ready} onClick={() => { setDownloadFailure(null); setRevision(n => n + 1); }}>{t.workbench.retry}</Button>}{downloadFailure && <p role="alert">{downloadFailure === 'missing' ? t.workbench.originalMissing : downloadFailure === 'invalid' ? m.invalid : t.workbench.readerDownloadFailed}</p>}{detail && <>{maintenance?.(detail)}<details><summary>{t.workbench.versionDetails}</summary><p className="reader-identity">{detail.version.source_version_id}</p><p className="reader-identity">{detail.extraction?.extraction_id ?? t.common.unknown}</p></details>{detail.version.original_status !== 'available' ? <p role="status">{t.workbench.originalMissing}</p> : <Button disabled={downloading || !ready} onClick={() => { void download(); }}>{t.workbench.downloadOriginal}</Button>}{detail.version.mime_type === 'application/pdf' && <>{blob ? <PdfView blob={blob} pageIndex={page} zoom={zoom} onZoomChange={setZoom} fallbackText={blocks.filter(b => b.page_index === page).map(b => b.text).join('\n')}/> : !loading && <PdfTextFallback text={blocks.filter(b => b.page_index === page).map(b => b.text).join('\n')}/>}<p className="panel-hint">{t.workbench.highlightUnavailable}</p></>}{intent.citation && !locator && <p className="panel-hint">{t.workbench.quoteMismatch}</p>}<TextView position={detail.version.mime_type === 'application/pdf' ? null : textPosition} blocks={blocks} search={search} onSearchChange={setSearch} locator={locator} quote={typeof intent.citation?.quote === 'string' ? intent.citation.quote : null} onPage={changePage}/></>}</div>{positionSave && <div className="reader-save-notice"><p role="status">{m.unsaved}</p><Button disabled={positionSave.blocked} onClick={() => {
        positionSave.onSave();
        // Keep focus in the reader when successful recovery removes this action.
        pane.current?.querySelector<HTMLButtonElement>('.reader-header button')?.focus({ preventScroll: true });
    }}>{m.savePosition}</Button></div>}</section>;
}
