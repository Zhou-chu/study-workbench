import { useSourceSelection } from './use-source-selection';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { readTurnContext, sessionCoordinator, canDispatch } from '@study/web-transport';
import type { WorkspaceViewV1, WorkbenchSelection } from '@study/contracts';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { DiscoveryPanel } from './DiscoveryPanel';
import { RemoteImportPanel } from './RemoteImportPanel';
import { SelectedSourceSearch } from './SelectedSourceSearch';
import { SourceRow } from './SourceRow';
import { AddSourceDialog } from './AddSourceDialog';
import { UploadStatus } from './UploadStatus';
import { useSourceOperations } from './use-source-operations';
import { includeImported, type SourceReadIntent } from './source-selection';
export function SourcesPanel({ notebookId, workspace, onRead }: {
    notebookId: string;
    workspace: WorkspaceViewV1;
    onRead: (intent: SourceReadIntent) => void;
}) {
    const { t, source: m } = useI18n(), client = useQueryClient();
    const [open, setOpen] = useState(false), [sourceId, setSourceId] = useState<string>(), [error, setError] = useState(false);
    const changed = () => { void client.invalidateQueries({ queryKey: ['workspace'] }); };
    const ops = useSourceOperations(notebookId, changed);
    const { operation: local, selection, unconfirmed } = useSourceSelection(notebookId, ops.context?.epoch, workspace);
    const blocked = !ops.ready || !selection || unconfirmed;
    const save = (next: WorkbenchSelection) => { const c = readTurnContext(); if (blocked || !c?.ready)
        return; const id = ops.store.capture(notebookId, { kind: 'selection', selection: next }, c, sessionCoordinator.current()); void ops.run(id); };
    const include = (ids: readonly string[]) => { if (!selection)
        return; try {
        setError(false);
        save(includeImported(selection, ids));
    }
    catch {
        setError(true);
    } };
    const select = (id: string, checked: boolean) => { if (!selection)
        return; checked ? include([id]) : save({ ...selection, source_version_ids: selection.source_version_ids.filter(v => v !== id) }); };
    return <><div className="panel-heading"><h2>{t.workbench.sources}</h2><Button onClick={() => { setSourceId(undefined); setOpen(true); }}>{m.add}</Button></div><p className="panel-hint">{t.workbench.readingScopeHint}</p><div className="source-actions"><Button disabled={blocked} onClick={() => include(workspace.sources.flatMap(s => 'versions' in s && Array.isArray(s.versions) ? s.versions.slice(0, 1).flatMap(v => 'source_version_id' in v && typeof v.source_version_id === 'string' ? [v.source_version_id] : []) : []))}>{t.workbench.selectAll}</Button><Button disabled={blocked} onClick={() => selection && save({ ...selection, source_version_ids: [], remote_source_ids: [] })}>{t.workbench.clearSelection}</Button></div>{!selection && <p role="status">{t.workbench.selectionUnsupported}</p>}{error && <p role="alert">{m.limit}</p>}{local && <p role="status">{local.operation.state === 'succeeded' ? t.workbench.selectionSaved : local.operation.state === 'submitting' ? t.workbench.selectionSaving : t.workbench.selectionUnconfirmed}</p>}{local?.operation.state === 'idle' && <Button disabled={!!local.reserved || !!local.transaction && (local.transaction.providerRevision!==ops.state?.providerEvidenceRevision || ops.state?.providerChecking || ops.state?.providerNeedsReauth) || !ops.ready || !canDispatch(local.operation.context, readTurnContext()) || local.operation.sessionGeneration !== sessionCoordinator.current()} onClick={() => { void ops.run(local.id); }}>{t.workbench.retrySelectionSave}</Button>}{local?.operation.state === 'unknown' && <Button disabled={!ops.ready} onClick={async () => { try {
        const check = ops.store.beginCheck(local.id, readTurnContext(), sessionCoordinator.current());
        if (!check)
            return;
        const w = await ops.api!.workspace(notebookId, check.context);
        ops.store.check(check, w, readTurnContext(), sessionCoordinator.current());
        changed();
    }
    catch {
        setError(true);
    } }}>{m.check}</Button>}<ul className="source-list">{workspace.sources.map((s, i) => <SourceRow key={'source_id' in s && typeof s.source_id === 'string' ? s.source_id : i} source={s} selected={selection?.source_version_ids ?? []} disabled={blocked} uploadDisabled={!ops.ready} onSelect={select} onRead={onRead} onUpload={id => { setSourceId(id); setOpen(true); }}/>)}</ul><div className="source-extended-tools"><DiscoveryPanel notebookId={notebookId} onChanged={changed}/><SelectedSourceSearch notebookId={notebookId} workspace={workspace} selection={selection} disabled={blocked} onRead={onRead}/><RemoteImportPanel notebookId={notebookId} workspace={workspace} selection={selection} onRemoteSelection={ids => { if (selection)
        save({ ...selection, remote_source_ids: ids }); }} onChanged={changed}/></div><UploadStatus notebookId={notebookId} onInclude={include} onChanged={changed} includeDisabled={blocked}/><AddSourceDialog key={sourceId ?? 'new'} notebookId={notebookId} {...(sourceId ? { sourceId } : {})} open={open} onClose={() => setOpen(false)} onChanged={changed}/></>;
}
