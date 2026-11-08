import { useState } from 'react';
import { canDispatch, readTurnContext, sessionCoordinator } from '@study/web-transport';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { useSourceOperations } from './use-source-operations';
export function UploadStatus({ notebookId, onInclude, onChanged, includeDisabled }: {
    notebookId: string;
    onInclude: (ids: readonly string[]) => void;
    onChanged: () => void;
    includeDisabled: boolean;
}) { const { source: m, t } = useI18n(); const ops = useSourceOperations(notebookId, onChanged); const [checking, setChecking] = useState<string | null>(null), [error, setError] = useState(false); return <ul className="upload-status" aria-live="polite">{ops.rows.filter(r => !r.hidden && r.payload.kind !== 'selection').map(r => <li key={r.id}><strong>{r.file?.name ?? (r.payload.kind === 'web' ? r.payload.result.title : r.payload.kind === 'remote' ? t.workbench.googleConnection : t.workbench.jobOperations.other)}</strong><p className="meta source-id">{r.id}</p><p>{r.operation.state === 'submitting' ? t.workbench.uploading : r.operation.state === 'succeeded' ? m.accepted : r.operation.state === 'unknown' ? t.workbench.uploadUncertain : r.file ? m.upload : m.missingFile}</p>{r.jobId && <p className="source-id">{t.workbench.jobId}: {r.jobId}</p>}{r.retired ? <p>{m.retired}</p> : r.operation.state === 'unknown' && <><p>{m.checkOnly}</p><Button disabled={!ops.ready || !!checking} onClick={async () => { if (!ops.api || checking || !canDispatch(r.operation.context, readTurnContext()))
    return; const check = ops.store.beginCheck(r.id, readTurnContext(), sessionCoordinator.current()); if (!check)
    return; setChecking(r.id); setError(false); try {
    const w = await ops.api.workspace(r.notebookId, check.context);
    ops.store.check(check, w, readTurnContext(), sessionCoordinator.current());
    onChanged();
}
catch {
    setError(true);
}
finally {
    setChecking(null);
} }}>{m.check}</Button></>}{r.versionIds && r.versionIds.length > 0 && <Button disabled={includeDisabled || r.retired} onClick={() => onInclude(r.versionIds!)}>{m.include}</Button>}{r.operation.state === 'idle' && r.file && !r.retired && <Button disabled={!ops.ready} onClick={() => { void ops.run(r.id); }}>{m.upload}</Button>}{r.operation.state === 'succeeded' && <Button onClick={() => ops.store.dismiss(r.id)}>{t.workbench.dismissUpload}</Button>}</li>)}{error && <li role="alert">{t.workbench.uploadInspectionFailed}</li>}</ul>; }
