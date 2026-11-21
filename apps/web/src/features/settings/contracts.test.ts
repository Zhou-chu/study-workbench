import {beforeEach,expect,it} from 'vitest';
import {canObserveCreate,canStartCreateSuccessor,parseSetupMetadata,parseCreateReceipt,createSettingsApi,parseLoginFlow,SettingsRequestError} from '../../data/settings-api';
import {parseProviderStatus} from '../../data/provider-status';
import {sourceContext} from '../../test/source-fixtures';
import {json} from '../../test/notebook-fixtures';
import {readTurnContext} from '@study/web-transport';
import {createHash} from 'node:crypto';
import {settingsMessages} from '../../i18n/settings-messages';
import {languages} from '../../i18n';
beforeEach(sourceContext);
it('projects setup metadata without credential paths, keys, or raw decryption errors',()=>{
 const out=parseSetupMetadata({encryption_configured:false,configured:{fixture:true},source:{fixture:'environment'},credentials_path:'/private',decryption_error:'private',api_key:'secret'},{fixture:true});
 expect(out).toEqual({encryption_configured:false,configured:{fixture:true},source:{fixture:'environment'},environment:{fixture:true}});
 expect(JSON.stringify(out)).not.toMatch(/private|secret/);expect(()=>parseSetupMetadata({},{})).toThrow();
});
it('preserves zero versus null quota and rejects negative or malformed quota without copying opaque fields',()=>{
 expect(parseProviderStatus({state:'connected',quota:0})).toMatchObject({quota:0});expect(parseProviderStatus({state:'connected',quota:null})).toMatchObject({quota:null});
 expect(()=>parseProviderStatus({state:'connected',quota:-1})).toThrow();
 expect(parseProviderStatus({state:'future',reason:'secret URL /private',credential:'secret'})).toEqual({state:'future',reason:null});
});
it('does not create a URL from a manual flow or retain arbitrary operator diagnostics',()=>{
 expect(parseLoginFlow({flow_id:'f',state:'unavailable',expires_at:'2026-11-09T00:00:00Z',reason:'do not paste credentials',url:'https://invalid.test'})).not.toHaveProperty('url');
 expect(()=>parseLoginFlow({flow_id:'f',state:'connected',expires_at:'not-time'})).toThrow();
});
const input={notebook_id:'n',title:'标题',idempotency_key:'original'};
const hash=createHash('sha256').update(JSON.stringify({operation:'create_notebook',request:{title:input.title}})).digest('hex');
const receipt={job_id:'owned-job',notebook_id:'n',operation:'create_notebook',provider:'notebooklm',idempotency_key:'original',request_hash:hash,request_snapshot:{title:input.title},state:'waiting_remote',submission_state:'confirmed'};
it('requires exact original create proof before admitting any dispatch-capable job observation',async()=>{
 for(const patch of [{restored_history:true},{replay_allowed:false},{request_hash:'wrong'},{notebook_id:'other'},{operation:'audio'},{provider:'other'},{idempotency_key:'other'},{request_snapshot:{title:'other'}},{state:'future'},{state:'succeeded',submission_state:'unknown',result:{remote_notebook_id:'not-confirmed'}}])await expect(parseCreateReceipt({...receipt,...patch},input)).rejects.toThrow();
 const parsed=await parseCreateReceipt(receipt,input);const requests:{path:string;method:string}[]=[];
 const api=createSettingsApi({send:async r=>{requests.push(r);return json({...receipt,state:'succeeded',result:{remote_notebook_id:'new-remote'}})}});
 expect(await api.observe(parsed,readTurnContext()!)).toMatchObject({remote_notebook_id:'new-remote'});expect(requests).toEqual([expect.objectContaining({method:'GET',path:'/personal/jobs/owned-job'})]);
 await expect(api.observe({...parsed,submission_state:'unknown'},readTurnContext()!)).rejects.toThrow();expect(requests).toHaveLength(1);
});
it.each([400,404,409,422,429])('retains exact HTTP %s without raw server body in errors',async status=>{
 const api=createSettingsApi({send:async()=>json({detail:'private path and secret'},status)});
 await expect(api.preview('n',readTurnContext()!)).rejects.toEqual(new SettingsRequestError(status));
});
it('has an explicit complete B9a translation set for every current locale',()=>{
 expect(Object.keys(settingsMessages).sort()).toEqual(languages.map(l=>l.code).sort());const keys=Object.keys(settingsMessages['en-US']).sort();
 for(const [locale,messages] of Object.entries(settingsMessages)){expect(Object.keys(messages).sort()).toEqual(keys);expect(Object.values(messages).every(v=>v.trim().length>0)).toBe(true);if(locale!=='en-US')expect(messages.manual).not.toBe(settingsMessages['en-US'].manual)}
});

it('keeps unknown submission non-actionable and permits only the producer-supported original observation and terminal successor combinations',async()=>{
 const parsed=await parseCreateReceipt(receipt,input);
 for(const state of ['queued','running']){
  expect(canObserveCreate({...parsed,state,submission_state:'not_submitted'})).toBe(true);
  expect(canObserveCreate({...parsed,state,submission_state:'unknown'})).toBe(false);
  expect(canStartCreateSuccessor({...parsed,state,submission_state:'not_submitted'})).toBe(false);
 }
 for(const state of ['failed','cancelled_local','needs_reauth']){
  expect(canStartCreateSuccessor({...parsed,state,submission_state:'not_submitted'})).toBe(true);
  for(const submission_state of ['confirmed','unknown',null])expect(canStartCreateSuccessor({...parsed,state,submission_state})).toBe(false);
 }
 expect(canObserveCreate({...parsed,state:'waiting_remote',submission_state:'not_submitted'})).toBe(false);
 expect(canStartCreateSuccessor({...parsed,state:'submission_unknown',submission_state:'unknown'})).toBe(false);
});
