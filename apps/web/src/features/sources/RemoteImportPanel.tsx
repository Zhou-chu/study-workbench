import { useEffect, useRef, useState } from 'react';
import type { WorkspaceViewV1, WorkbenchSelection } from '@study/contracts';
import { canDispatch, freezeDispatchContext, readTurnContext, sessionCoordinator, type DispatchContext } from '@study/web-transport';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import type { RemoteCapabilities, RemotePage, RemoteAction } from '../../data/source-api';
import { useSourceOperations } from './use-source-operations';
import { ConfirmSourceAction } from './ConfirmSourceAction';
type Confirmation = {
    context: DispatchContext;
    generation: number;
    scopeRevision: number;
    providerEvidenceRevision: number;
    action: RemoteAction;
};
export function RemoteImportPanel({ notebookId, workspace, selection, onRemoteSelection, onChanged }: {
    notebookId: string;
    workspace: WorkspaceViewV1;
    selection: WorkbenchSelection | null;
    onRemoteSelection: (ids: string[]) => void;
    onChanged: () => void;
}) {
    const { t, session: m, source: sourceLabels } = useI18n(), ops = useSourceOperations(notebookId, onChanged);
    const [capabilities, setCapabilities] = useState<RemoteCapabilities | null>(null), [pageState, setPage] = useState<{
        page: RemotePage;
        target: string;
        revision: number;
        context: DispatchContext;
        generation: number;
        providerEvidenceRevision: number;
    } | null>(null), [confirmation, setConfirmation] = useState<Confirmation | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(false);
    const verified = useRef<{
        context: DispatchContext;
        generation: number;
        providerEvidenceRevision: number;
    } | null>(null), mounted = useRef(true), flight = useRef(false);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const remote = workspace.link && 'remote_notebook_id' in workspace.link && typeof workspace.link.remote_notebook_id === 'string' && !workspace.link.projection_status ? workspace.link.remote_notebook_id : null;
    const targetFingerprint = JSON.stringify([notebookId, remote, ops.context?.epoch]);
    const targetScope = useRef({ fingerprint: targetFingerprint, revision: 0 });
    if (targetScope.current.fingerprint !== targetFingerprint)
        targetScope.current = { fingerprint: targetFingerprint, revision: targetScope.current.revision + 1 };
    const fingerprint = JSON.stringify([notebookId, remote, selection?.source_version_ids, selection?.remote_source_ids,ops.store.selectionRevision(notebookId)]);
    const scope = useRef({ fingerprint, revision: 0 });
    if (scope.current.fingerprint !== fingerprint)
        scope.current = { fingerprint, revision: scope.current.revision + 1 };
    const latest = useRef({ remote, selection });
    latest.current = { remote, selection };
    const validApp = (context: DispatchContext, generation: number) => mounted.current && canDispatch(context, readTurnContext()) && generation === sessionCoordinator.current();
    const valid = (context: DispatchContext, generation: number, providerEvidenceRevision: number) => {
        const state = ops.controller?.getSnapshot();
        return validApp(context, generation) && state?.ready === true && !state.providerNeedsReauth && !state.providerChecking && state.providerEvidenceRevision === providerEvidenceRevision;
    };
    const currentPage = () => pageState && pageState.target === remote && pageState.revision === targetScope.current.revision && valid(pageState.context, pageState.generation, pageState.providerEvidenceRevision) ? pageState.page : null;
    const page = currentPage();
    const isConnected = () => !ops.store.selectionUnconfirmed(notebookId,ops.context?.epoch) && ops.ready && !!verified.current && valid(verified.current.context, verified.current.generation, verified.current.providerEvidenceRevision);
    const connected = isConnected();
    const available = (name: string) => isConnected() && capabilities?.operations.find(capability => capability.name === name)?.support === 'available';
    const verify = async () => {
        if (!ops.api || !ops.controller || !ops.ready || flight.current) return;
        flight.current = true;
        setBusy(true);
        setError(false);
        setCapabilities(null);
        verified.current = null;
        try {
            const context = readTurnContext()!, generation = sessionCoordinator.current();
            const ok = await ops.controller.verifyProviderConnection();
            const providerEvidenceRevision = ops.controller.getSnapshot().providerEvidenceRevision;
            if (!ok || !valid(context, generation, providerEvidenceRevision)) return;
            const caps = await ops.api.remoteCapabilities(context);
            if (valid(context, generation, providerEvidenceRevision)) {
                setCapabilities(caps);
                verified.current = { context: freezeDispatchContext(context), generation, providerEvidenceRevision };
            }
        } catch {
            if (mounted.current) setError(true);
        } finally {
            flight.current = false;
            if (mounted.current) setBusy(false);
        }
    };
    const list = async () => { if (!ops.api || !remote || !available('list_sources') || flight.current)
        return; const target = remote, c = readTurnContext()!, g = sessionCoordinator.current(), revision = targetScope.current.revision, providerEvidenceRevision = ops.controller!.getSnapshot().providerEvidenceRevision; flight.current = true; setBusy(true); try {
        const next = await ops.api.remoteSources(target, page?.next_cursor ?? null, c);
        if (valid(c, g, providerEvidenceRevision) && latest.current.remote === target && targetScope.current.revision === revision)
            setPage({ page: { ...next, items: [...(page?.next_cursor ? page.items : []), ...next.items] }, target, revision, context: freezeDispatchContext(c), generation: g, providerEvidenceRevision });
    }
    catch {
        setError(true);
    }
    finally {
        flight.current = false;
        if (mounted.current)
            setBusy(false);
    } };
    const can = (kind: RemoteAction['kind']) => {
        if (!selection || !remote || !isConnected() || busy) return false;
        if (kind === 'sync') return available('upload_source') && selection.source_version_ids.length > 0;
        const current = currentPage();
        const selectedRemoteIsCurrent = !!current && selection.remote_source_ids.length > 0 && selection.remote_source_ids.every(id => current.items.some(item => item.id === id));
        return available('fetch_source_text') && selectedRemoteIsCurrent && (kind === 'import' || selection.source_version_ids.length === 1 && selection.remote_source_ids.length === 1);
    };
    const open = (kind: RemoteAction['kind']) => { const c = readTurnContext(); if (!can(kind) || !c?.ready || !remote || !selection)
        return; setConfirmation({ context: freezeDispatchContext(c), generation: sessionCoordinator.current(), scopeRevision: scope.current.revision, providerEvidenceRevision: ops.controller!.getSnapshot().providerEvidenceRevision, action: Object.freeze({ kind, remoteNotebookId: remote, versionIds: Object.freeze([...selection.source_version_ids]), remoteIds: Object.freeze([...selection.remote_source_ids]), idempotencyKey: crypto.randomUUID() }) }); };
    const confirmationValid = () => !!confirmation && confirmation.scopeRevision === scope.current.revision && valid(confirmation.context, confirmation.generation, confirmation.providerEvidenceRevision) && can(confirmation.action.kind) && latest.current.remote === confirmation.action.remoteNotebookId && JSON.stringify([latest.current.selection?.source_version_ids, latest.current.selection?.remote_source_ids]) === JSON.stringify([confirmation.action.versionIds, confirmation.action.remoteIds]) && !ops.controller?.getSnapshot().providerNeedsReauth;
    const confirm = () => { if (!confirmationValid() || !confirmation)
        return; const captured = confirmation; setConfirmation(null); const id = ops.store.capture(notebookId, { kind: 'remote', action: captured.action }, captured.context, captured.generation); void ops.run(id, () => !ops.store.selectionUnconfirmed(notebookId,captured.context.epoch) && captured.scopeRevision===scope.current.revision && !ops.controller?.getSnapshot().providerNeedsReauth && latest.current.remote === captured.action.remoteNotebookId && valid(captured.context, captured.generation, captured.providerEvidenceRevision)); };
    const localSourceTitle = (id: string) => { const source = workspace.sources.find(source => 'versions' in source && Array.isArray(source.versions) && source.versions.some(version => 'source_version_id' in version && version.source_version_id === id)); return source && 'title' in source && typeof source.title === 'string' && source.title.trim() ? source.title : id; };
    return <section className="remote-sources" aria-label={t.workbench.googleConnection}><h3>{t.workbench.googleConnection}</h3>{!connected && <p>{ops.state?.providerNeedsReauth ? m.google : t.workbench.connectionNotVerified}</p>}<Button disabled={!ops.ready || busy || ops.state?.providerChecking} onClick={() => { void verify(); }}>{m.verifyGoogle}</Button><details><summary>{t.workbench.capabilities}</summary><ul>{capabilities?.operations.map(c => <li key={c.name}>{c.name === 'list_sources' ? t.workbench.loadRemoteSources : c.name === 'upload_source' ? t.workbench.syncSelected : c.name === 'fetch_source_text' ? t.workbench.importSelected : c.name === 'generate_audio' ? t.workbench.audio : c.name === 'list_artifacts' ? t.workbench.listArtifacts : c.name === 'download_artifact' ? t.workbench.downloadArtifact : t.common.unknown}: {c.support === 'available' ? t.workbench.states.available : c.support === 'unsupported' || c.support === 'unavailable' ? sourceLabels.unavailableOperation : c.support === 'unverified' ? t.workbench.states.unverified : t.common.unknown}</li>)}</ul></details>{remote ? <p>{t.workbench.notebooklm}</p> : <p>{t.workbench.googleLinkRequired}</p>}<Button disabled={!remote || !available('list_sources') || busy} onClick={() => { void list(); }}>{page?.next_cursor ? t.common.next : t.workbench.loadRemoteSources}</Button>{page && <><p>{t.workbench.remoteOriginalWarning}</p><ul>{page.items.map(r => <li key={r.id}><label className="source-check"><input type="checkbox" aria-label={r.title} checked={selection?.remote_source_ids.includes(r.id) ?? false} disabled={!selection || !connected || busy || !selection.remote_source_ids.includes(r.id) && selection.remote_source_ids.length >= 20} onChange={e => { if (selection && currentPage())
        onRemoteSelection(e.target.checked ? [...selection.remote_source_ids, r.id] : selection.remote_source_ids.filter(id => id !== r.id)); }}/>{r.title}</label></li>)}</ul>{!page.listing_complete && <p>{t.workbench.listIncomplete}</p>}</>}<div className="source-actions"><Button disabled={!can('sync')} onClick={() => open('sync')}>{t.workbench.syncSelected}</Button><Button disabled={!can('import')} onClick={() => open('import')}>{t.workbench.importSelected}</Button><Button disabled={!can('associate')} onClick={() => open('associate')}>{t.workbench.associateSource}</Button></div>{error && <p role="alert">{t.workbench.error}</p>}<ConfirmSourceAction open={!!confirmation} title={t.workbench.confirmAction} description={confirmation?.action.kind === 'sync' ? t.workbench.syncConfirm : confirmation?.action.kind === 'import' ? t.workbench.importConfirm : t.workbench.associateConfirm} disabled={!confirmationValid()} onConfirm={confirm} onCancel={() => setConfirmation(null)}><p>{t.workbench.target}: {confirmation?.action.remoteNotebookId}</p><ul>{confirmation?.action.versionIds.map(id => <li key={id}>{localSourceTitle(id)}</li>)}{confirmation?.action.remoteIds.map(id => <li key={id}>{page?.items.find(source => source.id === id)?.title ?? id}</li>)}</ul></ConfirmSourceAction></section>;
}
