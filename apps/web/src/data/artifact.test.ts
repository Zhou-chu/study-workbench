import {expect,it,vi} from 'vitest';
vi.unmock('./artifact');
import * as artifact from './artifact';
const identity={release_slot:'synthetic-release-001',source_commit:'a'.repeat(40),authored_digest:'b'.repeat(64),contract_digest:'d'.repeat(64),ui_transport_protocol:1 as const,supported_contracts:['workspace-view-v1'] as ['workspace-view-v1']};
const manifest={schema_version:'spa-artifact-v1',...identity,asset_digest:'c'.repeat(64)};
const {release_slot:unused,...local}=manifest;void unused;
it('reads only its immutable same-origin release manifest and checks association',async()=>{
 const requests:Request[]=[];
 vi.stubGlobal('fetch',vi.fn(async(r:Request)=>{requests.push(r);return new Response(JSON.stringify(local),{headers:{'Content-Type':'application/json'}});}));
 const load=artifact.createArtifactIdentity(identity);
 expect(await load()).toEqual(local);
 expect(new URL(requests[0]!.url).pathname).toBe('/_spa/releases/synthetic-release-001/spa-artifact-manifest.json');
 expect(requests[0]!.cache).toBe('no-store');expect(requests[0]!.redirect).toBe('error');expect(requests[0]!.credentials).toBe('same-origin');
});
it('blocks mismatched or extra local metadata and distinguishes unreadable evidence',async()=>{
 for(const patch of [{source_commit:'e'.repeat(40)},{authored_digest:'f'.repeat(64)},{contract_digest:'f'.repeat(64)},{extra:'unexpected'},{asset_digest:'bad'}]){
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({...local,...patch}),{headers:{'Content-Type':'application/json'}})));
  await expect(artifact.createArtifactIdentity(identity)()).rejects.toBeInstanceOf(artifact.ArtifactMismatchError);
 }
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('not found',{status:404})));
 await expect(artifact.createArtifactIdentity(identity)()).rejects.not.toBeInstanceOf(artifact.ArtifactMismatchError);
});
it('fails closed without embedded identity and never reads a latest manifest',async()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 await expect(artifact.createArtifactIdentity(null)()).rejects.toThrow();
 expect(fetch).not.toHaveBeenCalled();
});
