import {isRecord} from '@study/contracts';
export type RebuildRequest=Readonly<{mode:'existing'|'all';include_sources:boolean;include_notes:boolean;include_insights:boolean}>;
/** Safe named projections: arbitrary producer messages/errors are never retained. */
export type RebuildReceipt=Readonly<{command_id:string;total_items:number}>;
export type RebuildStatus=Readonly<{command_id:string;status:string;progress?:Readonly<{processed:number;total:number;percentage:number}>|null;stats?:Readonly<{sources?:number;notes?:number;insights?:number;failed?:number}>|null;started_at?:string|null;completed_at?:string|null;error_present?:boolean}>;
export type ApiVersion=Readonly<{version:string;latestVersion?:string|null;hasUpdate?:boolean}>;
const record=(v:unknown)=>{if(!isRecord(v))throw Error('Invalid advanced response');return v};
const text=(v:unknown)=>{if(typeof v!=='string')throw Error('Invalid advanced text');return v};
const count=(v:unknown)=>{if(!Number.isSafeInteger(v)||Number(v)<0)throw Error('Invalid advanced count');return v as number};
export function commandId(v:unknown){const s=text(v);if(!s.trim()||s.length>500||/[\\/\s?#%\u0000-\u001f\u007f]/.test(s))throw Error('Invalid command identity');return s}
export function validRebuildRequest(v:RebuildRequest){return ['existing','all'].includes(v.mode)&&[v.include_sources,v.include_notes,v.include_insights].every(x=>typeof x==='boolean')&&(v.include_sources||v.include_notes||v.include_insights)}
export function parseRebuildReceipt(value:unknown):RebuildReceipt{const r=record(value);text(r.message);return Object.freeze({command_id:commandId(r.command_id),total_items:count(r.total_items)})}
export function parseRebuildStatus(value:unknown,expected:string):RebuildStatus{
 const r=record(value),id=commandId(r.command_id),status=text(r.status);
 if(id!==expected||!status||status.length>80||/[\u0000-\u001f\u007f]/.test(status))throw Error('Unmatched advanced status');
 let progress:RebuildStatus['progress'];if(r.progress===null)progress=null;else if(r.progress!==undefined){const p=record(r.progress);if(typeof p.percentage!=='number'||!Number.isFinite(p.percentage)||p.percentage<0||p.percentage>100)throw Error('Invalid percentage');progress=Object.freeze({processed:count(p.processed),total:count(p.total),percentage:p.percentage})}
 let stats:RebuildStatus['stats'];if(r.stats===null)stats=null;else if(r.stats!==undefined){const s=record(r.stats);stats=Object.freeze(Object.fromEntries(['sources','notes','insights','failed'].filter(k=>s[k]!==undefined).map(k=>[k,count(s[k])])));}
 const dates:Record<string,string|null>={};for(const k of ['started_at','completed_at'])if(r[k]!==undefined){if(r[k]===null)dates[k]=null;else{const s=text(r[k]);if(!Number.isFinite(Date.parse(s)))throw Error('Invalid command time');dates[k]=s}}
 if(r.error_message!==undefined&&r.error_message!==null)text(r.error_message);
 return Object.freeze({command_id:id,status,...(progress!==undefined?{progress}:{}),...(stats!==undefined?{stats}:{}),...dates,...(r.error_message!==undefined?{error_present:r.error_message!==null&&r.error_message!==''}:{})});
}
export function parseApiVersion(value:unknown):ApiVersion{const r=record(value),version=text(r.version);if(!version||version.length>120||/[\u0000-\u001f\u007f]/.test(version))throw Error('Invalid version');if(r.latestVersion!==undefined&&r.latestVersion!==null&&(typeof r.latestVersion!=='string'||!r.latestVersion.trim()||r.latestVersion.length>120||/[\u0000-\u001f\u007f]/.test(r.latestVersion)))throw Error('Invalid latest version');if(r.hasUpdate!==undefined&&typeof r.hasUpdate!=='boolean')throw Error('Invalid update flag');return Object.freeze({version,...(r.latestVersion!==undefined?{latestVersion:r.latestVersion as string|null}:{}),...(r.hasUpdate!==undefined?{hasUpdate:r.hasUpdate as boolean}:{})})}
/** Bounded safe body decoder, used only for this explicit typed409 branch. */
export async function rebuildUnknown(response:Response):Promise<{command_id?:string}|null>{
 if(response.status!==409)return null;let size=0;const chunks:Uint8Array[]=[];const reader=response.body?.getReader();if(!reader)return null;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192)return null;chunks.push(value)}const bytes=new Uint8Array(size);let offset=0;for(const x of chunks){bytes.set(x,offset);offset+=x.length}const r=record(JSON.parse(new TextDecoder().decode(bytes))),d=record(r.detail);if(d.code!=='COMMAND_SUBMISSION_UNKNOWN'||d.retry_safe!==false)return null;let id:string|undefined;try{if(d.command_id!==undefined)id=commandId(d.command_id)}catch{/* Unusable acknowledgement never permits a lookup. */}return id?{command_id:id}:{};}catch{return null}finally{void reader.cancel().catch(()=>{});}
}
