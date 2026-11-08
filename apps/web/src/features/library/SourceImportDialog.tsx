import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNotebookConnection } from '../../data/use-notebook-connection';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { LibraryDialog } from './LibraryDialog';
import { useLibraryState } from './use-library-state';
import { libraryDraftLocked, type ImportInput } from './library-store';
import { safeContentUrl, validImportInput } from './library-operations';
import { OperationStatus } from './OperationStatus';
import { FreshLibraryIntent } from './FreshLibraryIntent';
export function SourceImportDialog({ notebookId, open: controlled, onOpenChange, hideTrigger = false }: {
    notebookId?: string;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    hideTrigger?: boolean;
}) {
    const composing = useRef(false);
    const [local, setLocal] = useState(false), open = controlled ?? local;
    const change = (v: boolean) => { setLocal(v); onOpenChange?.(v); };
    const [id, setId] = useState<string | null>(null), c = useLibraryState(id), n = useNotebookConnection(), { t, library: l } = useI18n();
    useEffect(() => {
        if (open && c.ready && c.context) {
            const value = c.store.open(notebookId ? { kind: 'notebook', notebookId } : { kind: 'global' }, { kind: 'import', type: 'link', title: '', text: '', urls: '', files: [], notebooks: notebookId ? [notebookId] : [], transformations: [], embed: false, step: 1 }, c.context, c.generation);
            setId(value);
            c.navigation?.activateResource(value);
        }
    }, [open, notebookId, c.store, c.scope, c.ready]);
    const defaults = (): ImportInput => ({ kind: 'import', type: 'link', title: '', text: '', urls: '', files: [], notebooks: notebookId ? [notebookId] : [], transformations: [], embed: false, step: 1 });
    const row = c.row, p = row?.input.kind === 'import' ? row.input : undefined;
    const notebooks = useQuery({ queryKey: ['notebooks', n.scope], enabled: open && n.ready, queryFn: ({ signal }) => n.api!.list(n.context!, signal) });
    const transformations = useQuery({ queryKey: ['library', 'transformations', c.scope], enabled: open && c.ready, queryFn: ({ signal }) => c.api!.metadata.transformations(c.context!, signal) });
    const locked = !row || libraryDraftLocked(row) || !c.ready || !c.store.current(row, c.context, c.generation);
    const edit = (patch: Partial<ImportInput>) => {
        if (id)
            c.store.edit(id, patch);
    };
    const urls = p?.urls.split(/\r?\n/).map(s => s.trim()).filter(Boolean) ?? [];
    const valid = !!p && validImportInput(p, false);
    const reviewedOptions = (input: ImportInput) => notebooks.isSuccess && transformations.isSuccess && input.notebooks.every(id => notebooks.data.some(item => item.id === id)) && input.transformations.every(id => transformations.data.some(item => item.id === id));
    const toggle = (values: readonly string[], v: string) => values.includes(v) ? values.filter(s => s !== v) : [...values, v];
    return <>{!hideTrigger && <Button disabled={!c.ready} onClick={() => change(true)}>{t.sources.addSource}</Button>}<LibraryDialog open={open} onOpenChange={change} title={t.sources.addSource} description={t.sources.processDescription}>
 {p && <><form onSubmit={e => {
                e.preventDefault();
                const latest = id ? c.store.get(id)?.input : undefined;
                if (id && latest?.kind === 'import' && !composing.current && validImportInput(latest) && reviewedOptions(latest) && !locked)
                    void c.run(id);
            }} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={e => {
                // Keep ordinary textarea/button defaults; onSubmit enforces final review.
                if (e.key === 'Enter' && (composing.current || e.nativeEvent.isComposing || e.keyCode === 229))
                    e.preventDefault();
            }}>
 <fieldset disabled={locked}><legend>{p.step} / 3</legend>
 {p.step === 1 && <><div className="library-actions">{(['link', 'upload', 'text'] as const).map(type => <Button key={type} aria-pressed={p.type === type} onClick={() => edit({ type })}>{type === 'upload' ? t.sources.uploadFile : type === 'text' ? t.sources.enterText : t.sources.type.link}</Button>)}</div>
 <label>{l.importTitle}<input value={p.title} onChange={e => edit({ title: e.target.value })}/></label>
 {p.type === 'link' && <label>{t.sources.urlLabel}<textarea value={p.urls} onChange={e => edit({ urls: e.target.value })}/></label>}
 {p.type === 'text' && <label>{l.sourceText}<textarea value={p.text} onChange={e => edit({ text: e.target.value })}/></label>}
 {p.type === 'upload' && <><label>{t.sources.fileLabel}<input type="file" multiple onChange={e => edit({ files: Array.from(e.target.files ?? []) })}/></label><ul>{p.files.map((file, i) => <li key={i}>{file.name}</li>)}</ul></>}
 {p.type === 'link' && urls.some(url => !safeContentUrl(url)) && <p role="alert">{t.sources.fixInvalidUrls}</p>}</>}
 {p.step === 2 && <>{notebooks.isError && <p role="alert">{t.common.contentUnavailable.errorTitle}</p>}{notebooks.data?.map(item => <label className="library-check" key={item.id}><input type="checkbox" checked={p.notebooks.includes(item.id)} onChange={() => edit({ notebooks: toggle(p.notebooks, item.id) })}/>{item.name}</label>)}</>}
 {p.step === 3 && <>{transformations.isError && <p role="alert">{t.common.contentUnavailable.errorTitle}</p>}{transformations.data?.map(item => <label className="library-check" key={item.id}><input type="checkbox" checked={p.transformations.includes(item.id)} onChange={() => edit({ transformations: toggle(p.transformations, item.id) })}/>{item.title}</label>)}<label className="library-check"><input type="checkbox" checked={p.embed} onChange={e => edit({ embed: e.target.checked })}/>{t.sources.embedContent}</label></>}
 <div className="library-actions">{p.step > 1 && <Button onClick={() => edit({ step: p.step - 1 })}>{t.common.back}</Button>}{p.step < 3 ? <Button disabled={!valid} onClick={() => edit({ step: p.step + 1 })}>{t.common.next}</Button> : <Button type="submit" disabled={!validImportInput(p) || !reviewedOptions(p)}>{l.importSources}</Button>}</div></fieldset>
 </form><OperationStatus row={row}/><FreshLibraryIntent row={row} input={defaults()} onFresh={setId}/><Button onClick={() => {
                if (id)
                    c.store.stop(id);
                change(false);
            }}>{t.common.cancel}</Button></>}
 </LibraryDialog></>;
}
