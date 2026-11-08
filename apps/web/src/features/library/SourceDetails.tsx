import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { useNotebookConnection } from '../../data/use-notebook-connection';
import type { LibrarySource } from '../../data/library-api';
import { useLibraryState } from './use-library-state';
import { libraryDraftLocked } from './library-store';
import { OperationStatus } from './OperationStatus';
export function SourceDetails({ source }: {
    source: LibrarySource;
}) {
    const [id, setId] = useState<string | null>(null), c = useLibraryState(id), { t, library: l } = useI18n();
    useEffect(() => {
        if (c.context)
            setId(c.store.open({ kind: 'source', sourceId: source.id }, { kind: 'metadata', sourceId: source.id, title: source.title ?? '', topics: source.topics?.join(', ') ?? '' }, c.context, c.generation));
    }, [source, c.store, c.context?.epoch]);
    const p = c.row?.input.kind === 'metadata' ? c.row.input : null;
    return <section className="library-details">{p && <form onFocus={() => {
                if (id)
                    c.navigation?.activateResource(id);
            }} onSubmit={e => {
                e.preventDefault();
                if (id)
                    void c.run(id);
            }}>
 <fieldset disabled={!c.ready || !c.row || libraryDraftLocked(c.row) || c.row.generation !== c.generation}><label>{l.sourceTitle}<input value={p.title} onChange={e => { c.navigation?.activateResource(id); c.store.edit(id!, { title: e.target.value }); }}/></label><label>{t.sources.topics}<input value={p.topics} onChange={e => { c.navigation?.activateResource(id); c.store.edit(id!, { topics: e.target.value }); }}/></label><Button type="submit" disabled={!c.row?.dirty}>{l.saveDetails}</Button></fieldset><OperationStatus row={c.row}/></form>}
 <dl><dt>{t.sources.id}</dt><dd>{source.id}</dd><dt>{t.common.created_label}</dt><dd>{source.created}</dd><dt>{t.common.updated_label}</dt><dd>{source.updated}</dd><dt>{t.sources.embedded}</dt><dd>{source.embedded ? t.common.yes : t.common.no}</dd></dl>
 <SourceAssociations source={source}/>
 </section>;
}
export function SourceAssociations({ source }: {
    source: LibrarySource;
}) {
    const [editing, setEditing] = useState(false), [id, setId] = useState<string | null>(null), c = useLibraryState(id), n = useNotebookConnection(), { t, library: l } = useI18n();
    const list = useQuery({ queryKey: ['notebooks', n.scope], enabled: editing && n.ready, queryFn: ({ signal }) => n.api!.list(n.context!, signal) });
    const p = c.row?.input.kind === 'associations' ? c.row.input : null;
    const open = () => {
        if (!c.context || source.notebooks == null)
            return;
        const id = c.store.open({ kind: 'source', sourceId: source.id }, { kind: 'associations', sourceId: source.id, original: source.notebooks, selected: source.notebooks }, c.context, c.generation);
        setId(id);
        c.navigation?.activateResource(id);
        setEditing(true);
    };
    return <section><h3>{t.sources.manageNotebooks}</h3><Button disabled={!c.ready || source.notebooks == null} onClick={open}>{l.associations}</Button>
 {source.notebooks == null && <p>{t.common.unknown}</p>}
 {editing && p && <><fieldset disabled={!c.ready || !c.row || libraryDraftLocked(c.row) || c.row.generation !== c.generation}>{list.isError && <p role="alert">{t.common.contentUnavailable.errorTitle}</p>}{list.data?.map(item => <label className="library-check" key={item.id}><input type="checkbox" checked={p.selected.includes(item.id)} onChange={() => c.store.edit(id!, { selected: p.selected.includes(item.id) ? p.selected.filter(s => s !== item.id) : [...p.selected, item.id] })}/>{item.name}</label>)}<Button onClick={() => {
                if (id)
                    void c.run(id);
            }}>{l.saveAssociations}</Button></fieldset>
 <Button onClick={() => {
                if (id && !libraryDraftLocked(c.row!))
                    c.store.reset(id, { ...p, selected: p.original });
                setEditing(false);
            }}>{l.cancelAssociations}</Button><OperationStatus row={c.row}/></>}
 </section>;
}
