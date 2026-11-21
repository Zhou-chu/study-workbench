import { useMemo, useSyncExternalStore } from 'react';
import { readTurnContext, subscribeTurnContext } from '@study/web-transport';
import { useAppData } from '../app/providers';
import { createNotebookApi } from './notebook-api';
export function useNotebookConnection() {
    const { transport } = useAppData();
    const context = useSyncExternalStore(subscribeTurnContext, readTurnContext, () => null);
    const api = useMemo(() => transport ? createNotebookApi(transport) : undefined, [transport]);
    return { api, context, ready: !!api && !!context?.ready, scope: context ? JSON.stringify([context.epoch, context.target]) : 'unconnected' };
}
