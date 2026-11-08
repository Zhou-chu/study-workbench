import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { freezeDispatchContext } from '@study/web-transport';
import { AppChrome } from '../../app/AppChrome';
import { useNotebookConnection } from '../../data/use-notebook-connection';
import { EmptyState } from '../../ui/EmptyState';
import { Button } from '../../ui/Button';
import { useI18n } from '../../i18n';
import { NotebookCard } from './NotebookCard';
import { CreateNotebookDialog } from './CreateNotebookDialog';
export function NotebookHome() {
    const { t, shell, notebook: messages } = useI18n();
    const { api, context, ready, scope } = useNotebookConnection();
    const [search, setSearch] = useState('');
    const [archived, setArchived] = useState(false);
    const [recentOpen, setRecentOpen] = useState(true);
    const [view, setView] = useState<'tiles' | 'list'>('tiles');
    const list = useQuery({ queryKey: ['notebooks', scope], enabled: ready, queryFn: ({ signal }) => api!.list(freezeDispatchContext(context!), signal) });
    const recent = useQuery({ queryKey: ['recently-viewed', scope], enabled: ready, queryFn: ({ signal }) => api!.recent(freezeDispatchContext(context!), signal) });
    const filtered = (list.data ?? []).filter(item => item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
    const active = filtered.filter(item => !item.archived);
    const archives = filtered.filter(item => item.archived);
    return <AppChrome><div className="notebook-home"><div className="page-heading"><span className="eyebrow">Notebook / 01</span><h1>{shell.homeTitle}</h1><p>{messages.homeHint}</p><CreateNotebookDialog /></div><div className="notebook-toolbar"><label className="field-label" htmlFor="notebook-search">{t.common.accessibility.searchNotebooks}</label><input id="notebook-search" type="search" placeholder={t.notebooks.searchPlaceholder} value={search} onChange={event => setSearch(event.target.value)}/><Button disabled={!ready || list.isFetching || recent.isFetching} onClick={() => { void list.refetch(); void recent.refetch(); }}>{t.common.refresh}</Button><div className="view-control"><Button aria-pressed={view === 'tiles'} onClick={() => setView('tiles')}>{t.notebooks.tileView}</Button><Button aria-pressed={view === 'list'} onClick={() => setView('list')}>{t.notebooks.listView}</Button></div></div>
 {!ready && <p role="status">{shell.notConnected}</p>}{ready && list.isPending && <p role="status">{t.common.loading}</p>}{list.isError && <p role="alert" className="read-error">{list.data ? messages.listFailed : t.common.contentUnavailable.errorTitle}</p>}{recent.isError && <p role="alert" className="read-error">{recent.data ? messages.recentFailed : t.common.contentUnavailable.errorTitle}</p>}
 {!!recent.data?.length && <section className="recent-notebooks"><div className="section-heading"><h2>{t.notebooks.recentlyViewed}</h2><Button aria-label={t.notebooks.toggleRecentlyViewed} aria-expanded={recentOpen} onClick={() => setRecentOpen(!recentOpen)}>{recentOpen ? '−' : '+'}</Button></div>{recentOpen && <ul className="recent-list">{recent.data.map(item => <li key={`${item.type}:${item.id}`}><Link to={`/${item.type === 'notebook' ? 'notebooks' : 'sources'}/${encodeURIComponent(item.id)}`}><strong>{item.title}</strong><span className="meta">{item.type === 'notebook' ? t.notebooks.recentlyViewedNotebook : t.notebooks.recentlyViewedSource} · <time dateTime={item.last_viewed_at}>{item.last_viewed_at}</time></span></Link></li>)}</ul>}</section>}
 {list.data && <><section aria-label={t.notebooks.activeNotebooks}><h2>{t.notebooks.activeNotebooks}</h2><ul className="notebook-collection" data-view={view}>{active.map(item => <NotebookCard key={item.id} notebook={item}/>)}</ul></section><section className="archived-notebooks"><Button aria-expanded={archived} onClick={() => setArchived(!archived)}>{t.notebooks.archivedNotebooks} ({archives.length})</Button>{archived && <ul className="notebook-collection" data-view={view}>{archives.map(item => <NotebookCard key={item.id} notebook={item}/>)}</ul>}</section>{filtered.length === 0 && <EmptyState title={list.data.length ? t.common.noMatches : shell.homeEmpty} description={list.data.length ? t.common.tryDifferentSearch : messages.homeHint}/>}</>}
 </div></AppChrome>;
}
