import {canDispatch,freezeDispatchContext,type DispatchContext} from '@study/domain';
import {validRebuildRequest,type RebuildRequest,type RebuildReceipt,type RebuildStatus} from '../../data/advanced-contracts';
export const blankRebuild=():RebuildRequest=>Object.freeze({mode:'existing',include_sources:true,include_notes:true,include_insights:true});
export type AdvancedToken=Readonly<{id:string;ownerId:string;context:DispatchContext;generation:number;providerRevision:number;revision:number;request:RebuildRequest}>;
export type AdvancedAttempt=Readonly<{token:AdvancedToken;phase:'pending'|'accepted'|'terminal'|'unknown'|'not-sent'|'rejected';unknown:boolean;unavailable:boolean;commandId?:string;receipt?:RebuildReceipt;observation?:RebuildStatus;httpStatus?:number;readStartedAt?:number}>;
export type AdvancedDraft=Readonly<{id:string;kind:'advanced';context:DispatchContext;fields:RebuildRequest;revision:number;dirty:boolean;retired:boolean;status:'editing'|'pending'|'accepted'|'unknown'|'succeeded';attempt:AdvancedAttempt|null;history:readonly AdvancedAttempt[]}>;
export type AdvancedOutcome={kind:'receipt';receipt:RebuildReceipt}|{kind:'unknown';commandId?:string;status?:number}|{kind:'not-sent'}|{kind:'rejected';status:number};
const state=(a:AdvancedAttempt|null):AdvancedDraft['status']=>!a?'editing':a.unknown?'unknown':a.phase==='pending'?'pending':a.phase==='accepted'||a.unavailable?'accepted':a.phase==='terminal'?'succeeded':'editing';
export function createAdvancedStore(notify:()=>void){
 const rows=new Map<string,AdvancedDraft>();let selected:string|null=null,snapshot:readonly AdvancedDraft[]=Object.freeze([]);
 const emit=()=>{snapshot=Object.freeze([...rows.values()]);notify()};const put=(r:AdvancedDraft)=>{rows.set(r.id,Object.freeze(r));emit()};
 const create=(context:DispatchContext)=>{const id='advanced:'+crypto.randomUUID();selected=id;put({id,kind:'advanced',context:freezeDispatchContext(context),fields:blankRebuild(),revision:0,dirty:false,retired:false,status:'editing',attempt:null,history:Object.freeze([])});return id};
 const usable=(r:AdvancedDraft|undefined,current:DispatchContext|null):r is AdvancedDraft=>!!r&&!r.retired&&canDispatch(r.context,current);
 const available=(r:AdvancedDraft)=>!r.attempt||['not-sent','rejected'].includes(r.attempt.phase)&&!r.attempt.unknown;
 return {get:(id:string)=>rows.get(id),getSnapshot:()=>snapshot,
 open(context:DispatchContext){if(selected&&rows.has(selected))return selected;return context.ready?create(context):null},
 select(id:string){if(!rows.has(id))return false;selected=id;emit();return true},
 fresh(id:string,current:DispatchContext){const r=rows.get(id);if(!r?.retired||!current.ready)return null;const live=[...rows.values()].find(x=>!x.retired&&canDispatch(x.context,current));if(live){selected=live.id;emit();return live.id}return create(current)},
 edit(id:string,patch:Partial<RebuildRequest>){const r=rows.get(id);if(!r||r.retired)return;const fields=Object.freeze({...r.fields,...patch});put({...r,fields,revision:r.revision+1,dirty:JSON.stringify(fields)!==JSON.stringify(blankRebuild())})},
 capture(id:string,current:DispatchContext|null,generation:number,providerRevision:number):AdvancedToken|null{const r=rows.get(id);if(!usable(r,current)||!available(r)||!validRebuildRequest(r.fields))return null;return Object.freeze({id:crypto.randomUUID(),ownerId:id,context:r.context,generation,providerRevision,revision:r.revision,request:r.fields})},
 canBegin(token:AdvancedToken,current:DispatchContext|null,generation:number,providerRevision:number){const r=rows.get(token.ownerId);return usable(r,current)&&available(r)&&r.revision===token.revision&&r.fields===token.request&&token.generation===generation&&token.providerRevision===providerRevision&&validRebuildRequest(token.request)},
 begin(token:AdvancedToken,current:DispatchContext|null,generation:number,providerRevision:number){if(!this.canBegin(token,current,generation,providerRevision))return false;const r=rows.get(token.ownerId)!;put({...r,attempt:Object.freeze({token,phase:'pending',unknown:false,unavailable:false}),status:'pending'});return true},
 settle(token:AdvancedToken,outcome:AdvancedOutcome,current:DispatchContext|null,generation:number){const r=rows.get(token.ownerId);if(!r||r.attempt?.token!==token||r.attempt.phase!=='pending')return;
 const valid=usable(r,current)&&token.generation===generation;let a:AdvancedAttempt;
 if(outcome.kind==='receipt')a={token,phase:valid?'accepted':'unknown',unknown:!valid,unavailable:false,commandId:outcome.receipt.command_id,receipt:outcome.receipt};
 else if(outcome.kind==='unknown')a={token,phase:'unknown',unknown:true,unavailable:false,...(outcome.commandId?{commandId:outcome.commandId}:{}),...(outcome.status!==undefined?{httpStatus:outcome.status}:{})};
 else a={token,phase:valid?outcome.kind:'unknown',unknown:!valid,unavailable:false,...(outcome.kind==='rejected'?{httpStatus:outcome.status}:{})};
 put({...r,attempt:Object.freeze(a),status:state(a)})},
 canObserve(token:AdvancedToken,current:DispatchContext|null,generation:number){const r=rows.get(token.ownerId);return usable(r,current)&&r.attempt?.token===token&&!!r.attempt.commandId&&r.attempt.phase!=='terminal'&&token.generation===generation},
 readStarted(token:AdvancedToken,time:number,current:DispatchContext|null,generation:number){const r=rows.get(token.ownerId);if(!r||!this.canObserve(token,current,generation)||r.attempt?.readStartedAt!==undefined&&time-r.attempt.readStartedAt<5000)return false;put({...r,attempt:Object.freeze({...r.attempt!,readStartedAt:time})});return true},
 observe(token:AdvancedToken,value:RebuildStatus|null,current:DispatchContext|null,generation:number){const r=rows.get(token.ownerId);if(!r||!this.canObserve(token,current,generation))return false;const old=r.attempt!;if(value&&value.command_id!==old.commandId){const a=Object.freeze({...old,unavailable:true});put({...r,attempt:a,status:state(a)});return false}const known=value&&['queued','running','completed','failed'].includes(value.status);
 const terminal=!!value&&['completed','failed'].includes(value.status);const a:AdvancedAttempt=Object.freeze({...old,...(value?{observation:value}:{}),phase:known&&terminal?'terminal':old.phase,unavailable:!known});
 put({...r,attempt:a,status:state(a)});return !!known&&!terminal},
 reset(id:string,current:DispatchContext|null){const r=rows.get(id);if(!usable(r,current)||r.attempt&&(r.attempt.unknown||r.attempt.unavailable||!['terminal','not-sent','rejected'].includes(r.attempt.phase)))return false;put({...r,fields:blankRebuild(),revision:r.revision+1,dirty:false,status:'editing',history:Object.freeze([...r.history,...(r.attempt?[r.attempt]:[])]),attempt:null});return true},
 retire(epoch:number){for(const r of rows.values())if(r.context.epoch===epoch){const a=r.attempt&&r.attempt.phase==='pending'?Object.freeze({...r.attempt,phase:'unknown' as const,unknown:true}):r.attempt;rows.set(r.id,Object.freeze({...r,retired:true,attempt:a,status:state(a)}))}emit()},
 hasUnsaved:()=>[...rows.values()].some(r=>r.dirty||['pending','accepted','unknown'].includes(r.status))
 };
}
