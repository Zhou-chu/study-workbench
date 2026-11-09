import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { sourceContext } from '../test/source-fixtures';
import { profile, preview, receipt, status } from '../test/retrieval-fixtures';
import { indexBody, parseProfile, parsePreview, parseReceipt, parseStatus, parseIndexJob, parseMaintenance, disclosure, versions, type IndexRequest } from './retrieval-contracts';
const p=()=>parsePreview(preview,'n',['v-old'],parseProfile(profile));
const request:IndexRequest={source_version_ids:['v-old'],profile_id:'p',preview_hash:preview.preview_hash,acknowledge_external_processing:true,idempotency_key:'original',retry_of_job_id:null,acknowledge_duplicate_embedding_cost:false};
function hash(v:unknown):string {
 const json=(x:unknown):string=>Array.isArray(x)?'['+x.map(json).join(', ')+']':x&&typeof x==='object'?'{'+Object.entries(x).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+': '+json(v)).join(', ')+'}':JSON.stringify(x);
 return createHash('sha256').update(json(v)).digest('hex');
}
function child() {
 return {...receipt.jobs[0],job_id:'child',group_id:'group',operation:'index_evidence',notebook_id:'n',source_version_id:'v-old',extraction_id:'ex-old',
 scope_snapshot:preview.snapshot,version_snapshot:preview.snapshot,profile:Object.fromEntries(Object.entries(profile).filter(([k])=>!['fingerprint','endpoint_fingerprint'].includes(k))),
 profile_id:'p',profile_fingerprint:profile.fingerprint,disclosed_profile_fingerprint:profile.fingerprint,destination_descriptor_version:profile.destination_descriptor_version,
 preview_hash:preview.preview_hash,request_hash:hash({notebook_id:'n',...request}),request_snapshot:request,idempotency_key:'original',submission_state:'unknown'};
}
const owned=()=>({preview:p(),request,receipt:parseReceipt(receipt,p())});
it('T01-T05 preserves explicit unknown destination but rejects unsafe or missing profile evidence',()=>{
 expect(disclosure(parseProfile(profile))).toMatchObject({destination_kind:'unknown'});
 expect(disclosure(parseProfile({...profile,destination_kind:'future'}))).toBeNull();
 for(const patch of [{endpoint:'http://user:secret@localhost/'},{endpoint:'https://host/path?token=private'},{endpoint:'file:///private'},{fingerprint:null},{destination_descriptor_version:''},{dimension:0}])
  expect(()=>parseProfile({...profile,...patch})).toThrow();
 expect(()=>parseStatus({...status,enabled:null},'n',['v-old'])).toThrow();
});
it('T05 bounds exact unique preview versions to one through twenty',()=>{
 expect(()=>versions([])).toThrow();expect(()=>versions(Array.from({length:21},(_,i)=>'v'+i))).toThrow();
 expect(()=>versions(['v','v'])).toThrow();expect(()=>versions(['v/path'])).toThrow();
 expect(versions(Array.from({length:20},(_,i)=>'v'+i))).toHaveLength(20);
 expect(()=>parsePreview({...preview,extra:'ignored safely'},'other',['v-old'],parseProfile(profile))).toThrow();
});
it.each([
 {jobs:[]},{job_ids:['other']},{jobs:[receipt.jobs[0],receipt.jobs[0]]},{profile_fingerprint:'b'.repeat(64)},
 {jobs:[{...receipt.jobs[0],source_version_id:'other'}]},{jobs:[{...receipt.jobs[0],total_evidence:4}]},
 {state:'succeeded'},{retry_safe:true},{remote_cancel_confirmed:true},{restored_history:true},
])('T09 rejects incomplete, mismatched or unsafe admission evidence (%j)',patch=>{
 expect(()=>parseReceipt({...receipt,...patch},p())).toThrow();
});
it('T10/T12 validates the exact live nonreplay group exception and refuses restored history',async()=>{
 sourceContext();const o=owned();
 const group={job_id:'group',group_id:'group',notebook_id:'n',operation:'index_evidence_group',request_hash:hash({notebook_id:'n',...request}),
 replay_allowed:false,version_ids:['v-old'],job_ids:['child'],receipt,jobs:receipt.jobs,state:receipt.state,retry_safe:false,remote_cancel_confirmed:false};
 await expect(parseIndexJob(group,o,'group')).resolves.toMatchObject({group_id:'group'});
 for(const patch of [{restored_history:true},{replay_allowed:true},{job_ids:['unowned']},{version_ids:['wrong']},{operation:'future'}])
  await expect(parseIndexJob({...group,...patch},o,'group')).rejects.toThrow();
 await expect(parseIndexJob(child(),o,'unowned')).rejects.toThrow();
});
it.each([{restored_history:true},{replay_allowed:false},{restored_history:'false'},{replay_allowed:'true'},
 {profile_fingerprint:'c'.repeat(64)},{extraction_id:'other'},{request_hash:'d'.repeat(64)},
 {request_snapshot:{...request,idempotency_key:'new'}},{submission_state:'future'}])('T10/T13 rejects child provenance, identity or lifecycle mismatch (%j)',async patch=>{
 sourceContext();await expect(parseIndexJob({...child(),...patch},owned(),'child')).rejects.toThrow();
});
it('T10 never treats a compatible result from another attempt as this child completion',async()=>{
 sourceContext();const value={...child(),state:'succeeded',submission_state:'confirmed',completed_evidence:2,result:{state:'ready',attempt_id:'other'}};
 await expect(parseIndexJob(value,owned(),'child')).rejects.toThrow();
 await expect(parseIndexJob({...value,result:{state:'ready',attempt_id:'child'}},owned(),'child')).resolves.toMatchObject({state:'succeeded'});
});
it('T15/T16 preserves zero and partial counts, rejects foreign maintenance jobs and keeps exact historical extraction',async()=>{
 sourceContext();const original={notebookId:'n',versionId:'v-old',extractionId:'x-old',operation:'revalidate' as const,idempotency_key:'maintenance'};
 const job={job_id:'j',notebook_id:'n',source_version_id:'v-old',extraction_id:'x-old',fresh_extraction_id:'x-fresh',operation:'revalidate',idempotency_key:'maintenance',
 request_hash:hash({extraction_id:'x-old',operation:'revalidate'}),state:'succeeded',remote_may_continue:false,
 result:{source_version_id:'v-old',extraction_id:'x-old',fresh_extraction_id:'x-fresh',checked_count:2,verified_count:1,unverified_count:1}};
 await expect(parseMaintenance(job,original,'j')).resolves.toMatchObject({result:{checked_count:2,verified_count:1,unverified_count:1}});
 for(const patch of [{extraction_id:'latest'},{operation:'reparse'},{idempotency_key:'new'},{restored_history:true},{replay_allowed:false},{remote_may_continue:true},{request_hash:'a'.repeat(64)}])
  await expect(parseMaintenance({...job,...patch},original,'j')).rejects.toThrow();
 await expect(parseMaintenance(job,original,'unowned')).rejects.toThrow();
 await expect(parseMaintenance({...job,result:{...job.result,checked_count:0,verified_count:0,unverified_count:0}},original,'j')).resolves.toMatchObject({result:{checked_count:0,verified_count:0,unverified_count:0}});
 await expect(parseMaintenance({...job,result:{...job.result,unverified_count:3}},original,'j')).rejects.toThrow();
});

it('T08 rejects a duplicate-cost flag without an exact single-version retry reference',()=>{expect(()=>indexBody({...request,acknowledge_duplicate_embedding_cost:true})).toThrow();expect(()=>indexBody({...request,retry_of_job_id:'old',source_version_ids:['v-old','other'],acknowledge_duplicate_embedding_cost:true})).toThrow();expect(()=>indexBody({...request,retry_of_job_id:'old',acknowledge_duplicate_embedding_cost:false})).toThrow();});
