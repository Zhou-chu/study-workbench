import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { EvidenceCitationView, ReadingPosition, WorkspaceViewV1 } from '@study/contracts';
import { readTurnContext, sessionCoordinator } from '@study/web-transport';
import { useSourceOperations } from '../sources/use-source-operations';
import { selectionFromView, type SourceReadIntent } from '../sources/source-selection';
import type { CitationOrigin } from '../chat/Message';
import { createReaderNavigation, readerIsCurrent, restoreReaderFocus, type ReaderIntent } from './navigation';
/** Read history contains opaque handles only, never document text, credentials or pending writes. */
export function useNotebookReader(notebookId: string, workspace: WorkspaceViewV1 | undefined) {
    const location = useLocation(), navigate = useNavigate(), ops = useSourceOperations(notebookId);
    const entries = useRef(new Map<string, ReaderIntent>()), previous = useRef<ReaderIntent | null>(null);
    const [last, setLast] = useState<ReaderIntent | null>(null);
    const [unsaved, setUnsaved] = useState(false);
    const latestPosition = useRef<{
        key: string;
        position: ReadingPosition;
    } | null>(null), positionTicket = useRef(0);
    const key = typeof location.state?.readerKey === 'string' ? location.state.readerKey : null;
    const active = key ? entries.current.get(key) : null;
    const intent = active ?? last;
    const valid = intent?.notebookId === notebookId;
    const open = !!active && valid;
    useEffect(() => { if (!active && previous.current?.notebookId === notebookId)
        restoreReaderFocus(previous.current); previous.current = active ?? null; }, [active, notebookId]);
    function show(next: ReaderIntent) { setUnsaved(false); latestPosition.current = null; positionTicket.current++; entries.current.set(next.key, next); while (entries.current.size > 20)
        entries.current.delete(entries.current.keys().next().value!); setLast(next); void navigate(location.pathname + location.search, { state: { ...location.state, readerKey: next.key }, replace: open, preventScrollReset: true }); }
    const controller = () => { const context = readTurnContext(); return context?.ready ? createReaderNavigation({ notebookId, context, generation: sessionCoordinator.current() }) : null; };
    function savePosition(position: ReadingPosition) { if (!intent || !workspace || !readerIsCurrent(intent) || !ops.controller?.getSnapshot().ready)
        return; const ticket = ++positionTicket.current; latestPosition.current = { key: intent.key, position }; setUnsaved(true); const rows = ops.store.getSnapshot(), epoch = intent.context.epoch; const operation = [...rows].reverse().find(row => row.notebookId === notebookId && row.payload.kind === 'selection' && !row.retired && row.operation.context.epoch === epoch); if (rows.some(row => row.notebookId === notebookId && row.payload.kind === 'selection' && ['idle', 'submitting', 'unknown'].includes(row.operation.state)))
        return; const read = ops.store.getSelectionRead(notebookId); const selection = read && read.token.context.epoch === epoch && read.token.selectionOperation === operation ? read.selection : operation?.payload.kind === 'selection' ? operation.payload.selection : selectionFromView(workspace.selection); if (!selection || position.source_version_id !== intent.source_version_id)
        return; const id = ops.store.capture(notebookId, { kind: 'selection', selection: { ...selection, source_version_ids: [...selection.source_version_ids], remote_source_ids: [...selection.remote_source_ids], reading: position } }, intent.context, intent.generation); void ops.run(id).then(() => { if (positionTicket.current === ticket)
        setUnsaved(ops.store.get(id)?.operation.state !== 'succeeded'); }); }
    return { intent: valid ? intent : null, open,
        openCitation(c: EvidenceCitationView, origin: CitationOrigin) { const next = controller()?.openCitation(c, origin); if (next)
            show(next); },
        openSource(source: SourceReadIntent) { const element = document.activeElement; if (element instanceof HTMLElement && !element.id)
            element.id = 'reader-origin:' + crypto.randomUUID(); const next = controller()?.openSource(source, element instanceof HTMLElement ? { focusKey: element.id } : null); if (next)
            show(next); },
        close() { if (open)
            void navigate(-1); },
        onPositionChange: savePosition,
        unsavedPosition: unsaved,
        savePosition() { if (latestPosition.current?.key === intent?.key)
            savePosition(latestPosition.current!.position); },
        positionSaveBlocked: !ops.ready || ops.rows.some(row => row.payload.kind === 'selection' && ['idle', 'submitting', 'unknown'].includes(row.operation.state))
    };
}
