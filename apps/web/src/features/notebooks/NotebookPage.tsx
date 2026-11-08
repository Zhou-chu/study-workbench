import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router';
import { notebookIdFromPathname } from '../../app/notebook-route';
import { freezeDispatchContext } from '@study/web-transport';
import { AppDataBoundary, useAppData } from '../../app/providers';
import { useNotebookConnection } from '../../data/use-notebook-connection';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { NotebookShell } from './NotebookShell';
export function NotebookPage() {
    const notebookId = notebookIdFromPathname(useLocation().pathname) ?? '';
    const { api, context, ready, scope } = useNotebookConnection();
    const injected = useAppData();
    const { t, shell } = useI18n();
    const workspace = useQuery({ queryKey: ['workspace', scope, notebookId], enabled: ready && !!notebookId, queryFn: async ({ signal }) => {
            const captured = freezeDispatchContext(context!);
            const value = await api!.workspace(notebookId, captured, signal);
            // A route open, never a list prefetch. Stamp failure must not hide a successful read.
            void api!.recordOpen(notebookId, captured, signal).catch(() => { });
            return value;
        } });
    const content = <NotebookShell notebookId={notebookId} readStatus={<div className="workspace-read-status">{!ready && <p role="status">{shell.notConnected}</p>}{ready && workspace.isPending && <p role="status">{t.common.loading}</p>}{workspace.isError && <p role="alert" className="read-error">{workspace.data ? t.workbench.workspaceRefreshFailed : t.workbench.serviceError}</p>}<Button disabled={!ready || workspace.isFetching} onClick={() => { void workspace.refetch(); }}>{t.common.refresh}</Button></div>}/>;
    return injected.transport ? <AppDataBoundary transport={injected.transport} workspace={workspace.data ?? (!context ? injected.workspace : undefined)}>{content}</AppDataBoundary> : content;
}
