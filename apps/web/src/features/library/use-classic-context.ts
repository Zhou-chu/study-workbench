import { useEffect, useState } from 'react';
import { useLibraryState } from './use-library-state';
import { emptyContext, type ContextConfig } from '../../data/native-chat';
export function useClassicContext(notebookId: string, enabled = true) {
    const [id, setId] = useState<string | null>(null), s = useLibraryState(id);
    useEffect(() => { if (enabled && s.context?.ready)
        setId(s.store.open({ kind: 'notebook', notebookId }, { kind: 'classic-context', parent: { kind: 'notebook', notebookId }, config: emptyContext() }, s.context, s.generation)); }, [notebookId, enabled, s.scope]);
    const currentId = [...s.rows].reverse().find(r => r.input.kind === 'classic-context' && r.input.parent.kind === 'notebook' && r.input.parent.notebookId === notebookId && s.store.current(r, s.context, s.generation))?.id;
    useEffect(() => { if (currentId && id !== currentId)
        setId(currentId); }, [currentId, id]);
    const config = s.row?.input.kind === 'classic-context' ? s.row.input.config : emptyContext();
    const change = (kind: 'sources' | 'notes', ids: string[], mode: string) => {
        if (!id || !s.row || !s.store.current(s.row, s.context, s.generation))
            return;
        const next = { ...config, [kind]: { ...config[kind], ...Object.fromEntries(ids.map(v => [v, mode])) } } as ContextConfig;
        s.store.edit(id, { config: next });
        s.navigation?.activateResource(id);
    };
    return { ...s, config, change, onFresh: setId, locked: !s.ready || !s.row || !s.store.current(s.row, s.context, s.generation) };
}
