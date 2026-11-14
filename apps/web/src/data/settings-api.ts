import * as transformation from './transformation-contracts';
import * as retrieval from './retrieval-contracts';
import * as cfg from './configuration-contracts';
import {commandId,validRebuildRequest,parseRebuildReceipt,parseRebuildStatus,parseApiVersion,rebuildUnknown,type RebuildRequest} from './advanced-contracts';
import {isRecord} from '@study/contracts';
import {canDispatch,freezeDispatchContext,readTurnContext,sessionCoordinator,RequestNotDispatchedError,TransportResponseError,type DispatchContext,type WebTransport} from '@study/web-transport';
import {parseNotebookSummary,type NotebookSummary} from './notebook-api';
import {parseProviderStatus} from './provider-status';
export type NotebookPatch=Readonly<{name?:string;description?:string|null;archived?:boolean}>;
export type DeletePreview=Readonly<{notebook_id:string;notebook_name:string;note_count:number;exclusive_source_count:number;shared_source_count:number}>;
export type DeleteReceipt=Readonly<{deleted_notes:number;deleted_sources:number;unlinked_sources:number;deleted_chat_sessions:number}>;
export type LoginFlow=Readonly<{flow_id:string;state:string;expires_at:string;reason:'manual'|'expired'|'unknown'}>;
export type ConnectionCapability=Readonly<{name:string;support:string;reason:string|null;last_verified_at:string|null;sdk_version:string;adapter_version:string}>;
export type NotebookPage=Readonly<{items:readonly Readonly<{id:string;title:string}>[];next_cursor:string|null;listing_complete:boolean;completeness_note:string|null}>;
export type CreateReceipt=Readonly<{job_id:string;state:string;submission_state:string|null;remote_notebook_id:string|null;request_hash:string;notebook_id:string;idempotency_key:string;title:string}>;
export const canObserveCreate=(r:CreateReceipt)=>['queued','running'].includes(r.state)&&['not_submitted','confirmed'].includes(r.submission_state??'')||r.state==='waiting_remote'&&r.submission_state==='confirmed';
export const canStartCreateSuccessor=(r:CreateReceipt)=>r.state==='succeeded'&&r.submission_state==='confirmed'||['failed','cancelled_local','needs_reauth'].includes(r.state)&&r.submission_state==='not_submitted';
export type SetupMetadata=Readonly<{encryption_configured:boolean;configured:Readonly<Record<string,boolean>>;source:Readonly<Record<string,string>>;environment:Readonly<Record<string,boolean>>}>;
export class SettingsRequestError extends Error{constructor(readonly status:number){super('Settings request was not confirmed')}}
export class RebuildSubmissionUnknown extends SettingsRequestError { constructor(readonly command_id?:string){super(409)} }
const record=(v:unknown)=>{if(!isRecord(v))throw Error('Invalid response');return v};
const str=(v:unknown)=>{if(typeof v!=='string')throw Error('Invalid text');return v};
const id=(v:unknown)=>{const s=str(v);if(!s||s.length>500||[...s].some(c=>c.charCodeAt(0)<32))throw Error('Invalid identity');return s};
const count=(v:unknown)=>{if(!Number.isSafeInteger(v)||Number(v)<0)throw Error('Invalid count');return v as number};
const nullable=(v:unknown)=>v===null?null:str(v);
const bool=(v:unknown)=>{if(typeof v!=='boolean')throw Error('Invalid flag');return v};
const list=(v:unknown)=>{if(!Array.isArray(v))throw Error('Invalid list');return v as unknown[]};
const safeReason=(v:unknown)=>{const s=nullable(v);return s?.match(/^[A-Z][A-Z0-9_]{0,80}/)?.[0]??null};
export function parseSetupMetadata(status:unknown,environment:unknown):SetupMetadata{
 const r=record(status),c=record(r.configured),s=record(r.source),e=record(environment);
 return Object.freeze({encryption_configured:bool(r.encryption_configured),configured:Object.freeze(Object.fromEntries(Object.entries(c).map(([k,v])=>[k,bool(v)]))),source:Object.freeze(Object.fromEntries(Object.entries(s).map(([k,v])=>[k,str(v)]))),environment:Object.freeze(Object.fromEntries(Object.entries(e).map(([k,v])=>[k,bool(v)])))});
}
export function parseCapabilities(value:unknown):readonly ConnectionCapability[]{const r=record(value);str(r.sdk_version);str(r.adapter_version);return Object.freeze(list(r.operations).map(v=>{const x=record(v);return Object.freeze({name:id(x.name),support:id(x.support),reason:safeReason(x.reason),last_verified_at:nullable(x.last_verified_at),sdk_version:str(x.sdk_version),adapter_version:str(x.adapter_version)})}))}
export function parseLoginFlow(value:unknown):LoginFlow{const r=record(value),expires_at=id(r.expires_at);if(!Number.isFinite(Date.parse(expires_at)))throw Error('Invalid expiry');return Object.freeze({flow_id:id(r.flow_id),state:id(r.state),expires_at,reason:r.reason==='Login flow expired. Start reconnect to try again.'?'expired':r.reason==='This runtime has no approved visible persistent browser profile for Google login. An operator must provide the dedicated runtime browser; do not paste passwords, codes or cookies into this app.'?'manual':'unknown'})}
async function createHash(title:string){const data=JSON.stringify({operation:'create_notebook',request:{title}});const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data));return [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('')}
export async function parseCreateReceipt(value:unknown,input:{notebook_id:string;title:string;idempotency_key:string}):Promise<CreateReceipt>{
 const r=record(value),request=record(r.request_snapshot),hash=await createHash(input.title);
 if(r.restored_history===true||r.replay_allowed===false||r.projection_status||r.notebook_id!==input.notebook_id||r.operation!=='create_notebook'||r.provider!=='notebooklm'||r.idempotency_key!==input.idempotency_key||r.request_hash!==hash||Object.keys(request).length!==1||request.title!==input.title)throw Error('Unmatched original job');
 const state=id(r.state),submission_state=nullable(r.submission_state);
 if(!['queued','running','waiting_remote','succeeded','failed','needs_reauth','submission_unknown','cancelled_local'].includes(state)||!['not_submitted','confirmed','unknown',null].includes(submission_state))throw Error('Unknown job lifecycle');
 if(state==='succeeded'&&submission_state!=='confirmed')throw Error('Unconfirmed completion');
 const remote=state==='succeeded'&&submission_state==='confirmed'?id(record(r.result).remote_notebook_id):null;
 return Object.freeze({job_id:id(r.job_id),state,submission_state,remote_notebook_id:remote,request_hash:hash,notebook_id:input.notebook_id,title:input.title,idempotency_key:input.idempotency_key});
}
export function createSettingsApi(transport:WebTransport){
 async function request(method:string,path:string,context:DispatchContext,body?:unknown,options?:{signal?:AbortSignal;operationKey?:string;rebuild?:boolean}){
 const c=freezeDispatchContext(context),g=sessionCoordinator.current();if(!canDispatch(c,readTurnContext()))throw new RequestNotDispatchedError('superseded');
 const response=await transport.send({method,path,context:c,...(body!==undefined?{body:JSON.stringify(body)}:{}),...(options?.signal?{signal:options.signal}:{}),...(options?.operationKey?{operationKey:options.operationKey}:{})});
 if(!canDispatch(c,readTurnContext())||g!==sessionCoordinator.current()){void response.body?.cancel();throw new TransportResponseError('retired')}
 if(!response.ok){if(options?.rebuild&&response.status===409){const unknown=await rebuildUnknown(response);if(!canDispatch(c,readTurnContext())||g!==sessionCoordinator.current())throw new TransportResponseError('retired');if(unknown)throw new RebuildSubmissionUnknown(unknown.command_id)}else void response.body?.cancel();throw new SettingsRequestError(response.status)}
 const result:unknown=await response.json();if(!canDispatch(c,readTurnContext())||g!==sessionCoordinator.current())throw new TransportResponseError('retired');return result;
 }
 const notebook=(n:string)=>'/notebooks/'+encodeURIComponent(n);
 const connection='/personal/connections/notebooklm';
 return Object.freeze({
async transformations(c: DispatchContext) { return transformation.parseTransformations(await request('GET','/transformations',c)); },
async transformation(id: string,c: DispatchContext) {
 const expected=transformation.transformationId(id),value=transformation.parseTransformation(await request('GET','/transformations/'+encodeURIComponent(expected),c));
 if(value.id!==expected)throw Error('Mismatched transformation');return value;
},
async transformationInstructions(c: DispatchContext) { return transformation.parseTransformationInstructions(await request('GET','/transformations/default-prompt',c)); },
async saveTransformationInstructions(value: string,c: DispatchContext,key: string) {
 const result=transformation.parseTransformationInstructions(await request('PUT','/transformations/default-prompt',c,{transformation_instructions:value},{operationKey:key}));
 if(result!==value)throw Error('Unconfirmed instructions');return result;
},
async createTransformation(input: transformation.TransformationFields,c: DispatchContext,key: string) {
 const body=transformation.transformationBody(input,true);
 return transformation.matchTransformation(await request('POST','/transformations',c,body,{operationKey:key}),body);
},
async updateTransformation(id: string,input: transformation.TransformationPatch,c: DispatchContext,key: string) {
 const body=transformation.transformationBody(input),expected=transformation.transformationId(id);
 return transformation.matchTransformation(await request('PUT','/transformations/'+encodeURIComponent(expected),c,body,{operationKey:key}),body,expected);
},
async deleteTransformation(id: string,c: DispatchContext,key: string) {
 const value=record(await request('DELETE','/transformations/'+encodeURIComponent(transformation.transformationId(id)),c,undefined,{operationKey:key}));
 str(value.message);return Object.freeze({deleted:true as const});
},
async executeTransformation(input: transformation.ExecuteTransformation,c: DispatchContext,key: string) {
 if(!input.input_text.trim())throw new RequestNotDispatchedError('configuration');
 const body=Object.freeze({transformation_id:transformation.transformationId(input.transformation_id),input_text:input.input_text,model_id:transformation.transformationId(input.model_id)});
 return transformation.parseTransformationOutput(await request('POST','/transformations/execute',c,body,{operationKey:key}),body);
},
async semanticStatus(notebookId:string, selected:readonly string[], c:DispatchContext) {
 const n=retrieval.identity(notebookId),v=retrieval.versions(selected),q=new URLSearchParams();
 v.forEach(id=>q.append('source_version_ids',id));
 return retrieval.parseStatus(await request('GET','/personal/notebooks/'+encodeURIComponent(n)+'/semantic-index?'+q,c),n,v);
},
async indexPreview(notebookId:string, selected:readonly string[], profile:retrieval.SemanticProfile,c:DispatchContext) {
 const n=retrieval.identity(notebookId),v=retrieval.versions(selected);
 return retrieval.parsePreview(await request('POST','/personal/notebooks/'+encodeURIComponent(n)+'/semantic-index/preview',c,{source_version_ids:v,profile_id:profile.profile_id}),n,v,profile);
},
async indexBuild(preview:retrieval.Preview,input:retrieval.IndexRequest,c:DispatchContext,key:string) {
 const n=retrieval.identity(preview.snapshot.notebook_id),body=retrieval.indexBody(input);
 return retrieval.parseReceipt(await request('POST','/personal/notebooks/'+encodeURIComponent(n)+'/semantic-index',c,body,{operationKey:key}),preview);
},
async indexJob(owned:retrieval.IndexOwned,jobId:string,c:DispatchContext,cancel=false) {
 if(jobId!==owned.receipt.group_id&&!owned.receipt.job_ids.includes(jobId))throw new RequestNotDispatchedError('configuration');
 return retrieval.parseIndexJob(await request(cancel?'POST':'GET','/personal/jobs/'+encodeURIComponent(retrieval.identity(jobId))+(cancel?'/cancel':''),c),owned,jobId);
},
async maintain(input:retrieval.MaintenanceRequest,c:DispatchContext) {
 const body=input.operation==='reparse'?{idempotency_key:input.idempotency_key}:{extraction_id:input.extractionId,idempotency_key:input.idempotency_key};
 return retrieval.parseMaintenance(await request('POST','/personal/source-versions/'+encodeURIComponent(retrieval.identity(input.versionId))+'/'+input.operation,c,body,{operationKey:input.idempotency_key}),input);
},
async maintenanceJob(input:retrieval.MaintenanceRequest,job:retrieval.MaintenanceJob,c:DispatchContext) {
 const result = await retrieval.parseMaintenance(await request('GET','/personal/jobs/'+encodeURIComponent(retrieval.identity(job.job_id)),c),input,job.job_id);
 if (result.fresh_extraction_id !== job.fresh_extraction_id) throw new Error('Invalid semantic evidence');
 return result;
},
async contentSettings(c: DispatchContext) { return cfg.parseContent(await request('GET', '/settings', c)); },
async saveContentSettings(input: cfg.ContentSettings, c: DispatchContext, key: string) {
    const fields = Object.keys(input);
    if (!fields.length || fields.some(k => !cfg.contentKeys.includes(k as cfg.ContentKey) || !cfg.validContent(k as cfg.ContentKey, input[k as cfg.ContentKey])))
        throw new RequestNotDispatchedError('configuration');
    const result = cfg.parseContent(await request('PUT', '/settings', c, input, { operationKey: key }));
    if (fields.some(k => result[k as cfg.ContentKey] !== input[k as cfg.ContentKey]))
        throw Error('Unconfirmed content save');
    return result;
},
async extractionCapabilities(c: DispatchContext) { return cfg.parseCapabilities(await request('GET', '/capabilities', c)); },
async webSearchStatus(c: DispatchContext) { return cfg.parseWebSearch(await request('GET', '/personal/web-search/status', c)); },
async providers(c: DispatchContext) { return cfg.parseProviders(await request('GET', '/providers', c)); },
async credentialsMetadata(c: DispatchContext) { return cfg.parseCredentials(await request('GET', '/credentials', c)); },
async models(c: DispatchContext) { return cfg.parseModels(await request('GET', '/models', c)); },
async modelDefaults(c: DispatchContext) { return cfg.parseDefaults(await request('GET', '/models/defaults', c)); },
async saveModelDefault(field: cfg.DefaultKey, value: string | null, c: DispatchContext, key: string) {
    if (!cfg.defaultKeys.includes(field) || value === null && cfg.requiredDefaults.includes(field))
        throw new RequestNotDispatchedError('configuration');
    if (value !== null)
        cfg.identity(value);
    const result = cfg.parseDefaults(await request('PUT', '/models/defaults', c, { [field]: value }, { operationKey: key }));
    if (result[field] !== value)
        throw Error('Unconfirmed default save');
    return result;
},
async saveCredential(id: string | null, input: cfg.CredentialWrite, c: DispatchContext, key: string) {
    if (id !== null && Object.hasOwn(input, 'provider'))
        throw new RequestNotDispatchedError('configuration');
    const result = await request(id === null ? 'POST' : 'PUT', id === null ? '/credentials' : '/credentials/' + encodeURIComponent(cfg.identity(id)), c, input, { operationKey: key });
    const parsed = cfg.parseCredential(result);
    if (id !== null && parsed.id !== id)
        throw Error('Unconfirmed credential save');
    const privateValues = [input.api_key, ...cfg.privateFields.map(f => input[f])].filter((s): s is string => typeof s === 'string' && !!s);
    if (privateValues.some(value => JSON.stringify(parsed).includes(value)))
        throw Error('Unsafe credential response');
    return Object.freeze({ id: parsed.id });
},
async testCredential(id: string, c: DispatchContext, key: string) { return cfg.parseTest(await request('POST', '/credentials/' + encodeURIComponent(cfg.identity(id)) + '/test', c, undefined, { operationKey: key })); },
async discoverCredentialModels(id: string, provider: string, c: DispatchContext, key: string) { return cfg.parseDiscovery(await request('POST', '/credentials/' + encodeURIComponent(cfg.identity(id)) + '/discover', c, undefined, { operationKey: key }), id, provider); },
async registerCredentialModels(id: string, models: readonly cfg.Registration[], c: DispatchContext, key: string) {
    if (!models.length || models.some(m => !m.name.trim() || !cfg.modelTypes.includes(m.model_type)))
        throw new RequestNotDispatchedError('configuration');
    return cfg.parseRegistration(await request('POST', '/credentials/' + encodeURIComponent(cfg.identity(id)) + '/register-models', c, { models }, { operationKey: key }));
},
async deleteCredential(id: string, migrateTo: string | null, c: DispatchContext, key: string) {
    const suffix = migrateTo === null ? '' : '?migrate_to=' + encodeURIComponent(cfg.identity(migrateTo));
    return cfg.parseDeletion(await request('DELETE', '/credentials/' + encodeURIComponent(cfg.identity(id)) + suffix, c, undefined, { operationKey: key }), true);
},
async migrateEnvironment(c: DispatchContext, key: string) { return cfg.parseMigration(await request('POST', '/credentials/migrate-from-env', c, undefined, { operationKey: key })); },
async testModel(id: string, c: DispatchContext, key: string) { return cfg.parseTest(await request('POST', '/models/' + encodeURIComponent(cfg.identity(id)) + '/test', c, undefined, { operationKey: key })); },
async deleteModel(id: string, c: DispatchContext, key: string) { return cfg.parseDeletion(await request('DELETE', '/models/' + encodeURIComponent(cfg.identity(id)), c, undefined, { operationKey: key }), false); },
async autoAssignDefaults(c: DispatchContext, key: string) { return cfg.parseAutoAssign(await request('POST', '/models/auto-assign', c, undefined, { operationKey: key })); },
 async rebuild(input:RebuildRequest,c:DispatchContext,operationKey:string){if(!validRebuildRequest(input))throw new RequestNotDispatchedError('configuration');return parseRebuildReceipt(await request('POST','/embeddings/rebuild',c,{mode:input.mode,include_sources:input.include_sources,include_notes:input.include_notes,include_insights:input.include_insights},{operationKey,rebuild:true}))},
 async rebuildStatus(id:string,c:DispatchContext,signal?:AbortSignal){const expected=commandId(id);return parseRebuildStatus(await request('GET','/embeddings/rebuild/'+encodeURIComponent(expected)+'/status',c,undefined,{...(signal?{signal}:{})}),expected)},
 async version(c:DispatchContext,signal?:AbortSignal){return parseApiVersion(await request('GET','/config',c,undefined,{...(signal?{signal}:{})}))},
 async notebook(n:string,c:DispatchContext){const v=parseNotebookSummary(await request('GET',notebook(n),c));if(v.id!==n)throw Error('Mismatched notebook');return v},
 async update(n:string,input:NotebookPatch,c:DispatchContext):Promise<NotebookSummary>{const v=parseNotebookSummary(await request('PUT',notebook(n),c,input));if(v.id!==n)throw Error('Mismatched notebook');return v},
 async preview(n:string,c:DispatchContext):Promise<DeletePreview>{const r=record(await request('GET',notebook(n)+'/delete-preview',c));if(r.notebook_id!==n)throw Error('Mismatched preview');return Object.freeze({notebook_id:n,notebook_name:str(r.notebook_name),note_count:count(r.note_count),exclusive_source_count:count(r.exclusive_source_count),shared_source_count:count(r.shared_source_count)})},
 async remove(n:string,exclusive:boolean,c:DispatchContext):Promise<DeleteReceipt>{const r=record(await request('DELETE',notebook(n)+'?delete_exclusive_sources='+String(exclusive),c));str(r.message);return Object.freeze({deleted_notes:count(r.deleted_notes),deleted_sources:count(r.deleted_sources),unlinked_sources:count(r.unlinked_sources),deleted_chat_sessions:count(r.deleted_chat_sessions)})},
 async setup(c:DispatchContext){const [s,e]=await Promise.all([request('GET','/credentials/status',c),request('GET','/credentials/env-status',c)]);return parseSetupMetadata(s,e)},
 async connect(reconnect:boolean,c:DispatchContext){return parseLoginFlow(await request('POST',connection+(reconnect?'/reconnect':'/connect'),c))},
 async flow(flowId:string,c:DispatchContext){const v=parseLoginFlow(await request('GET',connection+'/connect/'+encodeURIComponent(flowId),c));if(v.flow_id!==flowId)throw Error('Mismatched flow');return v},
 async disconnect(c:DispatchContext){const v=parseProviderStatus(await request('DELETE',connection,c));if(v?.state!=='disconnected')throw Error('Unconfirmed disconnect');return v},
 async capabilities(c:DispatchContext){return parseCapabilities(await request('GET','/personal/notebooklm/capabilities',c))},
 async notebooks(cursor:string|null,c:DispatchContext):Promise<NotebookPage>{const r=record(await request('GET','/personal/notebooklm/notebooks'+(cursor===null?'':'?cursor='+encodeURIComponent(cursor)),c));return Object.freeze({items:Object.freeze(list(r.items).map(v=>{const x=record(v);return Object.freeze({id:id(x.id),title:str(x.title)})})),next_cursor:r.next_cursor===null?null:id(r.next_cursor),listing_complete:bool(r.listing_complete),completeness_note:nullable(r.completeness_note)})},
 async link(n:string,remoteId:string,c:DispatchContext){const r=record(await request('POST','/personal/notebooks/'+encodeURIComponent(n)+'/notebooklm-link',c,{remote_notebook_id:remoteId}));if(r.notebook_id!==n||r.remote_notebook_id!==remoteId||r.connection_id!=='notebooklm')throw Error('Mismatched link');id(r.link_id);str(r.last_checked_at);return Object.freeze({notebook_id:n,remote_notebook_id:remoteId})},
 async create(input:{notebook_id:string;title:string;idempotency_key:string},c:DispatchContext){return parseCreateReceipt(await request('POST','/personal/notebooklm/notebooks',c,input),input)},
 async observe(receipt:CreateReceipt,c:DispatchContext){if(!canObserveCreate(receipt))throw new RequestNotDispatchedError('configuration');const next=await parseCreateReceipt(await request('GET','/personal/jobs/'+encodeURIComponent(receipt.job_id),c),receipt);if(next.job_id!==receipt.job_id)throw Error('Mismatched job');return next}
 });
}
export type SettingsApi=ReturnType<typeof createSettingsApi>;
