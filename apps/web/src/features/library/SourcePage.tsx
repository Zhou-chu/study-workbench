import { Link, useLocation, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AppChrome } from '../../app/AppChrome';
import { useLibraryConnection } from '../../data/use-library-connection';
import { LibraryError } from '../../data/library-api';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { Tabs } from '../../ui/Tabs';
import { Markdown } from '../../ui/Markdown';
import { SourceDetails } from './SourceDetails';
import { SourceInsights } from './SourceInsights';
import { SourceAsset } from './SourceAsset';
import { SourceActionConfirm } from './SourceActionConfirm';
export function SourcePage() {
    const sourceId = useParams().sourceId ?? '', c = useLibraryConnection(), { t, library: l } = useI18n(), location = useLocation();
    const state = location.state as {
        sourceOrigin?: unknown;
    } | null;
    const origin = typeof state?.sourceOrigin === 'string' && /^\/(notebooks|sources)(?:[/?#]|$)/.test(state.sourceOrigin) ? state.sourceOrigin : '/sources';
    const read = useQuery({ queryKey: ['library', 'source', c.scope, sourceId], enabled: c.ready && !!sourceId, queryFn: ({ signal }) => c.api!.sources.get(sourceId, c.context!, signal), refetchInterval: q => ['queued', 'running', 'new'].includes(q.state.data?.status ?? '') ? 2000 : false });
    return <AppChrome title={read.data?.title ?? t.sources.title}><div className="notebook-home library-page"><Link className="button" to={origin}>{t.common.back}</Link>{read.isPending && <p role="status">{t.common.loading}</p>}{read.isError && <p role="alert">{read.error instanceof LibraryError && read.error.kind === 'missing' ? t.common.contentUnavailable.notFoundTitle : t.common.contentUnavailable.errorTitle}</p>}<Button disabled={!c.ready || read.isFetching} onClick={() => void read.refetch()}>{t.common.refresh}</Button>
 {read.data && <><header className="page-heading"><h1>{read.data.title ?? t.sources.untitledSource}</h1><p>{l.noEvidence}</p><div className="library-actions"><SourceActionConfirm source={read.data} action="embed"/><SourceActionConfirm source={read.data} action="delete"/><SourceActionConfirm source={read.data} action="retry"/></div></header>
 <Tabs key={sourceId} label={t.sources.detailsTitle} defaultValue="content" items={[{ value: 'content', label: t.sources.content, content: <><Markdown>{read.data.full_text ?? t.sources.noContent}</Markdown><SourceAsset source={read.data}/></> }, { value: 'insights', label: t.sources.insights, content: <SourceInsights source={read.data}/> }, { value: 'details', label: t.sources.details, content: <SourceDetails source={read.data}/> }]}/></>}
 </div></AppChrome>;
}
