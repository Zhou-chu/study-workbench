import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { readTurnContext, sessionCoordinator } from '@study/web-transport';
import { useAppData } from '../../app/providers';
import { useNotebookConnection } from '../../data/use-notebook-connection';
import { createStudioApi } from '../../data/studio-api';
import { emptyContext } from '../../data/native-chat';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { LibraryDialog } from './LibraryDialog';
import { usePodcastData, usePodcastForm } from './use-podcasts';
import { emptyPodcastForm, type PodcastPreview } from './podcast-state';
import { executePodcast, validatePodcastContext, podcastOperationFor } from './podcast-operations';
import { PodcastContextSelection } from './PodcastContextSelection';
import { PodcastReceipt } from './PodcastReceipt';
export function PodcastGenerationDialog({ onClose }: {
    onClose(): void;
}) {
    const initial = useMemo(emptyPodcastForm, []), s = usePodcastForm(initial), data = usePodcastData(false), n = useNotebookConnection(), { transport } = useAppData(), studio = useMemo(() => transport ? createStudioApi(transport) : null, [transport]), { t, podcast: p } = useI18n();
    const notebooks = useQuery({ queryKey: ['notebooks', n.scope], enabled: s.ready && n.ready && s.current(), queryFn: ({ signal }) => n.api!.list(n.context!, signal) });
    const controller = useRef<AbortController | null>(null), serial = useRef(0), busyRef = useRef(false), [busy, setBusy] = useState(false), composing = useRef(false);
    const form = s.row?.input.kind === 'podcast-form' ? s.row.input : null;
    useEffect(() => { busyRef.current = false; setBusy(false); return () => { serial.current++; controller.current?.abort(); busyRef.current = false; }; }, [s.scope]);
    const preview = s.row?.podcastPreview, validPreview = !!form && !!preview && preview.revision === s.row?.revision && !preview.issues.length && !!preview.content;
    const selectedProfile = data.profiles.data?.find(v => v.id === form?.profileId), speaker = data.speakers.data?.find(v => v.id === selectedProfile?.speaker_config);
    const configured = !!form && !!data.generationProfile(form.profileId);
    const chosen = !!form && Object.values(form.selection).some(c => [...Object.values(c.sources), ...Object.values(c.notes)].some(v => v !== 'not in'));
    const blockedPreview = !!form && !!preview?.issues.length && preview.selectionVersion === form.selectionVersion;
    function changeSelection(selection: NonNullable<typeof form>['selection']) { if (!form)
        return; serial.current++; controller.current?.abort(); busyRef.current = false; setBusy(false); s.edit({ selection, selectionVersion: form.selectionVersion + 1 }); }
    async function inspect() {
        if (!form || !s.row || s.locked || !chosen || busyRef.current || blockedPreview || !s.api || !s.context || !studio)
            return;
        const row = s.store.get(s.row.id);
        if (row !== s.row || !s.current())
            return;
        const token = ++serial.current, abort = new AbortController();
        controller.current?.abort();
        controller.current = abort;
        busyRef.current = true;
        setBusy(true);
        const value: PodcastPreview = { revision: row.revision, selectionVersion: form.selectionVersion, content: '', tokens: 0, chars: 0, issues: [] };
        try {
            const parts: string[] = [];
            for (const [notebookId, config] of Object.entries(form.selection)) {
                if (![...Object.values(config.sources), ...Object.values(config.notes)].some(v => v !== 'not in'))
                    continue;
                if (!notebooks.data?.some(v => v.id === notebookId)) {
                    value.issues.push({ id: notebookId, kind: 'missing' });
                    continue;
                }
                const sourceIds: string[] = [];
                for (let offset = 0;; offset += 100) {
                    const page = await s.api.sources.list({ notebook_id: notebookId, offset, limit: 100 }, row.context, abort.signal);
                    sourceIds.push(...page.map(v => v.id));
                    if (page.length < 100)
                        break;
                    if (abort.signal.aborted)
                        return;
                }
                const notes = await studio.listClassic(notebookId, row.context);
                if (abort.signal.aborted)
                    return;
                const context = await s.api.context({ kind: 'notebook', notebookId }, config, row.context, abort.signal);
                value.issues.push(...validatePodcastContext(config, { sources: sourceIds, notes: notes.map(v => v.id) }, context));
                parts.push((notebooks.data.find(v => v.id === notebookId)?.name ?? notebookId) + '\n' + JSON.stringify(context.context, null, 2));
                value.tokens += context.token_count;
                value.chars += context.char_count;
            }
            value.content = value.issues.length ? '' : parts.join('\n\n');
        }
        catch {
            if (!abort.signal.aborted)
                value.issues.push({ id: '', kind: 'invalid' });
        }
        finally {
            if (token === serial.current && !abort.signal.aborted) {
                s.store.podcastPreview(row.id, row.revision, value, readTurnContext(), sessionCoordinator.current());
                busyRef.current = false;
                setBusy(false);
            }
        }
    }
    async function generate() {
        if (composing.current || s.locked || !form || !s.row || !s.api || !validPreview || !configured || !form.name.trim() || !selectedProfile || !speaker)
            return;
        const row = s.store.get(s.row.id);
        if (row !== s.row || !s.current() || podcastOperationFor(s.store.getSnapshot(), form.intentId))
            return;
        const admitted = data.generationProfile(form.profileId);
        if (!admitted)
            return;
        const request = { episode_profile: admitted.profile.name, speaker_profile: admitted.speaker.id, episode_name: form.name.trim(), content: preview!.content, ...(form.instructions.trim() ? { briefing_suffix: form.instructions.trim() } : {}) };
        await executePodcast(s.store, { kind: 'podcast-operation', key: 'generate:' + form.intentId, originId: form.intentId, action: 'generate', targetId: null, request, original: form }, s.api);
        s.refresh();
    }
    return <LibraryDialog open={s.ready} onOpenChange={v => { if (!v)
        onClose(); }} title={t.podcasts.generateEpisode} description={t.podcasts.generateEpisodeDesc}>
 {form && <form className="podcast-form" onSubmit={e => { e.preventDefault(); void generate(); }} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}>
 <fieldset disabled={s.locked}><legend>{t.podcasts.content}</legend>{notebooks.data?.map(nb => <section key={nb.id}><label className="library-check"><input type="checkbox" checked={!!form.selection[nb.id]} onChange={e => { const selection = { ...form.selection }; if (e.target.checked)
            selection[nb.id] = emptyContext();
        else
            delete selection[nb.id]; changeSelection(selection); }}/>{nb.name}</label>{form.selection[nb.id] && <PodcastContextSelection notebookId={nb.id} config={form.selection[nb.id]!} disabled={s.locked} onChange={config => changeSelection({ ...form.selection, [nb.id]: config })}/>}</section>)}
 {Object.keys(form.selection).filter(id => !notebooks.data?.some(n => n.id === id)).map(id => <label key={id}><input type="checkbox" checked onChange={() => { const selection = { ...form.selection }; delete selection[id]; changeSelection(selection); }}/>{id + ' · ' + t.common.unknown}</label>)}
 <label>{t.podcasts.episodeProfile}<select value={form.profileId} onChange={e => s.edit({ profileId: e.target.value })}><option value="">{t.podcasts.episodeProfilePlaceholder}</option>{data.profiles.data?.map(profile => <option key={profile.id} value={profile.id}>{profile.name + ' · ' + profile.id}</option>)}</select></label>
 <label>{t.podcasts.episodeName}<input value={form.name} onChange={e => s.edit({ name: e.target.value })}/></label><label>{t.podcasts.additionalInstructions}<textarea value={form.instructions} onChange={e => s.edit({ instructions: e.target.value })}/></label></fieldset>
 {selectedProfile && !configured && <p role="alert">{t.podcasts.setupRequiredDesc}</p>}
 <Button disabled={s.locked || busy || !chosen || blockedPreview} onClick={() => void inspect()}>{p.preview}</Button>
 {preview && preview.selectionVersion === form.selectionVersion && preview.issues.map((issue, i) => <p role="alert" key={i}>{issue.kind === 'missing' ? p.missing : issue.kind === 'unusable' ? p.unusable : t.podcasts.buildContextFailed} {issue.id} {p.revise}</p>)}
 {validPreview && preview && <details open><summary>{p.preview}</summary><p>{p.estimate}</p><p>{t.podcasts.tokens.replace('{{value}}', String(preview.tokens)) + ' · ' + t.podcasts.chars.replace('{{value}}', String(preview.chars))}</p><pre>{preview.content}</pre></details>}
 <Button type="submit" disabled={s.locked || busy || !validPreview || !configured || !form.name.trim()}>{t.podcasts.generate}</Button>
 </form>}
 <PodcastReceipt row={s.operation}/>{(s.canRenew || s.operation && !['pending', 'accepted', 'unknown'].includes(s.operation.status)) && <Button onClick={s.renew}>{p.newDraft}</Button>}
 <Button onClick={onClose}>{t.common.cancel}</Button></LibraryDialog>;
}
