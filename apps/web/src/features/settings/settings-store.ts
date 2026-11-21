import {initialRetrieval,retrievalObligation,type RetrievalState} from './retrieval-state';
import {canStartCreateSuccessor} from '../../data/settings-api';
import type {LoginFlow,ConnectionCapability,NotebookPage,CreateReceipt,DeleteReceipt} from '../../data/settings-api';
import {canDispatch,freezeDispatchContext,type DispatchContext} from '@study/domain';
import type {NotebookSummary} from '../../data/notebook-api';
export type SettingsFields=Readonly<{name:string;description:string;remoteTitle:string;remoteId:string;deleteExclusive:boolean}>;
export type SettingsCommand=Readonly<{id:string;kind:'save'|'delete'|'connect'|'reconnect'|'disconnect'|'link'|'create';context:DispatchContext;generation:number;fields:SettingsFields;providerRevision:number;status:'pending'|'unknown'|'not-sent'|'succeeded';selectionId?:string;jobId?:string;httpStatus?:number}>;
export type SettingsMetadata=Readonly<{flow?:LoginFlow;capabilities?:readonly ConnectionCapability[];page?:NotebookPage;create?:CreateReceipt;createCommand?:SettingsCommand;capabilitiesRevision?:number;pageRevision?:number;linkConfirmed?:boolean;deleted?:DeleteReceipt}>;
export type SettingsDraft=Readonly<{id:string;notebookId:string;context:DispatchContext;generation:number;fields:SettingsFields;baseline:NotebookSummary|null;dirty:boolean;retired:boolean;status:'editing'|'pending'|'unknown'|'succeeded';command:SettingsCommand|null;metadata:SettingsMetadata;retrieval:RetrievalState}>;
/** Only enumerated nonsecret fields. Private values cannot be stored here. */
export function createSettingsStore(notify:()=>void){
 const selected=new Map<string,string>();const rows=new Map<string,SettingsDraft>();let snapshot:readonly SettingsDraft[]=Object.freeze([]);
 const emit=()=>{snapshot=Object.freeze([...rows.values()]);notify()};
 const put=(r:SettingsDraft)=>{rows.set(r.id,Object.freeze({...r,status:retrievalObligation(r.retrieval)??r.status}));emit()};
 const resourceStatus=(status:SettingsDraft['status'],metadata:SettingsMetadata):SettingsDraft['status']=>status==='pending'||status==='unknown'?status:metadata.create&&!canStartCreateSuccessor(metadata.create)?(['queued','running','waiting_remote'].includes(metadata.create.state)?'pending':'unknown'):status;
 const dirty=(f:SettingsFields,b:NotebookSummary|null)=>b?f.name!==b.name||f.description!==b.description||!!f.remoteTitle||!!f.remoteId:!!f.name||!!f.description||!!f.remoteTitle||!!f.remoteId;
 const create=(notebookId:string,context:DispatchContext,generation:number)=>{const id='settings:'+crypto.randomUUID();selected.set(notebookId,id);put({id,notebookId,context:freezeDispatchContext(context),generation,fields:Object.freeze({name:'',description:'',remoteTitle:'',remoteId:'',deleteExclusive:false}),baseline:null,dirty:false,retired:false,status:'editing',command:null,metadata:Object.freeze({}),retrieval:initialRetrieval()});return id};
 return {selected:(notebookId:string)=>selected.get(notebookId),
 retrieval(id:string,update:(state:RetrievalState)=>RetrievalState){const r=rows.get(id);if(!r)return;put({...r,status:resourceStatus(r.command?.status==='pending'?'pending':r.command?.status==='unknown'?'unknown':'editing',r.metadata),retrieval:Object.freeze(update(r.retrieval))})},
 get:(id:string)=>rows.get(id),getSnapshot:()=>snapshot,
 open(notebookId:string,context:DispatchContext,generation:number){const old=selected.get(notebookId);if(old&&rows.has(old))return old;return create(notebookId,context,generation)},
 select(id:string){const row=rows.get(id);if(!row)return false;selected.set(row.notebookId,id);emit();return true},
 fresh(id:string,context:DispatchContext,generation:number){const row=rows.get(id);if(!row||!context.ready||!row.retired&&(!row.metadata.create||!canStartCreateSuccessor(row.metadata.create)||row.command&&['pending','unknown'].includes(row.command.status)))return null;
 const live=[...rows.values()].find(r=>r.id!==id&&r.notebookId===row.notebookId&&!r.retired&&canDispatch(r.context,context));
 if(live){selected.set(row.notebookId,live.id);emit();return live.id}
 rows.set(id,Object.freeze({...row,retired:true}));return create(row.notebookId,context,generation)},
 metadata(id:string,patch:Partial<SettingsMetadata>){const r=rows.get(id);if(!r||r.retired)return;const metadata=Object.freeze({...r.metadata,...patch});put({...r,metadata,status:resourceStatus(r.command?.status==='pending'?'pending':r.command?.status==='unknown'?'unknown':'editing',metadata)})},
 seed(id:string,baseline:NotebookSummary){const r=rows.get(id);if(!r||r.retired||r.baseline||r.notebookId!==baseline.id)return;const fields=Object.freeze({...r.fields,name:r.dirty?r.fields.name:baseline.name,description:r.dirty?r.fields.description:baseline.description});put({...r,baseline:Object.freeze({...baseline}),fields,dirty:dirty(fields,baseline)})},
 edit(id:string,patch:Partial<SettingsFields>){const r=rows.get(id);if(!r||r.retired)return;const fields=Object.freeze({...r.fields,...patch});put({...r,fields,dirty:dirty(fields,r.baseline)})},
 begin(id:string,kind:SettingsCommand['kind'],current:DispatchContext|null,generation:number,providerRevision=0,selectionId?:string){const r=rows.get(id);if(!r||r.retired||!canDispatch(r.context,current)||r.command&&['pending','unknown'].includes(r.command.status))return null;
 const command:SettingsCommand=Object.freeze({id:crypto.randomUUID(),kind,context:r.context,generation,fields:Object.freeze({...r.fields}),providerRevision,status:'pending',...(selectionId?{selectionId}:{})});
 put({...r,status:'pending',command});return command},
 settle(id:string,command:SettingsCommand,status:SettingsCommand['status'],current:DispatchContext|null,generation:number,baseline?:NotebookSummary,jobId?:string,httpStatus?:number){const r=rows.get(id);if(!r||r.command!==command)return;
 const actual=r.retired||!canDispatch(command.context,current)||command.generation!==generation?'unknown':status;
 const b=actual==='succeeded'&&baseline?Object.freeze({...baseline}):r.baseline;
 put({...r,baseline:b,dirty:dirty(r.fields,b),status:resourceStatus(actual==='not-sent'?'editing':actual,r.metadata),command:Object.freeze({...command,status:actual,...(jobId?{jobId}:{}),...(httpStatus!==undefined?{httpStatus}:{})})})},
 retire(epoch:number){for(const r of rows.values())if(r.context.epoch===epoch)rows.set(r.id,Object.freeze({...r,retired:true,status:r.status==='pending'?'unknown':r.status,command:r.command?.status==='pending'?Object.freeze({...r.command,status:'unknown'}):r.command}));emit()},
 hasUnsaved(){return [...rows.values()].some(r=>r.dirty||r.retrieval.dirty||['pending','unknown'].includes(r.status))}
 };
}
