import { useLibraryConnection } from '../../data/use-library-connection';
import { useState } from 'react';
import { isRecord } from '@study/contracts';
import type { PodcastEpisode } from '../../data/podcast-contracts';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { Markdown } from '../../ui/Markdown';
import { LibraryDialog } from './LibraryDialog';
import { PodcastAudio } from './PodcastAudio';
export function PodcastEpisodeDetails({ episode: e, onClose }: {
    episode: PodcastEpisode;
    onClose(): void;
}) {
    const c = useLibraryConnection(), [tab, setTab] = useState('summary'), { t } = useI18n(), p = t.podcasts;
    const text = (v: unknown) => typeof v === 'string' || typeof v === 'number' ? String(v) : t.common.unknown;
    function model(snapshot: Record<string, unknown>, stage: string, legacy: string) { const provider = snapshot[stage + '_model_provider'] ?? snapshot[legacy + '_provider'], name = snapshot[stage + '_model_name'] ?? snapshot[legacy + '_model']; return typeof provider === 'string' && typeof name === 'string' ? provider + ' · ' + name : t.common.unknown; }
    const segments = Array.isArray(e.outline?.segments) ? e.outline.segments.filter(isRecord) : [], transcript = Array.isArray(e.transcript?.transcript) ? e.transcript.transcript.filter(isRecord) : [];
    return <LibraryDialog open={c.ready} title={e.name} onOpenChange={v => { if (!v)
        onClose(); }}><div className="library-actions">{(['summary', 'outline', 'transcript'] as const).map(k => <Button aria-pressed={tab === k} key={k} onClick={() => setTab(k)}>{k === 'summary' ? p.summaryTab : k === 'outline' ? p.outlineTab : p.transcriptTab}</Button>)}</div>
 {tab === 'summary' && <section><h3>{p.episodeProfile}</h3><p>{text(e.episode_profile.name)}</p><p>{p.outlineModel + ': '}</p><p>{model(e.episode_profile, 'outline', 'outline')}</p><p>{p.transcriptModel + ': '}</p><p>{model(e.episode_profile, 'transcript', 'transcript')}</p><p>{p.segments + ': ' + text(e.episode_profile.num_segments)}</p><p>{p.maxTokens + ': ' + text(e.episode_profile.max_tokens)}</p><p>{p.language + ': ' + text(e.episode_profile.language)}</p><h3>{p.defaultBriefingTitle}</h3><Markdown>{text(e.episode_profile.default_briefing)}</Markdown><h3>{p.speakerProfile}</h3><p>{text(e.speaker_profile.name)}</p><p>{model(e.speaker_profile, 'voice', 'tts')}</p>{Array.isArray(e.speaker_profile.speakers) && e.speaker_profile.speakers.filter(isRecord).map((s, i) => <article key={i}><h4>{text(s.name)}</h4>{['voice_id', 'backstory', 'personality'].map(k => <p key={k}>{text(s[k])}</p>)}</article>)}<h3>{p.briefing}</h3><Markdown>{e.briefing}</Markdown></section>}
 {tab === 'outline' && (segments.length ? segments.map((s, i) => <article key={i}><h3>{text(s.name)}</h3><Markdown>{text(s.description)}</Markdown><p>{text(s.size)}</p></article>) : <p>{p.noOutline}</p>)}
 {tab === 'transcript' && (transcript.length ? transcript.map((s, i) => <article key={i}><h3>{text(s.speaker)}</h3><Markdown>{text(s.dialogue)}</Markdown></article>) : <p>{p.noTranscript}</p>)}
 <PodcastAudio episode={e}/></LibraryDialog>;
}
