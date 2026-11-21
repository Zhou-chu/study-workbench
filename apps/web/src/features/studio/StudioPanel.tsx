import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { WorkspaceViewV1, NoteView, EvidenceCitationView, SnapshotOrigin, ArtifactView, TurnView } from '@study/contracts';
import { canDispatch, readTurnContext, sessionCoordinator } from '@study/web-transport';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { Markdown } from '../../ui/Markdown';
import { noteForEditor, parseLocalArtifact, parseScope, parseCitation } from '../../data/studio-api';
import type { NoteCitationOrigin } from '../reader/navigation';
import { useStudio } from './use-studio';
import { compatibleNoteMetadata, type NoteSession } from './studio-store';
import { NoteEditor } from './NoteEditor';
import { AudioArtifact } from './AudioArtifact';
import { ArtifactCard, studioStateLabel } from './ArtifactCard';
import { PortableDialog } from './PortableDialog';
import { RemoteAudioControls } from './RemoteAudioControls';
import { StudioConfirm } from './StudioConfirm';
export function promotableTurn(turn: TurnView, notebookId: string): SnapshotOrigin | null {
    try {
        if (turn.projection_status || turn.notebook_id !== notebookId || turn.status !== 'succeeded' || typeof turn.turn_id !== 'string' || !turn.turn_id || typeof turn.answer !== 'string' || !turn.answer.trim() || !Array.isArray(turn.citations))
            return null;
        parseScope(turn.scope_snapshot);
        turn.citations.forEach(v => parseCitation(v));
        return { kind: 'turn', id: turn.turn_id };
    }
    catch {
        return null;
    }
}
// Classic reads omit evidence metadata. They must not bypass a personal projection.
export function classicCandidate(note: NoteView, workspaceNotes: readonly NoteView[]): boolean { return typeof note.id === 'string' && workspaceNotes.every(existing => existing.id !== note.id || noteForEditor(existing)?.mode === 'classic'); }
/** Saved status only. These rows never authorize replay or create local operation captures. */
export function savedArtifactProgress(jobs: WorkspaceViewV1['jobs'], representedIds: readonly string[]) {
    const represented = new Set(representedIds);
    return jobs.filter(job => 'operation' in job && typeof job.operation === 'string' && ['audio', 'download', 'portable_export'].includes(job.operation) && !('job_id' in job && typeof job.job_id === 'string' && represented.has(job.job_id)));
}
export function StudioPanel({ notebookId, workspace, onCitation }: {
    notebookId: string;
    workspace: WorkspaceViewV1;
    onCitation?: (c: EvidenceCitationView, origin: NoteCitationOrigin) => void;
}) {
    const { t, studio, session } = useI18n(), query = useQueryClient(), c = useStudio(notebookId, () => void query.invalidateQueries({ queryKey: ['workspace'] })), [classic, setClassic] = useState<NoteView[] | null>(null), [error, setError] = useState(false), [transition, setTransition] = useState<{
        from: NoteSession;
        to: string | null;
    } | null>(null), [reload, setReload] = useState<NoteSession | null>(null), [deletion, setDeletion] = useState<{
        note: NoteView;
        context: NonNullable<typeof c.context>;
        generation: number;
    } | null>(null);
    const activeId = c.snapshot.active.get(notebookId), active = activeId ? c.store.get(activeId) : undefined;
    function select(id: string | null) {
        const currentId = c.store.getSnapshot().active.get(notebookId), current = currentId ? c.store.get(currentId) : undefined;
        if (current?.editor.pending)
            return;
        if (current?.editor.dirty) {
            setTransition({ from: current, to: id });
            return;
        }
        c.store.select(notebookId, id);
    }
    function open(note?: NoteView, mode: 'personal' | 'classic' = 'personal') {
        const context = readTurnContext();
        if (!c.ready || !context)
            return;
        const parsed = note ? noteForEditor(note) : null;
        if (note && !parsed)
            return;
        const id = c.store.open(notebookId, parsed?.draft ?? { title: '', content: '', citations: [], scope_snapshot: { source_version_ids: [] } }, context, sessionCoordinator.current(), parsed?.note, parsed?.mode ?? mode, parsed?.noteType ?? 'human');
        select(id);
    }
    async function listClassic() {
        if (!c.ready || !c.api || !c.context)
            return;
        const context = c.context, g = sessionCoordinator.current();
        setError(false);
        try {
            const notes = await c.api.listClassic(notebookId, context);
            if (canDispatch(context, readTurnContext()) && g === sessionCoordinator.current())
                setClassic(notes);
        }
        catch {
            setError(true);
        }
    }
    function promote(origin: SnapshotOrigin) {
        const context = readTurnContext();
        if (!c.ready || !context)
            return;
        const id = c.store.capture(notebookId, { kind: 'promote', origin }, context, sessionCoordinator.current());
        void c.run(id);
    }
    const notes = workspace.notes;
    const localArtifacts: ArtifactView[] = [];
    for (const job of workspace.jobs) {
        if ('result' in job && job.result && !job.result.projection_status && 'downloaded' in job.result && job.result.downloaded === true && 'artifact' in job.result) {
            try {
                localArtifacts.push(parseLocalArtifact(job.result.artifact, notebookId));
            }
            catch { /* Preserve the job below, but do not invent an actionable local asset. */ }
        }
    }
    const savedProgress = savedArtifactProgress(workspace.jobs, c.operations.flatMap(row => row.job ? [row.job.jobId] : []));
    const progress = (backup: boolean) => savedProgress.filter(job => 'operation' in job && (job.operation === 'portable_export') === backup).map((job, index) => {
        const operation = 'operation' in job ? job.operation : null;
        const rawState = 'state' in job && typeof job.state === 'string' && !job.projection_status ? job.state : 'unknown';
        const label = operation === 'audio' ? t.workbench.jobOperations.audio : operation === 'download' ? t.workbench.jobOperations.download : t.workbench.jobOperations.export;
        return <div key={index} className="artifact-progress"><p role="status">{label} · {studioStateLabel(rawState, t)}</p>{'remote_may_continue' in job && job.remote_may_continue === true && <p>{t.workbench.remoteMayContinue}</p>}{operation === 'audio' && rawState === 'succeeded' && !('result' in job && job.result && !job.result.projection_status && 'downloaded' in job.result && job.result.downloaded === true) && <p>{t.workbench.artifactNotSaved}</p>}</div>;
    });
    function card(note: NoteView, index: number, nativeList = false) {
        const parsed = nativeList && !classicCandidate(note, workspace.notes) ? null : noteForEditor(note), id = typeof note.id === 'string' ? note.id : undefined;
        return <ArtifactCard key={`${id ?? 'unknown'}:${index}`} title={typeof note.title === 'string' ? note.title : t.common.unknown}><details><summary>{t.workbench.read}</summary>{typeof note.content === 'string' && <Markdown>{note.content}</Markdown>}{typeof note.revision === 'number' && <p>{t.noteConflict.serverRevision}: {note.revision}</p>}</details>{!parsed && <p>{studio.readOnly}</p>}<Button disabled={!c.ready || !parsed} onClick={() => open(note)}>{t.common.edit}</Button>{parsed?.mode === 'classic' && <Button disabled={!c.ready || !c.context || c.store.noteMutationBlocked(id, c.context) || c.notes.some(n => n.editor.noteId === id && (n.editor.dirty || n.editor.pending))} onClick={() => {
                    const context = readTurnContext();
                    if (context)
                        setDeletion({ note, context, generation: sessionCoordinator.current() });
                }}>{t.common.delete}</Button>}</ArtifactCard>;
    }
    return <div className="studio-panel"><div className="panel-heading"><div><span className="eyebrow">{t.common.note}</span><h2>{t.workbench.notes}</h2></div><Button variant="primary" disabled={!c.ready} onClick={() => open()}>{t.common.new} {t.common.note}</Button></div><div className="studio-content">{active && <><NoteEditor classic={active.mode === 'classic'} {...(active.classic?.base ? { classicBase: active.classic.base } : {})} metadataCompatible={compatibleNoteMetadata(active)} draft={active.editor} readOnly={active.retired || c.store.noteMutationBlocked(active.editor.noteId, active.context)} readOnlyReason={c.store.noteMutationBlocked(active.editor.noteId, active.context) ? studio.noteDeletion : undefined} disabled={!c.ready || !canDispatch(active.context, readTurnContext())} onEdit={patch => c.store.edit(active.id, patch)} onSave={() => void c.save(active.id)} onClose={() => select(null)} {...(active.latest ? { latest: active.latest } : {})} {...(active.comparison ? { candidates: active.comparison } : {})} onCompare={() => void c.compare(active.id).then(ok => setError(!ok))} onReedit={() => c.store.reedit(active.id, active, readTurnContext(), sessionCoordinator.current())} onReload={() => setReload(active)} {...(onCitation ? { onCitation } : {})}/><Button disabled={!c.ready || !c.store.promotion(active.id)} onClick={() => {
                    const origin = c.store.promotion(active.id);
                    if (origin)
                        promote(origin);
                }}>{t.sourceSnapshots.add}</Button>{active.editor.dirty && <p>{t.sourceSnapshots.saveFirst}</p>}<p>{t.sourceSnapshots.notIndependentEvidence}</p></>}{c.notes.length > 0 && <details className="retained-notes" open={!active}><summary>{studio.retained} ({c.notes.length})</summary>{c.notes.map(row => <div key={row.id}><span>{row.editor.title || t.common.note} · {studioStateLabel(row.editor.saveResult, t)}</span><Button disabled={row.id === activeId || !!active?.editor.pending} onClick={() => select(row.id)}>{studio.resume}</Button>{row.history.length > 0 && <details><summary>{studio.savedCopy}</summary>{row.history.map((h, i) => <div key={i}><h4>{h.editor.title}</h4><Markdown>{h.editor.content}</Markdown></div>)}</details>}</div>)}</details>}{notes.length ? notes.map((n, i) => card(n, i)) : <div className="studio-empty"><span aria-hidden="true" className="empty-icon">↗</span><h3>{t.learningWorkspace.notesEmpty}</h3><p>{t.learningWorkspace.studioDescription}</p></div>}<details className="studio-tools"><summary>{t.learningWorkspace.classicNotebook}</summary><div className="studio-actions"><Button disabled={!c.ready} onClick={() => open(undefined, 'classic')}>{studio.newClassic}</Button><Button disabled={!c.ready} onClick={() => void listClassic()}>{t.common.refresh} {t.learningWorkspace.classicNotebook}</Button></div>{classic?.map((n, i) => card(n, i, true))}</details>{localArtifacts.map((artifact, index) => <AudioArtifact key={String(artifact.artifact_id) + index} artifact={artifact} {...(c.api && c.context ? { onLoad: () => c.api!.downloadArtifact(artifact, notebookId, c.context!) } : {})} valid={() => c.ready}/>)}{workspace.turns.length > 0 && <details className="studio-tools"><summary>{t.workbench.history} ({workspace.turns.length})</summary>{workspace.turns.map((turn, index) => {
                const origin = promotableTurn(turn, notebookId);
                return <ArtifactCard key={index} title={'message' in turn && typeof turn.message === 'string' ? turn.message : t.workbench.history}><Button disabled={!c.ready || !origin} onClick={() => {
                        if (origin)
                            promote(origin);
                    }}>{t.sourceSnapshots.add}</Button><p>{t.sourceSnapshots.notIndependentEvidence}</p></ArtifactCard>;
            })}</details>}<details className="studio-tools"><summary>{t.workbench.audio}</summary>{progress(false)}<RemoteAudioControls notebookId={notebookId} workspace={workspace} connection={c}/></details><details className="studio-tools"><summary>{t.workbench.exportProject} / {t.workbench.restoreProject}</summary>{progress(true)}<PortableDialog notebookId={notebookId} connection={c}/></details>{c.operations.filter(r => r.payload.kind === 'promote' || r.payload.kind === 'delete').map(row => <p key={row.id} role="status">{row.promoted ? t.sourceSnapshots.added : row.operation.state === 'unknown' ? t.workbench.unknownSubmission : studioStateLabel(row.operation.state, t)}</p>)}{error && <p role="alert">{t.noteConflict.readFailed}</p>}{transition && <StudioConfirm title={session.unsavedTitle} description={session.unsavedHint} confirmLabel={studio.keepOpen} disabled={c.store.get(transition.from.id) !== transition.from || !!transition.from.editor.pending} onCancel={() => setTransition(null)} onConfirm={() => {
                if (c.store.get(transition.from.id) !== transition.from || transition.from.editor.pending)
                    return;
                c.store.select(notebookId, transition.to);
                setTransition(null);
            }}><Button disabled={c.store.get(transition.from.id) !== transition.from || !!transition.from.editor.pending || !['idle', 'saved'].includes(transition.from.editor.saveResult)} onClick={() => {
                if (c.store.discardNote(transition.from.id, transition.from, readTurnContext(), sessionCoordinator.current())) {
                    c.store.select(notebookId, transition.to);
                    setTransition(null);
                }
            }}>{t.workbench.noteTransitionReplace}</Button></StudioConfirm>}{reload && <StudioConfirm title={t.noteConflict.discardTitle} description={studio.savedCopy} disabled={c.store.get(reload.id) !== reload} onCancel={() => setReload(null)} onConfirm={() => {
                if (c.store.reload(reload.id, reload, readTurnContext(), sessionCoordinator.current()))
                    setReload(null);
            }}/>}{deletion && <StudioConfirm title={t.common.delete} description={t.common.delete} disabled={!c.ready || !classicCandidate(deletion.note, workspace.notes) || !canDispatch(deletion.context, readTurnContext()) || deletion.generation !== sessionCoordinator.current()} onCancel={() => setDeletion(null)} onConfirm={() => {
                if (typeof deletion.note.id !== 'string' || !classicCandidate(deletion.note, workspace.notes) || !canDispatch(deletion.context, readTurnContext()) || deletion.generation !== sessionCoordinator.current())
                    return;
                const id = c.store.capture(notebookId, { kind: 'delete', noteId: deletion.note.id }, deletion.context, deletion.generation);
                setDeletion(null);
                void c.run(id);
            }}><p>{typeof deletion.note.title === 'string' ? deletion.note.title : ''}</p></StudioConfirm>}</div></div>;
}
