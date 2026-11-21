import {classifyIngressResponse,TransportResponseError} from '@study/web-transport';
export type SpaArtifactManifest=Readonly<{
 schema_version:'spa-artifact-v1';source_commit:string;authored_digest:string;asset_digest:string;contract_digest:string;
 ui_transport_protocol:1;supported_contracts:readonly ['workspace-view-v1'];
}>;
export type ArtifactIdentity=Readonly<Omit<SpaArtifactManifest,'schema_version'|'asset_digest'>&{release_slot:string}>;
declare const __SPA_ARTIFACT__: ArtifactIdentity|null;
export class ArtifactMismatchError extends Error {constructor(){super('Application artifact does not match its own release');}}
const hash=(v:unknown,n:number)=>typeof v==='string'&&new RegExp('^[a-f0-9]{'+n+'}$').test(v);
export function isArtifactManifest(value:unknown):value is SpaArtifactManifest{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const v=value as Record<string,unknown>;
 return Object.keys(v).sort().join(',')==='asset_digest,authored_digest,contract_digest,schema_version,source_commit,supported_contracts,ui_transport_protocol'&&v.schema_version==='spa-artifact-v1'&&hash(v.source_commit,40)&&['authored_digest','asset_digest','contract_digest'].every(k=>hash(v[k],64))&&v.ui_transport_protocol===1&&Array.isArray(v.supported_contracts)&&v.supported_contracts.length===1&&v.supported_contracts[0]==='workspace-view-v1';
}
/** Capture embedded identity once per application. Never substitutes a mutable latest release. */
export function createArtifactIdentity(embedded:ArtifactIdentity|null=typeof __SPA_ARTIFACT__==='undefined'?null:__SPA_ARTIFACT__):()=>Promise<SpaArtifactManifest>{
 const own=embedded?Object.freeze({...embedded,supported_contracts:Object.freeze([...embedded.supported_contracts])}):null;
 return async()=>{
  if(!own||!/^[a-z0-9][a-z0-9-]{15,79}$/.test(own.release_slot))throw new TransportResponseError('unavailable');
  let response:Response;
  try{response=await fetch(new Request(new URL('/_spa/releases/'+own.release_slot+'/spa-artifact-manifest.json',window.location.href),{credentials:'same-origin',redirect:'error',cache:'no-store'}));}
  catch{throw new TransportResponseError('unavailable');}
  const ingress=classifyIngressResponse(response,'/_spa/releases/'+own.release_slot+'/spa-artifact-manifest.json');
  if(ingress)throw new TransportResponseError(ingress,response.status);
  if(!response.ok)throw new TransportResponseError('unavailable',response.status);
  let value:unknown;try{value=await response.json();}catch{throw new TransportResponseError('unavailable');}
  if(!isArtifactManifest(value)||value.source_commit!==own.source_commit||value.authored_digest!==own.authored_digest||value.contract_digest!==own.contract_digest||value.ui_transport_protocol!==own.ui_transport_protocol||JSON.stringify(value.supported_contracts)!==JSON.stringify(own.supported_contracts))throw new ArtifactMismatchError();
  return Object.freeze({...value,supported_contracts:Object.freeze(['workspace-view-v1'] as const)});
 };
}
