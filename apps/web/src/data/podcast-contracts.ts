import { isRecord } from '@study/contracts';
export type EpisodeProfileInput = {
    name: string;
    description?: string;
    speaker_config: string;
    default_briefing: string;
    outline_llm?: string | null;
    transcript_llm?: string | null;
    language?: string | null;
    num_segments?: number;
    max_tokens?: number | null;
};
export type EpisodeProfile = Omit<EpisodeProfileInput, 'speaker_config' | 'description' | 'num_segments'> & {
    id: string;
    description: string;
    speaker_config: string | null;
    speaker_config_name?: string | null;
    num_segments: number;
};
export type SpeakerProfileInput = {
    name: string;
    description?: string;
    voice_model?: string | null;
    speakers: Record<string, unknown>[];
};
export type SpeakerProfile = SpeakerProfileInput & {
    id: string;
    description: string;
};
export type PodcastEpisode = {
    id: string;
    name: string;
    episode_profile: Record<string, unknown>;
    speaker_profile: Record<string, unknown>;
    briefing: string;
    audio_url?: string | null;
    transcript?: Record<string, unknown> | null;
    outline?: Record<string, unknown> | null;
    created?: string | null;
    job_status?: string | null;
};
export type GenerationRequest = {
    episode_profile: string;
    speaker_profile: string;
    episode_name: string;
    content: string;
    briefing_suffix?: string;
};
const bad = (): never => { throw new TypeError('Invalid podcast response'); };
export const podcastRecord = (v: unknown): Record<string, unknown> => isRecord(v) ? v : bad();
export const podcastString = (v: unknown): string => typeof v === 'string' ? v : bad();
export const podcastId = (v: unknown): string => { const s = podcastString(v); return s.trim() && !/[\\/\u0000-\u001f]/.test(s) ? s : bad(); };
function optional(r: Record<string, unknown>, keys: string[]) { const out: Record<string, string | null> = {}; for (const k of keys)
    if (r[k] !== undefined)
        out[k] = r[k] === null ? null : podcastString(r[k]); return out; }
export function parseEpisodeProfile(v: unknown): EpisodeProfile {
    const r = podcastRecord(v);
    if (typeof r.num_segments !== 'number' || !Number.isInteger(r.num_segments))
        bad();
    if (r.max_tokens !== undefined && r.max_tokens !== null && (typeof r.max_tokens !== 'number' || !Number.isInteger(r.max_tokens)))
        bad();
    return { id: podcastId(r.id), name: podcastString(r.name), description: podcastString(r.description), speaker_config: r.speaker_config == null ? null : podcastId(r.speaker_config), default_briefing: podcastString(r.default_briefing), num_segments: r.num_segments as number, ...optional(r, ['speaker_config_name', 'outline_llm', 'transcript_llm', 'language']), ...(r.max_tokens !== undefined ? { max_tokens: r.max_tokens as number | null } : {}) };
}
export function parseSpeakerProfile(v: unknown): SpeakerProfile { const r = podcastRecord(v); if (!Array.isArray(r.speakers))
    bad(); return { id: podcastId(r.id), name: podcastString(r.name), description: podcastString(r.description), ...optional(r, ['voice_model']), speakers: (r.speakers as unknown[]).map(v => ({ ...podcastRecord(v) })) }; }
export function parsePodcastEpisode(v: unknown): PodcastEpisode { const r = podcastRecord(v); return { id: podcastId(r.id), name: podcastString(r.name), episode_profile: { ...podcastRecord(r.episode_profile) }, speaker_profile: { ...podcastRecord(r.speaker_profile) }, briefing: podcastString(r.briefing), ...optional(r, ['audio_url', 'created', 'job_status']), ...(r.outline !== undefined ? { outline: r.outline === null ? null : podcastRecord(r.outline) } : {}), ...(r.transcript !== undefined ? { transcript: r.transcript === null ? null : podcastRecord(r.transcript) } : {}) }; }
export function podcastAudioPath(episode: PodcastEpisode): string | null {
    if (!episode.audio_url)
        return null;
    const canonical = '/api/podcasts/episodes/' + encodeURIComponent(episode.id) + '/audio';
    try {
        const url = episode.audio_url;
        if (!url.startsWith('/api/podcasts/episodes/') || /[?#\\]/.test(url))
            return null;
        return decodeURIComponent(url) === decodeURIComponent(canonical) ? canonical.slice(4) : null;
    }
    catch {
        return null;
    }
}
export const podcastActive = (status: string | null | undefined) => ['running', 'processing', 'pending', 'submitted'].includes(status ?? '');
export const podcastRetryable = (status: string | null | undefined) => status === 'failed' || status === 'error';
