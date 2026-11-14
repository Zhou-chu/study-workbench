import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAppDrafts } from '../../app/providers';
import { useLibraryConnection } from '../../data/use-library-connection';
import { observeCommand } from './library-operations';
/** Exactly one app-owned observer per accepted command, independent of mounted consumers. */
export function LibraryCommandObservers() {
    const store = useAppDrafts().library, rows = useSyncExternalStore(store.subscribe, store.getSnapshot), c = useLibraryConnection(), queries = useQueryClient();
    const observers = useRef(new Map<string, {
        scope: string;
        controller: AbortController;
    }>());
    useEffect(() => {
        const desired = new Set(rows.filter(r => r.status === 'accepted' && !r.stopRequested && !r.retired).map(r => r.id));
        for (const [id, entry] of observers.current)
            if (!desired.has(id) || entry.scope !== c.scope || !c.ready) {
                entry.controller.abort();
                observers.current.delete(id);
            }
        if (!c.api || !c.ready)
            return;
        for (const row of rows)
            if (desired.has(row.id) && row.commandId && !observers.current.has(row.id)) {
                const controller = new AbortController(), entry = { scope: c.scope, controller };
                observers.current.set(row.id, entry);
                void observeCommand(c.api, row, store, controller.signal, () => { void queries.invalidateQueries({ queryKey: ['library'] }); }).finally(() => {
                    if (observers.current.get(row.id) === entry)
                        observers.current.delete(row.id);
                });
            }
    }, [rows, c.api, c.ready, c.scope, store, queries]);
    useEffect(() => () => {
        for (const entry of observers.current.values())
            entry.controller.abort();
        observers.current.clear();
    }, []);
    return null;
}
