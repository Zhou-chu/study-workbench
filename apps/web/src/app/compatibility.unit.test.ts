import { expect, it } from 'vitest';
import * as owner from '../features/auth/session';
const local={schema_version:'spa-artifact-v1' as const,source_commit:'a'.repeat(40),authored_digest:'b'.repeat(64),asset_digest:'c'.repeat(64),contract_digest:'d'.repeat(64),ui_transport_protocol:1 as const,supported_contracts:['workspace-view-v1'] as ['workspace-view-v1']};
const config={apiUrl:'',auth_mode:'legacy_password',web_session_protocol:null,ui_transport_protocol:1,client_contracts:['workspace-view-v1']};
const caps={contract_version:'client-capabilities-v1',supported_contracts:['workspace-view-v1'],limits:{source_upload_max_bytes:50,portable:{max_archive_bytes:10,max_expanded_bytes:20,max_entity_bytes:10,max_manifest_bytes:10,max_request_bytes:30,multipart_overhead_bytes:10,max_entries:2,max_compression_ratio:5}}};

it('evaluates real BFF and authenticated API evidence independently',()=>{
 expect(typeof owner.evaluateCompatibility).toBe('function');
 expect(owner.evaluateCompatibility(local,config,caps)).toBe('compatible');
 expect(owner.evaluateCompatibility(local,{...config,ui_transport_protocol:2},caps)).toBe('blocked');
 expect(owner.evaluateCompatibility(local,config,{...caps,supported_contracts:[]})).toBe('blocked');
 expect(owner.evaluateCompatibility(local,config,null)).toBe('unavailable');
 expect(owner.evaluateCompatibility(null,config,caps)).toBe('unavailable');
});

it('rejects affirmative malformed evidence rather than trusting contract-name strings alone',()=>{
 expect(owner.evaluateCompatibility(local,{...config,apiUrl:'https://evil.test'},caps)).toBe('blocked');
 expect(owner.evaluateCompatibility(local,config,{contract_version:'client-capabilities-v1',supported_contracts:['workspace-view-v1']})).toBe('blocked');
});
