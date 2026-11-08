import { mergeTurnHistory } from './turn-history';
import { readySources, originalScopeAvailable } from './chat-admission';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import type { WorkspaceViewV1, TurnView, RetrievalOptions } from '@study/contracts';
import { canReplayCapturedTurn, type EmbeddingDisclosure, type TurnOwner } from '@study/domain';
import { canDispatch, freezeDispatchContext, readTurnContext, sessionCoordinator, subscribeTurnContext, type DispatchContext } from '@study/web-transport';
import { useAppData, useAppDrafts } from '../../app/providers';
import { useWorkbenchDraft, useWorkbenchSnapshot } from '../../app/WorkbenchSession';
import { createTurnApi, notebookChatSessionId } from '../../data/turn-api';
import { useSourceSelection } from '../sources/use-source-selection';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { Composer } from './Composer';
import { Message, type CitationHandler } from './Message';
import { ScopeSummary } from './ScopeSummary';
import { TurnRecovery } from './TurnRecovery';
import { WorkspaceHistory } from '../notebooks/WorkspaceRecords';
/** B9 owns controls and fresh disclosure verification. A missing/invalid hybrid capture blocks, never falls back. */
export type ConversationRetrieval = Readonly<{
    options: Readonly<RetrievalOptions>;
    disclosure?: EmbeddingDisclosure;
    available: boolean;
    /** Bound to this original options/disclosure revision, including after replacement or route unmount. Never retarget to current controls. */
    isCurrent(): boolean;
}>;
export type OutlineOrigin = Readonly<{
    notebookId: string;
    sessionId: string;
    turnId: string;
    operationId: string;
    owner: TurnOwner;
}>;
type Evidence = {
    context: DispatchContext;
    generation: number;
    available: boolean;
    revision?: number;
};
export function ConversationPanel({ notebookId, workspace, onCitation, onSaveAnswer, onOutlineReady, retrieval }: {
    notebookId: string;
    workspace: WorkspaceViewV1;
    onCitation?: CitationHandler | undefined;
    onSaveAnswer?: ((turn: TurnView) => void) | undefined;
    onOutlineReady?: ((turn: TurnView, origin: OutlineOrigin) => void) | undefined;
    retrieval?: ConversationRetrieval | undefined;
}) {
    const { transport } = useAppData(), drafts = useAppDrafts(), runtime = drafts.turns, { state, controller } = useWorkbenchSnapshot(), { t, chat, session } = useI18n();
    const context = useSyncExternalStore(subscribeTurnContext, readTurnContext, () => null), snapshot = useSyncExternalStore(runtime.subscribe, () => runtime.getSnapshot(notebookId));
    const api = useMemo(() => transport ? createTurnApi(transport) : null, [transport]);
    const [draftSession, setDraftSession] = useState('question'), draft = useWorkbenchDraft(notebookId, draftSession);
    const savedDraft = useSyncExternalStore(drafts.subscribe, () => drafts.get(draft.id)), question = savedDraft?.question ?? '';
    const { selection, unconfirmed } = useSourceSelection(notebookId, context?.epoch, workspace), sourceRevision = drafts.sources.getSnapshot();
    const [model, setModel] = useState<Evidence | null>(null), [google, setGoogle] = useState<Evidence | null>(null), [modelBusy, setModelBusy] = useState(false), [googleBusy, setGoogleBusy] = useState(false), [modelError, setModelError] = useState(false), [historyError, setHistoryError] = useState(false), [history, setHistory] = useState<{
        context: DispatchContext;
        turns: readonly TurnView[];
    } | null>(null), [rejection, setRejection] = useState(false);
    const mounted = useRef(true), modelTicket = useRef(0), googleFlight = useRef(false);
    const ready = !!api && !!context?.ready && state?.ready === true;
    const validEvidence = (e: Evidence | null, provider = false) => !!e && ready && e.generation === sessionCoordinator.current() && canDispatch(e.context, readTurnContext()) && (!provider || controller?.getSnapshot().providerEvidenceRevision === e.revision && !controller?.getSnapshot().providerNeedsReauth && !controller?.getSnapshot().providerChecking);
    const readModel = async () => {
        if (!api || !context?.ready || !state?.ready)
            return;
        const captured = freezeDispatchContext(context), generation = sessionCoordinator.current(), ticket = ++modelTicket.current;
        // A replacement metadata read cannot renew evidence attached to an older request.
        runtime.retireModelAdmission(notebookId);
        setModelBusy(true);
        setModelError(false);
        setModel(null);
        try {
            const available = await api.modelAvailable(captured);
            if (mounted.current && ticket === modelTicket.current && canDispatch(captured, readTurnContext()) && generation === sessionCoordinator.current())
                setModel({ context: captured, generation, available });
        }
        catch {
            if (mounted.current && ticket === modelTicket.current)
                setModelError(true);
        }
        finally {
            if (mounted.current && ticket === modelTicket.current)
                setModelBusy(false);
        }
    };
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; modelTicket.current++; }; }, []);
    const epoch = context?.epoch, generation = sessionCoordinator.current();
    useEffect(() => {
        if (!ready)
            return;
        void readModel();
        const abort = new AbortController(), captured = freezeDispatchContext(readTurnContext()!), g = sessionCoordinator.current();
        setHistoryError(false);
        void api!.list(notebookChatSessionId(notebookId), captured, abort.signal).then(turns => {
            if (!abort.signal.aborted && g === sessionCoordinator.current() && canDispatch(captured, readTurnContext()))
                setHistory({ context: captured, turns });
        }).catch(() => {
            if (!abort.signal.aborted)
                setHistoryError(true);
        });
        return () => abort.abort();
    }, [api, notebookId, epoch, generation, ready]);
    const verifyGoogle = async () => {
        if (!api || !controller || !ready || googleFlight.current)
            return;
        googleFlight.current = true;
        setGoogleBusy(true);
        setGoogle(null);
        const c = freezeDispatchContext(readTurnContext()!), g = sessionCoordinator.current();
        try {
            const ok = await controller.verifyProviderConnection(), revision = controller.getSnapshot().providerEvidenceRevision;
            if (!ok || !mounted.current || g !== sessionCoordinator.current() || !canDispatch(c, readTurnContext()))
                return;
            const caps = await api.capabilities(c);
            if (mounted.current && g === sessionCoordinator.current() && canDispatch(c, readTurnContext()) && controller.getSnapshot().providerEvidenceRevision === revision && !controller.getSnapshot().providerNeedsReauth && !controller.getSnapshot().providerChecking)
                setGoogle({ context: c, generation: g, revision, available: caps.filter(v => v.name === 'ask').length === 1 && caps.find(v => v.name === 'ask')?.support === 'available' });
        }
        catch { /* Keep unavailable; do not choose another engine. */ }
        finally {
            googleFlight.current = false;
            if (mounted.current)
                setGoogleBusy(false);
        }
    };
    const link = workspace.link && !workspace.link.projection_status && 'remote_notebook_id' in workspace.link ? workspace.link : null;
    const remote = link && typeof link.remote_notebook_id === 'string' ? link.remote_notebook_id : null;
    const connectionId = link && 'connection_id' in link && typeof link.connection_id === 'string' ? link.connection_id : undefined;
    const options = selection?.engine === 'independent' ? (retrieval?.options ?? { retrieval_mode: 'lexical' as const }) : {};
    const availability = () => ready && !draft.retired && !unconfirmed && drafts.sources.getSnapshot() === sourceRevision && !!selection && (selection.selection_origin === 'local' ? readySources(workspace, selection.source_version_ids) : selection.remote_source_ids.length > 0) && (selection.engine === 'independent' ? selection.selection_origin === 'local' && validEvidence(model) && model!.available && !modelBusy : validEvidence(google, true) && google!.available && !!remote) && (!retrieval || selection.engine !== 'independent' || retrieval.available && retrieval.isCurrent());
    const canAsk = availability();
    const retryAvailable = () => { const op = runtime.registry.getSnapshot(notebookId); return !!op && ready && !draft.retired && !unconfirmed && drafts.sources.getSnapshot() === sourceRevision && originalScopeAvailable(op.capture, workspace); };
    const submit = (task: 'question' | 'outline') => {
        if (!api || !selection || !availability() || runtime.hasPending(notebookId) || task === 'outline' && options.retrieval_mode === 'hybrid')
            return;
        const captured = freezeDispatchContext(readTurnContext()!), g = sessionCoordinator.current(), providerRevision = controller?.getSnapshot().providerEvidenceRevision;
        const message = task === 'outline' ? t.workbench.outlinePrompt : question.trim();
        if (!message)
            return;
        const request = { ...options, task, notebook_id: notebookId, engine: selection.engine, selection_origin: selection.selection_origin, source_version_ids: [...selection.source_version_ids], remote_source_ids: [...selection.remote_source_ids], remote_notebook_id: selection.engine === 'notebooklm' ? remote : null, message };
        if (!canReplayCapturedTurn({ dto: { ...request, idempotency_key: 'validation-only' }, ...(retrieval?.disclosure ? { embeddingDisclosure: retrieval.disclosure } : {}) })) {
            setRejection(true);
            return;
        }
        const revision = savedDraft?.questionRevision ?? 0, id = draft.id;
        const valid = () => g === sessionCoordinator.current() && canDispatch(captured, readTurnContext()) && controller?.getSnapshot().ready === true && (request.engine !== 'notebooklm' || controller.getSnapshot().providerEvidenceRevision === providerRevision && !controller.getSnapshot().providerNeedsReauth && !controller.getSnapshot().providerChecking);
        // Bind admission to the original engine evidence and retrieval callback, never later UI settings.
        const originalEvidence = request.engine === 'independent' ? model : google;
        const retrievalAvailable = retrieval?.available, retrievalCurrent = retrieval?.isCurrent.bind(retrieval);
        const admission = () => validEvidence(originalEvidence, request.engine === 'notebooklm') && originalEvidence!.available && (request.engine !== 'independent' || !retrievalCurrent || retrievalAvailable === true && retrievalCurrent());
        const result = runtime.start({ sessionId: notebookChatSessionId(notebookId), context: captured, request, owner: { mountId: id.editorSession, questionRevision: revision, requestGeneration: g }, ...(connectionId ? { googleConnectionId: connectionId } : {}), ...(retrieval?.disclosure ? { embeddingDisclosure: retrieval.disclosure } : {}) }, api, valid, () => {
            if (task === 'question')
                drafts.clearQuestion(id, revision);
        }, () => { const checkGeneration = sessionCoordinator.current(), checkRevision = controller?.getSnapshot().providerEvidenceRevision; return () => canDispatch(captured, readTurnContext()) && checkGeneration === sessionCoordinator.current() && controller?.getSnapshot().ready === true && controller.getSnapshot().providerEvidenceRevision === checkRevision; }, admission);
        setRejection(!result.ok);
    };
    const currentHistory = history && context?.epoch === history.context.epoch ? history.turns : [];
    // Completion advances the existing message; ambiguous/unknown rows are not hidden by an ID collision.
    const turns = mergeTurnHistory(workspace.turns, currentHistory, snapshot.turns);
    useEffect(() => {
        if (!onOutlineReady || snapshot.retired || !ready)
            return;
        for (const result of snapshot.outlines) {
            const { turn, capture } = result;
            if (typeof turn.turn_id !== 'string')
                continue;
            runtime.consumeOutline(notebookId, turn.turn_id);
            onOutlineReady(turn, { notebookId, sessionId: capture.sessionId, turnId: turn.turn_id, operationId: capture.operationId, owner: capture.owner });
        }
    }, [snapshot.outlines, snapshot.retired, onOutlineReady, notebookId, ready, runtime]);
    return <><div className="panel-heading"><h2>{t.workbench.conversation}</h2><span className="meta">{turns.length}</span></div><div className="conversation-scroll" aria-label={t.workbench.history}>{historyError && <p role="status">{chat.historyFailed}</p>}<WorkspaceHistory workspace={workspace}/>{turns.map((turn, i) => <Message key={i} turn={turn} index={i} onCitation={onCitation} onSaveAnswer={onSaveAnswer}/>)}<TurnRecovery snapshot={snapshot} canCheck={ready && !snapshot.retired && !!snapshot.operation && canDispatch(snapshot.operation.capture.context, context)} canRetry={runtime.canRetry(notebookId, retryAvailable)} onCheck={() => { void runtime.check(notebookId); }} onRetry={() => runtime.retry(notebookId, retryAvailable)} onAbandon={() => runtime.abandon(notebookId)} onStop={() => runtime.stop(notebookId)}/></div>
 <div className="chat-admission">{!selection && <p>{t.workbench.selectionUnsupported}</p>}{selection?.selection_origin === 'local' && !readySources(workspace, selection.source_version_ids) && <p>{selection.source_version_ids.length ? t.workbench.selectedSourcesBlocked : t.workbench.emptySelection}</p>}{selection?.engine === 'independent' && <><p role="status">{modelBusy ? t.workbench.modelChecking : modelError ? t.workbench.modelCheckFailed : validEvidence(model) && model?.available ? t.workbench.modelConfigured : t.workbench.notConfigured}</p><Button disabled={!ready || modelBusy} onClick={() => { void readModel(); }}>{t.workbench.retry}</Button></>}{selection?.engine === 'notebooklm' && <><p>{validEvidence(google, true) && google?.available ? t.workbench.connectionStates.connected : state?.providerNeedsReauth ? session.google : t.workbench.connectionNotVerified}</p><Button disabled={!ready || googleBusy || state?.providerChecking} onClick={() => { void verifyGoogle(); }}>{session.verifyGoogle}</Button>{!remote && <p>{t.workbench.googleLinkRequired}</p>}</>}<Link className="record-link" to="/settings/models">{t.workbench.modelSettings}</Link>{options.retrieval_mode === 'hybrid' && <p>{t.workbench.hybridOutlineUnavailable}</p>}{rejection && <p role="alert">{t.workbench.turnRecoveryInvalid}</p>}</div>
 <Composer question={question} onChange={value => drafts.update(draft.id, { question: value })} onSubmit={() => submit('question')} onOutline={options.retrieval_mode === 'hybrid' ? undefined : () => submit('outline')} disabled={!canAsk || !!snapshot.operation} readOnly={draft.retired} onNewDraft={() => setDraftSession(`question:${crypto.randomUUID()}`)} scope={<ScopeSummary selection={selection} unconfirmed={unconfirmed}/>}/><p className="panel-hint chat-outline-hint">{chat.outlineOnly}</p></>;
}
