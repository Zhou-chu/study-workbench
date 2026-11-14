import {useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {asRequestNotDispatchedError,canDispatch,readTurnContext,sessionCoordinator,subscribeTurnContext} from '@study/web-transport';
import {useAppData,useAppDrafts} from '../../app/providers';
import {useResourceNavigation,useWorkbenchSnapshot} from '../../app/WorkbenchSession';
import {AppChrome} from '../../app/AppChrome';
import {createSettingsApi,SettingsRequestError,RebuildSubmissionUnknown} from '../../data/settings-api';
import type {ApiVersion} from '../../data/advanced-contracts';
import {validRebuildRequest} from '../../data/advanced-contracts';
import {useI18n} from '../../i18n';
import {Button} from '../../ui/Button';
import {LibraryDialog} from '../library/LibraryDialog';
import {observeAdvanced} from './advanced-observer';
import type {AdvancedToken} from './advanced-store';
export function AdvancedPage(){
 const drafts=useAppDrafts(),store=drafts.advanced,rows=useSyncExternalStore(drafts.subscribe,store.getSnapshot),{transport}=useAppData(),{state,controller}=useWorkbenchSnapshot(),navigation=useResourceNavigation();
 const context=useSyncExternalStore(subscribeTurnContext,readTurnContext,()=>null),generation=sessionCoordinator.current(),{t,advanced:m}=useI18n();
 const api=useMemo(()=>transport?createSettingsApi(transport):null,[transport]);
 const [id,setId]=useState<string|null>(null),[confirm,setConfirm]=useState<AdvancedToken|null>(null),[observing,setObserving]=useState(false),[version,setVersion]=useState<ApiVersion|null>(null),[configState,setConfigState]=useState<'loading'|'error'|'ready'>('loading');
 const row=rows.find(r=>r.id===id),mounted=useRef(false),currentId=useRef(id),stop=useRef<(()=>void)|null>(null),opener=useRef<HTMLButtonElement>(null);
 currentId.current=id;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;stop.current?.()}},[]);
 useEffect(()=>{if(!id&&context?.ready&&state?.ready)setId(store.open(context))},[id,context,state?.ready,store]);
 useEffect(()=>{if(!id)return;navigation?.activateResource(id);return navigation?.holdResource(id)},[id,row?.dirty,row?.status,navigation]);
 useEffect(()=>{stop.current?.();setObserving(false);return()=>stop.current?.()},[id,context?.epoch,context?.ready,generation,row?.retired]);
 useEffect(()=>{if(!api||!context?.ready||!state?.ready)return;const c=context,g=sessionCoordinator.current(),abort=new AbortController();let active=true;setConfigState('loading');setVersion(null);
 void api.version(c,abort.signal).then(v=>{if(active&&canDispatch(c,readTurnContext())&&g===sessionCoordinator.current()){setVersion(v);setConfigState('ready')}}).catch(()=>{if(active)setConfigState('error')});return()=>{active=false;abort.abort()};
 },[api,context?.epoch,context?.ready,generation,state?.ready]);
 const ready=!!row&&!row.retired&&!!api&&state?.ready===true&&canDispatch(row.context,context);
 const close=()=>{setConfirm(null);queueMicrotask(()=>{if(opener.current?.isConnected&&!opener.current.disabled)opener.current.focus();else document.getElementById('main-content')?.focus()})};
 const startObservation=(token:AdvancedToken)=>{if(!api||!mounted.current||currentId.current!==token.ownerId||!store.canObserve(token,readTurnContext(),sessionCoordinator.current()))return;
 stop.current?.();setObserving(true);const command=store.get(token.ownerId)!.attempt!.commandId!;
 stop.current=observeAdvanced({notBefore:(store.get(token.ownerId)!.attempt!.readStartedAt??-Infinity)+5000,
 current:()=>mounted.current&&currentId.current===token.ownerId&&controller?.getSnapshot().ready===true&&store.canObserve(token,readTurnContext(),sessionCoordinator.current()),
 onStart:time=>store.readStarted(token,time,readTurnContext(),sessionCoordinator.current()),
 read:signal=>api.rebuildStatus(command,token.context,signal),value:value=>store.observe(token,value,readTurnContext(),sessionCoordinator.current()),unavailable:()=>{store.observe(token,null,readTurnContext(),sessionCoordinator.current())},stopped:()=>{if(mounted.current)setObserving(false)}});
 };
 const submit=async()=>{const original=confirm;if(!original||currentId.current!==original.ownerId||!api||!controller||!store.begin(original,readTurnContext(),sessionCoordinator.current(),controller.getSnapshot().providerEvidenceRevision))return;close();
 try{const receipt=await api.rebuild(original.request,original.context,original.id);store.settle(original,{kind:'receipt',receipt},readTurnContext(),sessionCoordinator.current());startObservation(original)}
 catch(e){const proof=asRequestNotDispatchedError(e);store.settle(original,proof?{kind:'not-sent'}:e instanceof RebuildSubmissionUnknown?{kind:'unknown',...(e.command_id?{commandId:e.command_id}:{}),status:409}:e instanceof SettingsRequestError&&[400,404,422,429].includes(e.status)?{kind:'rejected',status:e.status}:{kind:'unknown',...(e instanceof SettingsRequestError?{status:e.status}:{})},readTurnContext(),sessionCoordinator.current());if(e instanceof RebuildSubmissionUnknown&&e.command_id)startObservation(original)}
 };
 const attempt=row?.attempt,locked=!ready||!!attempt&&(!['not-sent','rejected'].includes(attempt.phase)||attempt.unknown),resetLocked=!ready||!!attempt&&(attempt.unknown||attempt.unavailable||!['terminal','not-sent','rejected'].includes(attempt.phase));
 const latest=version?.latestVersion&&version.latestVersion!=='unknown'?version.latestVersion:null;
 const confirmationValid=!!confirm&&confirm.ownerId===id&&ready&&store.canBegin(confirm,context,generation,state?.providerEvidenceRevision??-1);
 return <AppChrome><section className="notebook-home advanced-page"><h1>{t.navigation.advanced}</h1><p>{m.disclosure}</p>
 {row&&<><label className="field-label">{m.records}<select value={id??''} onChange={e=>{stop.current?.();close();if(store.select(e.target.value))setId(e.target.value)}}>{rows.map((r,i)=><option key={r.id} value={r.id}>{i+1}: {r.id}{r.retired?' · '+t.common.unknown:''}</option>)}</select></label>
 {row.retired&&<section className="settings-danger" role="status"><p>{m.retired}</p><Button disabled={!context?.ready||!state?.ready} onClick={()=>{if(context){const next=store.fresh(row.id,context);if(next){close();setId(next)}}}}>{m.fresh}</Button></section>}
 <label className="field-label">{m.mode}<select aria-label={m.mode} value={row.fields.mode} disabled={!ready} onChange={e=>{if(e.target.value==='existing'||e.target.value==='all')store.edit(row.id,{mode:e.target.value})}}><option value="existing">{t.advanced.rebuild.existing}</option><option value="all">{t.advanced.rebuild.all}</option></select></label>
 <fieldset className="advanced-categories" disabled={!ready}><legend>{t.advanced.rebuild.include}</legend>{(['sources','notes','insights'] as const).map((key,i)=><label key={key}><input type="checkbox" checked={row.fields[('include_'+key) as 'include_sources']} onChange={e=>store.edit(row.id,{['include_'+key]:e.target.checked})}/>{[t.navigation.sources,t.common.notes,t.common.insights][i]}</label>)}</fieldset>
 {!validRebuildRequest(row.fields)&&<p role="alert">{t.advanced.rebuild.selectOneError}</p>}
 <div className="dialog-actions"><Button ref={opener} variant="danger" disabled={locked||!validRebuildRequest(row.fields)} onClick={()=>{if(controller){const token=store.capture(row.id,readTurnContext(),sessionCoordinator.current(),controller.getSnapshot().providerEvidenceRevision);if(token)setConfirm(token)}}}>{m.start}</Button>
 <Button disabled={resetLocked} onClick={()=>store.reset(row.id,readTurnContext())}>{m.reset}</Button>
 <Button disabled={!attempt||!ready||observing||!store.canObserve(attempt.token,context,generation)} onClick={()=>{if(attempt)startObservation(attempt.token)}}>{m.refresh}</Button></div>
 {attempt&&<section aria-live="polite">{attempt.unknown&&<p className="settings-danger" role="status">{m.unknown}</p>}
 {attempt.httpStatus!==undefined&&<p role="alert">{t.common.error}: {attempt.httpStatus}</p>}
 {attempt.phase==='pending'&&<p role="status">{t.advanced.rebuild.starting}</p>}
 {attempt.commandId&&<p className="source-id">{attempt.commandId}</p>}
 {attempt.receipt&&<p>{m.estimate}: {attempt.receipt.total_items}</p>}
 {(attempt.unavailable||attempt.commandId&&(!ready||attempt.token.generation!==generation))&&<p role="status">{m.unavailable}</p>}
 {attempt.observation&&<><p role="status">{attempt.observation.status==='completed'?m.scheduling:attempt.observation.status==='failed'?t.advanced.rebuild.failed:attempt.observation.status==='queued'?t.advanced.rebuild.queued:attempt.observation.status==='running'?t.advanced.rebuild.running:t.common.unknown+': '+attempt.observation.status}</p>
 {attempt.observation.progress?<p>{m.submitted}: {attempt.observation.progress.processed} / {attempt.observation.progress.total} ({attempt.observation.progress.percentage}%)</p>:<p>{t.common.unknown}</p>}
 {attempt.observation.stats&&<dl>{(['sources','notes','insights','failed'] as const).map((key,i)=><div key={key}><dt>{[t.navigation.sources,t.common.notes,t.common.insights,m.failures][i]}</dt><dd>{attempt.observation!.stats![key]??t.common.unknown}</dd></div>)}</dl>}
 {attempt.observation.stats?.failed!==undefined&&<p>{m.failures}: {attempt.observation.stats.failed}</p>}</>}
 </section>}
 {row.history.map((a,i)=><p className="source-id" key={i}>{a.commandId??t.common.unknown}{a.receipt?' · '+m.estimate+': '+a.receipt.total_items:''}</p>)}
 </>}
 <section><h2>{t.advanced.systemInfo}</h2>{configState==='loading'?<p role="status">{t.common.loading}</p>:configState==='error'?<p role="alert">{t.common.error}</p>:<dl><dt>{t.advanced.currentVersion}</dt><dd>{version?.version==='unknown'?t.advanced.unknown:version?.version}</dd><dt>{t.advanced.latestVersion}</dt><dd>{latest??m.latestUnavailable}</dd><dt>{t.advanced.status}</dt><dd>{latest&&version?.hasUpdate!==undefined?(version.hasUpdate?t.advanced.updateAvailable.replace('{{version}}',latest):t.advanced.upToDate):t.advanced.unknown}</dd></dl>}
 <a className="button" href="https://github.com/lfnovo/open-notebook" target="_blank" rel="noopener noreferrer">{m.repository}</a></section>
 {confirm&&<LibraryDialog open onOpenChange={open=>{if(!open)close()}} title={m.confirm} description={m.disclosure}><p>{confirm.request.mode==='existing'?t.advanced.rebuild.existing:t.advanced.rebuild.all}</p><p>{[confirm.request.include_sources?t.navigation.sources:null,confirm.request.include_notes?t.common.notes:null,confirm.request.include_insights?t.common.insights:null].filter(Boolean).join(', ')}</p><div className="dialog-actions"><Button variant="danger" disabled={!confirmationValid} onClick={()=>void submit()}>{m.confirm}</Button><Button onClick={close}>{t.common.cancel}</Button></div></LibraryDialog>}
 </section></AppChrome>;
}
