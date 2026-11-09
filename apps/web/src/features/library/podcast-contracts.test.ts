import { expect, it } from 'vitest';
import { parsePodcastEpisode, parseEpisodeProfile, parseSpeakerProfile, podcastAudioPath, podcastRetryable } from '../../data/podcast-contracts';
import { podcastMessages } from '../../i18n/podcast-messages';
import { resources } from '../../i18n/locales';
import { episode, ep, sp } from '../../test/podcast-fixtures';
it('producer null/optional fields and weak historical dictionaries are preserved, with no private path/error projection', () => {
    const e = parsePodcastEpisode({ ...episode, episode_profile: { legacy: 42 }, speaker_profile: {}, outline: null, transcript: { other: true }, job_status: null });
    expect(e.episode_profile).toEqual({ legacy: 42 });
    expect(e.outline).toBeNull();
    expect(e).not.toHaveProperty('audio_file');
    expect(e).not.toHaveProperty('error_message');
    const profile = parseEpisodeProfile({ ...ep, speaker_config: null, language: null, max_tokens: null });
    expect(profile.speaker_config).toBeNull();
    expect(profile.language).toBeNull();
    const { voice_model, ...without } = sp;
    expect(voice_model).toBe('model:voice');
    expect(parseSpeakerProfile(without)).not.toHaveProperty('voice_model');
    expect(parseSpeakerProfile(sp).speakers[0]?.pronunciation).toBe('Keep me');
});
it('audio canonicalization never substitutes another episode identity or follows external paths', () => {
    expect(podcastAudioPath(episode)).toBe('/podcasts/episodes/episode%3Aone%3Afull/audio');
    expect(podcastAudioPath({ ...episode, audio_url: '/api/podcasts/episodes/episode%3Aother/audio' })).toBeNull();
    for (const status of ['completed', 'unknown', 'running', 'canceled', null, undefined])
        expect(podcastRetryable(status)).toBe(false);
    expect(podcastRetryable('failed')).toBe(true);
    expect(podcastRetryable('error')).toBe(true);
});
it('all14 locale registries include every podcast safety/control message without an English fallback', () => {
    expect(Object.keys(podcastMessages).sort()).toEqual(Object.keys(resources).sort());
    const keys = Object.keys(podcastMessages['en-US']).sort();
    for (const [locale, messages] of Object.entries(podcastMessages)) {
        expect(Object.keys(messages).sort()).toEqual(keys);
        for (const value of Object.values(messages))
            expect(value.trim()).toBeTruthy();
        if (locale !== 'en-US')
            expect(messages.retryLimit).not.toBe(podcastMessages['en-US'].retryLimit);
    }
});
