import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { WorkspaceViewV1 } from '@study/contracts';
import { canDispatch, freezeDispatchContext, readTurnContext, sessionCoordinator, asRequestNotDispatchedError } from '@study/web-transport';
import { useSettings } from './use-settings';
import { useSourceSelection } from '../sources/use-source-selection';
import { disclosure, same, type IndexReceipt, type ChildStatus } from '../../data/retrieval-contracts';
import { SettingsRequestError } from '../../data/settings-api';
import { invalidateRetrieval, type RetrievalFence, type RetrievalState, type IndexAttempt } from './retrieval-state';
import type { ConversationRetrieval } from '../chat/ConversationPanel';

export function useRetrieval(notebookId: string | undefined, workspace: WorkspaceViewV1 | undefined) {
    const owner = useSettings(notebookId ?? '');
    const { row, store, drafts, controller, api } = owner;
    const selected = useSourceSelection(notebookId ?? '', owner.context?.epoch, workspace);
    useSyncExternalStore(drafts.subscribe, drafts.configuration.getSnapshot);
    const mount = useRef({ active: true, id: crypto.randomUUID(), ownerId: row?.id });
    if (mount.current.ownerId !== row?.id) mount.current = { active: true, id: crypto.randomUUID(), ownerId: row?.id };
    const configuration = () => JSON.stringify(drafts.configuration.getSnapshot()
        .filter(r => r.kind === 'models' && !r.retired && r.context.epoch === row?.context.epoch && canDispatch(r.context, readTurnContext()))
        .map(r => [r.id, r.metadataRevision]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
    const selectionRevision = () => drafts.sources.selectionRevision(notebookId ?? '');
    const boundary = [row?.id, mount.current.id, sessionCoordinator.current(), controller?.getSnapshot().providerEvidenceRevision,
        selectionRevision(), configuration(), selected.selection?.engine, selected.selection?.selection_origin,
        ...(selected.selection?.source_version_ids ?? [])].join('|');
    const update = (fn: (s: RetrievalState) => RetrievalState) => { if (row) store.retrieval(row.id, fn); };
    useEffect(() => {
        const original = mount.current;
        original.active = true;
        return () => { original.active = false; };
    }, [row?.id]);
    useEffect(() => {
        if (row && row.retrieval.boundary !== boundary)
            store.retrieval(row.id, s => ({ ...invalidateRetrieval(s), boundary }));
    }, [boundary, row?.id, store]);
    const s = row?.retrieval;
    const scope = selected.selection;
    const local = !!scope && !selected.unconfirmed && scope.engine === 'independent' && scope.selection_origin === 'local' &&
        scope.source_version_ids.length > 0 && scope.source_version_ids.length <= 20 && new Set(scope.source_version_ids).size === scope.source_version_ids.length;
    const ready = !!row && owner.ready && mount.current.active && store.selected(notebookId ?? '') === row.id && s?.boundary === boundary;
    const renderedSelection = selectionRevision(), renderedConfiguration = configuration(), renderedGeneration = sessionCoordinator.current();
    const renderedProvider = controller?.getSnapshot().providerEvidenceRevision;
    const capture = (): RetrievalFence | null => !ready || !row || renderedSelection !== selectionRevision() ||
        renderedConfiguration !== configuration() || renderedGeneration !== sessionCoordinator.current() ||
        renderedProvider !== controller?.getSnapshot().providerEvidenceRevision || row.retrieval.revision !== store.get(row.id)?.retrieval.revision ? null : Object.freeze({
        ownerId: row.id, mount: mount.current.id, context: freezeDispatchContext(row.context),
        generation: sessionCoordinator.current(), selectionRevision: selectionRevision(), configuration: configuration(),
        providerRevision: controller?.getSnapshot().providerEvidenceRevision ?? -1, revision: row.retrieval.revision,
    });
    const current = (f: RetrievalFence, admission = true) => {
        const r = store.get(f.ownerId);
        return mount.current.active && f.mount === mount.current.id && store.selected(notebookId ?? '') === f.ownerId &&
            !!r && !r.retired && controller?.getSnapshot().ready === true && canDispatch(f.context, readTurnContext()) &&
            f.generation === sessionCoordinator.current() && (!admission ||
                f.revision === r.retrieval.revision && f.selectionRevision === selectionRevision() &&
                f.configuration === configuration() && f.providerRevision === controller?.getSnapshot().providerEvidenceRevision);
    };
    const patchAttempt = (id: string, patch: Partial<IndexAttempt>) => update(v => ({
        ...v, attempts: Object.freeze(v.attempts.map(a => a.id === id ? Object.freeze({ ...a, ...patch }) : a)),
    }));
    const profile = s?.status?.profiles.find(p => p.profile.profile_id === s.profileId)?.profile;
    const validProfile = profile && disclosure(profile);
    const semanticReady = ready && local && s?.status?.enabled === true && !!validProfile;
    const locked = !!s?.busy || !!s?.attempts.some(a => a.phase === 'pending' || a.phase === 'unknown' ||
        a.receipt && ['queued', 'running', 'submission_unknown'].includes((a.observedReceipt ?? a.receipt).state));
    const change = (patch: Partial<RetrievalState>) => {
        if (!ready || !s) return;
        update(v => ({ ...v, ...patch, revision: v.revision + 1, preview: null, query: null,
            documentAck: false, duplicateAck: false, retryChild: null, dirty: true }));
    };
    const chooseProfile = (value: string) => {
        if (s?.status?.profiles.some(p => p.profile.profile_id === value && disclosure(p.profile)))
            change({ profileId: value });
    };
    const query = (checked: boolean) => {
        if (!semanticReady || !profile) return;
        update(v => ({ ...v, revision: v.revision + 1, query: checked ? disclosure(profile) : null, dirty: true }));
    };
    const refresh = async () => {
        const f = capture();
        if (!api || !f || !local || !scope || store.get(f.ownerId)?.retrieval.busy) return;
        const versions = Object.freeze([...scope.source_version_ids]);
        const acknowledged = [...(s?.attempts ?? [])].reverse().find(a => a.receipt && current(a.fence, false));
        const busyToken = crypto.randomUUID();
        update(v => ({ ...v, busy: true, busyToken, error: false }));
        try {
            if (!current(f)) return;
            const status = await api.semanticStatus(notebookId!, versions, f.context);
            if (!current(f)) return;
            update(v => same(v.status, status) ? { ...v, status } : { ...invalidateRetrieval(v), status, busy: true, busyToken });
            if (acknowledged?.receipt) {
                let receipt = acknowledged.receipt;
                const children: ChildStatus[] = [];
                // One finite original group plus at most twenty originally acknowledged children.
                for (const id of [receipt.group_id, ...receipt.job_ids]) {
                    if (!current(acknowledged.fence, false)) return;
                    const value = await api.indexJob({ preview: acknowledged.preview, request: acknowledged.request, receipt }, id, acknowledged.fence.context);
                    if (!current(acknowledged.fence, false)) return;
                    if ('group_id' in value) receipt = value;
                    else children.push(value);
                }
                patchAttempt(acknowledged.id, { observedReceipt: receipt, children: Object.freeze(children), observationFailed: false });
            }
        } catch (e) {
            update(v => ({ ...v, error: true, ...(e instanceof SettingsRequestError ? { httpStatus: e.status } : {}) }));
            if (acknowledged) patchAttempt(acknowledged.id, { observationFailed: true });
        } finally { update(v => v.busyToken === busyToken ? { ...v, busy: false, busyToken: null } : v); }
    };
    const preview = async (childId?: string) => {
        const f = capture();
        if (!f || !api || !semanticReady || !profile || !scope || store.get(f.ownerId)?.retrieval.busy || !childId && locked) return;
        let versions = [...scope.source_version_ids];
        if (childId) {
            const original = s?.attempts.find(a => a.children.some(j => j.job_id === childId));
            const child = original?.children.find(j => j.job_id === childId);
            if (!original || !child || !current(original.fence, false) || !['failed', 'submission_unknown', 'cancelled_local'].includes(child.state) ||
                !child.source_version_id || !versions.includes(child.source_version_id) || !same(original.preview.profile, profile)) return;
            versions = [child.source_version_id];
        }
        const busyToken = crypto.randomUUID();
        update(v => ({ ...v, busy: true, busyToken, error: false, preview: null, documentAck: false, duplicateAck: false, retryChild: childId ?? null }));
        try {
            if (!current(f)) return;
            const value = await api.indexPreview(notebookId!, versions, profile, f.context);
            if (current(f)) {
                const expected = s?.status?.snapshot.entries.filter(e => versions.includes(e.version_id));
                if (!same(expected, value.snapshot.entries)) {
                    update(v => ({ ...invalidateRetrieval(v), error: true }));
                    return;
                }
                update(v => ({ ...v, preview: value }));
            }
        } catch (e) {
            if (current(f)) update(v => ({ ...v, error: true, ...(e instanceof SettingsRequestError ? { httpStatus: e.status } : {}) }));
        } finally { update(v => v.busyToken === busyToken ? { ...v, busy: false, busyToken: null } : v); }
    };
    const cancelPreview = () => {
        if (!ready) return;
        update(v => ({ ...v, revision: v.revision + 1, preview: null, documentAck: false, duplicateAck: false, retryChild: null }));
    };
    const acknowledge = (kind: 'documentAck' | 'duplicateAck', value: boolean) => {
        if (!ready || !s?.preview || s.busy || s.attempts.some(a => a.phase === 'pending')) return;
        update(v => ({ ...v, revision: v.revision + 1, [kind]: value }));
    };
    const build = async (recover?: string) => {
        let attempt: IndexAttempt | undefined;
        if (!api || !row || !s) return;
        const latest = store.get(row.id)?.retrieval;
        if (!latest || latest.attempts.some(a => a.phase === 'pending')) return;
        if (recover) {
            attempt = s.attempts.find(a => a.id === recover && a.phase === 'unknown');
            if (!attempt || !current(attempt.fence) || s.busy || !semanticReady ||
                !same(attempt.preview, s.preview) || !s.documentAck) return;
            patchAttempt(attempt.id, { phase: 'pending' });
        } else {
            const f = capture(), p = s.preview;
            if (!f || !semanticReady || !p || !s.documentAck || s.busy ||
                s.attempts.some(a => a.phase === 'pending' || a.phase === 'unknown') ||
                s.retryChild && !s.duplicateAck || !s.retryChild && locked) return;
            const request = Object.freeze({ source_version_ids: Object.freeze(p.snapshot.entries.map(e => e.version_id)),
                profile_id: p.profile.profile_id, preview_hash: p.preview_hash,
                acknowledge_external_processing: s.documentAck, idempotency_key: crypto.randomUUID(),
                retry_of_job_id: s.retryChild, acknowledge_duplicate_embedding_cost: s.duplicateAck });
            attempt = Object.freeze({ id: request.idempotency_key, fence: f, preview: p, request,
                phase: 'pending', receipt: null, observedReceipt: null, children: Object.freeze([]), observationFailed: false });
            update(v => ({ ...v, attempts: Object.freeze([...v.attempts, attempt!]) }));
        }
        // The synchronous store latch protects repeated DOM events before React rerenders.
        try {
            if (!current(attempt.fence)) { patchAttempt(attempt.id, { phase: 'not-sent' }); return; }
            const receipt: IndexReceipt = await api.indexBuild(attempt.preview, attempt.request, attempt.fence.context, attempt.id);
            patchAttempt(attempt.id, { phase: current(attempt.fence, false) ? 'acknowledged' : 'unknown', receipt });
        } catch (e) {
            patchAttempt(attempt.id, { phase: asRequestNotDispatchedError(e) ? 'not-sent' : 'unknown',
                ...(e instanceof SettingsRequestError ? { httpStatus: e.status } : {}) });
            // A conflict is a conservative stale-admission boundary. Preserve the unknown
            // original request; never use current consent to repair its authority.
            if (e instanceof SettingsRequestError && e.status === 409)
                update(v => ({ ...invalidateRetrieval(v), error: true, httpStatus: 409 }));
        }
    };
    const cancel = async (attemptId: string, jobId: string) => {
        const a = store.get(row?.id ?? '')?.retrieval.attempts.find(v => v.id === attemptId);
        if (!api || !a?.receipt || !current(a.fence, false) || store.get(a.fence.ownerId)?.retrieval.busy) return;
        const busyToken = crypto.randomUUID();
        update(v => ({ ...v, busy: true, busyToken }));
        try {
            const value = await api.indexJob({ preview: a.preview, request: a.request, receipt: a.receipt }, jobId, a.fence.context, true);
            if (current(a.fence, false)) patchAttempt(a.id, 'group_id' in value ? { observedReceipt: value } :
                { children: Object.freeze([...a.children.filter(c => c.job_id !== jobId), value]) });
        } catch { patchAttempt(a.id, { observationFailed: true }); }
        finally { update(v => v.busyToken === busyToken ? { ...v, busy: false, busyToken: null } : v); }
    };
    const f = capture(), originalQuery = s?.query;
    const conversation: ConversationRetrieval | undefined = !s ? undefined : Object.freeze({
        options: Object.freeze(s.mode === 'lexical' ? { retrieval_mode: 'lexical' as const } : {
            retrieval_mode: 'hybrid' as const, embedding_profile_id: s.profileId,
            disclosed_profile_fingerprint: originalQuery?.profile_fingerprint ?? null,
            destination_descriptor_version: originalQuery?.destination_descriptor_version ?? null,
            acknowledge_query_processing: !!originalQuery,
        }),
        ...(originalQuery ? { disclosure: originalQuery } : {}),
        available: s.mode === 'lexical' ? ready : semanticReady && !!originalQuery,
        isCurrent: () => !!f && current(f),
    });
    return { owner, s, ready, local, locked, profile, semanticReady, conversation, capture, current, update,
        chooseMode: (mode: 'lexical' | 'hybrid') => change({ mode }), chooseProfile, query, refresh, preview,
        cancelPreview, acknowledge, build, cancel };
}
export type RetrievalController = ReturnType<typeof useRetrieval>;
