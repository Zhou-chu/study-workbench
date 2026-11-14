import { useMemo, useSyncExternalStore } from 'react';
import { readTurnContext, subscribeTurnContext, sessionCoordinator } from '@study/web-transport';
import { useAppData } from '../app/providers';
import { useWorkbenchSnapshot } from '../app/WorkbenchSession';
import { createLibraryApi } from './library-api';
export function useLibraryConnection() {
    const { transport } = useAppData();
    useWorkbenchSnapshot();
    const context = useSyncExternalStore(subscribeTurnContext, readTurnContext, () => null);
    const api = useMemo(() => transport ? createLibraryApi(transport) : undefined, [transport]);
    const generation = sessionCoordinator.current();
    return { api, context, generation, ready: !!api && !!context?.ready, scope: JSON.stringify([context?.epoch, context?.target, generation]) };
}
