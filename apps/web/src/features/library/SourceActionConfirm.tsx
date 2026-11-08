import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { LibraryDialog } from './LibraryDialog';
import { useLibraryState } from './use-library-state';
import { retryReason } from './library-operations';
import type { LibrarySource } from '../../data/library-api';
import type { ActionInput, LibraryDraft } from './library-store';
import { OperationStatus } from './OperationStatus';
export function SourceActionConfirm({ source, action, notebookId, insightId, after, labelOverride }: {
    source: LibrarySource;
    action: ActionInput['action'];
    notebookId?: string;
    insightId?: string;
    after?: () => void;
    labelOverride?: string;
}) {
    const [open, setOpen] = useState(false), [capture, setCapture] = useState<LibraryDraft | null>(null), [sourceCapture, setSourceCapture] = useState<LibrarySource | null>(null), c = useLibraryState(capture?.id), { t, library: l } = useI18n();
    const navigate = useNavigate(), location = useLocation(), mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const reason = action === 'retry' ? retryReason(source) : null;
    const label = labelOverride ?? (action === 'delete' ? t.sources.deleteSource : action === 'unlink' ? t.sources.removeFromNotebook : action === 'retry' ? t.sources.retryProcessing : action === 'embed' ? t.sources.embedContent : t.sources.deleteInsight);
    const disabled = !c.ready || !!reason;
    const begin = () => {
        if (!c.context)
            return;
        const id = c.store.open({ kind: 'source', sourceId: source.id }, { kind: 'action', action, sourceId: source.id, ...(notebookId ? { notebookId } : {}), ...(insightId ? { insightId } : {}) }, c.context, c.generation);
        const previous = c.store.get(id)!;
        if (['not-sent', 'rejected'].includes(previous.status))
            c.store.edit(id, {});
        setCapture(c.store.get(id)!);
        setSourceCapture(source);
        setOpen(true);
        c.navigation?.activateResource(id);
    };
    return <><Button disabled={disabled} variant={['delete', 'unlink', 'delete-insight'].includes(action) ? 'danger' : 'secondary'} onClick={begin}>{label}</Button>{reason && <p className="meta">{reason === 'completed' ? l.retryCompleted : reason === 'active' ? l.retryActive : l.retryUnknown}</p>}
 <LibraryDialog open={open} onOpenChange={setOpen} title={label} description={action === 'unlink' ? t.sources.removeConfirm : action === 'retry' ? l.retryHint : action === 'delete' ? t.sources.deleteSourceConfirm : action === 'delete-insight' ? t.sources.deleteInsightConfirm : t.sources.embeddingDesc}>
 <p>{sourceCapture?.title ?? t.sources.untitledSource}</p><OperationStatus row={c.row}/>
 <Button variant="danger" disabled={!capture || capture !== c.row || c.row.status !== 'editing' || source.id !== (capture.input.kind === 'action' ? capture.input.sourceId : '') || capture.input.kind !== 'action' || capture.input.notebookId !== notebookId || capture.input.insightId !== insightId || !c.ready || sourceCapture?.updated !== source.updated || sourceCapture?.title !== source.title} onClick={() => {
            if (!capture || capture !== c.store.get(capture.id))
                return;
            void c.run(capture.id).then(() => {
                if (mounted.current && c.store.get(capture.id)?.status === 'succeeded') {
                    setOpen(false);
                    after?.();
                    if (action === 'delete' && location.pathname === '/sources/' + encodeURIComponent(source.id))
                        void navigate('/sources');
                }
            });
        }}>{t.common.confirm}</Button><Button onClick={() => setOpen(false)}>{t.common.cancel}</Button>
 </LibraryDialog></>;
}
