import { studioStateLabel } from './ArtifactCard';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { canDispatch, readTurnContext, sessionCoordinator } from '@study/web-transport';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { StudioConfirm } from './StudioConfirm';
import type { StudioConnection } from './use-studio';
import type { StudioOperation } from './studio-store';
export function PortableDialog({ notebookId, connection: c }: {
    notebookId: string;
    connection: StudioConnection;
}) {
    const { t, studio } = useI18n(), [confirm, setConfirm] = useState<StudioOperation | null>(null), [error, setError] = useState(false), [downloaded, setDownloaded] = useState(false), busy = useRef(false);
    const limits = c.state?.capabilities?.limits.portable, rows = c.operations.filter(r => ['export', 'import'].includes(r.payload.kind)), locked = rows.some(r => ['submitting', 'unknown'].includes(r.operation.state));
    const fileRow = [...rows].reverse().find(r => r.payload.kind === 'import' && r.operation.state === 'idle');
    async function download(row: StudioOperation) {
        if (!c.api || !row.job?.exportId || busy.current || row.retired || !canDispatch(row.operation.context, readTurnContext()) || row.operation.sessionGeneration !== sessionCoordinator.current())
            return;
        busy.current = true;
        setError(false);
        setDownloaded(false);
        try {
            const blob = await c.api.downloadExport(row.job.exportId, row.operation.context);
            if (!canDispatch(row.operation.context, readTurnContext()) || row.operation.sessionGeneration !== sessionCoordinator.current())
                return;
            const url = URL.createObjectURL(blob), a = document.createElement('a');
            a.href = url;
            a.download = 'study-workbench-project.zip';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 30000);
            setDownloaded(true);
        }
        catch {
            setError(true);
        }
        finally {
            busy.current = false;
        }
    }
    const canImport = (row: StudioOperation) => c.ready && !!limits && row.payload.kind === 'import' && row.payload.file.size <= limits.max_archive_bytes && row.payload.file.size + limits.multipart_overhead_bytes <= limits.max_request_bytes && !row.retired && row.operation.state === 'idle' && canDispatch(row.operation.context, readTurnContext()) && row.operation.sessionGeneration === sessionCoordinator.current();
    return <section aria-label={t.workbench.exportProject}><h3>{t.workbench.exportProject}</h3><p>{t.workbench.exportCoverage}</p><p>{studio.memoryLimit}</p><Button disabled={!c.ready || locked || rows.some(r => r.payload.kind === 'export' && r.job && !['succeeded', 'failed', 'cancelled_local'].includes(r.job.state))} onClick={() => {
            const context = readTurnContext();
            if (!context || !c.ready)
                return;
            const id = c.store.capture(notebookId, { kind: 'export' }, context, sessionCoordinator.current());
            void c.run(id);
        }}>{t.workbench.exportProject}</Button><h3>{t.workbench.restoreProject}</h3><p>{t.workbench.restoreConfirm}</p><p>{t.workbench.portableLimitsHint}</p>{limits ? <details><summary>{t.workbench.capabilities}</summary><dl>{Object.entries(limits).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></details> : <p>{t.workbench.portableLimitsError}</p>}<input aria-label={t.workbench.restoreProject} type="file" accept=".zip,application/zip" disabled={!c.ready || !limits || locked || !!fileRow} onChange={e => {
            const file = e.target.files?.[0], context = readTurnContext();
            if (!file || !context || !c.ready || !limits)
                return;
            c.store.capture(notebookId, { kind: 'import', file }, context, sessionCoordinator.current());
            e.target.value = '';
        }}/>{fileRow && fileRow.payload.kind === 'import' && <div><p>{fileRow.payload.file.name} · {fileRow.payload.file.size}</p><Button disabled={!canImport(fileRow)} onClick={() => setConfirm(fileRow)}>{t.workbench.restoreProject}</Button><Button onClick={() => c.store.discardUnsent(fileRow.id)}>{t.common.cancel}</Button></div>}{rows.map(row => <article className="artifact-card" key={row.id}><p>{row.payload.kind === 'import' ? t.workbench.restoreProject : t.workbench.exportProject}</p><p>{studioStateLabel(row.job?.state ?? row.operation.state, t)}</p>{row.operation.state === 'unknown' && <p role="alert">{studio.uncorrelated}</p>}{row.job && ['queued', 'running', 'waiting_remote'].includes(row.job.state) && <Button disabled={!c.ready || row.busy || row.retired} onClick={() => void c.observe(row.id)}>{t.workbench.refreshExportStatus}</Button>}{row.job?.exportId && <Button disabled={!c.ready || row.retired} onClick={() => void download(row)}>{t.workbench.downloadProject}</Button>}{row.imported && <><Link className="button" to={`/notebooks/${encodeURIComponent(row.imported.notebook_id)}`}>{t.workbench.restoredNotebook}</Link></>}</article>)}{downloaded && <p role="status">{t.workbench.exportDownloadStarted}</p>}{error && <p role="alert">{t.workbench.exportDownloadError}</p>}{confirm && <StudioConfirm title={t.workbench.restoreProject} description={t.workbench.restoreConfirm} onCancel={() => setConfirm(null)} disabled={c.store.getOperation(confirm.id) !== confirm || !canImport(confirm)} onConfirm={() => {
                if (c.store.getOperation(confirm.id) !== confirm || !canImport(confirm))
                    return;
                setConfirm(null);
                void c.run(confirm.id, () => !!limits && confirm.payload.kind === 'import' && confirm.payload.file.size <= limits.max_archive_bytes);
            }}><p>{confirm.payload.kind === 'import' ? confirm.payload.file.name : ''}</p></StudioConfirm>}</section>;
}
