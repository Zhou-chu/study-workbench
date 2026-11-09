import { useSyncExternalStore } from 'react';
import { useAppDrafts } from '../../app/providers';
import type { WorkspaceViewV1 } from '@study/contracts';
import { selectionFromView } from './source-selection';
/** Unresolved intent stays frozen. A succeeded overlay yields only to a read begun after its settlement. */
export function useSourceSelection(notebookId: string, epoch: number | undefined, workspace: WorkspaceViewV1 | undefined) {
    const store = useAppDrafts().sources;
    const rows = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const operation = [...rows].reverse().find(row => row.notebookId === notebookId && row.payload.kind === 'selection' && !row.retired && row.operation.context.epoch === epoch);
    const read = store.getSelectionRead(notebookId);
    // Generation gates incoming reads; an already accepted same-epoch value must not fall back to an older payload on app refresh.
    const authoritative = read && read.token.selectionOperation === operation && read.token.context.epoch === epoch;
    return {
        operation,
        selection: authoritative ? read.selection : operation?.payload.kind === 'selection' ? operation.payload.selection : selectionFromView(workspace?.selection),
        unconfirmed: rows.some(row => row.notebookId === notebookId && row.payload.kind === 'selection' && ['idle', 'submitting', 'unknown'].includes(row.operation.state)),
    };
}
