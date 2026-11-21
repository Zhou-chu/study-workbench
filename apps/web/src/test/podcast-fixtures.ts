import { libraryServer } from './library-harness';
import { json } from './notebook-fixtures';
import { legacySource } from './library-fixtures';
export const ep = { id: 'episode_profile:show:full', name: 'Study show', description: 'Format', speaker_config: 'speaker_profile:hosts:full', speaker_config_name: 'Hosts', outline_llm: 'model:language', transcript_llm: 'model:language', language: null, default_briefing: 'Explain carefully', num_segments: 5, max_tokens: null };
export const sp = { id: 'speaker_profile:hosts:full', name: 'Hosts', description: 'Voices', voice_model: 'model:voice', speakers: [{ name: 'Ada', voice_id: 'voice-one', backstory: 'A scholar', personality: 'Thoughtful', voice_model: null, pronunciation: 'Keep me' }] };
export const episode = { id: 'episode:one:full', name: 'Recorded lesson', episode_profile: { name: 'Historical format', outline_model_provider: 'Synthetic', outline_model_name: 'Prior model' }, speaker_profile: { name: 'Past hosts', speakers: [{ name: 'Ada' }] }, briefing: 'Saved briefing', audio_file: '/private/never-display.mp3', audio_url: '/api/podcasts/episodes/episode:one:full/audio', transcript: { transcript: [{ speaker: 'Ada', dialogue: 'Recorded dialogue' }] }, outline: { segments: [{ name: 'Opening', description: 'Explore the proof', size: 5 }] }, created: null, job_status: 'completed', error_message: null };
export const podcastNote = { id: 'note:pod:full', title: 'Selected note', content: 'Note material', note_type: 'human', revision: 1, created: '2026-11-08', updated: '2026-11-08' };
export function podcastServer(handler?: (r: Request) => Response | undefined | Promise<Response | undefined>) {
    return libraryServer(async (r) => {
        const custom = await handler?.(r);
        if (custom !== undefined)
            return custom;
        const p = decodeURIComponent(new URL(r.url).pathname);
        if (p === '/api/podcasts/episodes')
            return json([episode]);
        if (p === '/api/episode-profiles')
            return r.method === 'GET' ? json([ep]) : json({ ...ep, ...await r.clone().json(), id: 'episode_profile:new:full' });
        if (p === '/api/speaker-profiles')
            return r.method === 'GET' ? json([sp]) : json({ ...sp, ...await r.clone().json(), id: 'speaker_profile:new:full' });
        if (p === '/api/models')
            return json([{ id: 'model:language', name: 'Language', provider: 'Synthetic', type: 'language' }, { id: 'model:voice', name: 'Voice', provider: 'Synthetic', type: 'text_to_speech' }]);
        if (p === '/api/models/defaults')
            return json({ default_chat_model: 'model:language', default_embedding_model: null, default_text_to_speech_model: 'model:voice' });
        if (p === '/api/languages')
            return json([{ code: 'en-US', name: 'English' }, { code: 'zh-CN', name: 'Chinese' }]);
        if (p === '/api/notes')
            return json([podcastNote]);
        if (p === '/api/chat/context') {
            const b = await r.clone().json();
            return json({ context: { sources: Object.entries(b.context_config.sources).filter(([, m]) => m !== 'not in').map(([id, m]) => ({ id, title: 'Selected source', insights: [{ content: 'Source insight' }], ...(m === 'full content' ? { full_text: 'Source material' } : {}) })), notes: Object.entries(b.context_config.notes).filter(([, m]) => m !== 'not in').map(([id]) => ({ id, title: 'Selected note', content: 'Note material' })) }, token_count: 12, char_count: 48 });
        }
        if (p === '/api/podcasts/generate')
            return json({ job_id: 'command:podcast:full', status: 'submitted', message: 'Queued', episode_profile: ep.name, episode_name: 'Lesson' });
        if (p === '/api/commands/jobs/command:podcast:full')
            return json({ job_id: 'command:podcast:full', status: 'running' });
        if (p === `/api/podcasts/episodes/${episode.id}/audio`)
            return new Response(new Blob(['synthetic'], { type: 'audio/mpeg' }), { headers: { 'Content-Disposition': 'attachment; filename="lesson.mp3"' } });
        if (p.endsWith('/duplicate'))
            return json(p.includes('episode-profiles') ? { ...ep, id: 'episode_profile:copy', name: ep.name + ' - Copy' } : { ...sp, id: 'speaker_profile:copy', name: sp.name + ' - Copy' });
        if (r.method === 'PUT' && p.includes('-profiles/'))
            return json({ ...p.includes('episode-profiles') ? ep : sp, ...await r.clone().json() });
        if (r.method === 'DELETE')
            return json({ message: 'Deleted', episode_id: episode.id });
        if (p.endsWith('/retry'))
            return json({ job_id: 'command:retry', message: 'Queued' });
        if (p === '/api/commands/jobs/command:retry')
            return json({ job_id: 'command:retry', status: 'running' });
    });
}
export { legacySource };
