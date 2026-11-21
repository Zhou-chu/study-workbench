import { useClassicContext } from './use-classic-context';
import { ContextMode } from './ClassicContext';
import { SourceInspection } from './SourceInspection';
import { useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useLibraryConnection } from '../../data/use-library-connection';
import type { SourceSort } from '../../data/library-api';
import { Button } from '../../ui/Button';
import { useI18n } from '../../i18n';
import { sourceHref } from './library-operations';
import { SourceImportDialog } from './SourceImportDialog';
import { SourceActionConfirm } from './SourceActionConfirm';
export function SourceList({ notebookId, classicContext = false }: {
    notebookId?: string;
    classicContext?: boolean;
}) {
    const c = useLibraryConnection(), { t, library: l, native: n } = useI18n(), location = useLocation();
    const context = useClassicContext(notebookId ?? '', classicContext && !!notebookId), [inspect, setInspect] = useState<string | null>(null);
    const [sort, setSort] = useState<SourceSort>('created'), [direction, setDirection] = useState<'asc' | 'desc'>('desc'), [active, setActive] = useState(0);
    const links = useRef<(HTMLAnchorElement | null)[]>([]);
    const data = useInfiniteQuery({ queryKey: ['library', 'sources', c.scope, notebookId, sort, direction], enabled: c.ready, initialPageParam: 0, queryFn: ({ pageParam, signal }) => c.api!.sources.list({ ...(notebookId ? { notebook_id: notebookId } : {}), limit: 30, offset: pageParam, sort_by: sort, sort_order: direction }, c.context!, signal), getNextPageParam: (last, all) => last.length === 30 ? all.reduce((n, p) => n + p.length, 0) : undefined, refetchInterval: q => q.state.data?.pages.flat().some(s => ['queued', 'running', 'new'].includes(s.status ?? '')) ? 2000 : false });
    const rows = [...new Map((data.data?.pages.flat() ?? []).map(s => [s.id, s])).values()];
    const titles: Record<SourceSort, string> = { type: t.common.type, title: t.common.title, created: t.common.created_label, updated: t.common.updated_label, insights_count: t.common.insights, embedded: t.sources.embedded };
    return <>{classicContext && <ContextMode label={n.bulkSources} value="" bulk disabled={context.locked || !rows.length} onChange={mode => context.change('sources', rows.map(s => s.id), mode)}/>}{inspect && <SourceInspection sourceId={inspect} onClose={() => setInspect(null)} {...(notebookId ? { notebookId } : {})}/>}<div className="library-toolbar"><label>{l.sort}<select value={sort} onChange={e => { setSort(e.target.value as SourceSort); setActive(0); }}>{Object.entries(titles).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label><Button onClick={() => { setDirection(direction === 'asc' ? 'desc' : 'asc'); setActive(0); }}>{l.reverse}</Button><Button aria-label={t.sources.title + ' · ' + t.common.refresh} disabled={!c.ready || data.isFetching} onClick={() => void data.refetch()}>{t.common.refresh}</Button></div>
 {data.isPending && <p role="status">{t.common.loading}</p>}{data.isError && <p role="alert">{t.sources.failedToLoad}</p>}
 {data.data && rows.length === 0 && <section aria-label={t.sources.noSourcesYet}><p>{t.sources.noSourcesYet}</p><SourceImportDialog {...(notebookId ? { notebookId } : {})}/></section>}
 <ul className="library-list" aria-label={t.sources.title} onKeyDown={e => {
            if (e.target instanceof HTMLElement && e.target.tagName !== 'A')
                return;
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                links.current[active]?.click();
                return;
            }
            let next = active;
            if (e.key === 'ArrowDown')
                next = Math.min(rows.length - 1, active + 1);
            else if (e.key === 'ArrowUp')
                next = Math.max(0, active - 1);
            else if (e.key === 'Home')
                next = 0;
            else if (e.key === 'End')
                next = rows.length - 1;
            else
                return;
            e.preventDefault();
            setActive(next);
            links.current[next]?.focus();
        }}>{rows.map((s, i) => <li key={s.id}><div><Link ref={el => { links.current[i] = el; }} onFocus={() => setActive(i)} to={sourceHref(s.id)} state={{ sourceOrigin: location.pathname + location.search + location.hash }}>{s.title ?? t.sources.untitledSource}</Link><p className="meta">{s.asset?.url ? t.sources.type.link : s.asset?.hasFile ? t.sources.type.file : t.sources.type.text} · {s.embedded ? t.sources.embedded : t.sources.notEmbedded} · {s.insights_count ?? 0}</p>{s.status && <p>{['queued', 'running', 'new'].includes(s.status) ? t.sources.statusProcessing : s.status === 'completed' ? t.sources.statusCompleted : s.status === 'failed' ? t.sources.statusFailed : t.common.unknown}</p>}</div><div className="library-row-actions"><Button aria-label={n.inspect + ' · ' + (s.title ?? s.id)} onClick={() => setInspect(s.id)}>{n.inspect}</Button>{classicContext && <ContextMode label={n.sourceContext + ' · ' + (s.title ?? s.id)} value={context.config.sources[s.id] ?? 'not in'} disabled={context.locked} onChange={mode => context.change('sources', [s.id], mode)}/>}<SourceActionConfirm source={s} action="delete"/>{notebookId && <><SourceActionConfirm source={s} action="unlink" {...(notebookId ? { notebookId } : {})}/><SourceActionConfirm source={s} action="retry"/>{s.asset?.url && <SourceActionConfirm source={s} action="retry" labelOverride={t.sources.refreshContent}/>}</>}</div></li>)}</ul>
 {data.hasNextPage && <Button disabled={data.isFetchingNextPage} onClick={() => void data.fetchNextPage()}>{l.loadMore}</Button>}</>;
}
