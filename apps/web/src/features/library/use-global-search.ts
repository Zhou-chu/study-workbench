import type { LibraryDraft } from './library-store';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { readTurnContext, sessionCoordinator } from '@study/web-transport';
import { useLibraryState } from './use-library-state';
import { useNotebookConnection } from '../../data/use-notebook-connection';
import type { GlobalQuery, AskModels } from '../../data/global-search';
import { validScope } from '../../data/global-search';
import { readAskStream } from './global-ask-stream';
import { failure } from './library-operations';
export function useGlobalSearch() {
    const location = useLocation(), [id, setId] = useState<string | null>(null), s = useLibraryState(id), n = useNotebookConnection(), runs = useRef(new Map<string, AbortController>());
    const { store, context, generation, scope } = s;
    const query = new URLSearchParams(location.search), routeKey = location.search;
    useEffect(() => { if (context?.ready) {
        setId(store.open({ kind: 'global' }, { kind: 'global-query', routeKey, intentId: crypto.randomUUID(), question: query.get('q') ?? '', mode: query.get('mode') === 'ask' ? 'ask' : 'search', searchType: 'text', includeSources: true, includeNotes: true, notebooks: [] }, context, generation));
    } }, [routeKey, scope]);
    const notebooks = useQuery({ queryKey: ['notebooks', n.scope], enabled: n.ready, queryFn: ({ signal }) => n.api!.list(n.context!, signal) });
    const models = useQuery({ queryKey: ['library', 'models', scope], enabled: s.ready, queryFn: ({ signal }) => s.api!.metadata.models(context!, signal) });
    const defaults = useQuery({ queryKey: ['library', 'model-defaults', scope], enabled: s.ready, queryFn: ({ signal }) => s.api!.metadata.defaults(context!, signal) });
    const input = s.row?.input.kind === 'global-query' ? s.row.input : undefined;
    const held = s.rows.filter(r => (r.input.kind === 'global-run' || r.input.kind === 'global-save') && !store.isSuperseded(r.id) && ['pending', 'unknown', 'accepted'].includes(r.status)).map(r => r.id).join('|');
    useEffect(() => { const release = held.split('|').filter(Boolean).map(v => s.navigation?.holdResource(v)); return () => release.forEach(fn => fn?.()); }, [held, s.navigation]);
    useEffect(() => () => { for (const [run, abort] of runs.current) {
        const row = store.get(run);
        if (row?.token)
            store.finish(run, row.token, 'unknown', readTurnContext(), sessionCoordinator.current());
        abort.abort();
    } runs.current.clear(); }, [scope, routeKey, s.ready]);
    function edit(patch: Partial<GlobalQuery>) { if (id && s.row && store.current(s.row, readTurnContext(), sessionCoordinator.current())) {
        store.edit(id, patch);
        s.navigation?.activateResource(id);
    } }
    function fresh() { if (id && context?.ready) {
        const next = store.fresh(id, { kind: 'global-query', routeKey, intentId: crypto.randomUUID(), question: '', mode: 'search', searchType: 'text', includeSources: true, includeNotes: true, notebooks: [] }, context, generation);
        if (next)
            setId(next);
    } }
    async function submit(snapshot: GlobalQuery, chosen?: AskModels, owner: LibraryDraft | undefined = s.row) {
        if (!id || !s.api || !context?.ready || !s.row || !owner || owner !== s.row || store.get(owner.id) !== owner || owner.input.kind !== 'global-query' || store.getSnapshot().some(r => r.input.kind === 'global-run' && r.input.intentId === (owner.input.kind === 'global-query' ? owner.input.intentId : '')) || !store.current(s.row, readTurnContext(), sessionCoordinator.current()) || !snapshot.question.trim() || !validScope(snapshot.notebooks) || runs.current.size)
            return;
        if (snapshot.mode === 'ask' && (!chosen || Object.values(chosen).some(v => !v.trim())))
            return;
        const run = store.open({ kind: 'global' }, { ...snapshot, kind: 'global-run', runId: crypto.randomUUID(), intentId: owner.input.intentId, ...(chosen ? { models: { ...chosen } } : {}) }, context, generation);
        const row = store.begin(run, readTurnContext(), sessionCoordinator.current());
        if (!row?.token || row.input.kind !== 'global-run')
            return;
        const token = row.token, abort = new AbortController(), p = row.input;
        runs.current.set(run, abort);
        s.navigation?.activateResource(run);
        const current = () => store.current(row, readTurnContext(), sessionCoordinator.current()) && store.get(run)?.status === 'pending' && !abort.signal.aborted;
        const patch = (value: Parameters<typeof store.globalOutput>[2]) => { if (!current())
            throw new Error('Retired Ask owner'); store.globalOutput(run, token, value, readTurnContext(), sessionCoordinator.current()); };
        try {
            if (p.mode === 'search') {
                patch({ search: await s.api.search.submit(p, row.context, abort.signal) });
                store.finish(run, token, 'succeeded', readTurnContext(), sessionCoordinator.current());
            }
            else {
                const response = await s.api.search.ask(p, p.models!, row.context, abort.signal);
                await readAskStream(response, abort.signal, event => {
                    if (event.type === 'strategy')
                        patch({ strategy: event });
                    else if (event.type === 'answer')
                        patch({ answers: [...(store.get(run)?.global?.answers ?? []), event.content] });
                    else if (event.type === 'final_answer')
                        patch({ final: event.content });
                    else if (event.type === 'complete') {
                        patch(event.final_answer?.trim() ? { terminal: 'answer', final: event.final_answer } : { terminal: 'no-answer' });
                        store.finish(run, token, 'succeeded', readTurnContext(), sessionCoordinator.current());
                    }
                    else if (event.type === 'error') {
                        patch({ terminal: 'error', message: event.message });
                        store.finish(run, token, 'failed', readTurnContext(), sessionCoordinator.current());
                    }
                });
            }
        }
        catch (error) {
            store.finish(run, token, failure(error), readTurnContext(), sessionCoordinator.current());
        }
        finally {
            runs.current.delete(run);
        }
    }
    function stop(run: string) { const row = store.get(run); if (row?.token)
        store.finish(run, row.token, 'unknown', readTurnContext(), sessionCoordinator.current()); runs.current.get(run)?.abort(); runs.current.delete(run); }
    const submitted = !!input && s.rows.some(r => r.input.kind === 'global-run' && r.input.intentId === input.intentId);
    function newQuestion() { if (id && s.row && store.current(s.row, readTurnContext(), sessionCoordinator.current()))
        store.edit(id, { question: '', intentId: crypto.randomUUID() });
    else
        fresh(); }
    return { ...s, input, edit, fresh, newQuestion, submitted, submit, stop, notebooks, models, defaults, locked: !s.ready || !s.row || !store.current(s.row, context, generation), outputs: s.rows.filter(r => r.input.kind === 'global-run') };
}
