import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { readTurnContext, sessionCoordinator } from '@study/web-transport';
import { useAppDrafts } from '../../app/providers';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import type { NotebookSummary } from '../../data/notebook-api';
import { validScope } from '../../data/global-search';
import { useStudio } from '../studio/use-studio';
import { LibraryDialog } from './LibraryDialog';
import { useLibraryState } from './use-library-state';
import type { LibraryDraft } from './library-store';
type Save = (id: string) => Promise<void>;
function Target({ notebook, selected, disabled, onChange, register }: {
    notebook: NotebookSummary;
    selected: boolean;
    disabled: boolean;
    onChange(value: boolean): void;
    register(id: string, save: Save | null): void;
}) {
    const studio = useStudio(notebook.id), { global: g } = useI18n();
    useLayoutEffect(() => { register(notebook.id, studio.save); return () => register(notebook.id, null); });
    return <label className="library-check"><input type="checkbox" aria-label={g.saveScope + ' · ' + notebook.name} checked={selected} disabled={disabled} onChange={e => onChange(e.target.checked)}/>{notebook.name}</label>;
}
/** Coordinates explicit destinations; all note dispatch remains in the existing useStudio.save. */
export function GlobalSaveDialog({ answer, notebooks, onClose }: {
    answer: LibraryDraft;
    notebooks: readonly NotebookSummary[];
    onClose(): void;
}) {
    const s = useLibraryState(), studio = useAppDrafts().studio, { global: g, t } = useI18n(), [selected, setSelected] = useState<string[]>([]);
    const savers = useRef(new Map<string, Save>()), active = useRef<string | null>(null);
    useSyncExternalStore(studio.subscribe, studio.getSnapshot);
    const previous = s.rows.find(r => r.input.kind === 'global-save' && r.input.runId === answer.id);
    const eligible = answer.input.kind === 'global-run' && answer.status === 'succeeded' && answer.global?.terminal === 'answer' && !!answer.global.final?.trim() && !!answer.input.question.trim() && s.store.current(answer, s.context, s.generation);
    const register = (id: string, save: Save | null) => { if (save)
        savers.current.set(id, save);
    else
        savers.current.delete(id); };
    const stop = () => { if (active.current)
        s.store.stop(active.current); };
    useEffect(() => () => { if (active.current)
        s.store.stop(active.current); }, [s.store]);
    async function save() {
        const original = s.store.get(answer.id);
        if (!eligible || !s.ready || !s.context || !original || original !== answer || previous || active.current || !selected.length || !validScope(selected) || selected.some(id => !notebooks.some(n => n.id === id) || !savers.current.has(id)) || original.input.kind !== 'global-run')
            return;
        const callbacks = new Map(savers.current);
        const targets = selected.map(notebookId => ({ notebookId, studioId: studio.open(notebookId, { title: original.input.kind === 'global-run' ? original.input.question : '', content: original.global!.final!, citations: [] }, original.context, original.generation, undefined, 'classic', 'ai', 'global-ask:' + original.id + ':' + notebookId) }));
        const id = s.store.open({ kind: 'global' }, { kind: 'global-save', runId: original.id, title: original.input.question, content: original.global!.final!, targets }, original.context, original.generation);
        active.current = id;
        const batch = s.store.begin(id, readTurnContext(), sessionCoordinator.current());
        if (!batch?.token)
            return;
        const token = batch.token;
        s.navigation?.activateResource(id);
        const finish = (status: 'succeeded' | 'failed' | 'unknown' | 'not-sent' | 'rejected') => s.store.finish(id, token, status, readTurnContext(), sessionCoordinator.current());
        for (const [index, target] of targets.entries()) {
            const current = s.store.get(id);
            if (!current || !s.store.current(current, readTurnContext(), sessionCoordinator.current()) || current.status !== 'pending') {
                finish('unknown');
                return;
            }
            if (current.stopRequested) {
                finish('failed');
                return;
            }
            await callbacks.get(target.notebookId)!(target.studioId);
            const note = studio.get(target.studioId), result = note?.editor.saveResult;
            const state = result === 'saved' && note?.editor.noteId ? 'accepted' : result === 'rejected' || result === 'conflict' ? 'rejected' : result === 'idle' ? 'not-sent' : 'unknown';
            s.store.item(id, token, index, { state, targetId: target.notebookId, ...(state === 'accepted' ? { resourceId: note!.editor.noteId! } : {}) }, readTurnContext(), sessionCoordinator.current());
            if (state !== 'accepted') {
                finish(state);
                return;
            }
        }
        finish('succeeded');
    }
    const row = previous ?? (active.current ? s.store.get(active.current) : undefined);
    return <LibraryDialog open title={g.save} onOpenChange={open => { if (!open) {
        stop();
        onClose();
    } }}>
 <p>{answer.input.kind === 'global-run' ? answer.input.question : ''}</p>
 {notebooks.map(n => <Target key={n.id} notebook={n} selected={row?.input.kind === 'global-save' ? row.input.targets.some(v => v.notebookId === n.id) : selected.includes(n.id)} disabled={!!row || !eligible || !s.ready} register={register} onChange={value => setSelected(v => value ? [...v, n.id] : v.filter(id => id !== n.id))}/>)}
 {row?.input.kind === 'global-save' && <ul>{row.input.targets.map((target, index) => {
                const receipt = row.receipts[index], note = studio.get(target.studioId);
                const label = receipt?.state === 'accepted' ? t.common.success : receipt?.state === 'unknown' ? g.unknown : receipt?.state === 'rejected' ? g.rejected : note?.editor.saveResult === 'unknown' ? g.unknown : note?.editor.saveResult === 'saving' ? t.searchPage.saving : note?.editor.pending ? g.unknown : g.notSent;
                return <li key={target.notebookId}>{target.notebookId} · {label}{receipt?.resourceId ? ' · ' + receipt.resourceId : ''}</li>;
            })}</ul>}
 {row?.status === 'failed' && <p role="status">{g.stopped}</p>}
 <Button disabled={!!row || !eligible || !s.ready || !selected.length} onClick={() => void save()}>{t.common.save}</Button>
 <Button onClick={() => { stop(); onClose(); }}>{t.common.cancel}</Button>
 </LibraryDialog>;
}
