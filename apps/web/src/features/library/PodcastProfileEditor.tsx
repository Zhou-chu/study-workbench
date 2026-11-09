import { useMemo, useRef } from 'react';
import { readTurnContext } from '@study/web-transport';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { LibraryDialog } from './LibraryDialog';
import { usePodcastData, usePodcastForm } from './use-podcasts';
import { executePodcast, podcastOperationFor } from './podcast-operations';
import { PodcastReceipt } from './PodcastReceipt';
import type { EpisodeProfile, SpeakerProfile, EpisodeProfileInput, SpeakerProfileInput } from '../../data/podcast-contracts';
import type { PodcastProfileForm } from './podcast-state';
function payload(type: 'episode' | 'speaker', value?: EpisodeProfile | SpeakerProfile): EpisodeProfileInput | SpeakerProfileInput {
    if (value) {
        if ('speaker_config' in value) {
            const fields: EpisodeProfileInput = { name: value.name, description: value.description, speaker_config: value.speaker_config ?? '', default_briefing: value.default_briefing, num_segments: value.num_segments };
            for (const key of ['outline_llm', 'transcript_llm', 'language'] as const)
                if (value[key] !== undefined)
                    fields[key] = value[key];
            if (value.max_tokens !== undefined)
                fields.max_tokens = value.max_tokens;
            return fields;
        }
        return { name: value.name, description: value.description, ...(value.voice_model !== undefined ? { voice_model: value.voice_model } : {}), speakers: value.speakers.map(v => ({ ...v })) };
    }
    return type === 'episode' ? { name: '', description: '', speaker_config: '', outline_llm: null, transcript_llm: null, language: null, default_briefing: '', num_segments: 5, max_tokens: null } : { name: '', description: '', voice_model: null, speakers: [{ name: '', voice_id: '', backstory: '', personality: '', voice_model: null }] };
}
export function PodcastProfileEditor({ type, value, onClose }: {
    type: 'episode' | 'speaker';
    value?: EpisodeProfile | SpeakerProfile;
    onClose(): void;
}) {
    function makeForm(value?: EpisodeProfile | SpeakerProfile): PodcastProfileForm {
        return { kind: 'podcast-profile-form', formKey: type + ':' + (value?.id ?? 'new') + ':' + readTurnContext()?.epoch, intentId: crypto.randomUUID(), profileType: type, targetId: value?.id ?? null, payload: payload(type, value) };
    }
    const initial = useMemo(() => makeForm(value), [type, value?.id]);
    const s = usePodcastForm(initial, () => makeForm(), (operation, input) => {
        if (input.kind !== 'podcast-profile-form') return null;
        if (!input.targetId) return makeForm();
        if (operation.status !== 'succeeded') return input;
        const acknowledged = operation.podcastProfile;
        if (!acknowledged || acknowledged.id !== input.targetId || ('speaker_config' in acknowledged) !== (type === 'episode')) return null;
        return { ...input, payload: payload(type, acknowledged) };
    }), data = usePodcastData(false), { t, podcast: p } = useI18n(), composing = useRef(false);
    const langs = useQuery({ queryKey: ['library', 'podcast-languages', s.scope], enabled: s.ready, queryFn: ({ signal }) => s.api!.metadata.languages(s.context!, signal) });
    const form = s.row?.input.kind === 'podcast-profile-form' ? s.row.input : null, v = form?.payload;
    const change = (patch: Partial<EpisodeProfileInput & SpeakerProfileInput>) => { if (v)
        s.edit({ payload: { ...v, ...patch } }); };
    const valid = !!v?.name.trim() && ('speaker_config' in v ? !!v.speaker_config && !!v.default_briefing.trim() && data.speakers.data?.some(x => x.id === v.speaker_config) && Number.isInteger(v.num_segments) && v.num_segments! >= 3 && v.num_segments! <= 20 && (v.max_tokens == null || Number.isInteger(v.max_tokens) && v.max_tokens > 0) : v.speakers.length >= 1 && v.speakers.length <= 4 && v.speakers.every(row => ['name', 'voice_id', 'backstory', 'personality'].every(key => typeof row[key] === 'string' && !!(row[key] as string).trim())));
    function model(label: string, field: 'outline_llm' | 'transcript_llm' | 'voice_model', val: string | null | undefined, update: (v: string | null) => void, kind = 'language') {
        return <label>{label}<select value={val ?? ''} onChange={e => update(e.target.value || null)}><option value="">{t.podcasts.notConfigured}</option>{val && !data.models.data?.some(m => m.id === val) && <option value={val}>{val + ' · ' + t.common.unknown}</option>}{data.models.data?.filter(m => m.type === kind).map(m => <option key={m.id} value={m.id}>{(m.provider ? m.provider + ' · ' : '') + m.name}</option>)}</select></label>;
    }
    async function save() {
        if (!form || !s.row || !s.api || s.locked || !valid || composing.current || !s.admitted() || s.store.get(s.row.id) !== s.row || podcastOperationFor(s.store.getSnapshot(), form.intentId))
            return;
        await executePodcast(s.store, { kind: 'podcast-operation', key: 'save:' + form.intentId, originId: form.intentId, action: type === 'episode' ? 'save-episode' : 'save-speaker', targetId: form.targetId, request: form.payload, original: form }, s.api);
        s.refresh();
    }
    return <LibraryDialog open={s.ready} onOpenChange={v => { if (!v)
        onClose(); }} title={type === 'episode' ? (form?.targetId ? t.podcasts.editEpisodeProfile : t.podcasts.createEpisodeProfile) : (form?.targetId ? t.podcasts.editSpeakerProfile : t.podcasts.createSpeakerProfile)}>
 {v && <form className="podcast-form" onSubmit={e => { e.preventDefault(); void save(); }} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}><fieldset disabled={s.locked}><legend>{t.podcasts.profile}</legend>
 <label>{t.podcasts.profileName}<input value={v.name} onChange={e => change({ name: e.target.value })}/></label><label>{t.common.description}<textarea value={v.description ?? ''} onChange={e => change({ description: e.target.value })}/></label>
 {'speaker_config' in v ? <><label>{t.podcasts.speakerConfig}<select value={v.speaker_config} onChange={e => change({ speaker_config: e.target.value })}><option value="">{t.podcasts.selectSpeakerProfile}</option>{v.speaker_config && !data.speakers.data?.some(x => x.id === v.speaker_config) && <option value={v.speaker_config}>{v.speaker_config + ' · ' + t.common.unknown}</option>}{data.speakers.data?.map(x => <option value={x.id} key={x.id}>{x.name + ' · ' + x.id}</option>)}</select></label>
 {model(t.podcasts.outlineModel, 'outline_llm', v.outline_llm, next => change({ outline_llm: next }))}{model(t.podcasts.transcriptModel, 'transcript_llm', v.transcript_llm, next => change({ transcript_llm: next }))}
 <label>{t.podcasts.language}<select value={v.language ?? ''} onChange={e => change({ language: e.target.value || null })}><option value="">{t.podcasts.languagePlaceholder}</option>{v.language && !langs.data?.some(l => l.code === v.language) && <option value={v.language}>{v.language}</option>}{langs.data?.map(l => <option value={l.code} key={l.code}>{l.name}</option>)}</select></label>
 <label>{t.podcasts.defaultBriefingTitle}<textarea value={v.default_briefing} onChange={e => change({ default_briefing: e.target.value })}/></label><label>{t.podcasts.segments}<input type="number" min={3} max={20} step={1} value={v.num_segments ?? 5} onChange={e => change({ num_segments: e.target.valueAsNumber })}/></label>
 <label>{t.podcasts.maxTokens}<input type="number" min={1} step={1} value={v.max_tokens ?? ''} onChange={e => change({ max_tokens: e.target.value === '' ? null : e.target.valueAsNumber })}/></label><p>{t.podcasts.maxTokensHelp}</p>
 </> : <>{model(t.podcasts.voiceModel, 'voice_model', v.voice_model, next => change({ voice_model: next }), 'text_to_speech')}
 {v.speakers.map((speaker, index) => <fieldset key={index}><legend>{t.podcasts.speakerNumber.replace('{{number}}', String(index + 1))}</legend>{(['name', 'voice_id', 'backstory', 'personality'] as const).map(key => <label key={key}>{key === 'name' ? t.common.name : key === 'voice_id' ? t.podcasts.voiceId : key === 'backstory' ? t.podcasts.backstory : t.podcasts.personality}<input value={typeof speaker[key] === 'string' ? speaker[key] as string : ''} onChange={e => change({ speakers: v.speakers.map((row, i) => i === index ? { ...row, [key]: e.target.value } : row) })}/></label>)}
 {model(t.podcasts.perSpeakerTtsOverride, 'voice_model', typeof speaker.voice_model === 'string' ? speaker.voice_model : null, next => change({ speakers: v.speakers.map((row, i) => i === index ? { ...row, voice_model: next } : row) }), 'text_to_speech')}
 <Button disabled={s.locked || v.speakers.length <= 1} onClick={() => change({ speakers: v.speakers.filter((_, i) => i !== index) })}>{p.removeSpeaker}</Button></fieldset>)}
 <Button disabled={s.locked || v.speakers.length >= 4} onClick={() => change({ speakers: [...v.speakers, { name: '', voice_id: '', backstory: '', personality: '', voice_model: null }] })}>{t.podcasts.addSpeaker}</Button></>}
 </fieldset><Button type="submit" disabled={s.locked || !valid}>{t.common.save}</Button></form>}
 {(data.models.isError || data.speakers.isError || langs.isError) && <p role="alert">{t.common.contentUnavailable.errorTitle}</p>}
 <PodcastReceipt row={s.operation}/>{(s.canRenew || s.operation && !['pending', 'accepted', 'unknown'].includes(s.operation.status)) && <Button onClick={s.renew}>{p.newDraft}</Button>}<Button onClick={onClose}>{t.common.cancel}</Button></LibraryDialog>;
}
