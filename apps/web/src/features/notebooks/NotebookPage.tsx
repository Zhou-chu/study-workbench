import { useRef } from 'react';
import { useWorkbenchSnapshot } from '../../app/WorkbenchSession';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router';
import { notebookIdFromPathname } from '../../app/notebook-route';
import { TransportResponseError, canDispatch, freezeDispatchContext, readTurnContext, sessionCoordinator } from '@study/web-transport';
import { AppDataBoundary, useAppData, useAppDrafts } from '../../app/providers';
import { useNotebookConnection } from '../../data/use-notebook-connection';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { NotebookShell } from './NotebookShell';
export function NotebookPage() {
    const notebookId = notebookIdFromPathname(useLocation().pathname) ?? '';
    const { api, context, ready: connected, scope } = useNotebookConnection();
    const session = useWorkbenchSnapshot();
    const ready = connected && (session.controller ? session.state?.ready === true : true);
    const opened = useRef<string | null>(null);
    const injected = useAppData();
    const sourceStore = useAppDrafts().sources;
    const { t, shell } = useI18n();
    const workspace = useQuery({ queryKey: ['workspace', scope, notebookId], enabled: ready && !!notebookId, retry: false, refetchInterval: ready ? 2000 : false, refetchIntervalInBackground: false, queryFn: async ({ signal }) => {
            const captured = freezeDispatchContext(context!);
            const read = sourceStore.beginWorkspaceRead(notebookId, captured, sessionCoordinator.current());
            const value = await api!.workspace(notebookId, captured, signal);
            if (signal.aborted || !canDispatch(captured, readTurnContext()) || read.generation !== sessionCoordinator.current() || session.controller && !session.controller.getSnapshot().ready)
                throw new TransportResponseError('retired');
            const accepted=sourceStore.acceptWorkspaceRead(read, value, readTurnContext(), sessionCoordinator.current());
            if(!accepted&&(read.selectionOperation?.transaction||sourceStore.hasSelectionTransaction(notebookId,captured.epoch)))throw new TransportResponseError('retired');
            // A route open, never a list prefetch. Stamp failure must not hide a successful read.
            const openKey = JSON.stringify([scope, notebookId]);
            if (opened.current !== openKey) {
                opened.current = openKey;
                void api!.recordOpen(notebookId, captured, signal).catch(() => { });
            }
            return value;
        } });
    const content = <NotebookShell notebookId={notebookId} readStatus={<div className="workspace-read-status">{!ready && <p role="status">{shell.notConnected}</p>}{ready && workspace.isPending && <p role="status">{t.common.loading}</p>}{workspace.isError && <p role="alert" className="read-error">{workspace.data ? t.workbench.workspaceRefreshFailed : t.workbench.serviceError}</p>}<Button disabled={!ready || workspace.isFetching} onClick={() => { void workspace.refetch(); }}>{t.common.refresh}</Button></div>}/>;
    return injected.transport ? <AppDataBoundary transport={injected.transport} workspace={workspace.data ?? (!context ? injected.workspace : undefined)}>{content}</AppDataBoundary> : content;
}
