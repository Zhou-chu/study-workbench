import {SetupLink} from '../settings/SetupLink';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { canDispatch, readTurnContext, sessionCoordinator, type DispatchContext } from '@study/web-transport';
import { AppChrome } from '../../app/AppChrome';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { LibraryDialog } from './LibraryDialog';
import { usePodcastData } from './use-podcasts';
import { PodcastGenerationDialog } from './PodcastGenerationDialog';
import { PodcastProfileEditor } from './PodcastProfileEditor';
import { PodcastEpisodeDetails } from './PodcastEpisodeDetails';
import { PodcastReceipt } from './PodcastReceipt';
import { executePodcast } from './podcast-operations';
import type { PodcastOperation } from './podcast-state';
import { podcastRetryable, podcastActive, type EpisodeProfile, type SpeakerProfile, type PodcastEpisode } from '../../data/podcast-contracts';
type Action = {
    intentId: string;
    action: PodcastOperation['action'];
    targetId: string;
    name: string;
    context: DispatchContext;
    generation: number;
};
export function PodcastsPage() {
    const s = usePodcastData(), { t, podcast: p } = useI18n(), location = useLocation(), [tab, setTab] = useState('episodes'), [generate, setGenerate] = useState(false), [details, setDetails] = useState<PodcastEpisode | null>(null), [editor, setEditor] = useState<{
        type: 'episode' | 'speaker';
        value?: EpisodeProfile | SpeakerProfile;
    } | null>(null), [action, setAction] = useState<Action | null>(null), [actionId, setActionId] = useState<string | null>(null), leases = useRef(new Map<string, () => void>()), latestAction = useRef<Action | null>(null), attempted = useRef(new Set<string>());
    latestAction.current = action;
    useEffect(() => { if (new URLSearchParams(location.search).get('create') === '1')
        setGenerate(true); if (new URLSearchParams(location.search).get('tab') === 'profiles') { setTab('profiles'); setGenerate(false); } }, [location.search, location.key]);
    useEffect(() => { const ids = new Set(s.rows.filter(r => r.input.kind === 'podcast-operation' && ['pending', 'accepted', 'unknown'].includes(r.status)).map(r => r.id)); for (const [id, release] of leases.current)
        if (!ids.has(id)) {
            release();
            leases.current.delete(id);
        } for (const id of ids)
        if (!leases.current.has(id) && s.navigation)
            leases.current.set(id, s.navigation.holdResource(id)); }, [s.rows, s.navigation]);
    useEffect(() => () => { for (const release of leases.current.values())
        release(); leases.current.clear(); }, []);
    const blocked = (a: string, id: string) => s.store.getSnapshot().some(r => r.input.kind === 'podcast-operation' && (r.input.action === a || !['retry', 'delete-episode'].includes(a) && !['retry', 'delete-episode'].includes(r.input.action)) && r.input.targetId === id && ['pending', 'accepted', 'unknown'].includes(r.status));
    function choose(a: PodcastOperation['action'], id: string, name: string) { if (!s.ready || !s.context)
        return; setActionId(null); setAction({ intentId: a + ':' + id + ':' + crypto.randomUUID(), action: a, targetId: id, name, context: s.context, generation: s.generation }); }
    const speakerUsed = s.speakerInUse;
    async function run(a: Action) {
        if (attempted.current.has(a.intentId) || !s.api || !s.ready || !canDispatch(a.context, readTurnContext()) || a.generation !== sessionCoordinator.current() || blocked(a.action, a.targetId))
            return;
        if (a.action === 'delete-speaker-profile' && speakerUsed(a.targetId))
            return;
        if (a.action === 'retry' && !s.retryEligible(a.targetId))
            return;
        attempted.current.add(a.intentId);
        const key = a.intentId;
        const id = await executePodcast(s.store, { kind: 'podcast-operation', key, originId: key, action: a.action, targetId: a.targetId }, s.api);
        if (latestAction.current === a)
            setActionId(id);
        s.refresh();
    }
    const actionRow = actionId ? s.store.get(actionId) : undefined;
    const actionLocked = !!action && (!s.ready || !canDispatch(action.context, readTurnContext()) || action.generation !== sessionCoordinator.current() || blocked(action.action, action.targetId) || !!actionRow);
    const setup = !s.models.data?.some(m => m.type === 'language') || !s.models.data?.some(m => m.type === 'text_to_speech') || s.profiles.data?.some(ep => !ep.outline_llm || !ep.transcript_llm || !s.speakers.data?.some(sp => sp.id === ep.speaker_config && !!sp.voice_model));
    const status = (e: PodcastEpisode) => e.job_status === 'completed' ? t.podcasts.completedLabel : podcastRetryable(e.job_status) ? t.podcasts.failedLabel : podcastActive(e.job_status) ? t.podcasts.processingLabel : t.common.unknown;
    return <AppChrome><div className="notebook-home podcast-page"><header><h1>{t.podcasts.listTitle}</h1><p>{t.podcasts.listDesc}</p></header>
 <div className="library-actions"><Button aria-pressed={tab === 'episodes'} onClick={() => setTab('episodes')}>{t.podcasts.episodesTab}</Button><Button aria-pressed={tab === 'profiles'} onClick={() => setTab('profiles')}>{t.podcasts.templatesTab}</Button><Button disabled={!s.ready} onClick={() => setGenerate(true)}>{t.podcasts.generateBtn}</Button><Button disabled={!s.ready || s.episodes.isFetching} onClick={() => void s.episodes.refetch()}>{t.common.refresh}</Button></div>
 {setup && <aside role="status"><h2>{t.podcasts.setupRequired}</h2><p>{t.podcasts.setupRequiredDesc}</p><div className="library-actions"><SetupLink className="button" to="/settings/models" returnTo={tab === "profiles" ? "/podcasts?tab=profiles" : undefined}>{t.navigation.models}</SetupLink><SetupLink className="button" to="/podcasts?tab=profiles">{t.podcasts.templatesTab}</SetupLink></div></aside>}
 {(s.episodes.isError || s.profiles.isError || s.speakers.isError || s.models.isError) && <p role="alert">{t.podcasts.loadErrorDesc}</p>}
 {tab === 'episodes' ? <section aria-label={t.podcasts.episodesTab}>{s.episodes.isPending && <p role="status">{t.podcasts.loadingEpisodes}</p>}{s.episodes.data?.length === 0 && <p>{t.podcasts.noEpisodesYet}</p>}
 {s.episodes.data?.map(e => <article className="podcast-card" key={e.id}><h2>{e.name}</h2><p>{status(e)}</p><p className="meta">{e.id}</p>{e.created && !Number.isNaN(Date.parse(e.created)) && <time dateTime={e.created}>{new Date(e.created).toLocaleString()}</time>}
 <div className="library-actions"><Button onClick={() => setDetails(e)}>{t.podcasts.details}</Button><Button disabled={!s.ready || !podcastRetryable(e.job_status) || blocked('retry', e.id) || s.episodes.isFetching} onClick={() => choose('retry', e.id, e.name)}>{t.podcasts.retry}</Button><Button disabled={!s.ready || blocked('delete-episode', e.id)} onClick={() => choose('delete-episode', e.id, e.name)}>{t.podcasts.delete}</Button></div>
 {podcastRetryable(e.job_status) && <details><summary>{t.podcasts.errorDetails}</summary><p>{t.podcasts.generationFailed}</p></details>}</article>)}</section> : <>
 <details><summary>{t.podcasts.howTemplatesPowerTitle}</summary><p>{t.podcasts.howTemplatesPowerDesc}</p><h3>{t.podcasts.episodeProfilesSetFormat}</h3><ul><li>{t.podcasts.episodeProfilesList1}</li><li>{t.podcasts.episodeProfilesList2}</li><li>{t.podcasts.episodeProfilesList3}</li></ul><h3>{t.podcasts.speakerProfilesBringVoices}</h3><ul><li>{t.podcasts.speakerProfilesList1}</li><li>{t.podcasts.speakerProfilesList2}</li><li>{t.podcasts.speakerProfilesList3}</li></ul></details>
 <section aria-label={t.podcasts.episodeProfilesTitle}><h2>{t.podcasts.episodeProfilesTitle}</h2><Button disabled={!s.ready || !s.speakers.data?.length} onClick={() => setEditor({ type: 'episode' })}>{t.podcasts.createProfile}</Button>{!s.speakers.data?.length && <p>{t.podcasts.createSpeakerFirst}</p>}
 {s.profiles.data?.map(profile => <article className="podcast-card" key={profile.id}><h3>{profile.name}</h3><p>{profile.description || t.podcasts.noDescription}</p><p className="meta">{profile.id}</p><div className="library-actions"><Button onClick={() => setEditor({ type: 'episode', value: profile })}>{t.podcasts.edit}</Button><Button disabled={!s.ready || blocked('duplicate-episode', profile.id)} onClick={() => choose('duplicate-episode', profile.id, profile.name)}>{t.podcasts.duplicate}</Button><Button disabled={!s.ready || blocked('delete-episode-profile', profile.id)} onClick={() => choose('delete-episode-profile', profile.id, profile.name)}>{t.podcasts.delete}</Button></div></article>)}</section>
 <section aria-label={t.podcasts.speakerProfilesTitle}><h2>{t.podcasts.speakerProfilesTitle}</h2><Button disabled={!s.ready} onClick={() => setEditor({ type: 'speaker' })}>{t.podcasts.createSpeaker}</Button>
 {s.speakers.data?.map(profile => <article className="podcast-card" key={profile.id}><h3>{profile.name}</h3><p>{profile.description || t.podcasts.noDescription}</p><p className="meta">{profile.id}</p>{speakerUsed(profile.id) && <p>{t.podcasts.deleteSpeakerDisabledHint}</p>}<div className="library-actions"><Button onClick={() => setEditor({ type: 'speaker', value: profile })}>{t.podcasts.edit}</Button><Button disabled={!s.ready || blocked('duplicate-speaker', profile.id)} onClick={() => choose('duplicate-speaker', profile.id, profile.name)}>{t.podcasts.duplicate}</Button><Button disabled={!s.ready || speakerUsed(profile.id) || blocked('delete-speaker-profile', profile.id)} onClick={() => choose('delete-speaker-profile', profile.id, profile.name)}>{t.podcasts.delete}</Button></div></article>)}</section></>}
 {s.rows.filter(r => r.input.kind === 'podcast-operation').map(row => <section className="library-operation" key={row.id}><PodcastReceipt row={row}/></section>)}
 {generate && <PodcastGenerationDialog onClose={() => setGenerate(false)}/>}
 {details && <PodcastEpisodeDetails episode={details} onClose={() => setDetails(null)}/>}
 {editor && <PodcastProfileEditor {...editor} onClose={() => setEditor(null)}/>}
 {action && <LibraryDialog open={s.ready} title={action.action === 'retry' ? t.podcasts.retry : action.action.startsWith('duplicate') ? t.podcasts.duplicate : action.action === 'delete-episode' ? t.podcasts.deleteEpisodeTitle : action.action === 'delete-speaker-profile' ? t.podcasts.deleteSpeakerProfileTitle : t.podcasts.deleteProfileTitle} onOpenChange={v => { if (!v)
            setAction(null); }}>
 <p>{action.name}</p><p className="meta">{action.targetId}</p>{action.action === 'retry' ? <p>{p.retryLimit}</p> : action.action.startsWith('delete') ? <p>{(action.action === 'delete-episode' ? t.podcasts.deleteEpisodeDesc : action.action === 'delete-speaker-profile' ? t.podcasts.deleteSpeakerProfileDesc : t.podcasts.deleteProfileDesc).replace('{{name}}', action.name)}</p> : null}
 <PodcastReceipt row={actionRow}/><Button disabled={actionLocked || action.action === 'delete-speaker-profile' && speakerUsed(action.targetId)} onClick={() => void run(action)}>{action.action === 'retry' ? t.podcasts.retry : action.action.startsWith('duplicate') ? t.podcasts.duplicate : t.podcasts.delete}</Button><Button onClick={() => setAction(null)}>{t.common.cancel}</Button></LibraryDialog>}
 </div></AppChrome>;
}
