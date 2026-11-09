import { useAppDrafts } from '../../app/providers';
import { useState } from 'react';
import { SourceContent } from './SourceContent';
import { NativeChatPanel } from './NativeChatPanel';
import { Link, useLocation, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AppChrome } from '../../app/AppChrome';
import { useLibraryConnection } from '../../data/use-library-connection';
import { LibraryError } from '../../data/library-api';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { SourceActionConfirm } from './SourceActionConfirm';
export function SourcePage() {
    const sourceId = useParams().sourceId ?? '', c = useLibraryConnection(), { t, library: l, native: n } = useI18n(), location = useLocation();
    const state = location.state as {
        sourceOrigin?: unknown;
        openSourceChat?: boolean;
        sourceNotebookGrant?: unknown;
    } | null;
    const notebookOrigin = useAppDrafts().library.sourceNotebookOrigin(state?.sourceNotebookGrant, sourceId, c.context, c.generation);
    const [chat, setChat] = useState(state?.openSourceChat === true);
    const origin = typeof state?.sourceOrigin === 'string' && /^\/(notebooks|sources|search)(?:[/?#]|$)/.test(state.sourceOrigin) ? state.sourceOrigin : '/sources';
    const read = useQuery({ queryKey: ['library', 'source', c.scope, sourceId], enabled: c.ready && !!sourceId, queryFn: ({ signal }) => c.api!.sources.get(sourceId, c.context!, signal), refetchInterval: q => ['queued', 'running', 'new'].includes(q.state.data?.status ?? '') ? 2000 : false });
    return <AppChrome title={read.data?.title ?? t.sources.title}><div className="notebook-home library-page"><Link className="button" to={origin}>{t.common.back}</Link>{read.isPending && <p role="status">{t.common.loading}</p>}{read.isError && <p role="alert">{read.error instanceof LibraryError && read.error.kind === 'missing' ? t.common.contentUnavailable.notFoundTitle : t.common.contentUnavailable.errorTitle}</p>}<Button disabled={!c.ready || read.isFetching} onClick={() => void read.refetch()}>{t.common.refresh}</Button>
 {read.data && <><header className="page-heading"><h1>{read.data.title ?? t.sources.untitledSource}</h1><p>{l.noEvidence}</p><div className="library-actions"><SourceActionConfirm source={read.data} action="embed"/><SourceActionConfirm source={read.data} action="delete"/><SourceActionConfirm source={read.data} action="retry"/></div></header>
 <Button aria-expanded={chat} onClick={() => setChat(!chat)}>{n.sourceChat}</Button>{chat ? <NativeChatPanel key={sourceId} parent={{ kind: 'source', sourceId }} {...(notebookOrigin && read.data.notebooks?.includes(notebookOrigin) ? { sourceNoteOrigin: { notebookId: notebookOrigin, source: read.data } } : {})}/> : <SourceContent source={read.data}/>}</>}
 </div></AppChrome>;
}
