import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { Markdown } from '../../ui/Markdown';
import type { LibrarySource } from '../../data/library-api';
import { useLibraryState } from './use-library-state';
import { SourceActionConfirm } from './SourceActionConfirm';
import { OperationStatus } from './OperationStatus';
import { FreshLibraryIntent } from './FreshLibraryIntent';
import { sourceHref } from './library-operations';
export function SourceInsights({ source }: {
    source: LibrarySource;
}) {
    const [selected, setSelected] = useState<string | null>(null), [operation, setOperation] = useState<string | null>(null);
    const c = useLibraryState(operation), { t } = useI18n();
    useEffect(() => {
        if (c.ready && c.context)
            setOperation(c.store.open({ kind: 'source', sourceId: source.id }, { kind: 'action', action: 'insight', sourceId: source.id, transformationId: '' }, c.context, c.generation));
    }, [source.id, c.scope, c.ready, c.store]);
    const transformation = c.row?.input.kind === 'action' ? c.row.input.transformationId ?? '' : '';
    const locked = !c.ready || !!c.row && (!c.store.current(c.row, c.context, c.generation) || ['pending', 'accepted', 'unknown'].includes(c.row.status));
    const choose = (value: string) => {
        if (!c.context || locked)
            return;
        const id = c.store.open({ kind: 'source', sourceId: source.id }, { kind: 'action', action: 'insight', sourceId: source.id, transformationId: '' }, c.context, c.generation);
        setOperation(id);
        c.store.edit(id, { transformationId: value });
        c.navigation?.activateResource(id);
    };
    const list = useQuery({ queryKey: ['library', 'insights', c.scope, source.id], enabled: c.ready, queryFn: ({ signal }) => c.api!.insights.list(source.id, c.context!, signal) });
    const transformations = useQuery({ queryKey: ['library', 'transformations', c.scope], enabled: c.ready, queryFn: ({ signal }) => c.api!.metadata.transformations(c.context!, signal) });
    const detail = useQuery({ queryKey: ['library', 'insight', c.scope, source.id, selected], enabled: c.ready && !!selected, queryFn: async ({ signal }) => {
            const row = await c.api!.insights.get(selected!, c.context!, signal);
            if (row.source_id !== source.id)
                throw new Error('Invalid source parent');
            return row;
        } });
    return <section><div className="library-toolbar"><label>{t.navigation.transformation}<select disabled={locked} value={transformation} onChange={e => choose(e.target.value)}><option value="">{t.sources.selectTransformation}</option>{transformations.data?.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><Button disabled={locked || !transformation || !source.full_text?.trim()} onClick={() => {
            if (!c.context)
                return;
            const id = c.store.open({ kind: 'source', sourceId: source.id }, { kind: 'action', action: 'insight', sourceId: source.id, transformationId: transformation }, c.context, c.generation);
            setOperation(id);
            c.navigation?.activateResource(id);
            void c.run(id);
        }}>{t.sources.generateNewInsight}</Button></div>
 {!source.full_text?.trim() && <p>{t.apiErrors.sourceHasNoText}</p>}{(list.isError || transformations.isError || detail.isError) && <p role="alert">{t.common.contentUnavailable.errorTitle}</p>}
 <OperationStatus row={c.row}/><FreshLibraryIntent row={c.row} input={{ kind: "action", action: "insight", sourceId: source.id, transformationId: "" }} onFresh={setOperation}/>
 <ul className="library-list">{list.data?.map(item => <li key={item.id}><Button onClick={() => setSelected(item.id)}>{item.insight_type}</Button><span className="meta">{item.created ?? t.common.unknown}</span><SourceActionConfirm source={source} action="delete-insight" insightId={item.id} after={() => setSelected(null)}/></li>)}</ul>
 {list.data?.length === 0 && <p>{t.sources.noInsightsYet}</p>}{detail.data && <article><h3>{detail.data.insight_type}</h3><Markdown>{detail.data.content}</Markdown><Link className="button" to={sourceHref(detail.data.source_id)}>{t.sources.viewSource}</Link></article>}
 </section>;
}
