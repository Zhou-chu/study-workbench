import { useWorkbenchSnapshot } from '../../app/WorkbenchSession';
import type { LibraryDraft } from './library-store';
import type { EpisodeProfile, SpeakerProfile, PodcastEpisode } from '../../data/podcast-contracts';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { readTurnContext, sessionCoordinator, canDispatch } from '@study/web-transport';
import { useLibraryState } from './use-library-state';
import { podcastOperationFor } from './podcast-operations';
import type { PodcastGenerationForm, PodcastProfileForm } from './podcast-state';
export function usePodcastData(episodesEnabled = true) {
    const s = useLibraryState(), queries = useQueryClient(), session = useWorkbenchSnapshot(), ready = s.ready && session.state?.ready === true;
    const episodes = useQuery({ queryKey: ['library', 'podcast-episodes', s.scope], enabled: ready && episodesEnabled, queryFn: ({ signal }) => s.api!.podcasts.list(s.context!, signal), refetchInterval: q => episodesEnabled && ready && q.state.data?.some(e => ['running', 'processing', 'pending', 'submitted'].includes(e.job_status ?? '')) ? 15000 : false });
    const profiles = useQuery({ queryKey: ['library', 'episode-profiles', s.scope], enabled: ready, queryFn: ({ signal }) => s.api!.episodeProfiles.list(s.context!, signal) });
    const speakers = useQuery({ queryKey: ['library', 'speaker-profiles', s.scope], enabled: ready, queryFn: ({ signal }) => s.api!.speakerProfiles.list(s.context!, signal) });
    const models = useQuery({ queryKey: ['library', 'models', s.scope], enabled: ready, queryFn: ({ signal }) => s.api!.metadata.models(s.context!, signal) });
    function live<T>(name: string) { const q = queries.getQueryState<T>(['library', name, s.scope]); return q?.status === 'success' && q.fetchStatus === 'idle' ? q.data : undefined; }
    function speakerInUse(id: string) {
        const pendingBinding = s.store.getSnapshot().some(r => !r.retired && canDispatch(r.context, readTurnContext()) &&
            ['pending', 'accepted', 'unknown'].includes(r.status) && r.input.kind === 'podcast-operation' && r.input.action === 'save-episode' &&
            r.input.request && 'speaker_config' in r.input.request && r.input.request.speaker_config === id);
        const rows = live<EpisodeProfile[]>('episode-profiles');
        return pendingBinding || !rows || rows.some(p => p.speaker_config === id);
    }
    function generationProfile(id: string) {
        const ps = live<EpisodeProfile[]>('episode-profiles'), ss = live<SpeakerProfile[]>('speaker-profiles'), ms = live<{
            id: string;
            type: string;
        }[]>('models');
        const profile = ps?.find(p => p.id === id), speaker = ss?.find(p => p.id === profile?.speaker_config);
        if (!profile || !speaker || !ms || ps?.filter(p => p.name === profile.name).length !== 1 || !ms.some(m => m.id === profile.outline_llm && m.type === 'language') || !ms.some(m => m.id === profile.transcript_llm && m.type === 'language') || !ms.some(m => m.id === speaker.voice_model && m.type === 'text_to_speech'))
            return null;
        return { profile, speaker };
    }
    const retryEligible = (id: string) => live<PodcastEpisode[]>('podcast-episodes')?.some(e => e.id === id && ['failed', 'error'].includes(e.job_status ?? '')) === true;
    return { ...s, ready, episodes, profiles, speakers, models, speakerInUse, generationProfile, retryEligible, live };
}
export function usePodcastForm(initial: PodcastGenerationForm | PodcastProfileForm, blank: () => PodcastGenerationForm | PodcastProfileForm = () => initial, completedSeed?: (operation: LibraryDraft, input: PodcastGenerationForm | PodcastProfileForm) => PodcastGenerationForm | PodcastProfileForm | null) {
    const [id, setId] = useState<string | null>(null), s = useLibraryState(id), session = useWorkbenchSnapshot(), ready = s.ready && session.state?.ready === true;
    useEffect(() => { if (s.context?.ready)
        setId(s.store.open({ kind: 'podcast', key: initial.formKey }, initial, s.context, s.generation)); }, [initial.formKey, s.scope]);
    const operation = s.row && (s.row.input.kind === 'podcast-form' || s.row.input.kind === 'podcast-profile-form') ? podcastOperationFor(s.rows, s.row.input.intentId) : undefined;
    const input = s.row?.input;
    const blockingOperation = input?.kind === 'podcast-profile-form' && input.targetId ? [...s.rows].reverse().find(r => r.input.kind === 'podcast-operation' && r.input.targetId === input.targetId && ['pending', 'accepted', 'unknown'].includes(r.status)) : undefined;
    const current = () => !!s.row && s.store.current(s.row, readTurnContext(), sessionCoordinator.current());
    const admitted = () => {
        if (!s.row || !current() || (s.row.input.kind !== 'podcast-form' && s.row.input.kind !== 'podcast-profile-form'))
            return false;
        const input = s.row.input, rows = s.store.getSnapshot();
        return !podcastOperationFor(rows, input.intentId) && !(input.kind === 'podcast-profile-form' && input.targetId && rows.some(r => r.input.kind === 'podcast-operation' && r.input.targetId === input.targetId && ['pending', 'accepted', 'unknown'].includes(r.status)));
    };
    const locked = !ready || !admitted();
    function edit(patch: Partial<PodcastGenerationForm | PodcastProfileForm>) { if (id && admitted()) {
        s.store.edit(id, patch);
        s.navigation?.activateResource(id);
    } }
    const canRenew = !!s.row && !!s.context?.ready && (!operation || !['pending', 'accepted', 'unknown'].includes(operation.status)) && !blockingOperation && s.store.canFresh(s.row, s.context, s.generation);
    function renew() {
        if (!id || blockingOperation || operation && ['pending', 'accepted', 'unknown'].includes(operation.status))
            return;
        if (canRenew && s.row) {
            // Readiness/session recovery may preserve a choice only inside its original privacy/target owner.
            const sameOwner = !s.row.retired && canDispatch(s.row.context, readTurnContext());
            if (sameOwner) {
                const input = s.row.input;
                if (input.kind !== 'podcast-form' && input.kind !== 'podcast-profile-form') return;
                const seed = operation ? (completedSeed ? completedSeed(operation, input) : initial) : input;
                if (!seed) return;
                const next = s.store.fresh(id, { ...seed, intentId: crypto.randomUUID() }, s.context!, s.generation);
                if (next) setId(next);
            } else {
                const seed = { ...blank(), intentId: crypto.randomUUID() };
                const opened = s.store.open({ kind: 'podcast', key: seed.formKey }, seed, s.context!, s.generation);
                const row = s.store.get(opened)!;
                const next = s.store.current(row, s.context, s.generation) ? opened : s.store.fresh(opened, seed, s.context!, s.generation);
                if (next) setId(next);
            }
            return;
        }
        if (current() && s.row && (s.row.input.kind === 'podcast-form' || s.row.input.kind === 'podcast-profile-form')) {
            const seed = operation && completedSeed ? completedSeed(operation, s.row.input) : initial;
            if (seed) s.store.reset(id, { ...seed, intentId: crypto.randomUUID() });
        }
    }
    return { ...s, ready, operation: operation ?? blockingOperation, locked, current, admitted, edit, renew, canRenew };
}
