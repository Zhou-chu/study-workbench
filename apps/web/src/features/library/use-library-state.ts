import { useEffect, useSyncExternalStore } from 'react';
import { useAppDrafts } from '../../app/providers';
import { useResourceNavigation } from '../../app/WorkbenchSession';
import { useLibraryConnection } from '../../data/use-library-connection';
import { executeLibraryDraft } from './library-operations';
import { useQueryClient } from '@tanstack/react-query';
export function useLibraryState(id?: string | null) {
    const store = useAppDrafts().library, navigation = useResourceNavigation(), connection = useLibraryConnection(), queries = useQueryClient();
    const rows = useSyncExternalStore(store.subscribe, store.getSnapshot);
    useEffect(() => () => {
        if (id)
            navigation?.deactivateResource(id);
    }, [id, navigation]);
    const row = id ? rows.find(r => r.id === id) : undefined;
    const refresh = () => { void queries.invalidateQueries({ queryKey: ['library'] }); void queries.invalidateQueries({ queryKey: ['notebooks'] }); void queries.invalidateQueries({ queryKey: ['workspace'] }); };
    return { ...connection, store, rows, row, navigation, refresh, async run(value: string) {
            if (connection.api) {
                await executeLibraryDraft(store, value, connection.api);
                refresh();
            }
        } };
}
