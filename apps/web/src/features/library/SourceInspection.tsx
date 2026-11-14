import { useAppDrafts } from '../../app/providers';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useLocation } from 'react-router';
import { useLibraryConnection } from '../../data/use-library-connection';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { LibraryDialog } from './LibraryDialog';
import { SourceContent } from './SourceContent';
import { sourceHref } from './library-operations';
export function SourceInspection({ sourceId, onClose, notebookId }: {
    sourceId: string;
    onClose(): void;
    notebookId?: string;
}) {
    const store = useAppDrafts().library, c = useLibraryConnection(), { native: n, t } = useI18n(), navigate = useNavigate(), location = useLocation();
    const read = useQuery({ queryKey: ['library', 'source', c.scope, sourceId], enabled: c.ready, queryFn: ({ signal }) => c.api!.sources.get(sourceId, c.context!, signal) });
    return <LibraryDialog open onOpenChange={value => { if (!value)
        onClose(); }} title={read.data?.title ?? n.inspect}>{read.isPending && <p role="status">{t.common.loading}</p>}{read.isError && <p role="alert">{t.common.contentUnavailable.errorTitle}</p>}{read.data && <><SourceContent source={read.data}/><Button onClick={() => { const grant = notebookId && read.data?.notebooks?.includes(notebookId) && c.context ? store.rememberNotebookSource(sourceId, notebookId, c.context, c.generation) : undefined; onClose(); void navigate(sourceHref(sourceId), { state: { sourceOrigin: location.pathname + location.search + location.hash, openSourceChat: true, ...(grant ? { sourceNotebookGrant: grant } : {}) } }); }}>{n.sourceChat}</Button></>}</LibraryDialog>;
}
