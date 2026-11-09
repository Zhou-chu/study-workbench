import { readTurnContext, sessionCoordinator } from '@study/web-transport';
import { isRecord } from '@study/contracts';
import { LibraryError, type LibraryApi } from '../../data/library-api';
import type { LibraryStore, LibraryDraft } from './library-store';
import type { PodcastOperation, PodcastPreview } from './podcast-state';
import type { ContextConfig } from '../../data/native-chat';
import { failure } from './library-operations';
export async function executePodcast(store: LibraryStore, input: PodcastOperation, api: LibraryApi): Promise<string | null> {
    const c = readTurnContext(), g = sessionCoordinator.current();
    if (!c?.ready)
        return null;
    const prior = store.getSnapshot().find(r => r.input.kind === 'podcast-operation' && r.input.key === input.key && !['succeeded', 'failed'].includes(r.status));
    if (prior)
        return prior.id;
    const id = store.open({ kind: 'podcast', key: input.key }, input, c, g), row = store.begin(id, c, g);
    if (!row?.token || row.input.kind !== 'podcast-operation')
        return id;
    const t = row.token, p = row.input, key = id + ':' + t.attempt;
    try {
        let resourceId: string | undefined, commandId: string | undefined;
        switch (p.action) {
            case 'generate': {
                if (!p.request || !('content' in p.request))
                    throw new TypeError('Generation input');
                commandId = (await api.podcasts.generate(p.request, row.context, key)).job_id;
                break;
            }
            case 'retry':
                commandId = (await api.podcasts.retry(p.targetId!, row.context, key)).job_id;
                break;
            case 'delete-episode':
                await api.podcasts.delete(p.targetId!, row.context, key);
                resourceId = p.targetId!;
                break;
            case 'save-episode': {
                if (!p.request || !('speaker_config' in p.request))
                    throw new TypeError('Profile input');
                const value = p.targetId ? await api.episodeProfiles.update(p.targetId, p.request, row.context, key) : await api.episodeProfiles.create(p.request, row.context, key);
                resourceId = value.id;
                break;
            }
            case 'save-speaker': {
                if (!p.request || !('speakers' in p.request))
                    throw new TypeError('Profile input');
                const value = p.targetId ? await api.speakerProfiles.update(p.targetId, p.request, row.context, key) : await api.speakerProfiles.create(p.request, row.context, key);
                resourceId = value.id;
                break;
            }
            case 'duplicate-episode':
                resourceId = (await api.episodeProfiles.duplicate(p.targetId!, row.context, key)).id;
                break;
            case 'duplicate-speaker':
                resourceId = (await api.speakerProfiles.duplicate(p.targetId!, row.context, key)).id;
                break;
            case 'delete-episode-profile':
                await api.episodeProfiles.delete(p.targetId!, row.context, key);
                resourceId = p.targetId!;
                break;
            case 'delete-speaker-profile':
                await api.speakerProfiles.delete(p.targetId!, row.context, key);
                resourceId = p.targetId!;
                break;
        }
        store.item(id, t, 0, { state: 'accepted', ...(resourceId ? { resourceId } : {}), ...(commandId ? { commandId } : {}), ...(p.targetId ? { targetId: p.targetId } : {}) }, readTurnContext(), sessionCoordinator.current());
        store.finish(id, t, commandId ? 'accepted' : 'succeeded', readTurnContext(), sessionCoordinator.current(), commandId);
    }
    catch (e) {
        const state = failure(e);
        store.item(id, t, 0, { state, ...(e instanceof LibraryError && e.resourceId ? { resourceId: e.resourceId } : {}), ...(e instanceof LibraryError && e.commandId ? { commandId: e.commandId } : {}), ...(p.targetId ? { targetId: p.targetId } : {}) }, readTurnContext(), sessionCoordinator.current());
        store.finish(id, t, state, readTurnContext(), sessionCoordinator.current());
    }
    return id;
}
export function podcastOperationFor(rows: readonly LibraryDraft[], intent: string) { return [...rows].reverse().find(r => r.input.kind === 'podcast-operation' && r.input.originId === intent); }
export function validatePodcastContext(config: ContextConfig, membership: {
    sources: string[];
    notes: string[];
}, value: {
    context: {
        sources: unknown[];
        notes: unknown[];
    };
    token_count: number;
    char_count: number;
}): PodcastPreview['issues'] {
    const issues: PodcastPreview['issues'] = [];
    for (const kind of ['sources', 'notes'] as const) {
        const chosen = Object.entries(config[kind]).filter(([, mode]) => mode !== 'not in'), wanted = new Set(chosen.map(([id]) => id)), seen = new Set<string>();
        for (const item of value.context[kind]) {
            if (!isRecord(item) || typeof item.id !== 'string' || !wanted.has(item.id) || seen.has(item.id)) {
                issues.push({ id: isRecord(item) && typeof item.id === 'string' ? item.id : '', kind: 'invalid' });
                continue;
            }
            seen.add(item.id);
            const mode = config[kind][item.id];
            const usable = kind === 'notes' ? typeof item.content === 'string' && !!item.content.trim() : mode === 'full content' ? typeof item.full_text === 'string' && !!item.full_text.trim() : Array.isArray(item.insights) && item.insights.some(v => isRecord(v) && typeof v.content === 'string' && !!v.content.trim());
            if (!usable)
                issues.push({ id: item.id, kind: 'unusable' });
        }
        for (const [id] of chosen) {
            if (!seen.has(id))
                issues.push({ id, kind: 'missing' });
            else if (!membership[kind].includes(id))
                issues.push({ id, kind: 'invalid' });
        }
    }
    return issues;
}
