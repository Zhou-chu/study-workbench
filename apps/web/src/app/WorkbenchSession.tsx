import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { UNSAFE_DataRouterContext } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { readTurnContext } from '@study/web-transport';
import { createDraftRegistry, createNavigationController, type DraftId, type DraftState } from './drafts';
import { createSessionController } from '../features/auth/session';
import { LoginPage } from '../features/auth/LoginPage';
import { ReauthLayer } from '../features/auth/ReauthLayer';
import { ConnectionState } from '../features/auth/ConnectionState';
import { RouterNavigationGuard, UnsavedNavigationDialog } from './UnsavedNavigationDialog';
import { AppDataBoundary, useAppData } from './providers';
import { useI18n } from '../i18n';
function createWorkbench(clearServerData: () => void) { const drafts = createDraftRegistry(); return { drafts, navigation: createNavigationController(drafts), controller: createSessionController(epoch => { drafts.retireContext(epoch); clearServerData(); }) }; }
type Workbench = ReturnType<typeof createWorkbench>;
const Context = createContext<Workbench | null>(null);
export function WorkbenchSession({ children }: {
    children: ReactNode;
}) {
    const queryClient = useQueryClient();
    const [value] = useState(() => createWorkbench(() => queryClient.clear()));
    const state = useSyncExternalStore(value.controller.subscribe, value.controller.getSnapshot);
    const data = useAppData();
    const { session } = useI18n();
    const dataRouter = useContext(UNSAFE_DataRouterContext);
    useEffect(() => { void value.controller.start(); return () => value.controller.dispose(); }, [value]);
    const login = ['anonymous', 'reauth-required'].includes(state.phase);
    return <Context.Provider value={value}><AppDataBoundary transport={value.controller.transport} workspace={data.workspace}>
   {state.hasWorkspace && <div className="session-workspace" inert={login || !state.ready || undefined}>{children}</div>}
   {!state.hasWorkspace && login && <LoginPage controller={value.controller} state={state}/>}
   {state.hasWorkspace && login && <ReauthLayer controller={value.controller} state={state}/>}
   {!login && !state.ready && <ConnectionState controller={value.controller} state={state}/>}
   {state.hasWorkspace && state.privacyChanged && <p role="status" className="connection-state">{session.privacy}</p>}
   {dataRouter && <RouterNavigationGuard navigation={value.navigation}/>}<UnsavedNavigationDialog navigation={value.navigation}/>
 </AppDataBoundary></Context.Provider>;
}
export function useWorkbenchSession() { const value = useContext(Context); if (!value)
    throw new Error('WorkbenchSession required'); return { ...value, transport: value.controller.transport }; }
/** A draft retains its original scope through reauth; only a new editor intent captures a new scope. */
export function useWorkbenchDraft(notebookId: string, editorSession: string) {
    const value = useContext(Context);
    const capture = useRef<DraftId | null>(null);
    if (!capture.current || capture.current.notebookId !== notebookId || capture.current.editorSession !== editorSession)
        capture.current = Object.freeze({ notebookId, editorSession, epoch: readTurnContext()?.epoch ?? -1 });
    const id = capture.current;
    const draft = useSyncExternalStore(value?.drafts.subscribe ?? (() => () => { }), () => value?.drafts.get(id));
    useEffect(() => { value?.navigation.activate(id); return () => value?.navigation.activate(null); }, [value, id]);
    return { id, draft, connected: !!value, update: (patch: Partial<Pick<DraftState, 'editor' | 'question' | 'file'>>) => value?.drafts.update(id, patch) };
}
