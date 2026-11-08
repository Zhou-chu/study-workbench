import { useSyncExternalStore } from 'react';
import { useAppDrafts } from '../../app/providers';
import type { WorkspaceViewV1 } from '@study/contracts';
import { selectionFromView } from './source-selection';
/** Desired scope stays frozen while a selection write is unresolved. Consumers must honor unconfirmed. */
export function useSourceSelection(notebookId: string, epoch: number | undefined, workspace: WorkspaceViewV1) { const store = useAppDrafts().sources; const rows = useSyncExternalStore(store.subscribe, store.getSnapshot); const operation = [...rows].reverse().find(r => r.notebookId === notebookId && r.payload.kind === 'selection' && !r.retired && r.operation.context.epoch === epoch); return { operation, selection: operation?.payload.kind === 'selection' ? operation.payload.selection : selectionFromView(workspace.selection), unconfirmed: rows.some(r => r.notebookId === notebookId && r.payload.kind === 'selection' && ['idle', 'submitting', 'unknown'].includes(r.operation.state)) }; }
