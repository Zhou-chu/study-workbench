import { Link } from 'react-router';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { useAppDrafts } from '../../app/providers';
import { sourceHref } from './library-operations';
import type { LibraryDraft } from './library-store';
import { readTurnContext, sessionCoordinator } from '@study/web-transport';
export function OperationStatus({ row }: {
    row: LibraryDraft | undefined;
}) {
    const { t, library: l, session } = useI18n();
    const { library: store } = useAppDrafts();
    if (!row)
        return null;
    const stale = !store.current(row, readTurnContext(), sessionCoordinator.current());
    if (row.status === 'editing' && !stale)
        return null;
    const label = stale ? session.retiredDraft : row.status === 'unknown' ? t.commandSubmission.warning : row.status === 'not-sent' ? t.noteConflict.notSent : row.status === 'accepted' && row.stopRequested ? l.observationStopped : row.status === 'pending' || row.status === 'accepted' ? t.sources.statusProcessing : row.status === 'failed' ? (row.input.kind === 'action' ? t.common.failed : l.partial) : row.status === 'rejected' ? t.noteConflict.rejected : row.input.kind === 'import' ? l.accepted : t.common.saveSuccess;
    return <section className="library-operation" aria-label={l.retained}><p role={['unknown', 'failed', 'rejected'].includes(row.status) ? 'alert' : 'status'}>{label}</p>
 {!!row.receipts.length && <ol>{row.receipts.map((r, i) => <li key={i}>{i + 1}: {r.state === 'accepted' ? l.accepted : r.state === 'unknown' ? t.common.unknown : t.common.failed} {r.resourceId && (store.current(row, readTurnContext(), sessionCoordinator.current()) ? <Link className="button" to={sourceHref(r.resourceId)}>{r.resourceId}</Link> : <span>{r.resourceId}</span>)}</li>)}</ol>}
 {row.commandId && <p className="meta">{row.commandId}</p>}
 {row.status === 'accepted' && <Button disabled={row.stopRequested} onClick={() => store.stop(row.id)}>{l.stopChecking}</Button>}
 </section>;
}
