import { studioStateLabel } from './ArtifactCard';
import { useEffect, useRef, useState } from 'react';
import type { ArtifactView, WorkspaceViewV1 } from '@study/contracts';
import { canDispatch, freezeDispatchContext, readTurnContext, sessionCoordinator, type DispatchContext } from '@study/web-transport';
import { useAppDrafts } from '../../app/providers';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { useSourceSelection } from '../sources/use-source-selection';
import { StudioConfirm } from './StudioConfirm';
import { AudioArtifact } from './AudioArtifact';
import type { StudioConnection } from './use-studio';
import type { StudioPayload, RemoteTargetAdmission } from './studio-store';
type ProviderCapture = {
    context: DispatchContext;
    generation: number;
    revision: number;
    remote: string;
    targetAdmission: RemoteTargetAdmission;
};
export function RemoteAudioControls({ notebookId, workspace, connection: c }: {
    notebookId: string;
    workspace: WorkspaceViewV1;
    connection: StudioConnection;
}) {
    const { t, studio, session } = useI18n(), sources = useAppDrafts().sources, { selection, unconfirmed } = useSourceSelection(notebookId, c.context?.epoch, workspace), [language, setLanguage] = useState('zh'), [caps, setCaps] = useState<{
        capture: ProviderCapture;
        names: string[];
    } | null>(null), [page, setPage] = useState<{
        capture: ProviderCapture;
        items: ArtifactView[];
    } | null>(null), [confirm, setConfirm] = useState<{
        capture: ProviderCapture;
        payload: StudioPayload;
        selectionRevision: ReturnType<typeof sources.getSnapshot>;
        scopeRevision: number;
    } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(false), mounted = useRef(true), flight = useRef(false), admissionOwner=useRef(crypto.randomUUID());
    const remote = workspace.link && !workspace.link.projection_status && 'remote_notebook_id' in workspace.link && typeof workspace.link.remote_notebook_id === 'string' ? workspace.link.remote_notebook_id : null;
    const targetFingerprint = JSON.stringify([notebookId, remote, workspace.link, c.context?.epoch]), target = useRef({ fingerprint: targetFingerprint, revision: 0 });
    if (target.current.fingerprint !== targetFingerprint)
        target.current = { fingerprint: targetFingerprint, revision: target.current.revision + 1 };
    const scopeFingerprint = JSON.stringify([selection, language]), scope = useRef({ fingerprint: scopeFingerprint, revision: 0 });
    if (scope.current.fingerprint !== scopeFingerprint)
        scope.current = { fingerprint: scopeFingerprint, revision: scope.current.revision + 1 };
    const latest = useRef({ remote, selection, unconfirmed });
    latest.current = { remote, selection, unconfirmed };
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const valid = (a: ProviderCapture|null) => { const state = c.controller?.getSnapshot(); return !!a && !sources.selectionUnconfirmed(notebookId,a.context.epoch) && mounted.current && canDispatch(a.context, readTurnContext()) && a.generation === sessionCoordinator.current() && state?.ready === true && !state.providerNeedsReauth && !state.providerChecking && state.providerEvidenceRevision === a.revision && latest.current.remote === a.remote && !!a.targetAdmission && a.targetAdmission.ownerId===admissionOwner.current && target.current.revision===a.targetAdmission.revision; };
    const available = (name: string) => !!caps && valid(caps.capture) && caps.names.filter(n => n === name).length === 1;
    async function verify() {
        if (!c.api || !c.controller || !c.ready || !remote || flight.current)
            return;
        const context = freezeDispatchContext(readTurnContext()!), generation = sessionCoordinator.current(), remoteTarget = remote, targetAdmission=Object.freeze({ownerId:admissionOwner.current,revision:target.current.revision});
        flight.current = true;
        setBusy(true);
        setCaps(null);
        setPage(null);
        setError(false);
        try {
            const ok = await c.controller.verifyProviderConnection(), capture = { context, generation, revision: c.controller.getSnapshot().providerEvidenceRevision, remote: remoteTarget, targetAdmission };
            if (!ok || !valid(capture))
                return;
            const result = await c.api.capabilities(context);
            if (valid(capture))
                setCaps({ capture, names: result.filter(v => v.support === 'available').map(v => v.name) });
        }
        catch {
            if (mounted.current)
                setError(true);
        }
        finally {
            flight.current = false;
            if (mounted.current)
                setBusy(false);
        }
    }
    async function list() {
        if (!c.api || !caps || !available('list_artifacts') || flight.current)
            return;
        const capture = caps.capture;
        flight.current = true;
        setBusy(true);
        setError(false);
        setPage(null);
        try {
            const items = await c.api.remoteArtifacts(capture.remote, capture.context);
            if (valid(capture))
                setPage({ capture, items });
        }
        catch {
            if (mounted.current)
                setError(true);
        }
        finally {
            flight.current = false;
            if (mounted.current)
                setBusy(false);
        }
    }
    const scoped = available('generate_audio') && selection?.selection_origin === 'remote' && selection.engine === 'notebooklm' && selection.remote_source_ids.length > 0 && selection.remote_source_ids.length <= 20 && !unconfirmed && language.trim().length >= 2 && language.length <= 20;
    const confirmationValid = () => !!confirm && valid(confirm.capture) && sources.getSnapshot() === confirm.selectionRevision && scope.current.revision === confirm.scopeRevision && !latest.current.unconfirmed && (confirm.payload.kind === 'audio' ? available('generate_audio') : available('download_artifact'));
    return <section aria-label={t.workbench.audio}><h3>{t.workbench.audio}</h3><Button disabled={!c.ready || !remote || busy} onClick={() => void verify()}>{session.verifyGoogle}</Button>{!caps && <p>{t.workbench.capabilityUnverified}</p>}{selection?.selection_origin === 'local' && <p>{studio.localAudioUnavailable}</p>}<label htmlFor="studio-audio-language">{t.workbench.audioLanguage}</label><input id="studio-audio-language" value={language} onChange={e => setLanguage(e.target.value)}/><Button disabled={!scoped || busy} onClick={() => {
            if (!scoped || !caps || !selection)
                return;
            setConfirm({ capture: caps.capture, selectionRevision: sources.getSnapshot(), scopeRevision: scope.current.revision, payload: { kind: 'audio', providerRevision: caps.capture.revision, targetAdmission:caps.capture.targetAdmission, request: { remote_notebook_id: caps.capture.remote, remote_source_ids: [...selection.remote_source_ids], source_version_ids: [], language } } });
        }}>{t.workbench.audio}</Button><Button disabled={!available('list_artifacts') || busy} onClick={() => void list()}>{t.workbench.listArtifacts}</Button>{page && valid(page.capture) && page.items.map((artifact, index) => <article className="artifact-card" key={String(artifact.id) + index}><h4>{typeof artifact.title === 'string' ? artifact.title : t.common.unknown}</h4><Button disabled={!available('download_artifact') || busy} onClick={() => {
                if (typeof artifact.id !== 'string')
                    return;
                setConfirm({ capture: page.capture, selectionRevision: sources.getSnapshot(), scopeRevision: scope.current.revision, payload: { kind: 'download', providerRevision: page.capture.revision, targetAdmission:page.capture.targetAdmission, remoteNotebookId: page.capture.remote, remoteArtifactId: artifact.id } });
            }}>{t.workbench.downloadArtifact}</Button></article>)}{c.operations.filter(r => r.payload.kind === 'audio' || r.payload.kind === 'download').map(row => { const payload=row.payload; const capture:ProviderCapture|null=payload.kind==='audio'||payload.kind==='download'?{context:row.operation.context,generation:row.operation.sessionGeneration,revision:payload.providerRevision,targetAdmission:payload.targetAdmission,remote:payload.kind==='audio'?payload.request.remote_notebook_id:payload.remoteNotebookId}:null; return <article className="artifact-card" key={row.id}><p>{studioStateLabel(row.job?.state ?? row.operation.state, t)}</p>{row.job?.remoteMayContinue && <p>{t.workbench.remoteMayContinue}</p>}{row.operation.state === 'unknown' && <p role="alert">{t.workbench.unknownSubmission}</p>}{row.job && ['queued', 'running', 'waiting_remote'].includes(row.job.state) && <><Button disabled={!valid(capture) || row.busy} onClick={() => void c.observe(row.id, false, () => valid(capture))}>{t.common.refresh}</Button><Button disabled={!valid(capture) || row.busy} onClick={() => void c.observe(row.id, true, () => valid(capture))}>{t.workbench.cancelWaiting}</Button><p>{t.workbench.remoteMayContinue}</p></>}{row.job?.artifact && <AudioArtifact artifact={row.job.artifact} remoteMayContinue={row.job.remoteMayContinue} {...(row.job.downloaded === true && c.api ? { onLoad: () => c.api!.downloadArtifact(row.job!.artifact!, notebookId, row.operation.context) } : {})} valid={() => !row.retired && canDispatch(row.operation.context, readTurnContext()) && row.operation.sessionGeneration === sessionCoordinator.current()}/>}</article>; })}{error && <p role="alert">{t.workbench.error}</p>}{confirm && <StudioConfirm title={t.workbench.confirmAction} description={confirm.payload.kind === 'audio' ? t.workbench.audioConfirm : t.workbench.downloadArtifact} disabled={!confirmationValid()} onCancel={() => setConfirm(null)} onConfirm={() => {
                if (!confirmationValid())
                    return;
                const captured = confirm, id = c.store.capture(notebookId, captured.payload, captured.capture.context, captured.capture.generation);
                setConfirm(null);
                void c.run(id, () => valid(captured.capture) && sources.getSnapshot() === captured.selectionRevision && scope.current.revision === captured.scopeRevision && !latest.current.unconfirmed);
            }}><p>{t.workbench.target}: {confirm.capture.remote}</p>{confirm.payload.kind === 'audio' && <><p>{t.workbench.selectedRemoteSources}: {confirm.payload.request.remote_source_ids.join(', ')}</p><p>{t.workbench.audioLanguage}: {confirm.payload.request.language}</p></>}</StudioConfirm>}</section>;
}
