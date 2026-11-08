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
    action: RemoteAction;
};
export function RemoteImportPanel({ notebookId, workspace, selection, onRemoteSelection, onChanged }: {
    notebookId: string;
    workspace: WorkspaceViewV1;
    selection: WorkbenchSelection | null;
    onRemoteSelection: (ids: string[]) => void;
    onChanged: () => void;
}) {
    const { t, session: m } = useI18n(), ops = useSourceOperations(notebookId, onChanged);
    const [capabilities, setCapabilities] = useState<RemoteCapabilities | null>(null), [pageState, setPage] = useState<{
        page: RemotePage;
        target: string;
        revision: number;
        context: DispatchContext;
        generation: number;
    } | null>(null), [confirmation, setConfirmation] = useState<Confirmation | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(false);
    const verified = useRef<{
        context: DispatchContext;
        generation: number;
    } | null>(null), mounted = useRef(true), flight = useRef(false);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const remote = workspace.link && 'remote_notebook_id' in workspace.link && typeof workspace.link.remote_notebook_id === 'string' && !workspace.link.projection_status ? workspace.link.remote_notebook_id : null;
    const targetFingerprint = JSON.stringify([notebookId, remote, ops.context?.epoch]);
    const targetScope = useRef({ fingerprint: targetFingerprint, revision: 0 });
    if (targetScope.current.fingerprint !== targetFingerprint)
        targetScope.current = { fingerprint: targetFingerprint, revision: targetScope.current.revision + 1 };
    const fingerprint = JSON.stringify([notebookId, remote, selection?.source_version_ids, selection?.remote_source_ids]);
    const scope = useRef({ fingerprint, revision: 0 });
    if (scope.current.fingerprint !== fingerprint)
        scope.current = { fingerprint, revision: scope.current.revision + 1 };
    const latest = useRef({ remote, selection });
    latest.current = { remote, selection };
    const valid = (c: DispatchContext, g: number) => mounted.current && canDispatch(c, readTurnContext()) && g === sessionCoordinator.current();
    const page = pageState && pageState.target === remote && pageState.revision === targetScope.current.revision && valid(pageState.context, pageState.generation) ? pageState.page : null;
    const connected = ops.ready && !ops.state?.providerNeedsReauth && !!verified.current && valid(verified.current.context, verified.current.generation);
    const available = (name: string) => connected && capabilities?.operations.find(c => c.name === name)?.support === 'available';
    const verify = async () => { if (!ops.api || !ops.controller || !ops.ready || flight.current)
        return; flight.current = true; setBusy(true); setError(false); try {
        const c = readTurnContext()!, g = sessionCoordinator.current();
        const ok = await ops.controller.verifyProviderConnection();
        const caps = await ops.api.remoteCapabilities(c);
        if (valid(c, g)) {
            setCapabilities(caps);
            verified.current = ok ? { context: freezeDispatchContext(c), generation: g } : null;
        }
    }
    catch {
        setError(true);
    }
    finally {
        flight.current = false;
        if (mounted.current)
            setBusy(false);
    } };
    const list = async () => { if (!ops.api || !remote || !available('list_sources') || flight.current)
        return; const target = remote, c = readTurnContext()!, g = sessionCoordinator.current(), revision = targetScope.current.revision; flight.current = true; setBusy(true); try {
        const next = await ops.api.remoteSources(target, page?.next_cursor ?? null, c);
        if (valid(c, g) && latest.current.remote === target && targetScope.current.revision === revision)
            setPage({ page: { ...next, items: [...(page?.next_cursor ? page.items : []), ...next.items] }, target, revision, context: freezeDispatchContext(c), generation: g });
    }
    catch {
        setError(true);
    }
    finally {
        flight.current = false;
        if (mounted.current)
            setBusy(false);
    } };
    const can = (kind: RemoteAction['kind']) => !!selection && !!remote && connected && !busy && (kind === 'sync' ? available('upload_source') && selection.source_version_ids.length > 0 : kind === 'import' ? available('fetch_source_text') && selection.remote_source_ids.length > 0 : available('fetch_source_text') && selection.source_version_ids.length === 1 && selection.remote_source_ids.length === 1);
    const open = (kind: RemoteAction['kind']) => { const c = readTurnContext(); if (!can(kind) || !c?.ready || !remote || !selection)
        return; setConfirmation({ context: freezeDispatchContext(c), generation: sessionCoordinator.current(), scopeRevision: scope.current.revision, action: Object.freeze({ kind, remoteNotebookId: remote, versionIds: Object.freeze([...selection.source_version_ids]), remoteIds: Object.freeze([...selection.remote_source_ids]), idempotencyKey: crypto.randomUUID() }) }); };
    const confirmationValid = () => !!confirmation && confirmation.scopeRevision === scope.current.revision && valid(confirmation.context, confirmation.generation) && can(confirmation.action.kind) && latest.current.remote === confirmation.action.remoteNotebookId && JSON.stringify([latest.current.selection?.source_version_ids, latest.current.selection?.remote_source_ids]) === JSON.stringify([confirmation.action.versionIds, confirmation.action.remoteIds]) && !ops.controller?.getSnapshot().providerNeedsReauth;
    const confirm = () => { if (!confirmationValid() || !confirmation)
        return; const captured = confirmation; setConfirmation(null); const id = ops.store.capture(notebookId, { kind: 'remote', action: captured.action }, captured.context, captured.generation); void ops.run(id, () => !ops.controller?.getSnapshot().providerNeedsReauth && latest.current.remote === captured.action.remoteNotebookId && valid(captured.context, captured.generation)); };
    return <section className="remote-sources" aria-label={t.workbench.googleConnection}><h3>{t.workbench.googleConnection}</h3>{!connected && <p>{ops.state?.providerNeedsReauth ? m.google : t.workbench.connectionNotVerified}</p>}<Button disabled={!ops.ready || busy || ops.state?.providerChecking} onClick={() => { void verify(); }}>{m.verifyGoogle}</Button><details><summary>{t.workbench.capabilities}</summary><ul>{capabilities?.operations.map(c => <li key={c.name}>{c.name}: {c.support}</li>)}</ul></details>{remote ? <p className="source-id">{t.workbench.target}: {remote}</p> : <p>{t.workbench.googleLinkRequired}</p>}<Button disabled={!remote || !available('list_sources') || busy} onClick={() => { void list(); }}>{page?.next_cursor ? t.common.next : t.workbench.loadRemoteSources}</Button>{page && <><p>{t.workbench.remoteOriginalWarning}</p><ul>{page.items.map(r => <li key={r.id}><label className="source-check"><input type="checkbox" aria-label={r.title} checked={selection?.remote_source_ids.includes(r.id) ?? false} disabled={!selection || !connected || busy || !selection.remote_source_ids.includes(r.id) && selection.remote_source_ids.length >= 20} onChange={e => { if (selection)
        onRemoteSelection(e.target.checked ? [...selection.remote_source_ids, r.id] : selection.remote_source_ids.filter(id => id !== r.id)); }}/>{r.title}</label></li>)}</ul>{!page.listing_complete && <p>{t.workbench.listIncomplete}</p>}</>}<div className="source-actions"><Button disabled={!can('sync')} onClick={() => open('sync')}>{t.workbench.syncSelected}</Button><Button disabled={!can('import')} onClick={() => open('import')}>{t.workbench.importSelected}</Button><Button disabled={!can('associate')} onClick={() => open('associate')}>{t.workbench.associateSource}</Button></div>{error && <p role="alert">{t.workbench.error}</p>}<ConfirmSourceAction open={!!confirmation} title={t.workbench.confirmAction} description={confirmation?.action.kind === 'sync' ? t.workbench.syncConfirm : confirmation?.action.kind === 'import' ? t.workbench.importConfirm : t.workbench.associateConfirm} disabled={!confirmationValid()} onConfirm={confirm} onCancel={() => setConfirmation(null)}><p className="source-id">{confirmation?.action.remoteNotebookId}</p><ul>{confirmation?.action.versionIds.map(id => <li key={id}>{id}</li>)}{confirmation?.action.remoteIds.map(id => <li key={id}>{id}</li>)}</ul></ConfirmSourceAction></section>;
}
