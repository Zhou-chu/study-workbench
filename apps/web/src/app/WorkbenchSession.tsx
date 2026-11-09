import {safeReturnPath} from '../features/auth/cold-return';
import { LibraryCommandObservers } from '../features/library/LibraryCommandObservers';
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { UNSAFE_DataRouterContext } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { readTurnContext, sessionCoordinator } from '@study/web-transport';
import { createNavigationController, type DraftRegistry, type DraftId, type DraftState } from './drafts';
import { createSessionController } from '../features/auth/session';
import { LoginPage } from '../features/auth/LoginPage';
import { ReauthLayer } from '../features/auth/ReauthLayer';
import { ConnectionState } from '../features/auth/ConnectionState';
import { RouterNavigationGuard, UnsavedNavigationDialog } from './UnsavedNavigationDialog';
import { AppDataBoundary, useAppData, useAppDrafts } from './providers';
import { useI18n } from '../i18n';
function createWorkbench(drafts: DraftRegistry, clearServerData: () => void) { const controller=createSessionController(epoch => { drafts.retireContext(epoch); clearServerData(); }); controller.subscribe(()=>{drafts.turns.refreshFences();drafts.library.refreshFences(readTurnContext(), sessionCoordinator.current());}); return { drafts, navigation: createNavigationController(drafts), controller }; }
type Workbench = ReturnType<typeof createWorkbench>;
const Context = createContext<Workbench | null>(null);
export function WorkbenchSession({ children }: {
    children: ReactNode;
}) {
    const queryClient = useQueryClient();
    const drafts = useAppDrafts();
    const [value] = useState(() => createWorkbench(drafts, () => queryClient.clear()));
    const state = useSyncExternalStore(value.controller.subscribe, value.controller.getSnapshot);
    const data = useAppData();
    const { session } = useI18n();
    const dataRouter = useContext(UNSAFE_DataRouterContext);
    useEffect(() => { void value.controller.start(); return () => value.controller.dispose(); }, [value]);
    const login = ['anonymous', 'reauth-required'].includes(state.phase);
    const cold=useRef<{key:string;target:string;attempted:boolean}|null>(null);
    const location=dataRouter?.router.state.location;
    if(!state.hasWorkspace && login && location && cold.current?.key!==location.key){
        cold.current={key:location.key,attempted:false,target:safeReturnPath(location.pathname==='/login'?new URLSearchParams(location.search).get('returnTo'):location.pathname+location.search+location.hash)??'/notebooks'};
    }
    const coldLogin=async(password:string)=>{if(cold.current)cold.current.attempted=true;await value.controller.login(password)};
    useEffect(()=>{const original=cold.current;if(original?.attempted && state.ready && dataRouter?.router.state.location.key===original.key){cold.current=null;void dataRouter.router.navigate(original.target,{replace:true})}},[state.ready,dataRouter,location?.key]);

    return <Context.Provider value={value}><AppDataBoundary transport={value.controller.transport} workspace={data.workspace}>
   {state.hasWorkspace && <div className="session-workspace" inert={login || !state.ready || undefined}>{children}<LibraryCommandObservers/></div>}
   {!state.hasWorkspace && login && <LoginPage controller={value.controller} state={state} onLogin={coldLogin}/>}
   {state.hasWorkspace && login && <ReauthLayer controller={value.controller} state={state}/>}
   {!login && (!state.ready || state.providerNeedsReauth) && <ConnectionState controller={value.controller} state={state}/>}
   {state.hasWorkspace && state.privacyChanged && <p role="status" className="connection-state">{session.privacy}</p>}
   {dataRouter && <RouterNavigationGuard navigation={value.navigation}/>}<UnsavedNavigationDialog navigation={value.navigation}/>
 </AppDataBoundary></Context.Provider>;
}
export function useWorkbenchSession() {
    const value = useContext(Context);
    if (!value)
        throw new Error('WorkbenchSession required');
    return { ...value, transport: value.controller.transport };
}
/** A draft retains its original scope through reauth; only a new editor intent captures a new scope. */
export function useWorkbenchDraft(notebookId: string, editorSession: string) {
    const value = useContext(Context);
    const capture = useRef<DraftId | null>(null);
    if (!capture.current || capture.current.notebookId !== notebookId || capture.current.editorSession !== editorSession)
        capture.current = Object.freeze({ notebookId, editorSession, epoch: readTurnContext()?.epoch ?? -1 });
    const id = capture.current;
    const draft = useSyncExternalStore(value?.drafts.subscribe ?? (() => () => { }), () => value?.drafts.get(id));
    const retired = useSyncExternalStore(value?.drafts.subscribe ?? (() => () => { }), () => value?.drafts.isRetired(id) ?? false);
    useEffect(() => { value?.navigation.activate(id); return () => value?.navigation.deactivate(id); }, [value, id]);
    return { id, draft, retired, connected: !!value, update: (patch: Partial<Pick<DraftState, 'editor' | 'question' | 'file'>>) => value?.drafts.update(id, patch) };
}
/** App-lifetime creation records share the session's one navigation controller. */
export function useNotebookCreationDrafts(activated = true) {
    const workbench = useContext(Context);
    const drafts = useAppDrafts();
    const state = useSyncExternalStore(drafts.subscribe, drafts.getNotebookCreationSnapshot);
    const id = state.active?.id;
    useEffect(() => {
        if (id && activated)
            workbench?.navigation.activate(id);
        return () => {
            if (id && activated)
                workbench?.navigation.deactivate(id);
        };
    }, [workbench, id, activated]);
    return { drafts, state, activate: (value: DraftId) => workbench?.navigation.activate(value), navigationPending: () => !!workbench?.navigation.getSnapshot().status };
}

/** Read-only subscription: provider reauthentication is independent of app readiness. */
export function useWorkbenchSnapshot() {
 const value=useContext(Context);
 const state=useSyncExternalStore(value?.controller.subscribe??(()=>()=>{}),value?.controller.getSnapshot??(()=>null),()=>null);
 return {state,controller:value?.controller};
}

/** Optional owner access for synthetic previews; real routes use the one session navigation owner. */
export function useResourceNavigation() { return useContext(Context)?.navigation; }
