import {useQueryClient} from '@tanstack/react-query';
import {useRef,useState} from 'react';
import {canDispatch,readTurnContext,sessionCoordinator,asRequestNotDispatchedError,RequestNotDispatchedError} from '@study/web-transport';
import {useAppData} from '../../app/providers';
import {useI18n} from '../../i18n';
import {Button} from '../../ui/Button';
import {SettingsRequestError,canObserveCreate} from '../../data/settings-api';
import {useSettings} from './use-settings';
import type {SettingsFields} from './settings-store';
import {useSourceOperations} from '../sources/use-source-operations';
import {useSourceSelection} from '../sources/use-source-selection';
type Confirm=Readonly<{kind:'create'|'disconnect';fields:SettingsFields;generation:number;revision:number}>;
/** Explicit actions only. Verification remains on the existing session controller. */
export function ConnectionsPage({notebookId,owner:h}:{notebookId:string;owner:ReturnType<typeof useSettings>}){
 const {t,session,settings}=useI18n(),{row,id,api,store,controller}=h,{workspace}=useAppData();
 const queries=useQueryClient();
 const changed=()=>{if(h.current())void queries.invalidateQueries({queryKey:['workspace',JSON.stringify([row!.context.epoch,row!.context.target]),notebookId]})};
 const ops=useSourceOperations(notebookId,changed),selected=useSourceSelection(notebookId,h.context?.epoch,workspace!);
 const [busy,setBusy]=useState(false),[error,setError]=useState<number|null|'read'>(null),[confirm,setConfirm]=useState<Confirm|null>(null);
 const flight=useRef(false);
 const evidence=h.state?.providerVerification;
 const proof=!!evidence&&h.ready&&evidence.status?.state==='connected'&&evidence.revision===h.state?.providerEvidenceRevision&&evidence.generation===sessionCoordinator.current()&&canDispatch(evidence.context,h.context)&&!h.state?.providerNeedsReauth&&!h.state?.providerChecking;
 const caps=row?.metadata.capabilities,capCurrent=proof&&row?.metadata.capabilitiesRevision===evidence?.revision;
 const available=(name:string)=>capCurrent&&caps?.filter(c=>c.name===name).length===1&&caps.find(c=>c.name===name)?.support==='available';
 const locked=!h.ready||busy||!!row?.command&&['pending','unknown'].includes(row.command.status);
 const fence=(g:number,revision?:number)=>h.current()&&g===sessionCoordinator.current()&&(revision===undefined||controller?.getSnapshot().providerEvidenceRevision===revision&&!controller?.getSnapshot().providerNeedsReauth&&!controller?.getSnapshot().providerChecking);
 const read=async(work:(g:number)=>Promise<void>)=>{if(!row||!api||!h.ready||flight.current)return;flight.current=true;setBusy(true);setError(null);const g=sessionCoordinator.current();try{await work(g)}catch(e){setError(e instanceof SettingsRequestError?e.status:'read')}finally{flight.current=false;setBusy(false)}};
 const verify=()=>read(async g=>{await controller!.verifyProviderConnection();const revision=controller!.getSnapshot().providerEvidenceRevision;const values=await api!.capabilities(row!.context);if(fence(g,revision))store.metadata(id!,{capabilities:values,capabilitiesRevision:revision})});
 const load=(cursor:string|null)=>{if(!proof||!available('list_notebooks'))return;const revision=evidence!.revision;void read(async g=>{if(!fence(g,revision))return;const page=await api!.notebooks(cursor,row!.context);if(fence(g,revision))store.metadata(id!,{page,pageRevision:revision})})};
 const flow=async(kind:'connect'|'reconnect')=>{if(!row||!id||!api||locked)return;const command=store.begin(id,kind,readTurnContext(),sessionCoordinator.current());if(!command)return;
 try{const flow=await api.connect(kind==='reconnect',command.context);if(fence(command.generation))store.metadata(id,{flow});store.settle(id,command,'succeeded',readTurnContext(),sessionCoordinator.current())}
 catch(e){setError(e instanceof SettingsRequestError?e.status:'read');store.settle(id,command,asRequestNotDispatchedError(e)?'not-sent':'unknown',readTurnContext(),sessionCoordinator.current(),undefined,undefined,e instanceof SettingsRequestError?e.status:undefined)}};
 const refresh=()=>read(async g=>{if(row!.metadata.flow){const flow=await api!.flow(row!.metadata.flow.flow_id,row!.context);if(fence(g))store.metadata(id!,{flow})}
 await controller!.verifyProviderConnection();const revision=controller!.getSnapshot().providerEvidenceRevision;const capabilities=await api!.capabilities(row!.context);if(fence(g,revision))store.metadata(id!,{capabilities,capabilitiesRevision:revision})});
 const link=async()=>{if(!row||!id||!api||locked||!proof||!selected.selection||selected.unconfirmed||!row.fields.remoteId||row.metadata.pageRevision!==evidence?.revision||!row.metadata.page?.items.some(i=>i.id===row.fields.remoteId))return;
 if(!fence(sessionCoordinator.current(),evidence!.revision))return;
 const selectionId=ops.store.reserveSelection(notebookId,{...selected.selection,remote_source_ids:[]},row.context,sessionCoordinator.current(),{providerRevision:evidence!.revision,remoteNotebookId:row.fields.remoteId});if(!selectionId)return;
 const revision=evidence!.revision,command=store.begin(id,'link',readTurnContext(),sessionCoordinator.current(),revision,selectionId);if(!command)return;
 try{if(!fence(command.generation,revision))throw new RequestNotDispatchedError('superseded');await api.link(notebookId,command.fields.remoteId,command.context);if(!fence(command.generation,revision))throw Error('Retired original link');
 store.metadata(id,{linkConfirmed:true});ops.store.releaseSelection(selectionId);await ops.run(selectionId,()=>fence(command.generation,revision));
 store.settle(id,command,ops.store.get(selectionId)?.operation.state==='succeeded'?'succeeded':'unknown',readTurnContext(),sessionCoordinator.current())}
 catch(e){if(asRequestNotDispatchedError(e))ops.store.releaseUnsentReservation(selectionId,e);setError(e instanceof SettingsRequestError?e.status:'read');store.settle(id,command,asRequestNotDispatchedError(e)?'not-sent':'unknown',readTurnContext(),sessionCoordinator.current(),undefined,undefined,e instanceof SettingsRequestError?e.status:undefined)}};
 const execute=async()=>{const original=confirm;if(!original||!row||!id||!api||locked||original.fields!==row.fields||original.generation!==sessionCoordinator.current()||original.revision!==controller?.getSnapshot().providerEvidenceRevision||original.kind==='create'&&(!proof||!available('create_notebook')||!fence(original.generation,original.revision)))return;
 setConfirm(null);const command=store.begin(id,original.kind,readTurnContext(),sessionCoordinator.current(),original.revision);if(!command)return;
 try{if(original.kind==='disconnect'){controller!.invalidateProviderAdmission();await api.disconnect(command.context);store.settle(id,command,'succeeded',readTurnContext(),sessionCoordinator.current());controller!.retirePrivacyContext()}
 else{const result=await api.create({notebook_id:notebookId,title:command.fields.remoteTitle,idempotency_key:command.id},command.context);
 if(!fence(command.generation,command.providerRevision))throw Error('Retired original create');store.metadata(id,{create:result,createCommand:command});store.settle(id,command,'succeeded',readTurnContext(),sessionCoordinator.current(),undefined,result.job_id)}}
 catch(e){setError(e instanceof SettingsRequestError?e.status:'read');store.settle(id,command,asRequestNotDispatchedError(e)?'not-sent':'unknown',readTurnContext(),sessionCoordinator.current(),undefined,undefined,e instanceof SettingsRequestError?e.status:undefined)}};
 if(!row)return null;
 const status=evidence?.status,states=t.workbench.connectionStates;
 const statusCurrent=!!evidence&&evidence.revision===h.state?.providerEvidenceRevision&&canDispatch(evidence.context,h.context);
 const currentFlow=row.metadata.flow,expired=!!currentFlow&&Date.parse(currentFlow.expires_at)<=Date.now();
 const result=row.metadata.create;
 const pendingCreate=!!result;
 const command=row.command,selectionOp=command?.selectionId?ops.store.get(command.selectionId):undefined;
 return <section className="settings-connections"><h3>{settings.connections}</h3>
 <p role="status">{statusCurrent&&status?(status.state in states?states[status.state as keyof typeof states]:t.common.unknown+': '+status.state):t.workbench.connectionNotVerified}</p>
 {statusCurrent&&status&&<dl><dt>{t.workbench.googleConnection}</dt><dd>{status.account_label??t.common.unknown}</dd><dt>{t.workbench.verifiedAt.replace('{{time}}','')}</dt><dd>{status.last_verified_at??t.common.unknown}</dd><dd>{status.quota==null?t.workbench.quotaUnknown:String(status.quota)}</dd></dl>}
 <div className="dialog-actions"><Button disabled={!h.ready||busy||h.state?.providerChecking} onClick={()=>void verify()}>{session.verifyGoogle}</Button><Button disabled={locked} onClick={()=>void flow('connect')}>{t.workbench.connect}</Button><Button disabled={locked} onClick={()=>void flow('reconnect')}>{t.workbench.reconnect}</Button><Button disabled={!h.ready||busy} onClick={()=>void refresh()}>{t.common.refresh}</Button><Button variant="danger" disabled={locked} onClick={()=>setConfirm({kind:'disconnect',fields:row.fields,generation:sessionCoordinator.current(),revision:h.state!.providerEvidenceRevision})}>{t.workbench.disconnect}</Button></div>
 {currentFlow&&<section><p>{currentFlow.state in states?states[currentFlow.state as keyof typeof states]:t.common.unknown+': '+currentFlow.state}</p><time>{currentFlow.expires_at}</time><p>{expired||currentFlow.reason==='expired'?settings.expired:currentFlow.reason==='manual'?settings.manual:t.common.unknown}</p></section>}
 {caps&&<ul>{caps.map(c=><li key={c.name}>{c.name}: {c.support==='available'?t.workbench.states.available:c.support==='unverified'?t.workbench.capabilityUnverified:['unsupported','temporarily_unavailable'].includes(c.support)?t.workbench.unavailable:t.common.unknown+': '+c.support}{c.reason?' · '+c.reason:''}</li>)}</ul>}
 {error!==null&&<p role="alert">{t.common.error}{typeof error==='number'?': '+error:''}</p>}
 <Button disabled={locked||!available('list_notebooks')} onClick={()=>load(null)}>{t.workbench.listNotebooks}</Button>
 {row.metadata.page&&<><p>{row.metadata.page.listing_complete?t.common.success:t.workbench.listIncomplete}: {row.metadata.page.completeness_note??t.common.unknown}</p><label className="field-label">{t.workbench.remoteNotebook}<select value={row.fields.remoteId} disabled={locked||!proof||row.metadata.pageRevision!==evidence?.revision} onChange={e=>store.edit(row.id,{remoteId:e.target.value})}><option value="">{t.common.unknown}</option>{row.metadata.page.items.map(i=><option key={i.id} value={i.id}>{i.title}</option>)}</select></label><Button disabled={locked||!proof||!row.metadata.page.next_cursor||row.metadata.pageRevision!==evidence?.revision} onClick={()=>load(row.metadata.page!.next_cursor)}>{t.common.next}</Button><Button disabled={locked||!proof||row.metadata.pageRevision!==evidence?.revision||!row.fields.remoteId||selected.unconfirmed||!selected.selection} onClick={()=>void link()}>{t.workbench.link}</Button></>}
 {row.metadata.linkConfirmed&&<p role="status">{settings.partial} {selectionOp?.operation.state==='succeeded'?t.workbench.selectionSaved:t.workbench.selectionUnconfirmed}</p>}
 {selectionOp?.operation.state==='unknown'&&<Button disabled={!h.ready||busy} onClick={()=>void read(async g=>{const check=ops.store.beginCheck(selectionOp.id,readTurnContext(),g);if(!check||!ops.api)return;const value=await ops.api.workspace(notebookId,check.context);if(ops.store.check(check,value,readTurnContext(),sessionCoordinator.current())&&row.metadata.linkConfirmed&&row.command?.kind==='link'){store.settle(row.id,row.command,'succeeded',readTurnContext(),sessionCoordinator.current());changed()}})}>{t.workbench.turnRecoveryCheck}</Button>}
 <label className="field-label">{t.workbench.remoteTitle}<input value={row.fields.remoteTitle} maxLength={500} disabled={locked||pendingCreate} onChange={e=>store.edit(row.id,{remoteTitle:e.target.value})}/></label>
 <Button disabled={locked||!available('create_notebook')||!row.fields.remoteTitle.trim()||pendingCreate} onClick={()=>setConfirm({kind:'create',fields:row.fields,generation:sessionCoordinator.current(),revision:h.state!.providerEvidenceRevision})}>{t.workbench.createRemote}</Button>
 {confirm&&<section className="settings-danger"><p>{confirm.kind==='create'?settings.createImpact:t.workbench.disconnectConfirm}</p>{confirm.kind==='create'&&<p>{confirm.fields.remoteTitle} · {notebookId}</p>}<Button variant="danger" disabled={locked||confirm.fields!==row.fields||confirm.revision!==h.state?.providerEvidenceRevision||confirm.generation!==sessionCoordinator.current()} onClick={()=>void execute()}>{t.common.confirm}</Button><Button onClick={()=>setConfirm(null)}>{t.common.cancel}</Button></section>}
 {result&&<section><p className="source-id">{result.job_id} · {result.idempotency_key} · {result.title}</p><p>{result.state in t.workbench.states?t.workbench.states[result.state as keyof typeof t.workbench.states]:t.common.unknown+': '+result.state} · {t.workbench.submissionStatus.replace('{{status}}',result.submission_state==='confirmed'?t.common.success:result.submission_state==='not_submitted'?t.noteConflict.notSent:t.common.unknown)}</p>{result.remote_notebook_id&&<p>{result.remote_notebook_id}</p>}{canObserveCreate(result)&&<Button disabled={!h.ready||busy||row.metadata.createCommand?.providerRevision!==h.state?.providerEvidenceRevision||row.metadata.createCommand?.generation!==sessionCoordinator.current()} onClick={()=>void read(async g=>{const original=row.metadata.createCommand;if(!original||!fence(original.generation,original.providerRevision))return;const next=await api!.observe(result,original.context);if(fence(g,row.metadata.createCommand!.providerRevision))store.metadata(row.id,{create:next})})}>{t.workbench.jobs} · {t.common.refresh}</Button>}</section>}
 {command?.status==='unknown'&&<p role="status">{t.workbench.turnRecoveryUncertain}</p>}
 </section>;
}
