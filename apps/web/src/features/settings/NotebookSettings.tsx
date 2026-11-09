import {useEffect,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {readTurnContext,sessionCoordinator,asRequestNotDispatchedError} from '@study/web-transport';
import {useAppData} from '../../app/providers';
import {useI18n} from '../../i18n';
import {Button} from '../../ui/Button';
import {LibraryDialog} from '../library/LibraryDialog';
import {useSourceOperations} from '../sources/use-source-operations';
import {useSourceSelection} from '../sources/use-source-selection';
import {useSettings} from './use-settings';
import {ConnectionsPage} from './ConnectionsPage';
import {SettingsRequestError,canStartCreateSuccessor,type DeletePreview,type NotebookPatch} from '../../data/settings-api';
export function NotebookSettings({notebookId,onClose}:{notebookId:string;onClose():void}){
 const h=useSettings(notebookId),{row,store,id,api}=h,{workspace}=useAppData(),{t,settings,session}=useI18n(),queries=useQueryClient();
 const [connections,setConnections]=useState(false),[read,setRead]=useState<'pending'|'error'|'ready'>('pending'),[error,setError]=useState<number|null>(null);
 const [preview,setPreview]=useState<{value:DeletePreview;generation:number;ownerId:string}|null>(null),[previewing,setPreviewing]=useState(false);
 const previewButton=useRef<HTMLButtonElement>(null),flight=useRef(false);
 const ops=useSourceOperations(notebookId);
 // This hook only receives the currently retained, exact notebook projection.
 const selected=useSourceSelection(notebookId,h.context?.epoch,workspace!);
 useEffect(()=>{if(!row||!api||row.baseline||!h.ready){if(row?.baseline)setRead('ready');return}let active=true;const c=row.context,g=sessionCoordinator.current();
 void api.notebook(notebookId,c).then(value=>{if(h.current()&&g===sessionCoordinator.current()){store.seed(row.id,value);if(active)setRead('ready')}}).catch(()=>{if(active)setRead('error')});
 return()=>{active=false};
 },[id,api,h.ready]);
 const locked=row?.command?.kind==='delete'&&row.command.status==='succeeded'||!h.ready||!!row?.command&&['pending','unknown'].includes(row.command.status);
 const changed=async(patch:NotebookPatch)=>{
 if(!api||!row||!id||locked||!Object.keys(patch).length)return;
 const command=store.begin(id,'save',readTurnContext(),sessionCoordinator.current());if(!command)return;
 try{const ack=await api.update(notebookId,patch,command.context);store.settle(id,command,'succeeded',readTurnContext(),sessionCoordinator.current(),ack);if(h.current()){void queries.invalidateQueries({queryKey:['notebooks']});void queries.invalidateQueries({predicate:q=>q.queryKey[0]==='workspace'&&q.queryKey[2]===notebookId})}}
 catch(e){setError(e instanceof SettingsRequestError?e.status:null);store.settle(id,command,asRequestNotDispatchedError(e)?'not-sent':'unknown',readTurnContext(),sessionCoordinator.current(),undefined,undefined,e instanceof SettingsRequestError?e.status:undefined)}
 };
 const save=()=>{if(!row?.baseline||!row.fields.name.trim())return;void changed({... (row.fields.name!==row.baseline.name?{name:row.fields.name}:{}),...(row.fields.description!==row.baseline.description?{description:row.fields.description}:{})})};
 const previewDelete=async()=>{if(!api||!row||locked||flight.current)return;flight.current=true;setPreviewing(true);setError(null);const g=sessionCoordinator.current();
 try{const value=await api.preview(notebookId,row.context);if(h.current()&&g===sessionCoordinator.current())setPreview({value,generation:g,ownerId:row.id})}catch(e){setRead('error');setError(e instanceof SettingsRequestError?e.status:null)}finally{flight.current=false;setPreviewing(false)}};
 const remove=async()=>{if(!row||!id||!api||!preview||preview.ownerId!==row.id||locked||preview.generation!==sessionCoordinator.current())return;const command=store.begin(id,'delete',readTurnContext(),sessionCoordinator.current());if(!command)return;
 try{const receipt=await api.remove(notebookId,command.fields.deleteExclusive,command.context);store.metadata(id,{deleted:receipt});store.settle(id,command,'succeeded',readTurnContext(),sessionCoordinator.current());if(h.current())void queries.invalidateQueries({queryKey:['notebooks']})}
 catch(e){setError(e instanceof SettingsRequestError?e.status:null);store.settle(id,command,asRequestNotDispatchedError(e)?'not-sent':'unknown',readTurnContext(),sessionCoordinator.current(),undefined,undefined,e instanceof SettingsRequestError?e.status:undefined)}};
 const select=(kind:'engine'|'selection_origin',value:string)=>{if(!selected.selection||selected.unconfirmed||!h.ready||!h.context)return;
 if(kind==='engine'&&!['independent','notebooklm'].includes(value)||kind==='selection_origin'&&!['local','remote'].includes(value))return;
 const next={...selected.selection,[kind]:value};const op=ops.store.capture(notebookId,{kind:'selection',selection:next},h.context,sessionCoordinator.current());void ops.run(op)};
 const raw=workspace?.selection;
 return <LibraryDialog open onOpenChange={open=>{if(!open)onClose()}} title={settings.notebookSettings}>
 {row?.retired&&<p role="status">{session.retiredDraft}</p>}
 {h.rows.length>1&&<label className="field-label">{settings.notebookSettings}<select aria-label={settings.notebookSettings} value={id??''} onChange={e=>h.select(e.target.value)}>{h.rows.map(r=><option key={r.id} value={r.id}>{r.fields.name||r.notebookId} · {r.id}{r.retired?' · '+session.retiredDraft:''}</option>)}</select></label>}
 {(row?.retired||row?.metadata.create&&canStartCreateSuccessor(row.metadata.create))&&<Button disabled={!h.context?.ready||!h.state?.ready||!row.retired&&locked} onClick={h.fresh}>{t.common.new}</Button>}
 {read==='pending'&&<p role="status">{t.common.loading}</p>}{read==='error'&&<p role="alert">{t.common.error}{error===null?'':': '+error}</p>}
 {row&&<><label className="field-label">{t.common.name}<input aria-label={t.common.name} value={row.fields.name} disabled={!h.ready||!row.baseline} onChange={e=>store.edit(row.id,{name:e.target.value})}/></label>
 <label className="field-label">{t.common.description}<textarea value={row.fields.description} disabled={!h.ready||!row.baseline} onChange={e=>store.edit(row.id,{description:e.target.value})}/></label>
 <div className="dialog-actions"><Button disabled={locked||!row.baseline||!row.fields.name.trim()||row.fields.name===row.baseline.name&&row.fields.description===row.baseline.description} onClick={save}>{t.common.save}</Button><Button disabled={locked||!row.baseline} onClick={()=>void changed({archived:!row.baseline?.archived})}>{row.baseline?.archived?t.notebooks.unarchive:t.notebooks.archive}</Button><Button ref={previewButton} variant="danger" disabled={locked||previewing} onClick={()=>void previewDelete()}>{t.notebooks.deleteNotebook}</Button></div>
 {row.command&&<p className="source-id">{row.command.id}</p>}
 {row.command&&<p role="status">{row.command.status==='pending'?t.common.processing:row.command.status==='unknown'?t.workbench.turnRecoveryUncertain:row.command.status==='not-sent'?t.noteConflict.notSent:t.common.success}{row.command.httpStatus===undefined?'':': '+row.command.httpStatus}</p>}
 {row.metadata.deleted&&<p>{t.common.notes}: {row.metadata.deleted.deleted_notes} · {t.common.chat}: {row.metadata.deleted.deleted_chat_sessions}</p>}
 {preview&&preview.ownerId===row.id&&<section className="settings-danger"><h3>{t.notebooks.deleteNotebook}</h3><p>{preview.value.notebook_name}</p><p>{t.notebooks.deleteNotebookNotes.replace('{{count}}',String(preview.value.note_count))}</p><p>{t.notebooks.deleteNotebookExclusiveSources.replace('{{count}}',String(preview.value.exclusive_source_count))}</p><p>{t.notebooks.deleteNotebookSharedSources.replace('{{count}}',String(preview.value.shared_source_count))}</p><p>{settings.deleteImpact}</p>
 <label><input type="radio" name="exclusive" checked={!row.fields.deleteExclusive} disabled={locked} onChange={()=>store.edit(row.id,{deleteExclusive:false})}/>{t.notebooks.keepExclusiveSourcesLabel}</label><label><input type="radio" name="exclusive" checked={row.fields.deleteExclusive} disabled={locked} onChange={()=>store.edit(row.id,{deleteExclusive:true})}/>{t.notebooks.deleteExclusiveSourcesLabel}</label>
 <div className="dialog-actions"><Button variant="danger" disabled={locked||row.command?.kind==='delete'&&row.command.status==='succeeded'||preview.generation!==sessionCoordinator.current()} onClick={()=>void remove()}>{t.common.deleteForever}</Button><Button disabled={row.command?.kind==='delete'&&row.command.status==='pending'} onClick={()=>{setPreview(null);previewButton.current?.focus()}}>{t.common.cancel}</Button></div></section>}
 <label className="field-label">{t.workbench.engine}<select aria-label={t.workbench.engine} value={selected.selection?.engine??String(raw&&'engine'in raw?raw.engine:'')} disabled={!h.ready||selected.unconfirmed||!selected.selection} onChange={e=>select('engine',e.target.value)}>{!selected.selection&&<option value={String(raw&&'engine'in raw?raw.engine:'')}>{t.workbench.unknownEngine}: {String(raw&&'engine'in raw?raw.engine:t.common.unknown)}</option>}<option value="independent">{t.workbench.independent}</option><option value="notebooklm">{t.workbench.notebooklm}</option></select></label>
 <label className="field-label">{t.workbench.scope}<select value={selected.selection?.selection_origin??String(raw&&'selection_origin'in raw?raw.selection_origin:'')} disabled={!h.ready||selected.unconfirmed||!selected.selection} onChange={e=>select('selection_origin',e.target.value)}>{!selected.selection&&<option value={String(raw&&'selection_origin'in raw?raw.selection_origin:'')}>{t.workbench.unknownScope}: {String(raw&&'selection_origin'in raw?raw.selection_origin:t.common.unknown)}</option>}<option value="local">{t.workbench.localScope}</option><option value="remote">{t.workbench.remoteScope}</option></select></label>
 {selected.unconfirmed&&<p role="status">{t.workbench.selectionUnconfirmed}</p>}
 <Button aria-expanded={connections} onClick={()=>setConnections(!connections)}>{settings.connections}</Button>{connections&&<ConnectionsPage key={row.id} notebookId={notebookId} owner={h}/>}</>}
 </LibraryDialog>;
}
