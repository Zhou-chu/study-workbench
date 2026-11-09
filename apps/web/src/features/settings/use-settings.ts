import {useEffect,useMemo,useState,useSyncExternalStore} from 'react';
import {canDispatch,readTurnContext,sessionCoordinator,subscribeTurnContext} from '@study/web-transport';
import {useAppData,useAppDrafts} from '../../app/providers';
import {useResourceNavigation,useWorkbenchSnapshot} from '../../app/WorkbenchSession';
import {createSettingsApi} from '../../data/settings-api';
export function useSettings(notebookId:string){
 const drafts=useAppDrafts(),store=drafts.settings,{transport}=useAppData(),{state,controller}=useWorkbenchSnapshot();
 const context=useSyncExternalStore(subscribeTurnContext,readTurnContext,()=>null);
 const rows=useSyncExternalStore(drafts.subscribe,store.getSnapshot);
 const [id,setId]=useState<string|null>(null);
 useEffect(()=>{if(!id&&context?.ready&&state?.ready)setId(store.open(notebookId,context,sessionCoordinator.current()))},[id,context?.epoch,context?.ready,state?.ready,notebookId,store]);
 const row=rows.find(r=>r.id===id),api=useMemo(()=>transport?createSettingsApi(transport):null,[transport]);
 const navigation=useResourceNavigation();
 useEffect(()=>{if(!id)return;navigation?.activateResource(id);return navigation?.holdResource(id)},[navigation,id,row?.dirty,row?.status]);
 const ready=!!row&&!row.retired&&!!api&&state?.ready===true&&canDispatch(row.context,context);
 const current=()=>!!row&&!row.retired&&controller?.getSnapshot().ready===true&&canDispatch(row.context,readTurnContext());
 return {drafts,store,id,row,api,context,state,controller,ready,current,
 fresh:()=>{if(context?.ready&&state?.ready)setId(store.open(notebookId,context,sessionCoordinator.current()))}};
}
