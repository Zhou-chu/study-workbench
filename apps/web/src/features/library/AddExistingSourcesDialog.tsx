import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { LibraryDialog } from './LibraryDialog';
import { useLibraryState } from './use-library-state';
import { libraryDraftLocked } from './library-store';
import { OperationStatus } from './OperationStatus';
import { FreshLibraryIntent } from './FreshLibraryIntent';
export function AddExistingSourcesDialog({ notebookId }: {
    notebookId: string;
}) {
    const [open, setOpen] = useState(false), [id, setId] = useState<string | null>(null), [query, setQuery] = useState(''), c = useLibraryState(id), { t } = useI18n();
    const p = c.row?.input.kind === 'existing' ? c.row.input : null;
    const locked = !c.ready || !c.row || libraryDraftLocked(c.row) || !c.store.current(c.row, c.context, c.generation);
    const results = useQuery({ queryKey: ['library', 'existing', c.scope, notebookId, query], enabled: open && c.ready && !!c.row && c.store.current(c.row, c.context, c.generation), queryFn: async ({ signal }) => query.trim() ? c.api!.associations.search(query, c.context!, signal) : (await c.api!.sources.list({ limit: 100, offset: 0, sort_by: 'created', sort_order: 'desc' }, c.context!, signal)).map(s => ({ id: s.id, title: s.title })) });
    const current = useQuery({ queryKey: ['library', 'associated', c.scope, notebookId], enabled: open && c.ready, queryFn: ({ signal }) => c.api!.sources.list({ notebook_id: notebookId, limit: 100 }, c.context!, signal) });
    const begin = () => {
        if (!c.context)
            return;
        const id = c.store.open({ kind: 'notebook', notebookId }, { kind: 'existing', notebookId, selected: [], query: '' }, c.context, c.generation);
        setId(id);
        c.navigation?.activateResource(id);
        setOpen(true);
    };
    return <><Button disabled={!c.ready} onClick={begin}>{t.sources.addExisting}</Button><LibraryDialog open={open} onOpenChange={setOpen} title={t.sources.addExistingTitle} description={t.sources.addExistingDesc}>
 {p && <><form onSubmit={e => { e.preventDefault(); setQuery(p.query); }}><label>{t.sources.searchPlaceholder}<input disabled={locked} value={p.query} onChange={e => c.store.edit(id!, { query: e.target.value })}/></label><Button disabled={locked} type="submit">{t.common.search}</Button></form>
 {(results.isError || current.isError) && <p role="alert">{t.common.contentUnavailable.errorTitle}</p>}<fieldset disabled={!c.ready || !c.row || libraryDraftLocked(c.row) || !c.store.current(c.row, c.context, c.generation)}>
 {results.data?.map(s => { const supported = s.id.startsWith('source:') && !/[\\/]/.test(s.id), linked = current.data?.some(r => r.id === s.id); return <label className="library-check" key={s.id}><input type="checkbox" disabled={!supported || !!linked} checked={p.selected.includes(s.id)} onChange={() => c.store.edit(id!, { selected: p.selected.includes(s.id) ? p.selected.filter(v => v !== s.id) : [...p.selected, s.id] })}/>{s.title ?? t.sources.untitledSource}{!supported && <span>{t.common.unknown}</span>}</label>; })}
 <Button disabled={!p.selected.length || current.isError || current.isPending} onClick={() => {
                if (id)
                    void c.run(id);
            }}>{t.common.addSelected}</Button></fieldset><OperationStatus row={c.row}/><FreshLibraryIntent row={c.row} input={{ kind: "existing", notebookId, selected: [], query: "" }} onFresh={id => { setId(id); setQuery(""); }}/></>}
 </LibraryDialog></>;
}
