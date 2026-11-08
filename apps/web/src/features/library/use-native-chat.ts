import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { readTurnContext, sessionCoordinator, asRequestNotDispatchedError } from '@study/web-transport';
import { useLibraryState } from './use-library-state';
import { libraryDraftLocked, type NativeChatInput, type NativeSessionInput } from './library-store';
import { type NativeParent, type NativeSession, type NativeMessage, type ContextConfig, parentKey, ownsSession, emptyContext } from '../../data/native-chat';
import { LibraryError } from '../../data/library-api';
import { readSourceStream } from './source-chat-stream';
export function useNativeChat(parent: NativeParent, config: ContextConfig = emptyContext()) {
    const [id, setId] = useState<string | null>(null), s = useLibraryState(id), { store, api, context, generation, scope, navigation } = s;
    const key = parentKey(parent), selected = store.nativeSelection(parent), active = useRef(0), run = useRef<{
        id: string;
        abort: AbortController;
    } | null>(null), configRef = useRef(config);
    configRef.current = config;
    const native = parent.kind === 'notebook' ? api?.notebookChat : api?.sourceChat;
    const list = useQuery({ queryKey: ['library', 'native-sessions', scope, key], enabled: s.ready, queryFn: ({ signal }) => native!.list(parent, context!, signal) });
    const models = useQuery({ queryKey: ['library', 'models', scope], enabled: s.ready, queryFn: ({ signal }) => api!.metadata.models(context!, signal) });
    const defaults = useQuery({ queryKey: ['library', 'model-defaults', scope], enabled: s.ready, queryFn: ({ signal }) => api!.metadata.defaults(context!, signal) });
    const [error, setError] = useState(false), initialized = useRef('');
    const open = (sid: string | null) => {
        if (!context?.ready)
            return null;
        const existing = [...store.getSnapshot()].reverse().find(r => r.input.kind === 'native-chat' && parentKey(r.input.parent) === key && (r.input.sessionId === sid || !!sid && r.native?.session?.id === sid) && store.current(r, context, generation));
        return existing?.id ?? store.open(sid ? { kind: 'session', parent, sessionId: sid } : parent, { kind: 'native-chat', parent, sessionId: sid, message: '', model: null, title: '' }, context, generation);
    };
    useEffect(() => {
        if (!s.ready)
            return;
        const identity = scope + key;
        if (initialized.current !== identity && list.data) {
            initialized.current = identity;
            const available = list.data.filter(v => !store.nativeDeleted(parent, v.id));
            if (!selected && available.length && !store.getSnapshot().some(r => r.input.kind === 'native-chat' && parentKey(r.input.parent) === key && (r.dirty || r.attempt > 0))) {
                store.selectNative(parent, available[0]!.id);
                return;
            }
        }
        setId(open(selected));
        // Records are app-lifetime. Switching stops only observation, never remote work.
    }, [key, selected, scope, s.ready, list.data]);
    useEffect(() => {
        active.current++;
        return () => {
            active.current++;
            if (run.current) {
                store.stopNative(run.current.id);
                run.current.abort.abort();
                run.current = null;
            }
        };
    }, [key, selected, scope]);
    useEffect(() => {
        if (!s.ready && run.current) {
            store.stopNative(run.current.id);
            run.current.abort.abort();
            run.current = null;
        }
    }, [s.ready]);
    useEffect(() => {
        if (!id || !selected || !native || !context)
            return;
        const owner = store.get(id);
        if (owner?.input.kind !== 'native-chat' || owner.input.sessionId !== selected && owner.native?.session?.id !== selected)
            return;
        const read = store.nativeRead(id, readTurnContext(), sessionCoordinator.current()), abort = new AbortController();
        if (read)
            void native.get(parent, selected, context, abort.signal).then(value => {
                if (!ownsSession(parent, value))
                    throw new Error('Unowned native session');
                store.nativeHydrate(id, read, value, readTurnContext(), sessionCoordinator.current());
                setError(false);
            }).catch(() => {
                if (!abort.signal.aborted)
                    setError(true);
            });
        return () => abort.abort();
    }, [id, key, selected, scope]);
    // Every unresolved operation owned by this mounted surface stays in the navigation capture.
    const held = s.rows.filter(r => (r.input.kind === 'native-chat' || r.input.kind === 'native-session') && parentKey(r.input.parent) === key && (r.dirty || ['pending', 'unknown'].includes(r.status))).map(r => r.id).join('|');
    useEffect(() => { const release = held.split('|').filter(Boolean).map(v => navigation?.holdResource(v)); return () => release.forEach(f => f?.()); }, [held, navigation]);
    const row = s.row, input = row?.input.kind === 'native-chat' ? row.input : undefined;
    const session = row?.native?.session;
    const selectedListed = list.data?.find(v => v.id === selected);
    const matching = !!input && parentKey(input.parent) === key && (input.sessionId === selected || !!selected && session?.id === selected);
    const owned = matching && !!row && store.current(row, context, generation) && !!session && ownsSession(parent, session) && (!selected || session.id === selected);
    const locked = !s.ready || !row || !matching || list.isPending || !!row && (!store.current(row, context, generation) || libraryDraftLocked(row) && row.status !== 'succeeded') || !!selected && !owned || error;
    function edit(patch: Partial<NativeChatInput>) {
        if (!id || !input || !context || !row || !store.current(row, readTurnContext(), sessionCoordinator.current()))
            return;
        let target = id;
        if (row?.status === 'succeeded') {
            const sid = session?.id ?? selected;
            if (sid && sid !== selected)
                choose(sid);
            target = store.open(sid ? { kind: 'session', parent, sessionId: sid } : parent, { kind: 'native-chat', parent, sessionId: sid, message: '', model: session ? session.model_override ?? null : input.model, title: '' }, context, generation);
            if (session) {
                const read = store.nativeRead(target, readTurnContext(), sessionCoordinator.current());
                if (read)
                    store.nativeHydrate(target, read, { ...session, messages: row.native?.messages ?? [] }, context, generation);
            }
            setId(target);
        }
        store.edit(target, patch);
        navigation?.activateResource(target);
    }
    function choose(sid: string | null) {
        if (sid && store.nativeDeleted(parent, sid))
            return;
        if (sid !== selected)
            active.current++;
        if (run.current) {
            store.stopNative(run.current.id);
            run.current.abort.abort();
            run.current = null;
        }
        store.selectNative(parent, sid);
        setError(false);
    }
    async function check() {
        if (!id || !native || !context || !session)
            return;
        const read = store.nativeRead(id, readTurnContext(), sessionCoordinator.current());
        if (!read)
            return;
        try {
            const value = await native.get(parent, session.id, context);
            if (!ownsSession(parent, value))
                throw new Error('Unowned');
            store.nativeHydrate(id, read, value, readTurnContext(), sessionCoordinator.current());
        }
        catch {
            setError(true);
        }
    }
    async function mutate(action: NativeSessionInput['action'], value?: string | null) {
        if (!native || !context?.ready || !s.ready || store.nativeSelection(parent) !== selected)
            return;
        const sid = session?.id ?? selected;
        if (action !== 'create' && (!sid || !owned))
            return;
        if (parent.kind === 'source' && action === 'model' && value === null)
            return;
        const payload: NativeSessionInput = { kind: 'native-session', parent, sessionId: action === 'create' ? null : sid, action, ...(action === 'create' || action === 'rename' ? { title: value ?? '' } : {}), ...(action === 'model' ? { model: value ?? null } : {}) };
        const op = store.open(action === 'create' ? parent : { kind: 'session', parent, sessionId: sid! }, payload, context, generation);
        navigation?.activateResource(op);
        const a = store.begin(op, readTurnContext(), sessionCoordinator.current());
        if (!a?.token)
            return;
        const token = a.token, activation = active.current;
        let result: NativeSession | undefined;
        try {
            if (action === 'create')
                result = await native.create(parent, { ...(value?.trim() ? { title: value.trim() } : {}), ...(input?.model ? { model_override: input.model } : {}) }, a.context, a.id);
            else if (action === 'delete')
                await native.delete(parent, sid!, a.context, a.id);
            else
                result = await native.update(parent, sid!, action === 'rename' ? { title: value ?? '' } : { model_override: value ?? null }, a.context, a.id);
            if (result && !ownsSession(parent, result))
                throw new Error('Unowned native session');
            if (result)
                store.nativeReceipt(op, token, result);
            store.item(op, token, 0, { state: 'accepted', ...(result ? { resourceId: result.id } : {}), ...(sid ? { targetId: sid } : {}) }, readTurnContext(), sessionCoordinator.current());
            store.finish(op, token, 'succeeded', readTurnContext(), sessionCoordinator.current());
            if (store.get(op)?.status === 'succeeded' && action === 'delete')
                store.deleteNative(parent, sid!);
            if (store.get(op)?.status === 'succeeded' && active.current === activation) {
                if (action === 'create')
                    choose(result!.id);
                else if (action === 'delete') {
                    choose(null);
                    setId(null);
                }
                else if (id && result) {
                    const read = store.nativeRead(id, readTurnContext(), sessionCoordinator.current());
                    if (read)
                        store.nativeHydrate(id, read, { ...result, messages: store.get(id)?.native?.messages ?? [] }, readTurnContext(), sessionCoordinator.current());
                    if (action === 'model')
                        store.edit(id, { model: result.model_override ?? null });
                }
                void list.refetch();
            }
        }
        catch (e) {
            store.finish(op, token, asRequestNotDispatchedError(e) ? 'not-sent' : e instanceof LibraryError && e.kind === 'rejected' ? 'rejected' : 'unknown', readTurnContext(), sessionCoordinator.current());
        }
    }
    async function send() {
        if (!id || !api || !native || !context || locked || store.nativeSelection(parent) !== selected || !input?.message.trim())
            return;
        const a = store.begin(id, readTurnContext(), sessionCoordinator.current());
        if (!a?.token || a.input.kind !== 'native-chat')
            return;
        navigation?.activateResource(id);
        const token = a.token, p = a.input, abort = new AbortController(), activation = active.current, configSnapshot = JSON.stringify(configRef.current);
        run.current = { id, abort };
        let sid = a.native?.session?.id ?? p.sessionId, submitted = false;
        const current = () => !abort.signal.aborted && active.current === activation && store.current(a, readTurnContext(), sessionCoordinator.current()) && store.get(id)?.status === 'pending';
        const output = (patch: Parameters<typeof store.nativeOutput>[2]) => store.nativeOutput(id, token, patch, readTurnContext(), sessionCoordinator.current());
        try {
            if (!sid) {
                submitted = true;
                const created = await native.create(parent, { ...(p.model ? { model_override: p.model } : {}) }, a.context, a.id + ':session');
                if (!ownsSession(parent, created))
                    throw new Error('Unowned native session');
                sid = created.id;
                store.nativeReceipt(id, token, created);
                store.item(id, token, 0, { state: 'accepted', resourceId: sid }, readTurnContext(), sessionCoordinator.current());
                if (!current())
                    throw new Error('Observation stopped');
            }
            if (parent.kind === 'notebook') {
                const built = await api.context(parent, JSON.parse(configSnapshot) as ContextConfig, a.context, abort.signal);
                if (!current() || configSnapshot !== JSON.stringify(configRef.current))
                    throw new Error('Context changed before send');
                submitted = true;
                const transcript = await api.notebookChat.execute(sid, p.message, built.context, p.model, a.context, a.id, abort.signal);
                output({ messages: transcript });
            }
            else {
                if (!current())
                    throw new Error('Observation stopped');
                submitted = true;
                const before = a.native?.messages ?? [], question: NativeMessage = { provisional: true, id: 'local:' + a.id + ':human', type: 'human', content: p.message }, answerId = 'local:' + a.id + ':ai';
                output({ messages: [...before, question] });
                const response = await api.sourceChat.send(parent, sid, p.message, p.model, a.context, a.id, abort.signal);
                await readSourceStream(response, abort.signal, event => {
                    if (!current())
                        throw new Error('Observation stopped');
                    if (event.type === 'ai_message')
                        output({ messages: [...before, question, { provisional: true, id: answerId, type: 'ai', content: event.content }] });
                    else if (event.type === 'context_indicators')
                        output({ indicators: event.data });
                });
            }
            if (!current())
                throw new Error('Observation stopped');
            store.finish(id, token, 'succeeded', readTurnContext(), sessionCoordinator.current());
            // The transcript response is authoritative. This exact native-session read can refresh
            // IDs/counts, but is fenced against subsequent edits and read races.
            const read = store.nativeRead(id, readTurnContext(), sessionCoordinator.current());
            if (read) {
                try {
                    const detail = await native.get(parent, sid, a.context, abort.signal);
                    if (ownsSession(parent, detail))
                        store.nativeHydrate(id, read, detail, readTurnContext(), sessionCoordinator.current());
                }
                catch { /* Keep the confirmed transcript. */ }
            }
            if (!p.sessionId && store.get(id)?.status === 'succeeded' && active.current === activation)
                store.selectNative(parent, sid);
            void list.refetch();
        }
        catch (e) {
            const acceptedCreate = !!store.get(id)?.receipts.some(r => r.state === 'accepted' || r.state === 'unknown');
            const outcome = !acceptedCreate && (!submitted || asRequestNotDispatchedError(e)) ? 'not-sent' : !acceptedCreate && e instanceof LibraryError && e.kind === 'rejected' ? 'rejected' : 'unknown';
            store.finish(id, token, outcome, readTurnContext(), sessionCoordinator.current());
        }
        finally {
            if (run.current?.id === id)
                run.current = null;
        }
    }
    function stop() {
        if (run.current) {
            store.stopNative(run.current.id);
            run.current.abort.abort();
            run.current = null;
        }
    }
    const mutations = s.rows.filter(r => r.input.kind === 'native-session' && parentKey(r.input.parent) === key);
    return { ...s, row, input, session, selectedListed, selected, list, models, defaults, error, locked, owned, edit, choose, mutate, send, stop, check, mutations, onFresh: setId, messages: row?.native?.messages ?? [] };
}
